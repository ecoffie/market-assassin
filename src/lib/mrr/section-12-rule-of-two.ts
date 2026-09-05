/**
 * MRR Block 6 — §12 Small Business Opportunities / Rule of Two.
 *
 * Counts DISTINCT parent-deduplicated capable small-business families from §11
 * (never raw UEIs). Reconciles with assess_market_depth: a tool "met" that
 * collapses under family dedup is inflation, not support. Failures and truncated
 * samples stay undetermined / unknown — never a fabricated "no small businesses."
 *
 * Spec: INTERFACE-CONTRACTS.md §12; mrw-phase1-dev-spec.md §12.
 */
import type {
  CorporateFamilyResolution,
  EvidenceRef,
  GroundedField,
  Requirement,
  RuleOfTwoDetermination,
  SocioCount,
  SocioDesignation,
  SupplierRow,
} from './types';
import type { Section11 } from './section-11-suppliers';
import { callTool, metaDegraded, type ToolCall } from './mindy-client';
import { degraded, evidence, trueZero, unknown, value } from './grounding';
import { countEligibleFamilies } from './corporate-family';

export interface Section12 {
  determination: GroundedField<RuleOfTwoDetermination>;
  recommendation: GroundedField<string>;
  capableFamilyCount: GroundedField<number>;
  countedFamilies: Array<{ familyKey: string; displayName: string; uei: string }>;
  excluded: Array<{ uei: string; reason: string }>;
  socioCounts: SocioCount[];
  goalingContext: GroundedField<string>;
  sampleCoverage: GroundedField<number>;
  calls: ToolCall[];
  limitations: string[];
}

const SOCIO_DESIGNATIONS: SocioDesignation[] = [
  '8(a)',
  'HUBZone',
  'SDVOSB',
  'WOSB',
  'EDWOSB',
];

const CAPABLE_TIER_RE = /tier\s*=\s*(active_performer|capable)\b/i;
const SMALL_SIZE_RE = /\bsmall\b/i;
const OTHER_THAN_SMALL_RE = /other\s+than\s+small|\blarge\b/i;

export interface BuildSection12Opts {
  /** Optional synthetic assess_market_depth if s11 insufficient. */
  depthResult?: unknown;
  depthOk?: boolean;
  goalingResult?: unknown;
  goalingOk?: boolean;
}

function ueiOf(row: SupplierRow): string {
  if (row.uei.state === 'value') return row.uei.value;
  return row.family.rawUei || '';
}

function displayNameOf(row: SupplierRow): string {
  if (row.canonicalName.state === 'value' && row.canonicalName.value.trim()) {
    return row.canonicalName.value.trim();
  }
  if (row.legalEntityName.state === 'value' && row.legalEntityName.value.trim()) {
    return row.legalEntityName.value.trim();
  }
  return row.family.canonical?.displayName?.trim() || ueiOf(row) || 'unnamed family';
}

/** Capability evidence must be grounded AND show capable/active_performer tier. */
function hasCapableTierEvidence(row: SupplierRow): boolean {
  if (row.capabilityEvidence.state !== 'value') return false;
  return CAPABLE_TIER_RE.test(row.capabilityEvidence.value);
}

/**
 * SB status must be established. Missing size is NEVER treated as small.
 * Returns true / false / null(unknown).
 */
function establishedSmallStatus(row: SupplierRow): boolean | null {
  if (row.businessSize.state !== 'value') return null;
  const v = row.businessSize.value.trim();
  if (!v) return null;
  if (OTHER_THAN_SMALL_RE.test(v)) return false;
  if (SMALL_SIZE_RE.test(v)) return true;
  return null;
}

function pickDepthFromS11(s11: Section11): ToolCall | undefined {
  return s11.calls.find((c) => c.tool === 'assess_market_depth');
}

