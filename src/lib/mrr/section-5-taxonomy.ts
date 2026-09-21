/**
 * MRR Block 5 — §5 Taxonomy.
 *
 * Pipeline (WEEKEND.md Block 5):
 *   derive_company_keywords → select coverage keyword (DETERMINISTIC, recorded)
 *   → get_keyword_coverage → measured coverage set + supplied NAICS/PSC → SBA size standard.
 *
 * Two contract corrections are load-bearing here:
 *  1. `derive_company_keywords` returns KEYWORD PHRASES, not NAICS/PSC codes.
 *     The dev spec's claim that it yields candidate codes is wrong. It is used
 *     ONLY to improve search vocabulary. Coverage MEASURES a NAICS/PSC distribution;
 *     it does not establish market identity. Primary codes come from the requirement.
 *  2. Coverage is phrase-sensitive by design (USASpending keyword search is
 *     exact-phrase). Measured on the DHA notice: "medical modeling and
 *     simulation" → $1.1M/1 NAICS, but "joint medical planning" → $16.6B/288.
 *     A human picking the flattering number is the failure mode, so the
 *     selection RULE is fixed in code and the selected phrase plus the rule are
 *     both recorded and rendered.
 */
import type { GroundedField, Requirement } from './types';
import { callTool, metaDegraded, metaGrounded, type ToolCall } from './mindy-client';
import { degraded, evidence, unknown, unknownFromError, value } from './grounding';
import { formatSizeStandard, sizeStandardFor, tableCitation, type SizeStandard } from './sba-size-standards';
import {
  marketScopeFromRequirement,
  retrievalManifest,
  type RetrievalManifest,
} from './market-scope';

export interface NaicsShare { code: string; name: string; amount: number; pct: number }

export interface Section5 {
  /** The keyword actually sent to coverage, plus WHY it was chosen. */
  coverageKeyword: GroundedField<string>;
  selectionRule: string;
  derivedKeywords: GroundedField<string[]>;
  primaryNaics: GroundedField<string>;
  /** 'supplied' when the requirement carried it; 'derived' when coverage produced it. */
  primaryNaicsOrigin: 'supplied' | 'derived' | 'none';
  naicsTitle: GroundedField<string>;
  coverageSet: GroundedField<NaicsShare[]>;
  cumulativeCoveragePct: GroundedField<number>;
  marketTotal: GroundedField<number>;
  /** The measurement basis for marketTotal — a number without it is not a fact. */
  marketBasis: string;
  primaryPsc: GroundedField<string>;
  primaryPscOrigin: 'supplied' | 'derived' | 'none';
  pscTitle: GroundedField<string>;
  sizeStandard: GroundedField<SizeStandard>;
  sizeStandardCitation: string;
  naicsBasis: GroundedField<string>;
  retrievalManifests: RetrievalManifest[];
  calls: ToolCall[];
}

/**
 * Deterministic coverage-keyword selection.
 *
 * RULE (recorded verbatim in the document): use the requirement's own `keyword`
 * verbatim. Derived keywords are recorded as supporting vocabulary but do NOT
 * silently replace it — swapping in a derived phrase would change the measured
 * market without the KO's knowledge, and the phrase sensitivity above shows how
 * large that swing can be.
 */
export const SELECTION_RULE =
  "The requirement's stated keyword is used verbatim. Keywords derived by " +
  'derive_company_keywords are recorded as supporting vocabulary only and never ' +
  'substituted, because USASpending keyword search is exact-phrase and substituting ' +
  'a broader phrase would silently change the measured market.';

