/**
 * MRR Block 6 — §11 Potential Supplier Information.
 *
 * Spine: `assess_market_depth` (capable/active_performer list) → corporate-family
 * resolution → one table row per eligible family (richest member) plus unresolved
 * UEI rows. Raw UEI count and family-deduplicated count are SEPARATE grounded
 * fields so a corporate family of two UEIs cannot inflate Rule-of-Two supply.
 *
 * Failures and truncated samples stay `unknown` / limitations — never a fabricated
 * "0 suppliers" population claim.
 */
import type {
  CorporateFamilyResolution,
  EvidenceRef,
  FamilyConfidence,
  GroundedField,
  Requirement,
  SupplierRow,
} from './types';
import { callTool, metaDegraded, metaGrounded, type ToolCall } from './mindy-client';
import { evidence, trueZero, unknown, value } from './grounding';
import { batchParentEdgeLookup, resolveCorporateFamily } from './corporate-family';
import { describeSamSizeForRequirement, type SamSizeStatus } from '@/lib/gov-buyer/evaluation-bound';
import { supplierFunnel, type SupplierFunnel } from './supplier-funnel';
import {
  geographyName,
  marketCapacityLabel,
  marketScopeFromRequirement,
  retrievalManifest,
  type EvidenceClass,
  type RetrievalManifest,
  type ScopeDimension,
} from './market-scope';

export interface Section11 {
  suppliers: SupplierRow[];
  /**
   * Tool-reported matching UEI total from the depth result (distinct from the
   * broader eligible population and from the evaluated UEI subset). When
   * sample_coverage < 1 this is still not a complete market census relative to
   * eligible_population.
   */
  rawUeiCount: GroundedField<number>;
  /**
   * Parent-deduplicated rule-of-two-eligible families among the EVALUATED
   * UEI subset only — not a deduplication of rawUeiCount when evaluation was capped.
   */
  deduplicatedFamilyCount: GroundedField<number>;
  /** Depth-tool businesses.length — the bounded sample returned (usually ≤ tool limit). */
  boundedSampleReturned: GroundedField<number>;
  /** UEIs that met the capable/active_performer evaluation gate. Distinct from the bounded sample. */
  capableActiveCount: GroundedField<number>;
  /**
   * UEIs submitted for corporate-family resolution (capable/active after the
   * MAX_RESOLVE cap). Never the full matching census, and never a synonym for
   * the bounded sample when some sampled firms were excluded by tier.
   */
  evaluatedUeiCount: GroundedField<number>;
  /** Sampled minus capable/active — excluded before family resolution. */
  excludedBeforeFamilyResolution: GroundedField<number>;
  /** Tool request `limit` (usually 50). */
  toolLimit: GroundedField<number>;
  /** Ambiguous / conflicting parent_uei among the evaluated set. */
  ambiguousParentCount: GroundedField<number>;
  /** Broader eligible population from the depth tool when reported (distinct from matching UEIs). */
  eligiblePopulation: GroundedField<number>;
  /**
   * Matching UEIs / eligible population. The stored field name matches the
   * ratio it holds. Distinct from sampleToMatchingCoverage (bounded sample /
   * matching UEIs).
   */
  matchingCoverage: GroundedField<number>;
  /** Bounded sample returned / matching UEIs, when both counts are established. */
  sampleToMatchingCoverage: GroundedField<number>;
  /** Firms the depth tool scored (its `sample_size`, usually the 50 limit). */
  scoredSample: GroundedField<number>;
  /** Scored firms in the capable / active_performer tiers (`capable_in_sample`). */
  capableInScoredSample: GroundedField<number>;
  /** Why the supplier search did not run; null when it ran. */
  notRun: 'missing_naics' | 'failed' | 'degraded' | null;
  /** Scored firms that are contract holders; null when the tool did not report it. */
  contractHoldersInScored?: number | null;
  /** Contract holders among the capable scored firms. */
  capableContractHolders?: number | null;
  /** Every supplier count with its denominator — the one source for all surfaces. */
  funnel: SupplierFunnel;
  effortsToLocate: GroundedField<string>;
  calls: ToolCall[];
  limitations: string[];
  /** Honest label for what the depth query actually measured. */
  scopeLabel: string;
  evidenceClass: EvidenceClass;
  observedDimensions: ScopeDimension[];
  retrievalManifests: RetrievalManifest[];
}