async function resolveDepthCall(
  req: Requirement,
  primaryNaics: string | undefined,
  s11: Section11,
  opts: BuildSection12Opts | undefined,
  calls: ToolCall[],
): Promise<ToolCall | null> {
  const args: Record<string, unknown> = {
    naics: primaryNaics ?? req.naics ?? '',
    set_aside: 'Small Business',
    limit: 50,
  };
  if (req.place_of_performance_state) {
    args.state = req.place_of_performance_state;
  }

  // Synthetic opts take precedence (tests / injectors).
  if (opts?.depthResult !== undefined || opts?.depthOk === false) {
    const ev = evidence('Mindy MCP assess_market_depth', args);
    const ok = opts.depthOk !== false;
    const call: ToolCall = ok
      ? {
          tool: 'assess_market_depth',
          args,
          evidence: ev,
          ok: true,
          result: opts.depthResult as Record<string, unknown>,
        }
      : {
          tool: 'assess_market_depth',
          args,
          evidence: ev,
          ok: false,
          error: 'assess_market_depth failed (injected)',
        };
    calls.push(call);
    return call;
  }

  const existing = pickDepthFromS11(s11);
  if (existing) {
    // Reuse §11 call — do not re-push (already on s11); track for §12.calls so
    // the section's evidence trail is self-contained.
    calls.push(existing);
    return existing;
  }

  if (!primaryNaics && !req.naics) {
    return null;
  }

  const call = await callTool('assess_market_depth', args);
  calls.push(call);
  return call;
}

async function resolveGoalingCall(
  req: Requirement,
  opts: BuildSection12Opts | undefined,
  calls: ToolCall[],
): Promise<ToolCall> {
  const args = { agency: req.agency };
  if (opts?.goalingResult !== undefined || opts?.goalingOk === false) {
    const ev = evidence('Mindy MCP get_sba_goaling_share', args);
    const ok = opts.goalingOk !== false;
    const call: ToolCall = ok
      ? {
          tool: 'get_sba_goaling_share',
          args,
          evidence: ev,
          ok: true,
          result: opts.goalingResult as Record<string, unknown>,
        }
      : {
          tool: 'get_sba_goaling_share',
          args,
          evidence: ev,
          ok: false,
          error: 'get_sba_goaling_share failed (injected)',
        };
    calls.push(call);
    return call;
  }
  const call = await callTool('get_sba_goaling_share', args);
  calls.push(call);
  return call;
}

function readSampleCoverage(depth: ToolCall | null): {
  coverage: number | null;
  field: GroundedField<number>;
} {
  if (!depth) {
    return {
      coverage: null,
      field: unknown('assess_market_depth was not available — sample coverage unknown'),
    };
  }
  if (!depth.ok) {
    return {
      coverage: null,
      field: unknown(
        `assess_market_depth failed: ${depth.error ?? 'unknown error'}`,
        [depth.evidence],
      ),
    };
  }
  if (metaDegraded(depth.result) === true) {
    return {
      coverage: null,
      field: unknown(
        'assess_market_depth reported degraded upstream data — sample coverage cannot be established',
        [depth.evidence],
      ),
    };
  }
  const raw = (depth.result as { sample_coverage?: number | null } | undefined)?.sample_coverage;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { coverage: raw, field: value(raw, depth.evidence) };
  }
  return {
    coverage: null,
    field: unknown(
      'assess_market_depth did not report sample_coverage',
      [depth.evidence],
    ),
  };
}

function formatGoaling(call: ToolCall): GroundedField<string> {
  if (!call.ok) {
    return unknown(
      `get_sba_goaling_share failed: ${call.error ?? 'unknown error'}`,
      [call.evidence],
    );
  }
  if (metaDegraded(call.result) === true) {
    return unknown(
      'get_sba_goaling_share reported degraded upstream data',
      [call.evidence],
    );
  }
  const r = (call.result ?? {}) as {
    agency?: string | null;
    fiscal_year?: number;
    goals?: Array<{
      category: string;
      goal_pct: number;
      actual_setaside_pct: number;
      meets_goal: boolean;
    }> | null;
    _meta?: { grounded?: boolean; small_business_setaside_share?: number; basis?: string };
  };
  if (r._meta?.grounded === false || r.goals == null) {
    return unknown(
      'SBA goaling share could not be established for this agency (unmatched or no set-aside dollars)',
      [call.evidence],
    );
  }
  const agency = r.agency ?? 'agency';
  const fy = r.fiscal_year ?? 'n/a';
  const sbShare = r._meta?.small_business_setaside_share;
  const lines = r.goals.map(
    (g) =>
      `${g.category}: actual ${g.actual_setaside_pct}% vs goal ${g.goal_pct}% (${g.meets_goal ? 'meets' : 'below'})`,
  );
  const head =
    typeof sbShare === 'number'
      ? `${agency} FY${fy}: ${sbShare}% of dollars through small-business set-aside codes.`
      : `${agency} FY${fy}: set-aside goaling vs statutory floors.`;
  return value(`${head} ${lines.join('; ')}.`, call.evidence);
}

