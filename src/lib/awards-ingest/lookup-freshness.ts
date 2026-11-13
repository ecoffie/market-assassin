/**
 * Freshness of the award lookup tables relative to the awards warehouse (2026-11-13).
 *
 * The lookups (award_detail_lookup / piid_lookup) fell seven months behind the warehouse without a
 * single alert, because nothing compared them. The weekly rebuild (scripts/rebuild-award-lookups.ts)
 * records its outcome in data_sources row `bq_award_lookups`; the weekly ingest records the
 * warehouse's newest action date in row `bq_awards`. This compares the two — Supabase only, no
 * BigQuery — for the daily check-data-freshness cron, which posts to ops Slack.
 */
export interface LookupRunStatus {
  at: string;
  ok: boolean;
  stage: string;
  reasons?: string[];
  sourceMaxActionDate?: string | null;
  lastSuccess?: { at: string; sourceMaxActionDate: string | null } | null;
}

const OPEN = '[award-lookups:v1]';
const CLOSE = '[/award-lookups]';

export function parseLookupStatus(notes: string | null | undefined): LookupRunStatus | null {
  if (!notes) return null;
  const i = notes.indexOf(OPEN);
  const j = notes.indexOf(CLOSE);
  if (i === -1 || j === -1 || j < i) return null;
  try {
    return JSON.parse(notes.slice(i + OPEN.length, j).trim()) as LookupRunStatus;
  } catch {
    return null;
  }
}

export function encodeLookupStatus(header: string, status: LookupRunStatus): string {
  return `${header}\n\n${OPEN}\n${JSON.stringify(status)}\n${CLOSE}`;
}

/**
 * The status to store after a run: the run itself, plus the most recent SUCCESS (carried forward
 * from the previous status when this run failed), so one failure never hides the last good state.
 */
export function nextLookupStatus(prev: LookupRunStatus | null, run: Omit<LookupRunStatus, 'lastSuccess'>): LookupRunStatus {
  const lastSuccess = run.ok
    ? { at: run.at, sourceMaxActionDate: run.sourceMaxActionDate ?? null }
    : prev?.lastSuccess ?? null;
  return { ...run, lastSuccess };
}

export type LookupFreshness =
  | { status: 'healthy'; detail: string }
  | { status: 'never-built' | 'last-run-failed' | 'behind-source'; detail: string };

/** Grace after a warehouse merge before lagging lookups count as stale (the rebuild runs right after). */
export const LOOKUP_GRACE_HOURS = 36;

export function classifyLookupFreshness(
  lookups: LookupRunStatus | null,
  awards: { sourceActionMax?: string | null; mergedAt?: string | null } | null,
  now: number = Date.now(),
): LookupFreshness {
  // Rows written before `lastSuccess` existed (the 2026-11-13 production rebuild) carry only the run
  // itself: a successful run IS the last success.
  const last = lookups?.lastSuccess ?? (lookups?.ok ? { at: lookups.at, sourceMaxActionDate: lookups.sourceMaxActionDate ?? null } : null);
  if (!lookups || !last) return { status: 'never-built', detail: 'no successful award lookup rebuild recorded' };
  if (!lookups.ok) {
    return { status: 'last-run-failed', detail: `last rebuild ${lookups.at} failed at "${lookups.stage}": ${(lookups.reasons ?? []).join('; ') || 'no reason recorded'}` };
  }
  const src = awards?.sourceActionMax ?? null;
  const have = last.sourceMaxActionDate;
  if (src && have && have < src) {
    const merged = awards?.mergedAt ? Date.parse(awards.mergedAt) : NaN;
    const hoursSinceMerge = Number.isFinite(merged) ? (now - merged) / 3.6e6 : Infinity;
    if (hoursSinceMerge > LOOKUP_GRACE_HOURS) {
      return { status: 'behind-source', detail: `lookups at ${have}, warehouse at ${src} (merged ${Math.round(hoursSinceMerge)}h ago)` };
    }
  }
  return { status: 'healthy', detail: `lookups at ${have ?? 'unknown'}, warehouse at ${src ?? 'unknown'}` };
}
