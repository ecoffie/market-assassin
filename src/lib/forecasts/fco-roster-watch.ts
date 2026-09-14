/**
 * FCO ROSTER WATCH — monitoring for the `forecast_gsa_gateway` upstream source.
 *
 * ⚠️ MONITORING ONLY. This module has NO write path to `agency_forecasts`, by construction.
 * Canonical ingest remains the supported CSV export (`gsa_gateway_csv`).
 *
 * WHY IT EXISTS: **the Department of State joined FCO on 2026-08-19/20 — 396 rows in a two-day
 * window — and nothing noticed for three and a half weeks.** The only enumerator we had
 * (`scripts/import-forecasts-live.js`, the retired duplicate API writer) stops at page 320 × 25 =
 * 8,000 rows against an upstream of 9,225, so it could not see the tail of the source even in
 * principle. A source whose department roster can change, with no watcher on that roster, will
 * change again silently. Air Force is expected to onboard under the OFPP memo of 2024-11-29; this
 * is what will notice.
 */
import type { FcoCensus } from './fco-census';

export type FcoEventType =
  | 'department_appeared'
  | 'department_disappeared'
  | 'dod_component_appeared'
  | 'population_moved'
  | 'total_changed'
  | 'source_unreachable'
  | 'enumeration_incomplete'
  | 'upstream_advanced'
  | 'held_behind_upstream';

export type FcoSeverity = 'info' | 'warn' | 'critical';

export interface FcoEvent {
  type: FcoEventType;
  severity: FcoSeverity;
  department?: string;
  message: string;
  /** Stable key for alert de-duplication — same condition must not re-alert while unchanged. */
  dedupeKey: string;
}

/** The prior observation this run is compared against. Null on first ever run. */
export interface FcoWatchState {
  departments: string[];
  perDepartment: Record<string, number>;
  reportedTotal: number;
  maxChanged: string | null;
  fingerprint: string;
}

/** Anything matching these in a department name is a P0 — the thing we are actually waiting for. */
const DOD_PATTERN = /air force|space force|\busaf\b|\bussf\b|\bdaf\b|defense|army|navy|\bdod\b|marine corps/i;

/** A department population move beyond BOTH thresholds is material. Small sources move a lot in %. */
export const POPULATION_ABS_THRESHOLD = 200;
export const POPULATION_PCT_THRESHOLD = 0.05;

export interface FcoWatchInput {
  census: FcoCensus;
  previous: FcoWatchState | null;
  /** Canonical rows currently held under `forecast_gsa_gateway`. */
  heldCanonical: number;
  /** The instance's recorded `last_source_advance`, to detect upstream moving past us. */
  heldSourceAdvance?: string | null;
}

export interface FcoWatchResult {
  events: FcoEvent[];
  next: FcoWatchState | null;
  /** Clock updates the CALLER should apply. Never applied here; dry mode simply ignores them. */
  clocks: {
    /** Every real attempt, success or failure. */
    lastPoll: string;
    /** ONLY on a provably complete enumeration. A partial census is not a successful check. */
    lastSuccessfulCheck: string | null;
    /** The SOURCE's own MAX(changed) — never a Mindy timestamp. */
    lastSourceAdvance: string | null;
    /** Populations observed; held_population is NOT touched by a watch. */
    upstreamPopulation: number | null;
  };
}

/**
 * Compare a census against the previous observation and derive events + clock updates.
 *
 * PURE. No I/O, no writes, no clock mutation — the caller decides what to persist, which is what
 * makes dry mode provable rather than promised.
 */