type ResolveFamilyFn = (uei: string) => Promise<CorporateFamilyResolution>;

export interface BuildSection11Opts {
  resolveFamily?: ResolveFamilyFn;
  /** Synthetic assess_market_depth result — skips live callTool when provided. */
  depthResult?: unknown;
  depthOk?: boolean;
  depthError?: string;
  depthEvidence?: EvidenceRef;
}

/** Max capable/active UEIs to family-resolve and consider for RoT/table. */
const MAX_RESOLVE = 50;
/** Max rows rendered into the §11 Word table (richest families first). */
const MAX_TABLE_ROWS = 25;

const TABLE_TIERS = new Set(['active_performer', 'capable']);

const SOCIO_LABELS = new Set(['8(a)', 'HUBZone', 'SDVOSB', 'WOSB', 'EDWOSB']);

interface DepthBusiness {
  uei?: string;
  legalBusinessName?: string;
  cageCode?: string | null;
  state?: string | null;
  city?: string | null;
  pocName?: string | null;
  certifications?: string[];
  totalObligated?: number;
  awardCount?: number;
  distinctAgencyCount?: number;
  lastActionDate?: string | null;
  score?: number;
  tier?: string;
  sizeStatus?: SamSizeStatus | null;
  size_status?: SamSizeStatus | null;
  sizeStatusNaics?: string | null;
  size_status_naics?: string | null;
  sizeStatusSource?: string | null;
  size_status_source?: string | null;
}

