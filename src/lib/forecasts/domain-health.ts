/**
 * FORECAST DOMAIN HEALTH — the authority, derived from the HELD CORPUS.
 *
 * ⚠️ THE UNIVERSE STARTS FROM THE DATA, NOT FROM A REGISTRY. The previous authority
 * enumerated `FORECAST_SOURCE_POLICY`, a hardcoded 8-entry list. Measured 2026-09-14
 * that silently hid **13 of 20 represented agencies and 20,299 of 35,741 rows**, and
 * reported the domain `critical` for a "GSA outage" that was really an unregistered
 * source. Enumerating `data_source_instances` instead would hide exactly the same 13
 * agencies — there are only 7 instance rows. So the universe is
 * `SELECT DISTINCT (source_agency, source_type) FROM agency_forecasts`, and control
 * metadata is LEFT-JOINED onto it. A pair that exists in the data can never vanish
 * from health; at worst it surfaces as UNREGISTERED.
 *
 * ⚠️ A MISSING CONTROL PLANE IS NOT A FAILING SOURCE. `UNREGISTERED` means nobody has
 * dispositioned it yet — it is a domain TODO, not an outage, and must never be reported
 * as `critical`.
 *
 * ⚠️ DISPOSITION IS NOT FAILURE. A BLOCKED_CONTROLLED source with a healthy watcher is
 * in its intended final state. Watch-job success is not source currentness and not
 * ingest success; the two are tracked separately and never collapsed.
 *
 * ⚠️ NO COMPOSITE SCORE. Per the Data Core constitution this exposes exact semantic
 * populations, never a single "forecast health %" that hides which sources are blocked,
 * unregistered or historical. A blocked source is not a zero; an unregistered source is
 * not a failed ingest.
 */

/** The semantic state of one physical (agency, source_type) pair. */
export type ForecastSourceState =
  | 'AUTOMATED_CURRENT'
  | 'AUTOMATED_CURRENT_WITH_EXCEPTIONS'
  | 'MANUAL_CONTROLLED'
  | 'BLOCKED_CONTROLLED'
  | 'UNREGISTERED'
  | 'SUPERSEDED'
  | 'HISTORICAL_ONLY'
  | 'RETIRED'
  | 'UNKNOWN_CONFIGURATION';

/** One physical pair as it exists in agency_forecasts. */
export interface PhysicalPair {
  agency: string;
  sourceType: string;
  rows: number;                 // exact; -1 means COULD NOT MEASURE, never 0
  lastWriteAt: string | null;
}

/**
 * The explicit PAIR → CANONICAL SOURCE relationship.
 *
 * ⚠️ CONTROL IS THE BINDING, NOT A NAME MATCH. An instance that merely shares an
 * agency name governs nothing; `data_source_pair_bindings` is the only evidence of
 * control. That is what lets ONE Gateway source govern seven pairs without being
 * counted seven times.
 */
export interface PairBinding {
  agency: string;
  sourceType: string;
  disposition:
    | 'canonical_active' | 'canonical_controlled' | 'duplicate_ingest_path'
    | 'superseded' | 'historical_only' | 'retired' | 'blocked';
  /** NULL is legitimate: historical_only/retired have no current canonical source. */
  sourceKey: string | null;
  evidence: string | null;
}

/** The control-plane row for a canonical source, when one exists. */
export interface InstanceEvidence {
  sourceKey: string;
  agency: string;
  /** Which source_type(s) this instance governs. Empty = every pair of the agency. */
  sourceTypes?: string[];
  ingestMode: 'automated' | 'manual' | 'blocked';
  sourceState: string;
  interventionState: string;
  heldPopulation: number | null;
  upstreamPopulation: number | null;
  upstreamFingerprint: string | null;
  lastPoll: string | null;
  lastSuccessfulCheck: string | null;
  lastSourceAdvance: string | null;
  lastVerifiedIngest: string | null;
  lastDataAdvance: string | null;
  runbookPath: string | null;
  /** True when a watcher/ingest cron exists and is enabled for this source. */
  hasScheduledJob: boolean;
  scheduledJobKind?: 'ingest' | 'watch';
  /** Sources that intentionally reject some rows (DOJ cross-edition guard). */
  hasExplicitRejections?: boolean;
}

