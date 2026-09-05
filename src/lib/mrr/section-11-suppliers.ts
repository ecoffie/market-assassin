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

export interface Section11 {
  suppliers: SupplierRow[];
  rawUeiCount: GroundedField<number>;
  deduplicatedFamilyCount: GroundedField<number>;
  effortsToLocate: GroundedField<string>;
  calls: ToolCall[];
  limitations: string[];
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
    // ScoredEntity rarely carries SAM size status — never invent Small/Other than Small.
    businessSize: unknown(
      'SAM business-size status was not present on the market-depth entity record',
      [ev],
    ),
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
    return {
      suppliers: [],
      rawUeiCount: unknown('no primary NAICS — supplier search was not run'),
      deduplicatedFamilyCount: unknown('no primary NAICS — supplier search was not run'),
      effortsToLocate: value(
        'No assess_market_depth call was made because a primary NAICS code was not established for this requirement.',
        ev,
      ),
      calls,
      limitations: [
        'Primary NAICS missing; Potential Supplier Information could not be populated from market-depth data.',
      ],
    };
  }

  const args: Record<string, unknown> = {
    naics: primaryNaics,
    set_aside: 'Small Business',
    limit: 50,
  };
  if (req.place_of_performance_state) {
    args.state = req.place_of_performance_state;
  }

  const depthCall = await resolveDepthCall(args, opts);
  calls.push(depthCall);

  const failEfforts = (detail: string): GroundedField<string> =>
    value(
      `assess_market_depth(${JSON.stringify(args)}) — ${detail}`,
      depthCall.evidence,
    );

  if (!depthCall.ok) {
    return {
      suppliers: [],
      rawUeiCount: unknown(
        `assess_market_depth failed: ${depthCall.error ?? 'unknown error'}`,
        [depthCall.evidence],
      ),
      deduplicatedFamilyCount: unknown(
        `assess_market_depth failed: ${depthCall.error ?? 'unknown error'}`,
        [depthCall.evidence],
      ),
      effortsToLocate: failEfforts(`FAILED (${depthCall.error ?? 'unknown error'})`),
      calls,
      limitations: [
        'Market-depth lookup failed; supplier counts are Unknown, not a measured zero.',
      ],
    };
  }

  if (metaDegraded(depthCall.result) === true) {
    return {
      suppliers: [],
      rawUeiCount: unknown(
        'assess_market_depth reported degraded upstream data — supplier counts cannot be established',
        [depthCall.evidence],
      ),
      deduplicatedFamilyCount: unknown(
        'assess_market_depth reported degraded upstream data — supplier counts cannot be established',
        [depthCall.evidence],
      ),
      effortsToLocate: failEfforts('returned degraded:true — counts treated as Unknown, not zero'),
      calls,
      limitations: [
        'Market-depth data was degraded; do not treat an empty supplier table as a true-zero finding.',
      ],
    };
  }

  const result = (depthCall.result ?? {}) as {
    businesses?: DepthBusiness[];
    sample_coverage?: number | null;
    sample_size?: number;
    capable_depth?: number;
    market_depth?: number;
    eligible_population?: number | null;
    caveats?: string[];
  };
  const businesses = Array.isArray(result.businesses) ? result.businesses : [];
  const coverage =
    typeof result.sample_coverage === 'number' && Number.isFinite(result.sample_coverage)
      ? result.sample_coverage
      : null;

  if (coverage !== null && coverage < 1) {
    limitations.push(
      `sample_coverage=${coverage} (< 1): raw UEI count is the size of the scored SAMPLE, not the eligible population` +
        (result.eligible_population != null
          ? ` (eligible_population=${result.eligible_population})`
          : ''),
    );
  }
  if (Array.isArray(result.caveats)) {
    for (const c of result.caveats) {
      if (typeof c === 'string' && c.trim()) limitations.push(c.trim());
    }
  }

  const grounded = metaGrounded(depthCall.result);
  const emptyBusinesses = businesses.length === 0;

  // Measured empty sample — ONLY when the call succeeded and was not degraded.
  if (emptyBusinesses && grounded === false) {
    const label = 'no capable suppliers in sample';
    return {
      suppliers: [],
      rawUeiCount: trueZero(label, depthCall.evidence),
      deduplicatedFamilyCount: trueZero(label, depthCall.evidence),
      effortsToLocate: value(
        `assess_market_depth(${JSON.stringify(args)}) succeeded with grounded:false and 0 businesses — recorded as measured empty sample (not a failed read).`,
        depthCall.evidence,
      ),
      calls,
      limitations,
    };
  }

  if (emptyBusinesses) {
    // Grounded true but empty list is also a measured empty sample.
    const label = 'no capable suppliers in sample';
    return {
      suppliers: [],
      rawUeiCount: trueZero(label, depthCall.evidence),
      deduplicatedFamilyCount: trueZero(label, depthCall.evidence),
      effortsToLocate: value(
        `assess_market_depth(${JSON.stringify(args)}) returned grounded=${String(grounded)} with 0 businesses.`,
        depthCall.evidence,
      ),
      calls,
      limitations,
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
    buildSupplierRow(row.business, row.family, depthCall.evidence),
  );

  const rawCount = businesses.length;
  const eligibleKeys = new Set([...byFamily.keys()]);
  const fleetWideResolveFailed =
    pool.length > 0 && resolveFailures === pool.length && eligibleKeys.size === 0;

  let rawUeiCount: GroundedField<number>;
  let deduplicatedFamilyCount: GroundedField<number>;

  rawUeiCount = value(rawCount, depthCall.evidence);

  if (fleetWideResolveFailed) {
    deduplicatedFamilyCount = unknown(
      'corporate-family resolution failed for every supplier UEI — family-deduplicated count cannot be established',
      [depthCall.evidence],
    );
  } else {
    deduplicatedFamilyCount = value(eligibleKeys.size, depthCall.evidence);
  }

  const effortsToLocate = value(
    [
      `assess_market_depth(${JSON.stringify(args)})`,
      `returned ${rawCount} UEI(s) in the depth sample`,
      `capable_depth=${result.capable_depth ?? 'n/a'}`,
      `market_depth=${result.market_depth ?? 'n/a'}`,
      `sample_coverage=${coverage ?? 'n/a'}`,
      `resolved top ${pool.length} capable/active UEIs`,
      `rule-of-two-eligible families in resolved set=${eligibleKeys.size}`,
      `table rows rendered=${suppliers.length}`,
      `unresolved UEI rows in resolved set=${unresolvedRows.length}`,
    ].join('; '),
    depthCall.evidence,
  );

  if (tablePool.length === 0 && businesses.length > 0) {
    limitations.push(
      'No active_performer or capable entities in the sample — supplier table empty; emerging/registered_only were not promoted into RoT rows.',
    );
  }
  limitations.push(
    'Corporate-family membership lists are UEI-local (child only); sibling expansion across parent_uei is not performed in the MRR hot path.',
  );

  return {
    suppliers,
    rawUeiCount,
    deduplicatedFamilyCount,
    effortsToLocate,
    calls,
    limitations,
  };
}
