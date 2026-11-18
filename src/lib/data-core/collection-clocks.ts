/**
 * Collection clocks — attempt, successful read, and nonempty ingest are different facts.
 *
 * Gold master: the five clocks on data_source_instances (see gao-instance.ts).
 * A scheduled run stamps last_poll only. It does not move last_verified_ingest,
 * and it never invents last_source_advance from the job clock.
 *
 * DIBBS (and grants) were reporting MAX(synced_at) plus a control-plane
 * source_state of `current` that was inserted with every clock null. A weekend
 * no-data run and a re-upsert of unchanged rows both looked like a fresh feed.
 */
import {
  DISABLED_COLLECTOR_WARNING,
  freshnessStateForCollector,
  timestampState,
  type FreshnessState,
} from './inventory-model';

export interface CollectionClockInput {
  /** When this run tried. Always last_poll. Never a freshness claim. */
  attemptedAt: string;
  /** The upstream answered, including a confirmed empty publication window. */
  upstreamReadable: boolean;
  recordsReceived: number;
  /** Rows proven written this run. Zero does not move the nonempty-ingest clock. */
  recordsLanded: number;
  /**
   * A date the publisher put on the data. Null when we do not have one.
   * Callers must not pass attemptedAt.
   */
  sourcePublishedAt?: string | null;
  priorVerifiedIngest?: string | null;
  cadenceHours?: number | null;
  now?: string;
}

export type CollectionSourceState =
  | 'current'
  | 'content_stale'
  | 'upstream_quiet'
  | 'unreachable'
  | 'unmeasured';

export interface CollectionClockPatch {
  clocks: Record<string, string | null>;
  sourceState: CollectionSourceState;
  recordsReceived: number;
  /** True only when this run moved last_verified_ingest. */
  advancedNonemptyIngest: boolean;
}

export function buildCollectionClockPatch(input: CollectionClockInput): CollectionClockPatch {
  const clocks: Record<string, string | null> = {
    last_poll: input.attemptedAt,
  };
  if (!input.upstreamReadable) {
    clocks.source_state = 'unreachable';
    return {
      clocks,
      sourceState: 'unreachable',
      recordsReceived: input.recordsReceived,
      advancedNonemptyIngest: false,
    };
  }

  clocks.last_successful_check = input.attemptedAt;

  const sourceDate = input.sourcePublishedAt ?? null;
  if (sourceDate && sourceDate !== input.attemptedAt) {
    clocks.last_source_advance = sourceDate;
  }

  if (input.recordsLanded > 0) {
    clocks.last_verified_ingest = input.attemptedAt;
    clocks.source_state = 'current';
    return {
      clocks,
      sourceState: 'current',
      recordsReceived: input.recordsReceived,
      advancedNonemptyIngest: true,
    };
  }

  const prior = input.priorVerifiedIngest ?? null;
  let sourceState: CollectionSourceState;
  if (!prior) {
    sourceState = 'unmeasured';
  } else {
    const age = timestampState(prior, input.cadenceHours ?? null, new Date(input.now ?? input.attemptedAt));
    sourceState = age === 'CURRENT' ? 'upstream_quiet' : 'content_stale';
  }
  clocks.source_state = sourceState;
  return {
    clocks,
    sourceState,
    recordsReceived: input.recordsReceived,
    advancedNonemptyIngest: false,
  };
}

export interface ReportedCollectionFreshness {
  state: FreshnessState;
  /** The nonempty-ingest clock. Null when that clock was never recorded. */
  asOf: string | null;
  lastAttempted: string | null;
  lastSuccessfulCheck: string | null;
  lastNonemptyIngest: string | null;
  recordsReceived: number | null;
  warning: string | null;
  basis: string;
}

/**
 * What a customer or the inventory may say.
 * source_state `current` with no nonempty-ingest clock is not CURRENT.
 * A recent row-touch (MAX synced_at) is not CURRENT either.
 */
export function reportedCollectionFreshness(input: {
  sourceState: string | null;
  lastPoll: string | null;
  lastSuccessfulCheck: string | null;
  lastVerifiedIngest: string | null;
  lastDataAdvance: string | null;
  recordsReceived: number | null;
  /** MAX(synced_at) or equivalent. Used only to detect an old touch, never as proof of ingest. */
  rowTouchAt: string | null;
  cadenceHours: number | null;
  now: Date;
  /**
   * False when the producer cron is disabled. A recent nonempty ingest is then
   * STALE: the collector is not running, so that clock is a past ingest.
   * Null means the schedule was not read; it does not invent a disabled flag.
   */
  producerEnabled?: boolean | null;
}): ReportedCollectionFreshness {
  const report = collectionFreshness(input);
  const state = freshnessStateForCollector(report.state, input.producerEnabled);
  if (input.producerEnabled !== false) return report;
  return {
    ...report,
    state,
    warning: report.warning
      ? `${report.warning} ${DISABLED_COLLECTOR_WARNING}`
      : DISABLED_COLLECTOR_WARNING,
  };
}

function collectionFreshness(input: {
  sourceState: string | null;
  lastPoll: string | null;
  lastSuccessfulCheck: string | null;
  lastVerifiedIngest: string | null;
  lastDataAdvance: string | null;
  recordsReceived: number | null;
  rowTouchAt: string | null;
  cadenceHours: number | null;
  now: Date;
}): ReportedCollectionFreshness {
  const nonempty = input.lastVerifiedIngest || input.lastDataAdvance || null;
  const base = {
    lastAttempted: input.lastPoll,
    lastSuccessfulCheck: input.lastSuccessfulCheck,
    lastNonemptyIngest: nonempty,
    recordsReceived: input.recordsReceived,
  };

  if (input.sourceState === 'unreachable') {
    return {
      ...base,
      state: 'UNREACHABLE',
      asOf: nonempty,
      warning: 'The last check could not read the source. A scheduled run is not freshness, and this data is not current.',
      basis: 'source_state=unreachable; last_poll is the attempt, not the ingest',
    };
  }

  if (nonempty) {
    const byAge = timestampState(nonempty, input.cadenceHours, input.now);
    const state: FreshnessState = input.sourceState === 'content_stale' ? 'STALE' : byAge;
    return {
      ...base,
      state,
      asOf: nonempty,
      warning: state === 'CURRENT'
        ? null
        : 'The last successful nonempty ingestion is outside the source cadence. Do not describe this data as current.',
      basis: 'last_verified_ingest or last_data_advance — not last_poll and not a row synced_at',
    };
  }

  const touchStale = input.rowTouchAt != null
    && timestampState(input.rowTouchAt, input.cadenceHours, input.now) === 'STALE';
  const state: FreshnessState = touchStale || input.sourceState === 'content_stale' ? 'STALE' : 'UNKNOWN';
  return {
    ...base,
    state,
    asOf: null,
    warning: 'No successful nonempty ingestion is recorded. The last attempt and a row synced_at do not make this data current.',
    basis: 'no last_verified_ingest and no last_data_advance',
  };
}