export interface PairHealth {
  agency: string;
  sourceType: string;
  rows: number;
  lastWriteAt: string | null;
  state: ForecastSourceState;
  sourceKey: string | null;
  ingestMode: string | null;
  /** Whether this pair is inside the source control plane at all. */
  registered: boolean;
  /** Only a source we intend to poll can be operationally unhealthy. */
  operationalConcern: boolean;
  reasons: string[];
}

export interface ForecastDomainHealth {
  /** Exact populations — no composite score. */
  representedAgencies: number;
  /** Agencies whose every pair carries an explicit disposition. */
  controlledAgencies: number;
  uncontrolledAgencies: number;
  /** Agencies with at least one pair governed by a canonical instance. */
  instanceBackedAgencies: number;
  canonicalSourceInstances: number;
  registeredAgencies: number;
  unregisteredAgencies: number;
  physicalPairs: number;
  dispositionedPairs: number;
  undispositionedPairs: number;
  physicalRows: number;
  rowsUnderControlPlane: number;
  rowsOutsideControlPlane: number;
  byState: Record<ForecastSourceState, number>;
  pairs: PairHealth[];
  /** Unmeasurable counts are surfaced, never coerced to zero. */
  unmeasuredPairs: string[];
  /** Domain-level blockers to Phase II closure, as explicit statements. */
  domainTodos: string[];
  /** Operational concerns ONLY — never unregistered or dispositioned states. */
  operationalConcerns: string[];
}

const WARN_DAYS = 3;
const CRITICAL_DAYS = 7;

function daysSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86_400_000)) : null;
}

/** Does this instance govern this pair? */
function governs(inst: InstanceEvidence, pair: PhysicalPair): boolean {
  if (inst.agency !== pair.agency) return false;
  if (!inst.sourceTypes || inst.sourceTypes.length === 0) return true;
  return inst.sourceTypes.includes(pair.sourceType);
}

/**
 * Derive the state of ONE physical pair. The instance (if any) decides; the absence
 * of an instance is UNREGISTERED, which is a TODO rather than an outage.
 */
const DISPOSITION_STATE: Record<string, ForecastSourceState> = {
  canonical_active: 'AUTOMATED_CURRENT',
  canonical_controlled: 'MANUAL_CONTROLLED',
  duplicate_ingest_path: 'HISTORICAL_ONLY',   // physically retained, not a second source
  superseded: 'SUPERSEDED',
  historical_only: 'HISTORICAL_ONLY',
  retired: 'RETIRED',
  blocked: 'BLOCKED_CONTROLLED',
};

