/**
 * /api/cron/snapshot-leaderboards — weekly point-in-time snapshot of every
 * /top/[slug] contractor ranking into leaderboard_snapshots.
 *
 * Fired by the cron dispatcher (cron_jobs row 'snapshot-leaderboards', Mon 09:00 UTC),
 * NOT a vercel.json cron. Cheap: each listicle reads the topContractorsByDimension
 * rollup (a few MB, KV-cached) — same source the /top pages render from, so the
 * snapshot can never drift from what visitors see.
 *
 * PUBLIC ranking data only. This is the fuel for the public ▲▼ rank movement — it is
 * NOT the moat change-log (that stays private). Movement can't be backfilled, so the
 * value is entirely in starting to record now.
 *
 *   ?slug=<slug>  snapshot one listicle (manual/backfill of a single page)
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { LISTICLES } from '@/data/top-listicles';
import { fetchTopForListicle } from '@/lib/bigquery/listicle-fetch';
import { writeLeaderboardSnapshot } from '@/lib/leaderboards/snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const only = new URL(request.url).searchParams.get('slug');
  // A ranking snapshot is a point-in-time of CURRENT rankings, so "today" (UTC) is
  // correct here — unlike day-summary crons that must look back at the closed day.
  const today = new Date().toISOString().split('T')[0];
  const targets = only ? LISTICLES.filter((l) => l.slug === only) : LISTICLES;

  let ok = 0;
  let failed = 0;
  let rows = 0;
  const errors: string[] = [];
  const start = Date.now();

  for (const listicle of targets) {
    if (Date.now() - start > 110_000) {
      errors.push('time budget reached — remaining listicles will snapshot next run');
      break;
    }
    try {
      const top = await fetchTopForListicle(listicle, 50);
      rows += await writeLeaderboardSnapshot(listicle.slug, top, today);
      // Refresh the ISR page now that its snapshot + warm cache exist, so the ▲▼ and
      // fresh rankings appear without waiting out the revalidate window.
      revalidatePath(`/top/${listicle.slug}`);
      ok++;
    } catch (e) {
      failed++;
      errors.push(`${listicle.slug}: ${e instanceof Error ? e.message : String(e)}`);
      console.error(`[snapshot-leaderboards] ${listicle.slug} failed:`, e);
    }
  }

  // Non-2xx only when EVERYTHING failed — a partial run is still progress the
  // dispatcher shouldn't retry into a loop.
  const status = ok === 0 && failed > 0 ? 500 : 200;
  return NextResponse.json(
    { success: failed === 0, date: today, targets: targets.length, ok, failed, rows_written: rows, errors: errors.slice(0, 12) },
    { status },
  );
}
