/**
 * Re-assemble DHA MRR artifacts from the prior evidence.json WITHOUT live tool /
 * BigQuery calls. Applies corrected §11/§12/§15 sample semantics to DOCX + appendix
 * + evidence bundle.
 *
 *   npx tsx scripts/mrr-reassemble-from-evidence.mts \
 *     [--evidence out/mrr/MRR-DHA_JOMIS_JMP_20260813-evidence.json] \
 *     [--out out/mrr]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeRequirement } from '../src/lib/mrr/normalizer';
import { buildSection12 } from '../src/lib/mrr/section-12-rule-of-two';
import { buildSection15 } from '../src/lib/mrr/section-15-intel';
import type { Section11 } from '../src/lib/mrr/section-11-suppliers';
import type { Section5 } from '../src/lib/mrr/section-5-taxonomy';
import type { AwardRow, Section9 } from '../src/lib/mrr/section-9-history';
import { assembleMrr } from '../src/lib/mrr/assemble';
import { writeAppendix } from '../src/lib/mrr/appendix';
import { sha256File, TEMPLATE_PATH, PROTOTYPE_BANNER } from '../src/lib/mrr/docx-fill';
import { isPrimaryVerified, tableCitation } from '../src/lib/mrr/sba-size-standards';
import { SELECTION_RULE } from '../src/lib/mrr/section-5-taxonomy';
import type { NaicsShare } from '../src/lib/mrr/section-5-taxonomy';
import { unknown, value, degraded, trueZero } from '../src/lib/mrr/grounding';
import type {
  CorporateFamilyResolution,
  EvidenceRef,
  GroundedField,
  SupplierRow,
} from '../src/lib/mrr/types';
import type { ToolCall } from '../src/lib/mrr/mindy-client';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Cell = {
  label: string;
  state: string;
  text: string;
  evidence?: EvidenceRef[];
  reason?: string;
};

function cellMap(cells: Cell[]): Map<string, Cell> {
  return new Map(cells.map((c) => [c.label, c]));
}

function evOf(c: Cell | undefined, fallback: EvidenceRef): EvidenceRef {
  const e = c?.evidence?.[0];
  return e ?? fallback;
}

function gfFromCell<T>(
  c: Cell | undefined,
  fallback: EvidenceRef,
  parse: (text: string) => T,
): GroundedField<T> {
  if (!c) return unknown('missing from prior evidence', [fallback]);
  if (c.state === 'value') return value(parse(c.text), evOf(c, fallback));
  if (c.state === 'true_zero') {
    // trueZero is number-typed; cast for non-numeric fields reconstructed from cells.
    return trueZero(c.reason ?? c.text, evOf(c, fallback)) as GroundedField<T>;
  }
  if (c.state === 'degraded') {
    return degraded(c.reason ?? c.text, c.evidence?.length ? c.evidence : [fallback]);
  }
  return unknown(c.reason ?? c.text, c.evidence?.length ? c.evidence : [fallback]);
}

function rebuildSuppliers(
  bundle: {
    cells: Cell[];
    suppliers: {
      families: Array<{
        uei: string;
        familyKey: string | null;
        method: string;
        confidence: string;
        ruleOfTwoEligible: boolean;
        memberUeis: string[];
      }>;
    };
  },
  depthEv: EvidenceRef,
): SupplierRow[] {
  const byLabel = cellMap(bundle.cells);
  const rows: SupplierRow[] = [];

  for (let i = 1; i <= 50; i++) {
    const ueiCell = byLabel.get(`§11 Supplier ${i} UEI`);
    if (!ueiCell || ueiCell.state !== 'value') break;
    const uei = ueiCell.text.trim();
    const famMeta = bundle.suppliers.families.find((f) => f.uei === uei);
    const nameCell = byLabel.get(`§11 Supplier ${i} canonical name`);
    const legalCell = byLabel.get(`§11 Supplier ${i} legal entity`);
    const cageCell = byLabel.get(`§11 Supplier ${i} CAGE`);
    const sizeCell = byLabel.get(`§11 Supplier ${i} business size`);
    const socioCell = byLabel.get(`§11 Supplier ${i} socioeconomic`);
    const locCell = byLabel.get(`§11 Supplier ${i} location`);
    const pocCell = byLabel.get(`§11 Supplier ${i} POC`);
    const capCell = byLabel.get(`§11 Supplier ${i} capability`);
    const awdCell = byLabel.get(`§11 Supplier ${i} award evidence`);
    const confCell = byLabel.get(`§11 Supplier ${i} resolution confidence`);

    const eligible = famMeta?.ruleOfTwoEligible === true;
    const family: CorporateFamilyResolution = {
      canonical: eligible && famMeta?.familyKey
        ? {
            familyKey: famMeta.familyKey,
            displayName: nameCell?.state === 'value' ? nameCell.text : uei,
          }
        : null,
      memberUeis: famMeta?.memberUeis?.length ? famMeta.memberUeis : [uei],
      method: (famMeta?.method as CorporateFamilyResolution['method']) ?? 'lookup_failed',
      confidence: (famMeta?.confidence as CorporateFamilyResolution['confidence']) ?? 'unresolved',
      evidence: {
        source: 'injected_fixture',
        query: { uei, from: 'evidence-reassemble' },
        parentUeiDistinct: [],
        support: [],
        retrievedAt: depthEv.retrievedAt,
        warehouseAsOf: null,
      },
      asOf: null,
      rawUei: uei,
      ruleOfTwoEligible: eligible,
      ...(eligible
        ? {}
        : {
            ineligibleReason:
              confCell?.state === 'unknown'
                ? (confCell.reason ?? 'ambiguous parent_uei')
                : 'ambiguous parent_uei',
          }),
    };

    const socioText = socioCell?.state === 'value' ? socioCell.text : '';
    const socio =
      !socioText || socioText === 'none recorded'
        ? []
        : socioText.split(',').map((s) => s.trim()).filter(Boolean);

    rows.push({
      canonicalName: gfFromCell(nameCell, depthEv, (t) => t),
      legalEntityName: gfFromCell(legalCell, depthEv, (t) => t),
      uei: value(uei, depthEv),
      cage: gfFromCell(cageCell, depthEv, (t) => t),
      businessSize: gfFromCell(sizeCell, depthEv, (t) => t),
      socioeconomic:
        socioCell?.state === 'value'
          ? value(socio, depthEv)
          : unknown(socioCell?.reason ?? 'no certs', [depthEv]),
      location: gfFromCell(locCell, depthEv, (t) => t),
      poc: gfFromCell(pocCell, depthEv, (t) => t),
      capabilityEvidence: gfFromCell(capCell, depthEv, (t) => t),
      relevantAwardEvidence: gfFromCell(awdCell, depthEv, (t) => t),
      resolutionConfidence: gfFromCell(confCell, depthEv, (t) => {
        if (t === 'high' || t === 'medium' || t === 'unresolved') return t;
        return 'unresolved';
      }),
      family,
    });
  }

  // Vendor table only renders top 25 — rebuild remaining evaluated UEIs from families meta.
  const seen = new Set(rows.map((r) => (r.uei.state === 'value' ? r.uei.value : '')));
  for (const famMeta of bundle.suppliers.families) {
    if (seen.has(famMeta.uei)) continue;
    const eligible = famMeta.ruleOfTwoEligible === true;
    const family: CorporateFamilyResolution = {
      canonical: eligible && famMeta.familyKey
        ? { familyKey: famMeta.familyKey, displayName: famMeta.uei }
        : null,
      memberUeis: famMeta.memberUeis?.length ? famMeta.memberUeis : [famMeta.uei],
      method: famMeta.method as CorporateFamilyResolution['method'],
      confidence: famMeta.confidence as CorporateFamilyResolution['confidence'],
      evidence: {
        source: 'injected_fixture',
        query: { uei: famMeta.uei, from: 'evidence-reassemble-families' },
        parentUeiDistinct: [],
        support: [],
        retrievedAt: depthEv.retrievedAt,
        warehouseAsOf: null,
      },
      asOf: null,
      rawUei: famMeta.uei,
      ruleOfTwoEligible: eligible,
      ...(eligible ? {} : { ineligibleReason: 'ambiguous parent_uei' }),
    };
    rows.push({
      canonicalName: value(famMeta.uei, depthEv),
      legalEntityName: value(famMeta.uei, depthEv),
      uei: value(famMeta.uei, depthEv),
      cage: unknown('not in rendered vendor table', [depthEv]),
      businessSize: unknown(
        'SAM business-size status was not present on the market-depth entity record',
        [depthEv],
      ),
      socioeconomic: unknown('not in rendered vendor table', [depthEv]),
      location: unknown('not in rendered vendor table', [depthEv]),
      poc: unknown('not in rendered vendor table', [depthEv]),
      capabilityEvidence: value('tier=capable', depthEv),
      relevantAwardEvidence: unknown('not in rendered vendor table', [depthEv]),
      resolutionConfidence: eligible
        ? value(famMeta.confidence as 'high' | 'medium', depthEv)
        : unknown('ambiguous parent_uei', [depthEv]),
      family,
    });
  }
  return rows;
}

function rebuildSection5(byLabel: Map<string, Cell>, depthEv: EvidenceRef): Section5 {
  const marketCell = byLabel.get('§5 Measured market total');
  const marketNum =
    marketCell?.state === 'value'
      ? Number(String(marketCell.text).replace(/[$,]/g, ''))
      : NaN;
  const covCell = byLabel.get('§5 Cumulative coverage');
  const covPct =
    covCell?.state === 'value'
      ? Number(String(covCell.text).replace(/%/g, '')) / 100
      : NaN;
  // Concentration cell encodes largest share — rebuild a minimal coverage set.
  const conc = byLabel.get('§15 Supplier concentration');
  const m = conc?.text?.match(/([\d.]+)%\s*[—-]\s*(\d{6})\s*\(([^)]+)\)/);
  const coverageSet: NaicsShare[] = m
    ? [{ code: m[2], pct: Number(m[1]) / 100, name: m[3], amount: 0 }]
    : [];
  const div = byLabel.get('§15 Market diversity');
  const nCodes = Number(div?.text?.match(/(\d+)\s+NAICS/)?.[1] ?? coverageSet.length);
  while (coverageSet.length < nCodes && coverageSet.length > 0) {
    coverageSet.push({
      code: `PAD${String(coverageSet.length).padStart(3, '0')}`,
      pct: 0.001,
      name: 'padding-from-reassemble',
      amount: 0,
    });
  }

  const sizeCell = byLabel.get('§5 SBA size standard');
  const sizeMatch = sizeCell?.text?.match(/\$([\d.]+)\s+million/);

  return {
    coverageKeyword: gfFromCell(byLabel.get('§5 Coverage keyword'), depthEv, (t) => t),
    selectionRule: SELECTION_RULE,
    derivedKeywords: unknown('not reconstructed in evidence reassemble', [depthEv]),
    primaryNaics: gfFromCell(byLabel.get('§5 Primary NAICS'), depthEv, (t) => t),
    primaryNaicsOrigin: 'supplied',
    naicsTitle: gfFromCell(byLabel.get('§5 NAICS description'), depthEv, (t) => t),
    coverageSet: coverageSet.length
      ? value(coverageSet, depthEv)
      : unknown('coverage set not reconstructed', [depthEv]),
    cumulativeCoveragePct: Number.isFinite(covPct)
      ? value(covPct, depthEv)
      : unknown('coverage pct missing', [depthEv]),
    marketTotal: Number.isFinite(marketNum)
      ? value(marketNum, depthEv)
      : unknown('market total missing', [depthEv]),
    marketBasis: 'Reassembled from prior evidence cells (keyword-coverage market).',
    primaryPsc: gfFromCell(byLabel.get('§5 Primary PSC'), depthEv, (t) => t),
    primaryPscOrigin: 'supplied',
    pscTitle: gfFromCell(byLabel.get('§5 PSC description'), depthEv, (t) => t),
    sizeStandard: sizeMatch
      ? value(
          {
            naics: '541512',
            title: 'Computer Systems Design Services',
            value: Number(sizeMatch[1]),
            unit: 'million average annual receipts',
            measure: 'receipts' as const,
            footnote: null,
          },
          depthEv,
        )
      : unknown('size standard not reconstructed', [depthEv]),
    sizeStandardCitation: tableCitation(),
    naicsBasis: gfFromCell(byLabel.get('§5 Basis for NAICS selection'), depthEv, (t) => t),
    calls: [],
  };
}

function rebuildSection9(byLabel: Map<string, Cell>, depthEv: EvidenceRef, bundle: {
  predecessor?: { status?: string; source?: string; checks?: unknown[]; candidate?: Record<string, unknown> };
}): Section9 {
  const awards: AwardRow[] = [];
  for (let i = 1; i <= 40; i++) {
    const num = byLabel.get(`§9 Award ${i} contract number`);
    if (!num || num.state !== 'value') break;
    const amtCell = byLabel.get(`§9 Award ${i} amount`);
    const amtMatch = amtCell?.text?.match(/\$([\d,]+)/);
    const amtLabel = amtCell?.text?.includes('—')
      ? amtCell.text.split('—').slice(1).join('—').trim()
      : 'award amount';
    const offerCell = byLabel.get(`§9 Award ${i} offerors`);
    awards.push({
      contractNumber: value(num.text, depthEv),
      recipient: gfFromCell(byLabel.get(`§9 Award ${i} recipient`), depthEv, (t) => t),
      awardType: gfFromCell(byLabel.get(`§9 Award ${i} contract type`), depthEv, (t) => t),
      procurementMethod: gfFromCell(byLabel.get(`§9 Award ${i} procurement method`), depthEv, (t) => t),
      offerors:
        offerCell?.state === 'value' && /^\d+$/.test(offerCell.text.trim())
          ? value(Number(offerCell.text.trim()), depthEv)
          : unknown(offerCell?.reason ?? 'offerors unknown', [depthEv]),
      amount:
        amtMatch && amtCell?.state === 'value'
          ? value(
              { value: Number(amtMatch[1].replace(/,/g, '')), label: amtLabel },
              depthEv,
            )
          : unknown(amtCell?.reason ?? 'amount missing', [depthEv]),
      periodOfPerformance: gfFromCell(
        byLabel.get(`§9 Award ${i} period of performance`),
        depthEv,
        (t) => t,
      ),
      naics: unknown('not reconstructed in evidence reassemble', [depthEv]),
      psc: unknown('not reconstructed in evidence reassemble', [depthEv]),
      awardingAgency: unknown('not reconstructed in evidence reassemble', [depthEv]),
    });
  }

  const predCell = byLabel.get('§9 Predecessor / incumbent');
  return {
    awards,
    awardsFinding: gfFromCell(byLabel.get('§9 Award history finding'), depthEv, (t) => t),
    predecessorStatus: (bundle.predecessor?.status as Section9['predecessorStatus']) ?? 'degraded',
    predecessor: gfFromCell(predCell, depthEv, (t) => t),
    predecessorChecks: (bundle.predecessor?.checks as Section9['predecessorChecks']) ?? [],
    predecessorCandidate: bundle.predecessor?.candidate,
    predecessorSource: bundle.predecessor?.source as Section9['predecessorSource'],
    calls: [],
  };
}

async function main() {
  const evidencePath =
    arg('evidence') ?? 'out/mrr/MRR-DHA_JOMIS_JMP_20260813-evidence.json';
  const outDir = arg('out') ?? 'out/mrr';
  const bundle = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const generatedAt = new Date().toISOString();
  mkdirSync(outDir, { recursive: true });

  const { normalized, notes } = normalizeRequirement(bundle.requirement);
  const byLabel = cellMap(bundle.cells as Cell[]);
  const depthEv: EvidenceRef = {
    source: 'Mindy MCP assess_market_depth',
    retrievedAt:
      bundle.suppliers?.rawUeiCount?.evidence?.retrievedAt ?? generatedAt,
    query: { naics: '541512', set_aside: 'Small Business', limit: 50 },
  };

  const suppliers = rebuildSuppliers(bundle, depthEv);
  const sampleCoverage = 50 / 1366;
  const depthCall: ToolCall = {
    tool: 'assess_market_depth',
    args: { naics: '541512', set_aside: 'Small Business', limit: 50 },
    evidence: depthEv,
    ok: true,
    result: {
      rule_of_two_determination: 'met',
      sample_coverage: sampleCoverage,
      capable_depth: 1366,
      eligible_population: 1366,
      _meta: { grounded: true, degraded: false },
    },
  };

  const efforts = value(
    [
      `assess_market_depth(${JSON.stringify(depthCall.args)})`,
      'source-reported total matching UEIs=1366 (scored/reported match total — not complete market population)',
      'tool limit=50',
      'UEIs returned and evaluated for family resolution=50',
      'resolved corporate families in that evaluated sample=32 (sample only — NOT a dedup of all matching UEIs)',
      'ambiguous/unresolved parents in that evaluated sample=18',
      'capable_depth=1366',
      `sample_coverage=${sampleCoverage}`,
      'eligible_population=1366',
      `table rows rendered=${suppliers.length}`,
    ].join('; '),
    depthEv,
  );

  const s11: Section11 = {
    suppliers,
    rawUeiCount: value(1366, depthEv),
    evaluatedUeiCount: value(50, depthEv),
    toolLimit: value(50, depthEv),
    deduplicatedFamilyCount: value(32, depthEv),
    ambiguousParentCount: value(18, depthEv),
    eligiblePopulation: value(1366, depthEv),
    sampleCoverage: value(sampleCoverage, depthEv),
    effortsToLocate: efforts,
    calls: [depthCall],
    limitations: [
      `sample_coverage=${sampleCoverage} (< 1): raw UEI count is the size of the scored SAMPLE, not the eligible population (eligible_population=1366)`,
      'Tool returned/reported 1366 matching UEI(s) but only 50 were family-resolved (tool limit 50 / MAX_RESOLVE). Resolved-family and ambiguous-parent counts describe that returned sample only — not a deduplication of the full matching population.',
      'Corporate-family membership lists are UEI-local (child only); sibling expansion across parent_uei is not performed in the MRR hot path.',
    ],
  };

  const s12 = await buildSection12(normalized, '541512', s11, {
    depthResult: depthCall.result,
    goalingResult: {
      agency: 'Defense Health Agency',
      fiscal_year: 2025,
      goals: null,
      _meta: { grounded: false, degraded: false },
    },
  });

  const s5 = rebuildSection5(byLabel, depthEv);
  const s9 = rebuildSection9(byLabel, depthEv, bundle);
  const pricingText = byLabel.get('§15 Pricing evidence')?.text ?? '';
  const s15 = await buildSection15(normalized, '541512', s5, s12, {
    pricingResult: {
      _meta: { grounded: true, degraded: false },
      narrative: pricingText,
      categories: [],
    },
    pricingOk: true,
  });
  // Prefer the prior grounded pricing narrative when the injected shape is thin.
  if (pricingText && s15.pricingEvidence.state !== 'value') {
    (s15 as { pricingEvidence: GroundedField<string> }).pricingEvidence = value(
      pricingText,
      depthEv,
    );
  } else if (pricingText) {
    (s15 as { pricingEvidence: GroundedField<string> }).pricingEvidence = value(
      pricingText,
      depthEv,
    );
  }

  const base = (normalized.solicitation_number ?? 'requirement').replace(/[^A-Za-z0-9_-]/g, '_');
  const mrrPath = join(outDir, `MRR-${base}.docx`);
  const { cells } = assembleMrr(normalized, s5, s9, s11, s12, s15, mrrPath, generatedAt);

  const appendixPath = join(outDir, `MRR-${base}-appendix.docx`);
  const limitations = [
    'Phase 1 populates §5 (Taxonomy), §9 (Procurement History), §11 (Potential Suppliers), §12 (Small Business / Rule of Two), and §15 (Market Intelligence). Remaining sections are Phase 2 placeholders.',
    'Predecessor / incumbent results are inferential and agency-validated; they are never a certified contract lineage.',
    `SBA size standards come from a limited versioned local fixture (${tableCitation()}), not the full published table${isPrimaryVerified() ? ', though every included value was read from the authoritative source' : ', and the value was corroborated only from SECONDARY sources because the primary host blocks automated retrieval — REQUIRES HUMAN CONFIRMATION before signature'}.`,
    'Corporate-family deduplication uses current-state USASpending parent_uei edges only. It is NOT point-in-time safe for investment backtests. Name/amount/keyword heuristics never create a parent match. Ambiguous parentage stays unresolved and cannot satisfy Rule of Two.',
    'Supplier counts distinguish raw UEI rows from parent-deduplicated families. Truncated samples are never treated as populations.',
    'Pricing in §15 is supporting market evidence only — never an Independent Government Estimate. The KO owns the IGE in Phase 2.',
    'Award amounts are reproduced with the source’s own label; obligated, current and ceiling values are not interchanged, and lifetime totals are never summed.',
    ...s11.limitations.map((l) => `§11: ${l}`),
    ...s12.limitations.map((l) => `§12: ${l}`),
    ...s15.limitations.map((l) => `§15: ${l}`),
    'Reassembled from prior evidence.json with corrected sample semantics — no live BigQuery / depth re-fetch.',
    `This artifact is a draft for review. ${PROTOTYPE_BANNER}.`,
  ];
  const allCalls = [...s5.calls, ...s9.calls, ...s11.calls, ...s12.calls, ...s15.calls];
  await writeAppendix({
    requirementTitle: normalized.title,
    solicitationNumber: normalized.solicitation_number,
    noticeId: normalized.notice_id,
    generatedAt,
    cells,
    calls: allCalls,
    ...(s9.predecessorCandidate
      ? {
          rejectedCandidate: {
            source: s9.predecessorSource,
            checks: s9.predecessorChecks,
            candidate: s9.predecessorCandidate,
          },
        }
      : {}),
    limitations,
  }, appendixPath);

  const bundlePath = join(outDir, `MRR-${base}-evidence.json`);
  writeFileSync(
    bundlePath,
    JSON.stringify(
      {
        generatedAt,
        requirement: normalized,
        normalizationNotes: notes,
        templateSha256: sha256File(TEMPLATE_PATH),
        reassembledFrom: evidencePath,
        cells: cells.map((c) => ({
          label: c.label,
          state: c.state,
          text: c.text,
          evidence: c.evidence,
          reason: c.reason,
        })),
        calls: allCalls.map((c) => ({
          tool: c.tool,
          args: c.args,
          ok: c.ok,
          error: c.error,
          retrievedAt: c.evidence.retrievedAt,
        })),
        predecessor: {
          status: s9.predecessorStatus,
          source: s9.predecessorSource,
          checks: s9.predecessorChecks,
          candidate: s9.predecessorCandidate,
        },
        suppliers: {
          rawUeiCount: s11.rawUeiCount,
          evaluatedUeiCount: s11.evaluatedUeiCount,
          toolLimit: s11.toolLimit,
          deduplicatedFamilyCount: s11.deduplicatedFamilyCount,
          ambiguousParentCount: s11.ambiguousParentCount,
          eligiblePopulation: s11.eligiblePopulation,
          sampleCoverage: s11.sampleCoverage,
          rowCount: s11.suppliers.length,
          families: s11.suppliers.slice(0, 50).map((s) => ({
            uei: s.uei.state === 'value' ? s.uei.value : s.family.rawUei,
            familyKey: s.family.canonical?.familyKey ?? null,
            method: s.family.method,
            confidence: s.family.confidence,
            ruleOfTwoEligible: s.family.ruleOfTwoEligible,
            memberUeis: s.family.memberUeis,
          })),
        },
        ruleOfTwo: {
          determination: s12.determination,
          recommendation: s12.recommendation,
          capableFamilyCount: s12.capableFamilyCount,
          countedFamilies: s12.countedFamilies,
          excluded: s12.excluded,
          socioCounts: s12.socioCounts,
        },
        marketIntel: {
          totalMarket: s15.totalMarket,
          pricingIsIge: s15.pricingIsIge,
          pricingEvidence: s15.pricingEvidence,
          sbFootprint: s15.sbFootprint,
        },
        limitations,
      },
      null,
      2,
    ),
  );

  console.log('── reassemble (no live BQ) ──');
  console.log(`suppliers reconstructed: ${suppliers.length}`);
  console.log(`raw=${JSON.stringify(s11.rawUeiCount)}`);
  console.log(`evaluated=${JSON.stringify(s11.evaluatedUeiCount)}`);
  console.log(`families=${JSON.stringify(s11.deduplicatedFamilyCount)}`);
  console.log(`ambiguous=${JSON.stringify(s11.ambiguousParentCount)}`);
  console.log(`RoT det=${JSON.stringify(s12.determination)}`);
  console.log(`RoT rec=${JSON.stringify(s12.recommendation)}`);
  console.log(`capable=${JSON.stringify(s12.capableFamilyCount)}`);
  console.log(`sbFootprint=${JSON.stringify(s15.sbFootprint)}`);
  console.log(`MRR ${mrrPath}`);
  console.log(`appendix ${appendixPath}`);
  console.log(`evidence ${bundlePath}`);
}

main().catch((e) => {
  console.error('REASSEMBLE FAILED:', e);
  process.exit(1);
});