export function evaluateFcoWatch(input: FcoWatchInput, now = new Date()): FcoWatchResult {
  const { census, previous, heldCanonical, heldSourceAdvance } = input;
  const nowIso = now.toISOString();
  const events: FcoEvent[] = [];

  // ── A census that did not complete tells us nothing about the roster. Say so and stop. ──
  if (!census.complete) {
    const unreachable = census.pagesFetched === 0;
    events.push({
      type: unreachable ? 'source_unreachable' : 'enumeration_incomplete',
      severity: 'critical',
      message: unreachable
        ? 'FCO source unreachable — no page could be read.'
        : `FCO enumeration INCOMPLETE (${census.incompleteReason}). Roster comparison skipped: a partial census cannot prove a department is absent.`,
      dedupeKey: unreachable ? 'source_unreachable' : `enumeration_incomplete:${census.uniqueRows}`,
    });
    return {
      events,
      next: null,                       // never overwrite a good observation with a partial one
      clocks: {
        lastPoll: nowIso,
        lastSuccessfulCheck: null,      // ⚠️ NOT advanced — the run failed
        lastSourceAdvance: null,
        upstreamPopulation: null,
      },
    };
  }

  const perDepartment: Record<string, number> = {};
  for (const d of census.departments) perDepartment[d.department] = d.rows;
  const departments = Object.keys(perDepartment).sort();

  if (previous) {
    const prevSet = new Set(previous.departments);
    const curSet = new Set(departments);

    for (const d of departments) {
      if (prevSet.has(d)) continue;
      const isDod = DOD_PATTERN.test(d);
      events.push({
        type: isDod ? 'dod_component_appeared' : 'department_appeared',
        severity: 'critical',
        department: d,
        message: isDod
          ? `A DoD component appeared in FCO: "${d}" (${perDepartment[d]} rows). This is the onboarding we have been waiting for — re-open the Air Force coverage decision.`
          : `New department appeared in FCO: "${d}" (${perDepartment[d]} rows). It is a new slice of the SAME source — add a CSV slice, do not create a source instance.`,
        dedupeKey: `department_appeared:${d}`,
      });
    }
    for (const d of previous.departments) {
      if (curSet.has(d)) continue;
      events.push({
        type: 'department_disappeared',
        severity: 'warn',
        department: d,
        message: `Department "${d}" is no longer present upstream (was ${previous.perDepartment[d] ?? '?'} rows). Held rows are RETAINED — absence upstream is not proof of deletion.`,
        dedupeKey: `department_disappeared:${d}`,
      });
    }
    for (const d of departments) {
      if (!prevSet.has(d)) continue;
      const before = previous.perDepartment[d] ?? 0;
      const after = perDepartment[d];
      const delta = after - before;
      const pct = before > 0 ? Math.abs(delta) / before : 1;
      if (Math.abs(delta) >= POPULATION_ABS_THRESHOLD && pct >= POPULATION_PCT_THRESHOLD) {
        events.push({
          type: 'population_moved',
          severity: 'warn',
          department: d,
          message: `"${d}" moved ${delta > 0 ? '+' : ''}${delta} rows (${before} → ${after}).`,
          dedupeKey: `population_moved:${d}:${after}`,
        });
      }
    }
    if (previous.reportedTotal !== census.reportedTotal) {
      events.push({
        type: 'total_changed',
        severity: 'info',
        message: `FCO total ${previous.reportedTotal} → ${census.reportedTotal}.`,
        dedupeKey: `total_changed:${census.reportedTotal}`,
      });
    }
    if (census.maxChanged && previous.maxChanged && census.maxChanged > previous.maxChanged) {
      events.push({
        type: 'upstream_advanced',
        severity: 'info',
        message: `Upstream advanced: MAX(changed) ${previous.maxChanged} → ${census.maxChanged}.`,
        dedupeKey: `upstream_advanced:${census.maxChanged}`,
      });
    }
  }

  // ── JOB SUCCESS ≠ DATA CURRENTNESS ───────────────────────────────────────────────────────
  // A green watcher run must never imply the held data is current. If upstream carries rows we do
  // not hold canonically, say so on every successful check — that is the State condition, and it
  // was true and unsaid for three and a half weeks.
  if (census.uniqueListingIds > heldCanonical) {
    events.push({
      type: 'held_behind_upstream',
      severity: 'warn',
      message: `Canonical held (${heldCanonical}) is BEHIND upstream (${census.uniqueListingIds} unique ids). A successful watch does NOT mean the source is ingested.`,
      dedupeKey: `held_behind_upstream:${census.uniqueListingIds}:${heldCanonical}`,
    });
  }
  if (heldSourceAdvance && census.maxChanged && census.maxChanged > heldSourceAdvance) {
    events.push({
      type: 'upstream_advanced',
      severity: 'info',
      message: `Upstream MAX(changed) ${census.maxChanged} is ahead of the recorded source advance ${heldSourceAdvance}.`,
      dedupeKey: `upstream_advanced:${census.maxChanged}`,
    });
  }

  return {
    events,
    next: {
      departments,
      perDepartment,
      reportedTotal: census.reportedTotal,
      maxChanged: census.maxChanged,
      fingerprint: census.fingerprint,
    },
    clocks: {
      lastPoll: nowIso,
      lastSuccessfulCheck: nowIso,
      lastSourceAdvance: census.maxChanged,
      upstreamPopulation: census.uniqueRows,
      // NOTE: `last_verified_ingest` and `last_data_advance` are deliberately ABSENT.
      // A watch is not an ingest, and observing the source is not advancing our data.
    },
  };
}

/** Events not already present in `alreadyAlerted` — the de-dup contract. */
export function dedupeFcoEvents(events: FcoEvent[], alreadyAlerted: Set<string>): FcoEvent[] {
  return events.filter((e) => !alreadyAlerted.has(e.dedupeKey));
}