export function evaluatePair(
  pair: PhysicalPair,
  inst: InstanceEvidence | null,
  now = new Date().toISOString(),
  binding: PairBinding | null = null,
): PairHealth {
  const reasons: string[] = [];
  const nowMs = Date.parse(now);
  const age = daysSince(pair.lastWriteAt, nowMs);

  if (pair.rows === -1) reasons.push('row count COULD NOT BE MEASURED (unknown, not zero)');

  // A bound pair is CONTROLLED even when no instance governs it (historical_only /
  // retired). Refusing to invent a fake instance for ONR/NRL is the whole point.
  if (binding && !inst) {
    const st = DISPOSITION_STATE[binding.disposition] ?? 'UNKNOWN_CONFIGURATION';
    return {
      agency: pair.agency, sourceType: pair.sourceType, rows: pair.rows,
      lastWriteAt: pair.lastWriteAt, state: st, sourceKey: null, ingestMode: null,
      registered: true, operationalConcern: false,
      reasons: [...reasons, `dispositioned ${binding.disposition}; no current canonical source by decision`,
        ...(binding.evidence ? [binding.evidence] : [])],
    };
  }

  // Bound to a governing instance, in a disposition that is NOT the current path:
  // the instance's own state must not make a retained duplicate look "current".
  if (binding && inst && binding.disposition !== 'canonical_active' && binding.disposition !== 'canonical_controlled') {
    const st = DISPOSITION_STATE[binding.disposition] ?? 'UNKNOWN_CONFIGURATION';
    return {
      agency: pair.agency, sourceType: pair.sourceType, rows: pair.rows,
      lastWriteAt: pair.lastWriteAt, state: st, sourceKey: inst.sourceKey,
      ingestMode: inst.ingestMode, registered: true, operationalConcern: false,
      reasons: [...reasons, `dispositioned ${binding.disposition}; governed by ${inst.sourceKey}`,
        ...(binding.evidence ? [binding.evidence] : [])],
    };
  }

  if (!inst) {
    return {
      agency: pair.agency, sourceType: pair.sourceType, rows: pair.rows,
      lastWriteAt: pair.lastWriteAt, state: 'UNREGISTERED', sourceKey: null, ingestMode: null,
      registered: false, operationalConcern: false,   // a missing control plane is NOT an outage
      reasons: [...reasons,
        'no data_source_instance — source architecture not yet dispositioned',
        `${pair.rows >= 0 ? pair.rows : 'unknown'} row(s) held outside the control plane`],
    };
  }

  const base = {
    agency: pair.agency, sourceType: pair.sourceType, rows: pair.rows,
    lastWriteAt: pair.lastWriteAt, sourceKey: inst.sourceKey, ingestMode: inst.ingestMode,
    registered: true,
  };

  // BLOCKED / manual-because-inaccessible. A healthy watcher does NOT make it current.
  if (inst.sourceState === 'unreachable' || inst.ingestMode === 'blocked') {
    return {
      ...base, state: 'BLOCKED_CONTROLLED', operationalConcern: false,
      reasons: [...reasons,
        `upstream ${inst.sourceState}; intervention ${inst.interventionState}`,
        inst.hasScheduledJob
          ? 'access watch scheduled — watch success is NOT source currentness'
          : 'NO access watch scheduled — a blocked source must be watched',
        inst.upstreamPopulation === null
          ? 'upstream population UNMEASURED (not zero)'
          : `upstream population ${inst.upstreamPopulation} at last successful verification`,
      ],
    };
  }

  if (inst.ingestMode === 'manual') {
    return {
      ...base, state: 'MANUAL_CONTROLLED', operationalConcern: false,
      reasons: [...reasons,
        `controlled manual ingest; source_state=${inst.sourceState}, intervention=${inst.interventionState}`,
        inst.hasScheduledJob ? 'currentness watch scheduled' : 'no currentness watch scheduled'],
    };
  }

  // AUTOMATED. Only here can staleness be a real operational concern.
  let concern = false;
  if (age === null) { concern = true; reasons.push('automated source has never written'); }
  else if (age > CRITICAL_DAYS) { concern = true; reasons.push(`last write ${age}d ago (> ${CRITICAL_DAYS}d)`); }
  else if (age > WARN_DAYS) { concern = true; reasons.push(`last write ${age}d ago (> ${WARN_DAYS}d)`); }
  if (pair.rows === 0) { concern = true; reasons.push('automated source holds no rows'); }
  if (!inst.hasScheduledJob) { concern = true; reasons.push('automated source has NO enabled cron'); }

  // An unchanged ingest is healthy: last_data_advance is SUPPOSED to be old when the
  // upstream has not changed. Only last_verified_ingest/last_poll speak to liveness.
  if (!concern) reasons.push(`${pair.rows} row(s); verified ingest ${daysSince(inst.lastVerifiedIngest, nowMs) ?? '—'}d ago`);

  return {
    ...base,
    state: inst.hasExplicitRejections ? 'AUTOMATED_CURRENT_WITH_EXCEPTIONS' : 'AUTOMATED_CURRENT',
    operationalConcern: concern, reasons,
  };
}

const EMPTY_BY_STATE = (): Record<ForecastSourceState, number> => ({
  AUTOMATED_CURRENT: 0, AUTOMATED_CURRENT_WITH_EXCEPTIONS: 0, MANUAL_CONTROLLED: 0,
  BLOCKED_CONTROLLED: 0, UNREGISTERED: 0, SUPERSEDED: 0, HISTORICAL_ONLY: 0,
  RETIRED: 0, UNKNOWN_CONFIGURATION: 0,
});

