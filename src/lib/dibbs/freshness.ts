/**
 * DIBBS panel freshness disclosure (Agent 3, 2026-11-14; Eric approved a narrow UI patch, not deployment).
 *
 * The DIBBS sync is parked (availability.ts, 2026-11-07), so `dibbs_rfqs` stops advancing, but the panel still
 * listed "open" RFQs from a frozen snapshot with no notice (58 open on 2026-11-14, last synced 2026-11-02). This helper
 * derives the disclosure from the DATA (newest `scraped_at`) and the parked flag. It never types a date by hand, and an
 * unknown last-sync time stays unknown (never "today", never hidden).
 */
import { DIBBS_MAP_ENABLED } from './availability';

/** A feed with no new row for this long is shown as stale even if the sync is nominally on. */
export const DIBBS_STALE_AFTER_DAYS = 3;

export interface DibbsFreshness {
  paused: boolean;
  stale: boolean;
  lastSyncedAt: string | null;
  daysSinceSync: number | null;
}

export function dibbsFreshness(lastSyncedAt: string | null, now: Date = new Date(), syncEnabled = DIBBS_MAP_ENABLED): DibbsFreshness {
  const t = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
  const days = Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86_400_000) : null;
  return {
    paused: !syncEnabled,
    stale: !syncEnabled || days == null || days > DIBBS_STALE_AFTER_DAYS,
    lastSyncedAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
    daysSinceSync: days,
  };
}

/** Panel copy. Plain words; the date is the data's own. */
export function dibbsFreshnessNotice(f: DibbsFreshness): string | null {
  if (!f.stale) return null;
  const when = f.lastSyncedAt
    ? new Date(f.lastSyncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null;
  const head = f.paused ? 'Paused' : 'Not updating';
  const updated = when ? `last updated ${when}` : 'last update date unavailable';
  return `${head} · ${updated}. DIBBS updates are ${f.paused ? 'paused' : 'behind'}, so deadlines and open counts below may be out of date. Confirm on DIBBS before bidding.`;
}