function buildSocioCounts(
  counted: SupplierRow[],
  ev: EvidenceRef,
): SocioCount[] {
  const withSocio = counted.filter((r) => r.socioeconomic.state === 'value');
  const anyUnknownSocio = counted.some(
    (r) => r.socioeconomic.state === 'unknown' || r.socioeconomic.state === 'degraded',
  );

  return SOCIO_DESIGNATIONS.map((designation) => {
    if (counted.length === 0) {
      // No eligible families at all — designation empty is not a measured market claim
      // unless we have a successful depth read establishing the pool. Prefer unknown
      // over fabricated zero when the capable set itself is empty for inconclusive reasons.
      return {
        designation,
        familyCount: unknown(
          `no Rule-of-Two-eligible capable small-business families to attribute ${designation}`,
          [ev],
        ),
      };
    }

    if (withSocio.length === 0) {
      return {
        designation,
        familyCount: unknown(
          `socioeconomic designations were not established for counted families — ${designation} count unknown`,
          [ev],
        ),
      };
    }

    const keys = new Set<string>();
    for (const row of withSocio) {
      if (row.socioeconomic.state !== 'value') continue;
      if (!row.socioeconomic.value.includes(designation)) continue;
      const key = row.family.canonical?.familyKey;
      if (key) keys.add(key);
    }

    if (keys.size > 0) {
      return { designation, familyCount: value(keys.size, ev) };
    }

    // Measured empty only when EVERY counted family has grounded socio arrays.
    if (!anyUnknownSocio && withSocio.length === counted.length) {
      return {
        designation,
        familyCount: trueZero(
          `no counted capable families carry ${designation}`,
          ev,
        ),
      };
    }

    return {
      designation,
      familyCount: unknown(
        `cannot establish ${designation} family count — some counted families lack socioeconomic evidence`,
        [ev],
      ),
    };
  });
}

/**
 * Prefer §11 suppliers (already family-resolved). Count unique familyKeys among
 * suppliers that are ruleOfTwoEligible + capable-tier + established small.
 */
function selectCapableFamilies(suppliers: SupplierRow[]): {
  counted: SupplierRow[];
  countedFamilies: Section12['countedFamilies'];
  excluded: Section12['excluded'];
} {
  const excluded: Section12['excluded'] = [];
  const byKey = new Map<string, SupplierRow>();

  for (const row of suppliers) {
    const uei = ueiOf(row) || row.family.rawUei || '(missing-uei)';

    if (!row.family.ruleOfTwoEligible || !row.family.canonical?.familyKey) {
      excluded.push({
        uei,
        reason:
          row.family.ineligibleReason ??
          `corporate family ${row.family.method} — Rule-of-Two ineligible`,
      });
      continue;
    }

    if (!hasCapableTierEvidence(row)) {
      excluded.push({
        uei,
        reason: 'no grounded capable/active_performer capability evidence',
      });
      continue;
    }

    const size = establishedSmallStatus(row);
    if (size === null) {
      excluded.push({
        uei,
        reason: 'business size not established — cannot treat as small',
      });
      continue;
    }
    if (size === false) {
      excluded.push({
        uei,
        reason: 'established as other than small — excluded from Rule of Two',
      });
      continue;
    }

    const key = row.family.canonical.familyKey;
    // One family → at most one count (keep first / richest already in §11).
    if (!byKey.has(key)) {
      byKey.set(key, row);
    } else {
      excluded.push({
        uei,
        reason: `sibling UEI under familyKey ${key} — already counted once toward Rule of Two`,
      });
    }
  }

  // Cross-check with countEligibleFamilies on the counted resolutions (sanity).
  const resolutions: CorporateFamilyResolution[] = [...byKey.values()].map((r) => r.family);
  const { eligibleKeys } = countEligibleFamilies(resolutions);
  // Drop any that somehow lost eligibility (should be none).
  const counted = [...byKey.entries()]
    .filter(([k]) => eligibleKeys.includes(k))
    .map(([, row]) => row);

  const countedFamilies = counted.map((row) => ({
    familyKey: row.family.canonical!.familyKey,
    displayName: displayNameOf(row),
    uei: ueiOf(row),
  }));

  return { counted, countedFamilies, excluded };
}

