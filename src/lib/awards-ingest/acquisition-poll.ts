/**
 * USASpending bulk-download acquisition polling — bounded, fail-closed.
 *
 * Run 33277315965: export finished in ~51 min but the hard-coded ~20 min poll
 * cap aborted while status was still `running`. Production workflow sets
 * BQ_AWARDS_ACQUISITION_POLL_MINUTES from the measured budget (90 min as of
 * 2026-08-29); local runs keep the explicit 20 min default when unset.
 */
import {
  BQ_AWARDS_MIN_POST_ACQUISITION_BUFFER_MINUTES,
} from './workflow-control';

export const ACQUISITION_POLL_INTERVAL_MS = 5_000;

/** Local default when BQ_AWARDS_ACQUISITION_POLL_MINUTES is unset (~20 min at 5s interval). */
export const DEFAULT_LOCAL_ACQUISITION_POLL_MINUTES = 20;

/** Minimum when the env var is explicitly set (workflow production budget). */
export const MIN_CONFIGURED_ACQUISITION_POLL_MINUTES = 60;

export const MAX_ACQUISITION_POLL_MINUTES = 120;

export const BQ_AWARDS_ACQUISITION_POLL_MINUTES_ENV = 'BQ_AWARDS_ACQUISITION_POLL_MINUTES' as const;

export interface BulkDownloadPollStatus {
  status: string;
  total_rows?: number;
  file_url?: string;
  message?: string;
}

/** Measured from run 33277315965 job seconds_elapsed (~51.25 min). */
export function computeProductionPollBudgetMinutes(measuredCompletionMinutes: number): number {
  const raw = Math.max(
    MIN_CONFIGURED_ACQUISITION_POLL_MINUTES,
    measuredCompletionMinutes * 1.5,
  );
  return Math.ceil(raw / 15) * 15;
}

export function parseAcquisitionPollMinutes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_LOCAL_ACQUISITION_POLL_MINUTES;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('invalid acquisition poll minutes — must be a positive integer');
  }
  const value = Number(trimmed);
  if (
    !Number.isSafeInteger(value)
    || value < MIN_CONFIGURED_ACQUISITION_POLL_MINUTES
    || value > MAX_ACQUISITION_POLL_MINUTES
  ) {
    throw new Error(
      `invalid acquisition poll minutes — must be between ${MIN_CONFIGURED_ACQUISITION_POLL_MINUTES} and ${MAX_ACQUISITION_POLL_MINUTES}`,
    );
  }
  return value;
}

export function maxPollIterations(
  pollMinutes: number,
  intervalMs = ACQUISITION_POLL_INTERVAL_MS,
): number {
  return Math.floor((pollMinutes * 60_000) / intervalMs);
}

export function acquisitionPollTimeoutMessage(pollMinutes: number): string {
  return `download did not finish within ~${pollMinutes} min — aborting`;
}

export function assertWorkflowTimeoutCoversAcquisition(
  jobTimeoutMinutes: number,
  pollMinutes: number,
  postBufferMinutes = BQ_AWARDS_MIN_POST_ACQUISITION_BUFFER_MINUTES,
): void {
  if (jobTimeoutMinutes < pollMinutes + postBufferMinutes) {
    throw new Error(
      `workflow timeout ${jobTimeoutMinutes}m must leave at least ${postBufferMinutes}m after ${pollMinutes}m acquisition poll`,
    );
  }
}

export async function pollBulkDownloadUntilReady(options: {
  statusUrl: string;
  initialFileUrl: string;
  maxIterations: number;
  pollIntervalMs?: number;
  pollMinutesForTimeoutMessage: number;
  fetchStatus: (statusUrl: string) => Promise<BulkDownloadPollStatus>;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}): Promise<{ fileUrl: string; totalRows: number }> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollIntervalMs = options.pollIntervalMs ?? ACQUISITION_POLL_INTERVAL_MS;
  const initialFileUrl = options.initialFileUrl;

  for (let i = 0; ; i++) {
    const st = await options.fetchStatus(options.statusUrl);
    if (st.status === 'finished') {
      return {
        fileUrl: st.file_url || initialFileUrl,
        totalRows: st.total_rows ?? 0,
      };
    }
    if (st.status === 'failed') {
      throw new Error(`USASpending download failed: ${st.message || 'unknown'}`);
    }
    if (i >= options.maxIterations) {
      throw new Error(acquisitionPollTimeoutMessage(options.pollMinutesForTimeoutMessage));
    }
    if (i % 6 === 0) {
      options.log?.(`  …${st.status} (${st.total_rows ?? '?'} rows so far)`);
    }
    await sleep(pollIntervalMs);
  }
}
