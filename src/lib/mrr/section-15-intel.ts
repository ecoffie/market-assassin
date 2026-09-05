/**
 * MRR Phase 1 — §15 Market Intelligence / Industry Analysis.
 *
 * Reuses §5 coverage (market $ + NAICS shares) and §12 Rule-of-Two / socio
 * counts. Pricing is GSA CALC evidence ONLY — never the Independent Government
 * Estimate. The KO owns the IGE in Phase 2; this section must never present a
 * Mindy rate as that estimate.
 *
 * Spec: INTERFACE-CONTRACTS.md §15; mrw-phase1-dev-spec.md §15.
 */
import type { EvidenceRef, GroundedField, Requirement } from './types';
import { callTool, metaDegraded, metaGrounded, type ToolCall } from './mindy-client';
import { degraded, unknown, unknownFromError, value } from './grounding';

const SUPPORTING_NOT_IGE = 'supporting data, not the Government estimate';

export interface Section15 {
  totalMarket: GroundedField<number>;
  marketBasis: string;
  supplierConcentration: GroundedField<string>;
  marketDiversity: GroundedField<string>;
  sbFootprint: GroundedField<string>;
  socioeconomicFootprint: GroundedField<string>;
  pricingEvidence: GroundedField<string>;
  /** Compile-time constant — pricing is NEVER the IGE. */
  pricingIsIge: false;
  calls: ToolCall[];
  limitations: string[];
}

type CoverageShare = { code: string; pct: number; name?: string };

type Section5Slice = {
  marketTotal: GroundedField<number>;
  cumulativeCoveragePct: GroundedField<number>;
  coverageSet: GroundedField<CoverageShare[] | unknown>;
  marketBasis: string;
};

type Section12Slice = {
  capableFamilyCount: GroundedField<number>;
  determination: GroundedField<'met' | 'not_met' | 'undetermined'>;
  recommendation: GroundedField<string>;
  socioCounts: Array<{ designation: string; familyCount: GroundedField<number> }>;
};

type PricingOpts = {
  pricingResult?: unknown;
  pricingOk?: boolean;
  pricingError?: string;
};

/** Display a coverage share pct whether stored as 0–1 or already 0–100. */
function formatSharePct(pct: number): string {
  const display = pct >= 0 && pct <= 1 ? pct * 100 : pct;
  return `${display.toFixed(1)}%`;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtRate(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `$${n.toFixed(2)}/hr`;
}

function asCoverageShares(raw: unknown): CoverageShare[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CoverageShare[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.code !== 'string' || typeof r.pct !== 'number') continue;
    out.push({
      code: r.code,
      pct: r.pct,
      ...(typeof r.name === 'string' ? { name: r.name } : {}),
    });
  }
  return out;
}

/**
 * Resolve pricing: prefer an injected opts result (orchestrator / hermetic tests),
 * otherwise call get_pricing_intel when a primary NAICS is present.
 */
async function resolvePricingCall(
  primaryNaics: string | undefined,
  opts?: PricingOpts,
): Promise<ToolCall | null> {
  if (!primaryNaics) return null;

  const args = { naics: primaryNaics };
  const injected =
    opts &&
    (opts.pricingResult !== undefined ||
      opts.pricingError !== undefined ||
      opts.pricingOk !== undefined);

  if (injected) {
    const evidence = {
      source: 'Mindy MCP get_pricing_intel',
      retrievedAt: new Date().toISOString(),
      query: { ...args },
    };
    if (opts!.pricingOk === false || opts!.pricingError) {
      return {
        tool: 'get_pricing_intel',
        args,
        evidence,
        error: opts!.pricingError ?? 'pricing call failed',
        ok: false,
      };
    }
    return {
      tool: 'get_pricing_intel',
      args,
      evidence,
      result: (opts!.pricingResult ?? {}) as Record<string, unknown>,
      ok: true,
    };
  }

  return callTool('get_pricing_intel', args);
}

