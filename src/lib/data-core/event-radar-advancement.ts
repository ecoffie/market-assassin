/**
 * EVENT RADAR ADVANCEMENT — Phase II, Potato 1.
 *
 * THE PROBLEM THIS SOLVES. On 2026-09-13 `extract-sam-events` reported HTTP 200
 * `success` at 07:00, yet no `sam_events` row was newer than 09-12 07:00. Three
 * different realities produce that identical signature:
 *     A. upstream had no new qualifying notices          (healthy, quiet)
 *     B. new notices existed but none met qualification  (healthy, filtered)
 *     C. qualifying notices existed and the write failed (BROKEN)
 * Nothing in the response, the cron status, or the destination table could tell
 * them apart. "Success" plus an unchanged table is not evidence of anything.
 *
 * ⚠️ C1 IS REUSED, NOT REPLACED. `classifyAdvancement` already distinguishes
 * healthy / upstream_stale / ingest_broken / stamp_ahead / unmeasured against a
 * single oracle column. What it cannot express is **filtered_quiet** — upstream
 * genuinely advanced, and correctly produced nothing. Event Radar is a FILTERING
 * collector (a keyword classifier over SAM notices), so that state is its normal
 * steady state and must not read as a fault. This module adds exactly that one
 * distinction and defers everything else to C1's vocabulary.
 *
 * MEASURED GROUND TRUTH for the 09-13 run (this is what the classifier had to be
 * able to say): 25 new candidate notices posted since 09-12, **0 of them matched
 * any qualification keyword**, and 0 were already in `sam_events`. So 09-13 was
 * FILTERED_QUIET — genuinely not broken. But note the qualifier below.
 */
import type { AdvancementStatus } from './advancement';

/**
 * Event Radar's states. Four are C1's own; `filtered_quiet` is the one addition.
 * `upstream_stale` is deliberately NOT reused here — for a filtering collector,
 * "upstream published nothing" and "upstream published nothing that qualified" are
 * different operational facts and both are healthy.
 */
export type EventRadarStatus =
  | 'advancing'          // qualifying items found AND written
  | 'upstream_quiet'     // source read fine; no NEW candidate notices at all
  | 'filtered_quiet'     // NEW candidates existed; none qualified. Healthy.
  | 'ingest_broken'      // qualifying items existed but the destination did not advance
  | 'unmeasured';        // cannot distinguish the above

/** Everything a run must record to make the four states distinguishable after the fact. */
export interface EventRadarEvidence {
  /** Candidate notices examined this run. Null = the source read itself failed. */
  noticesScanned: number | null;
  /** Newest posted_date among candidates. Null = unreadable. */
  newestCandidatePosted: string | null;
  /** Candidates newer than the previous run's high-water mark. */
  newCandidates: number | null;
  /** Of those, how many the classifier QUALIFIED as events. */
  qualified: number | null;
  /** Rows the upsert actually reported back. Null = the write was not attempted. */
  upserted: number | null;
  /** Destination's newest extracted_at BEFORE this run. */
  priorIngestAt: string | null;
  /** Destination's newest extracted_at AFTER this run. */
  currentIngestAt: string | null;
  /** TRUE when the source read or the write ERRORED (as opposed to returning nothing). */
  failed?: boolean;
  /**
   * Candidates evaluated with NO description text. The classifier reads title +
   * description, so these were judged on a partial record. Measured 2026-09-13:
   * 1,962 of 5,994 active candidates (32.7%) carry no description.
   */
  evaluatedWithoutDescription?: number | null;
}

export interface EventRadarResult {
  status: EventRadarStatus;
  /** Maps onto C1's vocabulary so Platform Health can render it beside the others. */
  c1Equivalent: AdvancementStatus;
  detail: string;
  /** TRUE when some candidates lacked the text the classifier needs. */
  partialEvidence: boolean;
}

/**
 * Classify one Event Radar run.
 *
 * ORDER MATTERS. An explicit failure outranks everything; an unreadable source is
 * UNMEASURED (never "quiet"); and the broken case is asserted ONLY when qualifying
 * items existed and the destination still did not move — never inferred from an
 * unchanged table alone, which was the original ambiguity.
 */
export function classifyEventRadarRun(e: EventRadarEvidence): EventRadarResult {
  const partialEvidence = (e.evaluatedWithoutDescription ?? 0) > 0;

  // An error is a failure, never a quiet upstream.
  if (e.failed) {
    return { status: 'ingest_broken', c1Equivalent: 'ingest_broken', partialEvidence,
      detail: 'the source read or the destination write errored' };
  }

  // Could not enumerate the source -> we know nothing. Never "quiet".
  if (e.noticesScanned === null || e.newCandidates === null || e.qualified === null) {
    return { status: 'unmeasured', c1Equivalent: 'unmeasured', partialEvidence,
      detail: 'run did not record scanned/new/qualified counts — the three quiet causes are indistinguishable' };
  }

  // Qualifying items existed. Did the destination actually move?
  if (e.qualified > 0) {
    const wrote = (e.upserted ?? 0) > 0;
    const advanced = Boolean(e.currentIngestAt && e.currentIngestAt !== e.priorIngestAt);
    if (!wrote && !advanced) {
      return { status: 'ingest_broken', c1Equivalent: 'ingest_broken', partialEvidence,
        detail: `${e.qualified} qualifying event(s) found but the destination did not advance` };
    }
    return { status: 'advancing', c1Equivalent: 'healthy', partialEvidence,
      detail: `${e.qualified} qualifying event(s); ${e.upserted ?? 0} row(s) written` };
  }

  // Nothing qualified. WHY is the distinction that did not exist before.
  if (e.newCandidates > 0) {
    return {
      status: 'filtered_quiet',
      c1Equivalent: 'healthy',   // the collector is working; this is its steady state
      partialEvidence,
      detail: partialEvidence
        ? `${e.newCandidates} new notice(s) examined, none qualified — but ${e.evaluatedWithoutDescription} were judged on title alone (no description yet)`
        : `${e.newCandidates} new notice(s) examined, none qualified as events`,
    };
  }

  return { status: 'upstream_quiet', c1Equivalent: 'healthy', partialEvidence,
    detail: 'source read successfully; no new candidate notices since the last run' };
}