export async function buildSection5(req: Requirement): Promise<Section5> {
  const calls: ToolCall[] = [];

  // --- 1. derive_company_keywords: VOCABULARY ONLY, never codes ---
  const kwCall = await callTool('derive_company_keywords', {
    description: req.description,
    code_titles: [req.title],
    limit: 12,
  });
  calls.push(kwCall);

  let derivedKeywords: GroundedField<string[]>;
  if (!kwCall.ok) {
    derivedKeywords = unknownFromError(new Error(kwCall.error ?? 'call failed'), kwCall.evidence);
  } else if (metaGrounded(kwCall.result) === false) {
    derivedKeywords = unknown('derive_company_keywords returned grounded:false', [kwCall.evidence]);
  } else {
    const raw = (kwCall.result as { keywords?: unknown })?.keywords;
    const list = Array.isArray(raw)
      ? raw.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string; phrase?: string })?.keyword ?? (k as { phrase?: string })?.phrase))
          .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      : [];
    derivedKeywords = list.length
      ? value(list, kwCall.evidence)
      : unknown('derive_company_keywords returned no usable keyword phrases', [kwCall.evidence]);
  }

  // --- 2. coverage on the requirement's own keyword (the fixed rule) ---
  const covCall = await callTool('get_keyword_coverage', { keyword: req.keyword });
  calls.push(covCall);

  const coverageKeyword = value(req.keyword, evidence('Requirement intake (operator-supplied)', { keyword: req.keyword }));

  const cov = (covCall.result as { coverage?: Record<string, unknown> })?.coverage;
  const covGrounded = covCall.ok && metaGrounded(covCall.result) === true && !!cov;
  const covDegraded = metaDegraded(covCall.result) === true;

  let coverageSet: GroundedField<NaicsShare[]>;
  let cumulativeCoveragePct: GroundedField<number>;
  let marketTotal: GroundedField<number>;
  let measuredTopPsc: { code: string; name: string } | undefined;

  if (!covCall.ok) {
    const e = new Error(covCall.error ?? 'call failed');
    coverageSet = unknownFromError(e, covCall.evidence);
    cumulativeCoveragePct = unknownFromError(e, covCall.evidence);
    marketTotal = unknownFromError(e, covCall.evidence);
  } else if (covDegraded) {
    const r = 'get_keyword_coverage reported degraded upstream data';
    coverageSet = degraded(r, [covCall.evidence]);
    cumulativeCoveragePct = degraded(r, [covCall.evidence]);
    marketTotal = degraded(r, [covCall.evidence]);
  } else if (!covGrounded) {
    const r = `no grounded coverage for keyword "${req.keyword}"`;
    coverageSet = unknown(r, [covCall.evidence]);
    cumulativeCoveragePct = unknown(r, [covCall.evidence]);
    marketTotal = unknown(r, [covCall.evidence]);
  } else {
    const allNaics = Array.isArray(cov!.allNaics) ? (cov!.allNaics as NaicsShare[]) : [];
    const psc = cov!.topPsc as { code?: string; name?: string } | null | undefined;
    if (psc?.code) measuredTopPsc = { code: psc.code, name: psc.name ?? '' };

    coverageSet = allNaics.length
      ? value(allNaics, covCall.evidence)
      : unknown('coverage returned no NAICS breakdown', [covCall.evidence]);

    const pct = typeof cov!.coveragePct === 'number' ? cov!.coveragePct : undefined;
    cumulativeCoveragePct = pct === undefined
      ? unknown('coverage did not report a cumulative coverage percentage', [covCall.evidence])
      : value(pct, covCall.evidence);

    const total = typeof cov!.totalMarket === 'number' ? cov!.totalMarket : undefined;
    // A measured zero market is possible and must READ as measured, not missing.
    marketTotal = total === undefined
      ? unknown('coverage did not report a market total', [covCall.evidence])
      : total === 0
        ? { state: 'true_zero', value: 0, label: `no obligations matched "${req.keyword}" in the measured window`, evidence: covCall.evidence }
        : value(total, covCall.evidence);
  }

  // --- 3. primary NAICS: supplied only. Coverage shares are a distribution, not identity.
  let primaryNaics: GroundedField<string>;
  let primaryNaicsOrigin: Section5['primaryNaicsOrigin'];
  let naicsTitle: GroundedField<string>;
  if (req.naics) {
    primaryNaics = value(req.naics, evidence('Requirement intake (operator-supplied)', { naics: req.naics }));
    primaryNaicsOrigin = 'supplied';
    const match = (coverageSet.state === 'value' ? coverageSet.value : []).find((n) => n.code === req.naics);
    naicsTitle = match
      ? value(match.name, covCall.evidence)
      : unknown(`no title for NAICS ${req.naics} in the grounded coverage set`, [covCall.evidence]);
  } else {
    primaryNaics = unknown('no NAICS supplied; keyword coverage does not establish market identity', [covCall.evidence]);
    primaryNaicsOrigin = 'none';
    naicsTitle = unknown('no primary NAICS established', [covCall.evidence]);
  }

  // --- 4. primary PSC: supplied only. Coverage top PSC is a measured share, not identity.
  let primaryPsc: GroundedField<string>;
  let primaryPscOrigin: Section5['primaryPscOrigin'];
  let pscTitle: GroundedField<string>;
  if (req.psc) {
    primaryPsc = value(req.psc, evidence('Requirement intake (operator-supplied)', { psc: req.psc }));
    primaryPscOrigin = 'supplied';
    pscTitle = measuredTopPsc && measuredTopPsc.code === req.psc
      ? value(measuredTopPsc.name, covCall.evidence)
      : unknown(`no title for PSC ${req.psc} in the grounded coverage result`, [covCall.evidence]);
  } else {
    primaryPsc = unknown('no PSC supplied; keyword coverage does not establish product identity', [covCall.evidence]);
    primaryPscOrigin = 'none';
    pscTitle = unknown('no primary PSC established', [covCall.evidence]);
  }

  // --- 5. size standard from the versioned fixture ---
  const sizeStandard = sizeStandardFor(primaryNaics.state === 'value' ? primaryNaics.value : undefined);

  // --- 6. the §5 "basis for NAICS selection" the template REQUIRES ---
  // The template says an explanation that only states the code was used on the
  // last procurement is NOT appropriate — so the basis cites the measured
  // market split, or honestly reports that it could not be established.
  let naicsBasis: GroundedField<string>;
  if (primaryNaics.state === 'value' && coverageSet.state === 'value' && marketTotal.state !== 'unknown') {
    const set = coverageSet.value;
    const chosen = set.find((n) => n.code === primaryNaics.value);
    const totalTxt = marketTotal.state === 'value' ? `$${(marketTotal.value / 1e6).toFixed(1)}M` : '$0';
    const sharePart = chosen
      ? `${primaryNaics.value} represents ${(chosen.pct * 100).toFixed(1)}% of that PHRASE market (not the entire NAICS ${primaryNaics.value} federal market)`
      : `${primaryNaics.value} was supplied by the requiring activity and does not appear in the measured coverage set for this keyword`;
    naicsBasis = value(
      `Measured against federal obligations matching the exact phrase "${req.keyword}": ${totalTxt} across ${set.length} NAICS code(s). ${sharePart}. ` +
        'Keyword-coverage dollars are NOT the size of the entire primary-NAICS market and MUST NOT be equated with it. ' +
        `Coverage set (${set.length} code(s)): ${set.map((n) => n.code).join(', ')}.`,
      covCall.evidence,
    );
  } else if (coverageSet.state === 'value' && marketTotal.state !== 'unknown') {
    const set = coverageSet.value;
    const totalTxt = marketTotal.state === 'value' ? `$${(marketTotal.value / 1e6).toFixed(1)}M` : '$0';
    naicsBasis = value(
      `Measured against federal obligations matching the exact phrase "${req.keyword}": ${totalTxt} across ${set.length} NAICS code(s). ` +
        'Coverage NAICS shares are a measured distribution, not a selected market identity. ' +
        `Coverage set (${set.length} code(s)): ${set.map((n) => n.code).join(', ')}.`,
      covCall.evidence,
    );
  } else {
    naicsBasis = unknown('the measured market basis for the NAICS selection could not be established from grounded coverage', [covCall.evidence]);
  }

  const scope = marketScopeFromRequirement(req);
  const coverageCount =
    coverageSet.state === 'value' ? coverageSet.value.length : marketTotal.state === 'true_zero' ? 0 : null;
  const retrievalManifests: RetrievalManifest[] = [
    retrievalManifest({
      section: '5',
      tool: 'get_keyword_coverage',
      requested: scope,
      consumed: { phrase: req.keyword },
      unsupported: {
        ...(scope.department ? { department: 'keyword coverage is not agency-scoped' } : {}),
        ...(scope.service ? { service: 'keyword coverage is not service-scoped' } : {}),
        ...(scope.contractingOffice || scope.contractingOfficeCode
          ? { contracting_office: 'keyword coverage cannot filter contracting office' }
          : {}),
        ...(scope.installation ? { installation: 'keyword coverage cannot filter installation' } : {}),
        ...(scope.geography ? { geography: 'keyword coverage is not geography-scoped' } : {}),
      },
      resultCount: coverageCount,
      grounded: covCall.ok && metaGrounded(covCall.result) === true,
      source: covCall.evidence.source,
      asOf: covCall.evidence.retrievedAt,
      evidenceClass: 'contextual',
    }),
  ];

  return {
    coverageKeyword,
    selectionRule: SELECTION_RULE,
    derivedKeywords,
    primaryNaics,
    primaryNaicsOrigin,
    naicsTitle,
    coverageSet,
    cumulativeCoveragePct,
    marketTotal,
    marketBasis:
      'Federal prime-contract obligations matching the exact keyword phrase, as measured by Mindy get_keyword_coverage over USASpending. ' +
      'Keyword coverage is measured over a single fiscal year and is an exact-phrase match, so it is a lower bound on the addressable PHRASE market. ' +
      'It is not a census of the entire primary-NAICS market and must not be silently equated with one.',
    primaryPsc,
    primaryPscOrigin,
    pscTitle,
    sizeStandard,
    sizeStandardCitation: tableCitation(),
    naicsBasis,
    retrievalManifests,
    calls,
  };
}

export { formatSizeStandard };