function buildPricingEvidence(
  call: ToolCall | null,
  primaryNaics: string | undefined,
): GroundedField<string> {
  if (!primaryNaics) {
    return unknown(
      'no primary NAICS available — GSA CALC pricing evidence was not queried (Phase 2 / KO-owned Independent Government Estimate remains the KO\'s responsibility)',
    );
  }
  if (!call) {
    return unknown('pricing call was not attempted');
  }
  if (!call.ok) {
    return unknownFromError(new Error(call.error ?? 'call failed'), call.evidence);
  }

  const grounded = metaGrounded(call.result);
  const isDegraded = metaDegraded(call.result) === true;

  if (isDegraded) {
    return degraded(
      'get_pricing_intel reported degraded upstream data — GSA CALC rates unavailable; this is supporting labor-rate evidence only and is not a Phase 2 / KO-owned Independent Government Estimate',
      [call.evidence],
    );
  }

  if (grounded === false) {
    return unknown(
      'get_pricing_intel returned grounded:false — no GSA CALC labor rates for this NAICS; Mindy does not fabricate rates and does not produce the Independent Government Estimate (Phase 2 / KO-owned)',
      [call.evidence],
    );
  }

  if (grounded !== true) {
    return unknown(
      'get_pricing_intel did not report grounded:true — pricing evidence not established',
      [call.evidence],
    );
  }

  const pricing = (call.result as { pricing?: Record<string, unknown> | null } | undefined)?.pricing;
  if (!pricing || typeof pricing !== 'object') {
    return unknown(
      'get_pricing_intel was grounded but returned no pricing payload — rates not established',
      [call.evidence],
    );
  }

  const ptw = pricing.priceToWinGuidance as
    | { aggressiveRate?: number; competitiveRate?: number; premiumRate?: number }
    | undefined;
  const cats = Array.isArray(pricing.laborCategories) ? pricing.laborCategories : [];
  const records =
    typeof pricing.totalRecordsAnalyzed === 'number' ? pricing.totalRecordsAnalyzed : undefined;
  const top = cats[0] as { category?: string; median?: number; percentile25?: number; percentile75?: number } | undefined;

  const parts: string[] = [
    `GSA CALC labor-rate ${SUPPORTING_NOT_IGE} for NAICS ${primaryNaics}`,
  ];
  if (ptw) {
    parts.push(
      `price-to-win targets: aggressive ${fmtRate(ptw.aggressiveRate)} / competitive ${fmtRate(ptw.competitiveRate)} / premium ${fmtRate(ptw.premiumRate)}`,
    );
  }
  if (top?.category) {
    parts.push(
      `top category "${top.category}" median ${fmtRate(top.median)}` +
        (typeof top.percentile25 === 'number' && typeof top.percentile75 === 'number'
          ? ` (p25 ${fmtRate(top.percentile25)} – p75 ${fmtRate(top.percentile75)})`
          : ''),
    );
  }
  parts.push(
    `based on ${cats.length} labor categor${cats.length === 1 ? 'y' : 'ies'}` +
      (records !== undefined ? ` across ${records.toLocaleString('en-US')} awarded records` : ''),
  );
  parts.push(
    'These are Schedule labor-rate inputs for market research only; the Independent Government Estimate is Phase 2 and KO-owned.',
  );

  return value(parts.join('. ') + '.', call.evidence);
}

function buildSbFootprint(s12: Section12Slice): GroundedField<string> {
  const count = s12.capableFamilyCount;
  const det = s12.determination;
  const rec = s12.recommendation;

  // Prefer grounded pieces; never invent a determination or count.
  if (count.state === 'unknown' && det.state === 'unknown') {
    return unknown(
      '§12 capable-family count and Rule-of-Two determination were not established',
      [...(count.attemptedEvidence ?? []), ...(det.attemptedEvidence ?? [])],
    );
  }
  if (count.state === 'degraded' || det.state === 'degraded') {
    const reasons = [
      count.state === 'degraded' ? count.reason : null,
      det.state === 'degraded' ? det.reason : null,
    ].filter(Boolean);
    return degraded(
      `§12 small-business footprint degraded — ${reasons.join('; ')}`,
      [
        ...(count.state === 'degraded' ? count.evidence : []),
        ...(det.state === 'degraded' ? det.evidence : []),
        ...(count.state === 'value' || count.state === 'true_zero' ? [count.evidence] : []),
        ...(det.state === 'value' ? [det.evidence] : []),
      ],
    );
  }

  const countTxt =
    count.state === 'value'
      ? `${count.value}`
      : count.state === 'true_zero'
        ? '0'
        : null;
  const detTxt = det.state === 'value' ? det.value : null;

  if (countTxt === null || detTxt === null) {
    return unknown(
      '§12 small-business footprint incomplete — capable-family count or determination missing',
      [
        ...(count.state === 'unknown' ? count.attemptedEvidence ?? [] : []),
        ...(det.state === 'unknown' ? det.attemptedEvidence ?? [] : []),
        ...(count.state === 'value' || count.state === 'true_zero' ? [count.evidence] : []),
        ...(det.state === 'value' ? [det.evidence] : []),
      ],
    );
  }

  const detLabel =
    detTxt === 'met' ? 'met' : detTxt === 'not_met' ? 'not met' : 'undetermined';
  const recTail =
    rec.state === 'value' && rec.value.trim()
      ? ` Recommendation (from §12): ${rec.value}`
      : '';

  const text =
    `Small-business footprint (reused from §12): Rule of Two ${detLabel}; ` +
    `${countTxt} capable small-business corporate famil${countTxt === '1' ? 'y' : 'ies'} counted.` +
    recTail;

  // Evidence from the determination (or count) — both are §12-sourced.
  const e =
    det.state === 'value'
      ? det.evidence
      : count.state === 'value' || count.state === 'true_zero'
        ? count.evidence
        : null;
  if (!e) {
    return unknown('§12 small-business footprint missing provenance');
  }
  return value(text, e);
}

