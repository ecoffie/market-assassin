/**
 * Leaderboard rank snapshots — write (cron) + read baseline (page) + movement calc.
 *
 * PUBLIC ranking data only (contractor $ rank within a /top listicle). NOT the moat
 * change-log. ▲▼ = current live rank vs a snapshot from a prior period; it can't be
 * backfilled, so it accrues from the first snapshot forward.
 */
import { getWriteClient, getReadClient } from '@/lib/supabase/server-clients';
import type { TopContractorRow } from '@/lib/bigquery/top-listicles';

export interface RankMovement {
  dir: 'up' | 'down' | 'same' | 'new';
  delta: number; // positions moved (0 for same/new)
}

/** Upsert one snapshot (rank per contractor, 1-based) for a listicle on a date. */
export async function writeLeaderboardSnapshot(
  slug: string,
  rows: TopContractorRow[],
  snapshotDate: string,
): Promise<number> {
  if (!rows.length) return 0;
  const payload = rows.map((r, i) => ({
    snapshot_date: snapshotDate,
    slug,
    recipient_uei: r.recipient_uei,
    recipient_name: r.recipient_name,
    rank: i + 1,
    total_amount: Number(r.total_amount) || 0,
  }));
  const { error } = await getWriteClient()
    .from('leaderboard_snapshots')
    .upsert(payload, { onConflict: 'snapshot_date,slug,recipient_uei' });
  if (error) throw new Error(`writeLeaderboardSnapshot(${slug}): ${error.message}`);
  return payload.length;
}

/**
 * Ranks (Map<uei, rank>) from the most recent snapshot at least `minAgeDays` old —
 * i.e. "where each contractor stood ~a period ago." Returns null when no snapshot
 * that old exists yet (correct: no baseline → show no movement). Compared against the
 * page's live rankings, this yields honest month-over-month ▲▼ (the rollups the page
 * reads rebuild monthly, so an older baseline is what actually moved).
 */
export async function getBaselineRankMap(slug: string, minAgeDays = 25): Promise<Map<string, number> | null> {
  const sb = getReadClient();
  const cutoff = new Date(Date.now() - minAgeDays * 86400_000).toISOString().split('T')[0];

  const { data: dateRow, error: dErr } = await sb
    .from('leaderboard_snapshots')
    .select('snapshot_date')
    .eq('slug', slug)
    .lte('snapshot_date', cutoff)
    .order('snapshot_date', { ascending: false })
    .limit(1);
  if (dErr) throw new Error(`getBaselineRankMap date(${slug}): ${dErr.message}`);

  const baselineDate = dateRow?.[0]?.snapshot_date as string | undefined;
  if (!baselineDate) return null;

  const { data: rows, error: rErr } = await sb
    .from('leaderboard_snapshots')
    .select('recipient_uei, rank')
    .eq('slug', slug)
    .eq('snapshot_date', baselineDate);
  if (rErr) throw new Error(`getBaselineRankMap rows(${slug}): ${rErr.message}`);

  const map = new Map<string, number>();
  for (const r of rows ?? []) map.set(r.recipient_uei as string, r.rank as number);
  return map.size ? map : null;
}

/** Movement of a contractor now at `currentRank` vs the baseline snapshot. */
export function rankMovement(
  baseline: Map<string, number> | null,
  uei: string,
  currentRank: number,
): RankMovement | null {
  if (!baseline) return null; // no baseline yet → render nothing
  const was = baseline.get(uei);
  if (was === undefined) return { dir: 'new', delta: 0 };
  const delta = was - currentRank; // + = climbed
  if (delta > 0) return { dir: 'up', delta };
  if (delta < 0) return { dir: 'down', delta: -delta };
  return { dir: 'same', delta: 0 };
}