function dollars(n: number): string {
  if (!Number.isFinite(n)) return 'unknown';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function pickSocio(certs: string[] | undefined): string[] {
  if (!Array.isArray(certs)) return [];
  const out: string[] = [];
  for (const c of certs) {
    const t = String(c ?? '').trim();
    if (SOCIO_LABELS.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

function richness(b: DepthBusiness): number {
  const score = typeof b.score === 'number' ? b.score : 0;
  const awards = typeof b.awardCount === 'number' ? b.awardCount : 0;
  const obl = typeof b.totalObligated === 'number' ? b.totalObligated : 0;
  // Score dominates; awards then dollars break ties.
  return score * 1e12 + awards * 1e6 + obl;
}

async function defaultResolveFamily(uei: string): Promise<CorporateFamilyResolution> {
  // Agent A owns this module. Lazy import so tests inject resolveFamily without
  // requiring the sibling file at module-load time.
  const mod = (await import(
    /* @vite-ignore */ './corporate-family'
  )) as { resolveCorporateFamily: ResolveFamilyFn };
  return mod.resolveCorporateFamily(uei);
}

function strField(
  v: string | null | undefined,
  missingReason: string,
  ev: EvidenceRef,
): GroundedField<string> {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? value(s, ev) : unknown(missingReason, [ev]);
}

function buildSupplierRow(
  b: DepthBusiness,
  family: CorporateFamilyResolution,
  ev: EvidenceRef,
  requirementNaics: string,
): SupplierRow {
  const legal = typeof b.legalBusinessName === 'string' ? b.legalBusinessName.trim() : '';
  const canonical =
    family.canonical?.displayName?.trim() ||
    legal ||
    undefined;

  const city = typeof b.city === 'string' ? b.city.trim() : '';
  const state = typeof b.state === 'string' ? b.state.trim() : '';
  const location =
    city && state ? `${city}, ${state}` : city || state || undefined;

  const awards = typeof b.awardCount === 'number' && Number.isFinite(b.awardCount) ? b.awardCount : null;
  const obl =
    typeof b.totalObligated === 'number' && Number.isFinite(b.totalObligated)
      ? b.totalObligated
      : null;
  const agencies =
    typeof b.distinctAgencyCount === 'number' && Number.isFinite(b.distinctAgencyCount)
      ? b.distinctAgencyCount
      : null;
  const last = typeof b.lastActionDate === 'string' && b.lastActionDate.trim()
    ? b.lastActionDate.trim()
    : null;
  const tier = typeof b.tier === 'string' ? b.tier : 'unknown';

  const capabilityParts = [
    `tier=${tier}`,
    awards !== null ? `awards=${awards}` : null,
    obl !== null ? `totalObligated=${dollars(obl)}` : null,
  ].filter(Boolean);
  const awardParts = [
    awards !== null ? `${awards} award(s)` : null,
    obl !== null ? `total obligated ${dollars(obl)}` : null,
    agencies !== null ? `${agencies} distinct agency(ies)` : null,
    last ? `last action ${last}` : null,
  ].filter(Boolean);

  const socio = pickSocio(b.certifications);
  const uei = typeof b.uei === 'string' ? b.uei.trim() : '';

  const size = describeSamSizeForRequirement({
    sizeStatus: b.sizeStatus ?? b.size_status ?? null,
    sizeStatusNaics: b.sizeStatusNaics ?? b.size_status_naics ?? null,
    requirementNaics,
  });
  const businessSize: GroundedField<string> = size.established
    ? value(size.label, ev)
    : unknown<string>(size.reason, [ev]);

  let resolutionConfidence: GroundedField<FamilyConfidence>;
  if (family.confidence === 'unresolved' || !family.ruleOfTwoEligible) {
    resolutionConfidence = unknown(
      family.ineligibleReason ??
        `corporate family ${family.method} — confidence=${family.confidence}; Rule-of-Two ineligible`,
      [ev],
    );
  } else {
    resolutionConfidence = value(family.confidence, ev);
  }

  return {
    canonicalName: canonical
      ? value(canonical, ev)
      : unknown('no canonical or legal name available for this supplier', [ev]),
    legalEntityName: legal
      ? value(legal, ev)
      : unknown('the source did not report a legal business name', [ev]),
    uei: uei ? value(uei, ev) : unknown('the source did not report a UEI', [ev]),
    cage: strField(b.cageCode, 'the source did not report a CAGE code', ev),
    businessSize,
    socioeconomic:
      Array.isArray(b.certifications)
        ? value(socio, ev)
        : unknown('the source did not report certifications for socioeconomic designations', [ev]),
    location: location
      ? value(location, ev)
      : unknown('the source did not report a city/state location', [ev]),
    poc: strField(
      b.pocName,
      'the source did not report a government-business POC name (SAM redacts email/phone)',
      ev,
    ),
    capabilityEvidence: capabilityParts.length
      ? value(capabilityParts.join('; '), ev)
      : unknown('no capability tier or award activity was reported for this entity', [ev]),
    relevantAwardEvidence: awardParts.length
      ? value(awardParts.join('; '), ev)
      : unknown('no award statistics were reported for this entity', [ev]),
    resolutionConfidence,
    family,
  };
}

async function resolveDepthCall(
  args: Record<string, unknown>,
  opts?: BuildSection11Opts,
): Promise<ToolCall> {
  if (opts?.depthResult !== undefined || opts?.depthOk === false || opts?.depthError) {
    const ev =
      opts.depthEvidence ??
      evidence('Mindy MCP assess_market_depth', args);
    const ok = opts.depthOk !== false && !opts.depthError;
    if (!ok) {
      return {
        tool: 'assess_market_depth',
        args,
        evidence: ev,
        ok: false,
        error: opts.depthError ?? 'assess_market_depth failed',
      };
    }
    return {
      tool: 'assess_market_depth',
      args,
      evidence: ev,
      ok: true,
      result: opts.depthResult as Record<string, unknown>,
    };
  }
  return callTool('assess_market_depth', args);
}

const TOOL_LIMIT_DEFAULT = 50;

function supplierContractMeta(
  req: Requirement,
  primaryNaics: string | undefined,
  args: Record<string, unknown>,
  call: { evidence: EvidenceRef; ok?: boolean },
  resultCount: number | null,
  grounded: boolean | null,
): Pick<Section11, 'scopeLabel' | 'evidenceClass' | 'observedDimensions' | 'retrievalManifests'> {
  const scope = marketScopeFromRequirement(primaryNaics ? { ...req, naics: primaryNaics } : req);
  const observed: ScopeDimension[] = [];
  if (primaryNaics || req.naics) observed.push('naics');
  if (req.place_of_performance_state) observed.push('geography');
  const scopeLabel = marketCapacityLabel(scope, primaryNaics ?? req.naics);
  return {
    scopeLabel,
    evidenceClass: 'contextual',
    observedDimensions: observed,
    retrievalManifests: [
      retrievalManifest({
        section: '11',
        tool: 'assess_market_depth',
        requested: scope,
        consumed: {
          ...(primaryNaics ? { naics: primaryNaics } : {}),
          ...(req.place_of_performance_state ? { geography: req.place_of_performance_state } : {}),
        },
        unsupported: {
          ...(scope.department ? { department: 'assess_market_depth cannot filter awarding department' } : {}),
          ...(scope.service ? { service: 'assess_market_depth cannot filter service' } : {}),
          ...(scope.contractingOffice || scope.contractingOfficeCode
            ? { contracting_office: 'assess_market_depth cannot filter contracting office / DoDAAC' }
            : {}),
          ...(scope.installation ? { installation: 'assess_market_depth cannot filter installation' } : {}),
          ...(scope.psc ? { psc: 'assess_market_depth is NAICS+state, not PSC' } : {}),
          ...(scope.phrase ? { phrase: 'assess_market_depth does not constrain by requirement phrase' } : {}),
        },
        resultCount,
        grounded,
        source: call.evidence.source,
        asOf: call.evidence.retrievedAt,
        evidenceClass: 'contextual',
      }),
    ],
  };
}

function emptySampleFields(
  reason: string,
  ev?: EvidenceRef | EvidenceRef[],
): Pick<
  Section11,
  | 'boundedSampleReturned'
  | 'capableActiveCount'
  | 'evaluatedUeiCount'
  | 'excludedBeforeFamilyResolution'
  | 'toolLimit'
  | 'ambiguousParentCount'
  | 'eligiblePopulation'
  | 'matchingCoverage'
  | 'sampleToMatchingCoverage'
  | 'scoredSample'
  | 'capableInScoredSample'
> {
  const attempted = ev ? (Array.isArray(ev) ? ev : [ev]) : undefined;
  return {
    scoredSample: unknown(reason, attempted),
    capableInScoredSample: unknown(reason, attempted),
    boundedSampleReturned: unknown(reason, attempted),
    capableActiveCount: unknown(reason, attempted),
    evaluatedUeiCount: unknown(reason, attempted),
    excludedBeforeFamilyResolution: unknown(reason, attempted),
    toolLimit: unknown(reason, attempted),
    ambiguousParentCount: unknown(reason, attempted),
    eligiblePopulation: unknown(reason, attempted),
    matchingCoverage: unknown(reason, attempted),
    sampleToMatchingCoverage: unknown(reason, attempted),
  };
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function funnelFor(
  req: Requirement,
  naics: string | undefined,
  notRun: Section11['notRun'],
  f: Pick<
    Section11,
    | 'rawUeiCount'
    | 'eligiblePopulation'
    | 'scoredSample'
    | 'capableInScoredSample'
    | 'boundedSampleReturned'
    | 'deduplicatedFamilyCount'
    | 'ambiguousParentCount'
  > & {
    evaluatedUeiCount?: GroundedField<number>;
    contractHoldersInScored?: number | null;
    capableContractHolders?: number | null;
  },
): SupplierFunnel {
  return supplierFunnel({
    naics: naics ?? null,
    state: req.place_of_performance_state ?? null,
    notRun,
    eligiblePopulation: f.eligiblePopulation,
    matchingPerformers: f.rawUeiCount,
    scoredSample: f.scoredSample,
    capableInScoredSample: f.capableInScoredSample,
    contractHoldersInScored: f.contractHoldersInScored ?? null,
    capableContractHolders: f.capableContractHolders ?? null,
    returnedRows: f.boundedSampleReturned,
    checkedForParent: f.evaluatedUeiCount,
    resolvedFamilies: f.deduplicatedFamilyCount,
    unresolvedParents: f.ambiguousParentCount,
  });
}

export async function buildSection11(
  req: Requirement,
  primaryNaics: string | undefined,
  opts?: BuildSection11Opts,
): Promise<Section11> {
  const calls: ToolCall[] = [];
  const limitations: string[] = [];
  const resolveFamily = opts?.resolveFamily ?? defaultResolveFamily;

  if (!primaryNaics) {
    const ev = evidence('MRR §11 Potential Supplier Information', {
      reason: 'missing_primary_naics',
      keyword: req.keyword,
    });
    const notRunReason = 'not run — no NAICS code was provided';
    const fields = {
      rawUeiCount: unknown<number>(notRunReason),
      deduplicatedFamilyCount: unknown<number>(notRunReason),
      ...emptySampleFields(notRunReason, ev),
    };
    return {
      suppliers: [],
      ...fields,
      notRun: 'missing_naics',
      funnel: funnelFor(req, undefined, 'missing_naics', fields),
      effortsToLocate: value(
        'Supplier search was not run because no NAICS code was provided for this requirement. Add a NAICS code and run the research again to list potential suppliers.',
        ev,
      ),
      calls,
      limitations: [
        'No NAICS code was provided, so potential suppliers were not searched. This is missing input, not a failed lookup and not a finding of zero suppliers.',
      ],
      ...supplierContractMeta(req, undefined, {}, { evidence: ev, ok: false }, null, null),
    };
  }

  const args: Record<string, unknown> = {
    naics: primaryNaics,
    set_aside: 'Small Business',
    limit: TOOL_LIMIT_DEFAULT,
  };
  if (req.place_of_performance_state) {
    args.state = req.place_of_performance_state;
  }

  const depthCall = await resolveDepthCall(args, opts);
  calls.push(depthCall);
  const scopeMeta = supplierContractMeta(req, primaryNaics, args, depthCall, null, depthCall.ok);

  const failEfforts = (detail: string): GroundedField<string> =>
    value(
      `assess_market_depth(${JSON.stringify(args)}) — ${detail}`,
      depthCall.evidence,
    );

  if (!depthCall.ok) {
    const reason = `assess_market_depth failed: ${depthCall.error ?? 'unknown error'}`;
    const fields = {
      rawUeiCount: unknown<number>(reason, [depthCall.evidence]),
      deduplicatedFamilyCount: unknown<number>(reason, [depthCall.evidence]),
      ...emptySampleFields(reason, depthCall.evidence),
    };
    return {
      suppliers: [],
      ...fields,
      notRun: 'failed',
      funnel: funnelFor(req, primaryNaics, 'failed', fields),
      effortsToLocate: failEfforts(`FAILED (${depthCall.error ?? 'unknown error'})`),
      calls,
      limitations: [
        'Market-depth lookup failed; supplier counts are Unknown, not a measured zero.',
      ],
      ...scopeMeta,
    };
  }

  if (metaDegraded(depthCall.result) === true) {
    const reason =
      'assess_market_depth reported degraded upstream data — supplier counts cannot be established';
    const fields = {
      rawUeiCount: unknown<number>(reason, [depthCall.evidence]),
      deduplicatedFamilyCount: unknown<number>(reason, [depthCall.evidence]),
      ...emptySampleFields(reason, depthCall.evidence),
    };
    return {
      suppliers: [],
      ...fields,
      notRun: 'degraded',
      funnel: funnelFor(req, primaryNaics, 'degraded', fields),
      effortsToLocate: failEfforts('returned degraded:true — counts treated as Unknown, not zero'),
      calls,
      limitations: [
        'Market-depth data was degraded; do not treat an empty supplier table as a true-zero finding.',
      ],
      ...scopeMeta,
    };
  }

  const result = (depthCall.result ?? {}) as {
    businesses?: DepthBusiness[];
    sample_coverage?: number | null;
    sample_size?: number;
    capable_in_sample?: number;
    contract_holders_in_sample?: number | null;
    capable_contract_holders_in_sample?: number | null;
    matching_uei_count?: number | null;
    capable_depth?: number;
    market_depth?: number;
    eligible_population?: number | null;
    caveats?: string[];
  };
  const businesses = Array.isArray(result.businesses) ? result.businesses : [];
  const matchingReported =
    result.matching_uei_count != null && Number.isFinite(Number(result.matching_uei_count))
      ? Number(result.matching_uei_count)
      : null;
  const coverage =
    typeof result.sample_coverage === 'number' && Number.isFinite(result.sample_coverage)
      ? result.sample_coverage
      : null;

  if (coverage !== null && coverage < 1) {
    limitations.push(
      'The supplier evidence is a sample, not a census: the firms Mindy scored are a limited subset of the registered small businesses, and the supplier counts describe that sample.',
    );
  }
  if (Array.isArray(result.caveats)) {
    for (const c of result.caveats) {
      if (typeof c !== 'string' || !c.trim()) continue;
      // assess_market_depth caveats may claim "Rule of Two is MET" from raw UEI
      // counts. §12 owns the parent-deduplicated determination — never echo a
      // UEI-inflated RoT conclusion into the MRR limitations.
      if (/rule of two/i.test(c)) continue;
      if (/as of the sync date below/i.test(c)) continue;
      limitations.push(c.trim());
    }
  }

  const grounded = metaGrounded(depthCall.result);
  const emptyBusinesses = businesses.length === 0;
  const scoredSample: GroundedField<number> =
    typeof result.sample_size === 'number' && Number.isFinite(result.sample_size)
      ? result.sample_size === 0
        ? trueZero('the market-depth tool scored 0 firms', depthCall.evidence)
        : value(result.sample_size, depthCall.evidence)
      : unknown('the market-depth tool did not report how many firms it scored', [depthCall.evidence]);
  const capableInScoredSample: GroundedField<number> =
    typeof result.capable_in_sample === 'number' && Number.isFinite(result.capable_in_sample)
      ? result.capable_in_sample === 0
        ? trueZero('no scored firm met the capable/active threshold', depthCall.evidence)
        : value(result.capable_in_sample, depthCall.evidence)
      : unknown('the market-depth tool did not report its capable count', [depthCall.evidence]);

  if (emptyBusinesses) {
    const emptyLabel = 'evaluated sample contained 0 businesses';
    const matchingField =
      matchingReported != null
        ? value(matchingReported, depthCall.evidence)
        : trueZero(emptyLabel, depthCall.evidence);
    const fields = {
      rawUeiCount: matchingField,
      deduplicatedFamilyCount: trueZero(emptyLabel, depthCall.evidence),
      boundedSampleReturned: trueZero(emptyLabel, depthCall.evidence),
      ambiguousParentCount: trueZero(emptyLabel, depthCall.evidence),
      eligiblePopulation:
        result.eligible_population != null && Number.isFinite(result.eligible_population)
          ? value(Number(result.eligible_population), depthCall.evidence)
          : unknown<number>('eligible_population not reported', [depthCall.evidence]),
      scoredSample,
      capableInScoredSample,
    };
    return {
      suppliers: [],
      scoredSample,
      capableInScoredSample,
      notRun: null,
      funnel: funnelFor(req, primaryNaics, null, fields),
      rawUeiCount: matchingField,
      deduplicatedFamilyCount: trueZero(emptyLabel, depthCall.evidence),
      boundedSampleReturned: trueZero(emptyLabel, depthCall.evidence),
      capableActiveCount: trueZero(emptyLabel, depthCall.evidence),
      evaluatedUeiCount: trueZero(emptyLabel, depthCall.evidence),
      excludedBeforeFamilyResolution: trueZero(emptyLabel, depthCall.evidence),
      toolLimit: value(TOOL_LIMIT_DEFAULT, depthCall.evidence),
      ambiguousParentCount: trueZero(emptyLabel, depthCall.evidence),
      eligiblePopulation:
        result.eligible_population != null && Number.isFinite(result.eligible_population)
          ? value(Number(result.eligible_population), depthCall.evidence)
          : unknown('eligible_population not reported', [depthCall.evidence]),
      matchingCoverage:
        coverage !== null
          ? value(coverage, depthCall.evidence)
          : unknown('matching coverage not reported', [depthCall.evidence]),
      sampleToMatchingCoverage: unknown('empty evaluated sample — sample/matching coverage not established', [
        depthCall.evidence,
      ]),
      effortsToLocate: value(
        `assess_market_depth(${JSON.stringify(args)}) returned grounded=${String(grounded)} with 0 businesses` +
          (matchingReported != null
            ? `; matching_uei_count=${matchingReported} kept separate from the empty evaluated sample`
            : ' — recorded as measured empty evaluated sample (not a failed read).'),
        depthCall.evidence,
      ),
      calls,
      limitations,
      ...supplierContractMeta(req, primaryNaics, args, depthCall, matchingReported, grounded === true),
    };
  }

  // Prefer active_performer + capable for the table; emerging stay out of RoT rows.
  const tablePool = businesses.filter((b) => TABLE_TIERS.has(String(b.tier ?? '')));
  // Cap BEFORE family resolution — resolving thousands of UEIs hangs the runner
  // and produces an unreadable Word table. Counts below still disclose the full
  // sample size from the depth tool.
  const ranked = [...tablePool].sort((a, b) => richness(b) - richness(a));
  const pool = ranked.slice(0, MAX_RESOLVE);
  if (tablePool.length > MAX_RESOLVE) {
    limitations.push(
      `Family resolution and Rule-of-Two consideration limited to the top ${MAX_RESOLVE} ` +
        `capable/active_performer UEIs by score/awards (of ${tablePool.length} in the depth sample).`,
    );
  }

  let resolve: ResolveFamilyFn = resolveFamily;
  if (!opts?.resolveFamily) {
    const ueis = pool
      .map((b) => (typeof b.uei === 'string' ? b.uei.trim() : ''))
      .filter(Boolean);
    const batch = batchParentEdgeLookup(ueis);
    resolve = (uei) => resolveCorporateFamily(uei, batch);
  }

  const resolved: Array<{ business: DepthBusiness; family: CorporateFamilyResolution }> = [];
  let resolveFailures = 0;

  for (const b of pool) {
    const uei = typeof b.uei === 'string' ? b.uei.trim() : '';
    if (!uei) continue;
    try {
      const family = await resolve(uei);
      if (family.method === 'lookup_failed' || family.method === 'malformed_uei') {
        resolveFailures += 1;
      }
      resolved.push({ business: b, family });
    } catch (err) {
      resolveFailures += 1;
      const msg = err instanceof Error ? err.message : String(err);
      const failed: CorporateFamilyResolution = {
        canonical: null,
        memberUeis: [uei],
        method: 'lookup_failed',
        confidence: 'unresolved',
        evidence: {
          source: 'injected_fixture',
          query: { uei, error: msg },
          parentUeiDistinct: [],
          support: [],
          retrievedAt: new Date().toISOString(),
          warehouseAsOf: null,
        },
        asOf: null,
        rawUei: uei,
        ruleOfTwoEligible: false,
        ineligibleReason: `resolveCorporateFamily threw: ${msg}`,
      };
      resolved.push({ business: b, family: failed });
    }
  }

  // Deduplicate: ONE row per eligible familyKey (richest member); unresolved stay as UEI rows.
  const byFamily = new Map<string, { business: DepthBusiness; family: CorporateFamilyResolution }>();
  const unresolvedRows: Array<{ business: DepthBusiness; family: CorporateFamilyResolution }> = [];

  for (const row of resolved) {
    if (row.family.ruleOfTwoEligible && row.family.canonical?.familyKey) {
      const key = row.family.canonical.familyKey;
      const prev = byFamily.get(key);
      if (!prev || richness(row.business) > richness(prev.business)) {
        byFamily.set(key, row);
      }
    } else {
      unresolvedRows.push(row);
    }
  }

  const allCandidateRows = [...byFamily.values(), ...unresolvedRows].sort(
    (a, b) => richness(b.business) - richness(a.business),
  );
  if (allCandidateRows.length > MAX_TABLE_ROWS) {
    limitations.push(
      `Assembler should render at most ${MAX_TABLE_ROWS} §11 vendor rows ` +
        `(${allCandidateRows.length} available after parent dedup in the resolved set); ` +
        `Rule-of-Two uses the full resolved eligible-family count.`,
    );
  }

  const suppliers: SupplierRow[] = allCandidateRows.map((row) =>
    buildSupplierRow(row.business, row.family, depthCall.evidence, primaryNaics),
  );

  // matching_uei_count is the matching census. businesses.length is the bounded
  // sample returned. tablePool is capable/active. pool is submitted for family
  // resolution. Never call capable/active the complete bounded sample.
  const rawCount = matchingReported ?? businesses.length;
  const boundedSample = businesses.length;
  const capableActive = tablePool.length;
  const evaluatedCount = pool.length;
  const excludedBeforeFamily = Math.max(0, boundedSample - capableActive);
  const eligibleKeys = new Set([...byFamily.keys()]);
  const ambiguousCount = unresolvedRows.length;
  const fleetWideResolveFailed =
    pool.length > 0 && resolveFailures === pool.length && eligibleKeys.size === 0;
  const eligiblePopNum =
    result.eligible_population != null && Number.isFinite(result.eligible_population)
      ? Number(result.eligible_population)
      : null;
  const rawUeiCount: GroundedField<number> = value(rawCount, depthCall.evidence);
  let deduplicatedFamilyCount: GroundedField<number>;

  if (fleetWideResolveFailed) {
    deduplicatedFamilyCount = unknown(
      'corporate-family resolution failed for every supplier UEI — family-deduplicated count cannot be established',
      [depthCall.evidence],
    );
  } else {
    deduplicatedFamilyCount = value(eligibleKeys.size, depthCall.evidence);
  }


  const funnelFields = {
    rawUeiCount: value(rawCount, depthCall.evidence),
    eligiblePopulation:
      eligiblePopNum != null
        ? value(eligiblePopNum, depthCall.evidence)
        : unknown<number>('eligible_population not reported', [depthCall.evidence]),
    scoredSample,
    capableInScoredSample,
    boundedSampleReturned: value(boundedSample, depthCall.evidence),
    evaluatedUeiCount: value(evaluatedCount, depthCall.evidence),
    deduplicatedFamilyCount: fleetWideResolveFailed
      ? unknown<number>('parent-company lookup failed for every listed firm', [depthCall.evidence])
      : value(eligibleKeys.size, depthCall.evidence),
    ambiguousParentCount: value(ambiguousCount, depthCall.evidence),
    contractHoldersInScored: finiteOrNull(result.contract_holders_in_sample),
    capableContractHolders: finiteOrNull(result.capable_contract_holders_in_sample),
  };
  const funnel = funnelFor(req, primaryNaics, null, funnelFields);
  const effortsToLocate = value(
    `Mindy searched active SAM registrations for small businesses in NAICS ${primaryNaics}` +
      `${req.place_of_performance_state ? ` located in ${geographyName(req.place_of_performance_state)}` : ''}, ` +
      'scored them on their federal award history, and resolved parent companies through USASpending. ' +
      funnel.summary +
      ' The search covers the NAICS and state only; it does not filter by contracting office, installation or PSC.',
    depthCall.evidence,
  );

  if (tablePool.length === 0 && businesses.length > 0) {
    limitations.push(
      'No active_performer or capable entities in the sample — supplier table empty; emerging/registered_only were not promoted into RoT rows.',
    );
  }
  limitations.push(
    'Parent companies come from current USASpending parent records. Sister companies under the same parent are not searched for separately.',
  );
  limitations.push(
    `${scopeMeta.scopeLabel}. These firms are statewide market capacity, not a list of the contracting office's own suppliers.`,
  );

  return {
    suppliers,
    scoredSample,
    capableInScoredSample,
    notRun: null,
    contractHoldersInScored: funnelFields.contractHoldersInScored,
    capableContractHolders: funnelFields.capableContractHolders,
    funnel,
    rawUeiCount,
    deduplicatedFamilyCount,
    boundedSampleReturned: value(boundedSample, depthCall.evidence),
    capableActiveCount: value(capableActive, depthCall.evidence),
    evaluatedUeiCount: value(evaluatedCount, depthCall.evidence),
    excludedBeforeFamilyResolution: value(excludedBeforeFamily, depthCall.evidence),
    toolLimit: value(TOOL_LIMIT_DEFAULT, depthCall.evidence),
    ambiguousParentCount: value(ambiguousCount, depthCall.evidence),
    eligiblePopulation:
      result.eligible_population != null && Number.isFinite(result.eligible_population)
        ? value(Number(result.eligible_population), depthCall.evidence)
        : unknown('eligible_population not reported', [depthCall.evidence]),
    sampleToMatchingCoverage:
      rawCount > 0
        ? value(boundedSample / rawCount, depthCall.evidence)
        : unknown('matching UEI count not established — sample/matching coverage unknown', [
            depthCall.evidence,
          ]),
    matchingCoverage:
      coverage !== null
        ? value(coverage, depthCall.evidence)
        : unknown('matching coverage not reported', [depthCall.evidence]),
    effortsToLocate,
    calls,
    limitations,
    ...supplierContractMeta(req, primaryNaics, args, depthCall, rawCount, true),
  };
}