function buildSocioFootprint(s12: Section12Slice): GroundedField<string> {
  const rows = s12.socioCounts ?? [];
  if (rows.length === 0) {
    return unknown('§12 reported no socioeconomic designation counts');
  }

  const parts: string[] = [];
  const evidenceRefs: EvidenceRef[] = [];
  let anyUnknown = false;
  let anyDegraded = false;
  let anyValue = false;

  for (const row of rows) {
    const fc = row.familyCount;
    if (fc.state === 'value' || fc.state === 'true_zero') {
      anyValue = true;
      parts.push(`${row.designation}: ${fc.value} famil${fc.value === 1 ? 'y' : 'ies'}`);
      evidenceRefs.push(fc.evidence);
    } else if (fc.state === 'degraded') {
      anyDegraded = true;
      parts.push(`${row.designation}: degraded (${fc.reason})`);
      evidenceRefs.push(...fc.evidence);
    } else {
      anyUnknown = true;
      parts.push(`${row.designation}: unknown`);
      if (fc.attemptedEvidence) evidenceRefs.push(...fc.attemptedEvidence);
    }
  }

  if (!anyValue && anyDegraded) {
    return degraded(
      `socioeconomic footprint degraded — ${parts.join('; ')}`,
      evidenceRefs,
    );
  }
  if (!anyValue) {
    return unknown(
      `socioeconomic footprint not established — ${parts.join('; ')}`,
      evidenceRefs,
    );
  }

  const text =
    `Socioeconomic footprint (parent-deduplicated families from §12): ${parts.join('; ')}.` +
    (anyUnknown || anyDegraded
      ? ' Some designation counts were not fully established (see per-designation notes).'
      : '');

  return value(text, evidenceRefs[0]);
}

function buildConcentrationAndDiversity(
  coverageSet: GroundedField<CoverageShare[] | unknown>,
): {
  supplierConcentration: GroundedField<string>;
  marketDiversity: GroundedField<string>;
} {
  if (coverageSet.state === 'unknown') {
    const r = coverageSet.reason;
    return {
      supplierConcentration: unknown(`supplier concentration not established — ${r}`, coverageSet.attemptedEvidence),
      marketDiversity: unknown(`market diversity not established — ${r}`, coverageSet.attemptedEvidence),
    };
  }
  if (coverageSet.state === 'degraded') {
    const r = coverageSet.reason;
    return {
      supplierConcentration: degraded(`supplier concentration degraded — ${r}`, coverageSet.evidence),
      marketDiversity: degraded(`market diversity degraded — ${r}`, coverageSet.evidence),
    };
  }
  // true_zero is not expected for an array field; treat like empty.
  if (coverageSet.state === 'true_zero') {
    return {
      supplierConcentration: unknown('coverage set empty — no NAICS shares to measure concentration', [coverageSet.evidence]),
      marketDiversity: value('Coverage set contains 0 NAICS codes (diversity proxy).', coverageSet.evidence),
    };
  }

  const shares = asCoverageShares(coverageSet.value);
  if (!shares || shares.length === 0) {
    return {
      supplierConcentration: unknown('coverage set empty — no NAICS shares to measure concentration', [coverageSet.evidence]),
      marketDiversity: unknown('coverage set empty — NAICS diversity not established', [coverageSet.evidence]),
    };
  }

  // Top share by pct (largest NAICS share in the measured coverage set).
  const top = [...shares].sort((a, b) => b.pct - a.pct)[0];
  const namePart = top.name ? ` (${top.name})` : '';
  const concentration = value(
    `Largest NAICS share ${formatSharePct(top.pct)} — ${top.code}${namePart} of the measured keyword-coverage market.`,
    coverageSet.evidence,
  );
  const diversity = value(
    `Market diversity proxy: ${shares.length} NAICS code${shares.length === 1 ? '' : 's'} in the §5 coverage set.`,
    coverageSet.evidence,
  );
  return { supplierConcentration: concentration, marketDiversity: diversity };
}