/** Roll the pairs up into exact populations. No score, no percentage. */
export function rollupForecastDomain(
  pairs: PhysicalPair[],
  instances: InstanceEvidence[],
  now = new Date().toISOString(),
  bindings: PairBinding[] = [],
): ForecastDomainHealth {
  const bindOf = (p: PhysicalPair) =>
    bindings.find((b) => b.agency === p.agency && b.sourceType === p.sourceType) ?? null;
  const evaluated = pairs.map((p) => {
    const b = bindOf(p);
    // The BINDING decides which instance governs — never a name match.
    const inst = b?.sourceKey
      ? instances.find((i) => i.sourceKey === b.sourceKey) ?? null
      : (bindings.length ? null : instances.find((i) => governs(i, p)) ?? null);
    return evaluatePair(p, inst, now, b);
  });

  const byState = EMPTY_BY_STATE();
  for (const e of evaluated) byState[e.state]++;

  const agencies = new Set(pairs.map((p) => p.agency));
  const registeredAgencies = new Set(evaluated.filter((e) => e.registered).map((e) => e.agency));
  const unregisteredAgencies = new Set(
    evaluated.filter((e) => !e.registered).map((e) => e.agency));
  // An agency counts as unregistered only if NONE of its pairs is registered.
  for (const a of registeredAgencies) unregisteredAgencies.delete(a);

  const sumRows = (list: PairHealth[]) => list.reduce((n, e) => n + (e.rows > 0 ? e.rows : 0), 0);
  const physicalRows = sumRows(evaluated);
  const underPlane = sumRows(evaluated.filter((e) => e.registered));

  const domainTodos: string[] = [];
  if (unregisteredAgencies.size > 0) {
    domainTodos.push(
      `${unregisteredAgencies.size} represented agenc${unregisteredAgencies.size === 1 ? 'y' : 'ies'} have no source control: ${[...unregisteredAgencies].sort().join(', ')}`);
  }
  if (byState.UNREGISTERED > 0) {
    domainTodos.push(`${byState.UNREGISTERED} of ${evaluated.length} physical pairs are undispositioned`);
  }
  if (physicalRows - underPlane > 0) {
    domainTodos.push(`${physicalRows - underPlane} row(s) held outside the source control plane`);
  }
  for (const e of evaluated) {
    if (e.state === 'BLOCKED_CONTROLLED' && e.reasons.some((r) => r.startsWith('NO access watch'))) {
      domainTodos.push(`${e.agency}/${e.sourceType} is blocked with no access watch`);
    }
  }

  const controlled = new Set(evaluated.filter((e) => e.registered).map((e) => e.agency));
  const uncontrolled = new Set(evaluated.filter((e) => !e.registered).map((e) => e.agency));
  for (const a of controlled) uncontrolled.delete(a);
  const instanceBacked = new Set(evaluated.filter((e) => e.sourceKey).map((e) => e.agency));

  return {
    representedAgencies: agencies.size,
    controlledAgencies: controlled.size,
    uncontrolledAgencies: uncontrolled.size,
    instanceBackedAgencies: instanceBacked.size,
    canonicalSourceInstances: new Set(
      evaluated.map((e) => e.sourceKey).filter((k): k is string => Boolean(k))).size,
    registeredAgencies: registeredAgencies.size,
    unregisteredAgencies: unregisteredAgencies.size,
    physicalPairs: evaluated.length,
    dispositionedPairs: evaluated.filter((e) => e.registered).length,
    undispositionedPairs: byState.UNREGISTERED,
    physicalRows,
    rowsUnderControlPlane: underPlane,
    rowsOutsideControlPlane: physicalRows - underPlane,
    byState,
    pairs: evaluated,
    unmeasuredPairs: evaluated.filter((e) => e.rows === -1).map((e) => `${e.agency}|${e.sourceType}`),
    domainTodos,
    operationalConcerns: evaluated.filter((e) => e.operationalConcern).map(
      (e) => `${e.agency}/${e.sourceType}: ${e.reasons.join('; ')}`),
  };
}