function toolDetermination(
  depth: ToolCall | null,
): RuleOfTwoDetermination | null {
  if (!depth || !depth.ok || metaDegraded(depth.result) === true) return null;
  const d = (depth.result as { rule_of_two_determination?: string } | undefined)
    ?.rule_of_two_determination;
  if (d === 'met' || d === 'not_met' || d === 'undetermined') return d;
  return null;
}

function buildDeterminationAndRecommendation(args: {
  n: number;
  countedFamilies: Section12['countedFamilies'];
  coverage: number | null;
  depth: ToolCall | null;
  depthFailed: boolean;
  depthDegraded: boolean;
  evidence: EvidenceRef;
}): {
  determination: GroundedField<RuleOfTwoDetermination>;
  recommendation: GroundedField<string>;
  limitations: string[];
} {
  const { n, countedFamilies, coverage, depth, depthFailed, depthDegraded, evidence: ev } = args;
  const limitations: string[] = [];
  const names = countedFamilies.map((f) => f.displayName).join('; ');
  const toolDet = toolDetermination(depth);

  // Failed read → NEVER not_met from fabricated 0.
  if (depthFailed) {
    return {
      determination: unknown(
        `assess_market_depth failed: ${depth?.error ?? 'unknown error'} — Rule of Two cannot be determined`,
        depth ? [depth.evidence] : [ev],
      ),
      recommendation: value(
        `Insufficient evidence to support a set-aside — assess_market_depth failed (${depth?.error ?? 'unknown error'}); a failed read is not a finding of zero capable small businesses.`,
        depth?.evidence ?? ev,
      ),
      limitations: [
        'Market-depth lookup failed; Rule of Two is Unknown, not "not met".',
      ],
    };
  }

  if (depthDegraded) {
    return {
      determination: unknown(
        'assess_market_depth reported degraded upstream data — Rule of Two cannot be determined',
        depth ? [depth.evidence] : [ev],
      ),
      recommendation: value(
        'Insufficient evidence to support a set-aside — market-depth data was degraded; do not treat missing capable families as "no small businesses."',
        depth?.evidence ?? ev,
      ),
      limitations: [
        'Market-depth data degraded; determination withheld (undetermined/unknown), never not_met.',
      ],
    };
  }

  // ≥2 distinct parent-deduplicated capable SB families → supportable.
  if (n >= 2) {
    const rec =
      `Rule of Two supported: ${n} distinct parent-deduplicated capable small businesses` +
      (names ? ` (${names})` : '') +
      '.';
    return {
      determination: value('met', ev),
      recommendation: value(rec, ev),
      limitations,
    };
  }

  // Tool claimed met but family dedup yields <2 → inflation.
  if (toolDet === 'met' && n < 2) {
    const reason = `UEI count inflated; parent-deduplicated capable families = ${n}`;
    limitations.push(reason);
    const inconclusive = coverage === null || coverage < 1;
    const det: RuleOfTwoDetermination = inconclusive ? 'undetermined' : 'not_met';
    return {
      determination: degraded(reason, [ev], det),
      recommendation: value(
        inconclusive
          ? `Insufficient evidence to support a set-aside — ${reason} (sample_coverage=${coverage ?? 'unknown'} < 1; tool met is not conclusive under parent dedup).`
          : `Insufficient evidence to support a set-aside — ${reason}.`,
        ev,
      ),
      limitations,
    };
  }

  // Truncated / unknown coverage with <2 → undetermined (NOT not_met).
  if (coverage === null || coverage < 1) {
    const why =
      coverage === null
        ? 'sample coverage was not established'
        : `sample_coverage=${coverage} (< 1) — sample is not exhaustive`;
    limitations.push(
      `${why}; fewer than 2 parent-deduplicated capable families in sample cannot support a conclusive not_met.`,
    );
    return {
      determination: value('undetermined', ev),
      recommendation: value(
        `Insufficient evidence to support a set-aside — only ${n} distinct parent-deduplicated capable small-business famil${n === 1 ? 'y' : 'ies'} in sample and ${why}.`,
        ev,
      ),
      limitations,
    };
  }

  // Exhaustive (sample_coverage === 1) AND <2 → conclusive not supported.
  const rec =
    `Rule of Two not supported: only ${n} distinct parent-deduplicated capable small business` +
    (n === 1 ? '' : 'es') +
    ` identified under exhaustive sample coverage` +
    (names ? ` (${names})` : '') +
    '.';
  return {
    determination: value(n === 0 ? 'not_met' : 'not_met', ev),
    recommendation: value(rec, ev),
    limitations,
  };
}