function buildLimitations(
  req: Requirement,
  s5: Section5Slice,
  s12: Section12Slice,
  pricingEvidence: GroundedField<string>,
  concentration: GroundedField<string>,
  diversity: GroundedField<string>,
): string[] {
  const measured: string[] = [];
  const estimates: string[] = [];
  const unknowns: string[] = [];

  // Market $
  if (s5.marketTotal.state === 'value') {
    measured.push(`total market ${money(s5.marketTotal.value)} reused from §5 keyword coverage (${req.keyword})`);
  } else if (s5.marketTotal.state === 'true_zero') {
    measured.push(`total market recorded as 0 from §5 (${s5.marketTotal.label})`);
  } else if (s5.marketTotal.state === 'degraded') {
    unknowns.push(`total market degraded from §5 — ${s5.marketTotal.reason}`);
  } else {
    unknowns.push(`total market unknown from §5 — ${s5.marketTotal.reason}`);
  }

  if (concentration.state === 'value') {
    measured.push(`supplier concentration from §5 coverage NAICS shares: ${concentration.value}`);
  } else {
    unknowns.push(`supplier concentration not established (${concentration.state})`);
  }

  if (diversity.state === 'value') {
    // Diversity is a PROXY (NAICS count), not a measured Herfindahl — label as estimate/proxy.
    estimates.push(`market diversity is a NAICS-count proxy from the §5 coverage set, not a formal concentration index`);
  } else {
    unknowns.push(`market diversity not established (${diversity.state})`);
  }

  if (s12.capableFamilyCount.state === 'value' || s12.capableFamilyCount.state === 'true_zero') {
    measured.push(`§12 capable small-business family count reused`);
  } else {
    unknowns.push(`§12 capable-family count not established`);
  }

  if (pricingEvidence.state === 'value') {
    estimates.push(
      `GSA CALC labor rates are Schedule ${SUPPORTING_NOT_IGE}; they are not the Independent Government Estimate (Phase 2 / KO-owned)`,
    );
  } else if (pricingEvidence.state === 'degraded') {
    unknowns.push(`pricing evidence degraded — ${pricingEvidence.reason}`);
  } else if (pricingEvidence.state === 'unknown') {
    unknowns.push(`pricing evidence unknown — ${pricingEvidence.reason}`);
  } else {
    unknowns.push(`pricing evidence not established (${pricingEvidence.state})`);
  }

  estimates.push(
    '§15 does not auto-fill commerciality (§15b) — that determination remains Phase 2 / KO-owned',
  );

  return [
    `Measured facts: ${measured.length ? measured.join('; ') : 'none established in this build'}.`,
    `Estimates / proxies: ${estimates.join('; ')}.`,
    `Unknowns: ${unknowns.length ? unknowns.join('; ') : 'none recorded'}.`,
  ];
}

export async function buildSection15(
  req: Requirement,
  primaryNaics: string | undefined,
  s5: Section5Slice,
  s12: Section12Slice,
  opts?: PricingOpts,
): Promise<Section15> {
  const calls: ToolCall[] = [];

  // 1. Reuse §5 market $ + basis — do not re-fetch coverage.
  const totalMarket = s5.marketTotal;
  const marketBasis = s5.marketBasis;

  // 2–3. Concentration + diversity from coverage set shares.
  const { supplierConcentration, marketDiversity } = buildConcentrationAndDiversity(s5.coverageSet);

  // 4–5. SB + socio footprint from §12.
  const sbFootprint = buildSbFootprint(s12);
  const socioeconomicFootprint = buildSocioFootprint(s12);

  // 6–8. Pricing evidence (never IGE).
  const pricingCall = await resolvePricingCall(primaryNaics, opts);
  if (pricingCall) calls.push(pricingCall);
  const pricingEvidence = buildPricingEvidence(pricingCall, primaryNaics);

  const limitations = buildLimitations(
    req,
    s5,
    s12,
    pricingEvidence,
    supplierConcentration,
    marketDiversity,
  );

  return {
    totalMarket,
    marketBasis,
    supplierConcentration,
    marketDiversity,
    sbFootprint,
    socioeconomicFootprint,
    pricingEvidence,
    pricingIsIge: false,
    calls,
    limitations,
  };
}