export async function buildSection12(
  req: Requirement,
  primaryNaics: string | undefined,
  s11: Section11,
  opts?: BuildSection12Opts,
): Promise<Section12> {
  const calls: ToolCall[] = [];
  const limitations: string[] = [];

  const depth = await resolveDepthCall(req, primaryNaics, s11, opts, calls);
  const goalingCall = await resolveGoalingCall(req, opts, calls);

  const depthFailed = !!depth && !depth.ok;
  const depthDegraded = !!depth && depth.ok && metaDegraded(depth.result) === true;

  const { coverage, field: sampleCoverage } = readSampleCoverage(depth);
  if (coverage !== null && coverage < 1) {
    limitations.push(
      `sample_coverage=${coverage} (< 1): Rule-of-Two "not met" is not conclusive on a truncated sample`,
    );
  }

  const sectionEv =
    depth?.evidence ??
    evidence('MRR §12 Small Business Opportunities', {
      agency: req.agency,
      primaryNaics: primaryNaics ?? null,
      supplierRows: s11.suppliers.length,
    });

  // Prefer deriving from s11.suppliers (already family-resolved).
  const { counted, countedFamilies, excluded } = selectCapableFamilies(s11.suppliers);
  const n = countedFamilies.length;

  const fleetResolveFailed =
    s11.deduplicatedFamilyCount.state === 'unknown'
    || (
      s11.suppliers.length > 0
      && s11.suppliers.every(
        (s) =>
          s.family.method === 'lookup_failed'
          || s.family.method === 'malformed_uei'
          || s.family.confidence === 'unresolved',
      )
    );

  let capableFamilyCount: GroundedField<number>;
  if (depthFailed && s11.suppliers.length === 0) {
    // Failed read with no supplier evidence → unknown count, never 0.
    capableFamilyCount = unknown(
      `assess_market_depth failed: ${depth?.error ?? 'unknown error'} — capable family count cannot be established`,
      depth ? [depth.evidence] : [sectionEv],
    );
  } else if (depthDegraded && s11.suppliers.length === 0) {
    capableFamilyCount = unknown(
      'assess_market_depth degraded — capable family count cannot be established',
      depth ? [depth.evidence] : [sectionEv],
    );
  } else if (fleetResolveFailed && n === 0) {
    // Parent-edge lookup failed (e.g. BQ quota) for the whole set — NOT a measured zero.
    capableFamilyCount = unknown(
      s11.deduplicatedFamilyCount.state === 'unknown'
        ? s11.deduplicatedFamilyCount.reason
        : 'corporate-family resolution failed for supplier UEIs — capable family count cannot be established',
      depth ? [depth.evidence] : [sectionEv],
    );
  } else if (n === 0) {
    // Measured empty among established candidates — true_zero ONLY when we have
    // a successful non-degraded depth (or grounded §11 rows that were all excluded
    // for documented reasons). A failed/degraded path already returned unknown.
    if (depthFailed || depthDegraded) {
      capableFamilyCount = unknown(
        'capable parent-deduplicated family count cannot be established from a failed/degraded market-depth read',
        depth ? [depth.evidence] : [sectionEv],
      );
    } else {
      capableFamilyCount = trueZero(
        'no distinct parent-deduplicated capable small-business families after family resolution and size/capability gates',
        sectionEv,
      );
    }
  } else {
    capableFamilyCount = value(n, sectionEv);
  }

  const { determination, recommendation, limitations: detLimits } =
    buildDeterminationAndRecommendation({
      n,
      countedFamilies,
      coverage,
      depth,
      depthFailed,
      depthDegraded,
      evidence: sectionEv,
    });
  limitations.push(...detLimits);

  // If depth failed/degraded, force recommendation onto Insufficient evidence
  // even when family selection produced a count from stale s11 rows.
  // (buildDeterminationAndRecommendation already handles this.)

  const socioCounts = buildSocioCounts(counted, sectionEv);
  const goalingContext = formatGoaling(goalingCall);

  // Carry forward §11 truncation notes that matter for RoT.
  for (const lim of s11.limitations) {
    if (/sample_coverage/i.test(lim) && !limitations.includes(lim)) {
      limitations.push(lim);
    }
  }

  return {
    determination,
    recommendation,
    capableFamilyCount,
    countedFamilies,
    excluded,
    socioCounts,
    goalingContext,
    sampleCoverage,
    calls,
    limitations,
  };
}
