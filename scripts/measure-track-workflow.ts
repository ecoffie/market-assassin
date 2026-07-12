/**
 * measure-track-workflow.ts — did the track→act + runway work move behavior?
 *
 * Prints the engagement metrics the workflow changes were meant to lift, as a
 * WEEK-OVER-WEEK comparison so you get a clean before/after around the ship date
 * (in-app feed runway + next-action fixed 2026-07-11..07-12).
 *
 * Grounded in REAL tables (no assumptions):
 *   - BROWSE  = distinct users with in-app engagement (user_engagement, sources
 *               market_intelligence + source_feed — the 94% of daily activity)
 *               in the window.
 *   - TRACK   = distinct users who CREATED a user_pipeline row (created_at) in the
 *               window. Tracking has no dedicated engagement event; the row IS the
 *               record. (memory: no 'track' EventType exists.)
 *   - BROWSE→TRACK RATE = trackers-who-also-browsed / browsers. The headline the
 *               plan baselined at 4%.
 *   - NEXT_ACTION FILL  = of pipeline rows created in the window, what fraction got
 *               a non-null next_action (write-time stamp shipped 07-11; was 24%).
 *   - GIVE-UP SIGNAL    = browsers in the window who NEVER created a pipeline row
 *               (browsed, didn't act) — the population the fixes target.
 *
 * Excludes staff/internal/test noise via isExcludedFromMetrics so the rates are
 * real customers, not us.
 *
 *   npx tsx scripts/measure-track-workflow.ts            # last 2 weeks vs prior 2
 *   npx tsx scripts/measure-track-workflow.ts --days 7   # 7d windows
 *   npx tsx scripts/measure-track-workflow.ts --since 2026-07-11   # split on ship date
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { isExcludedFromMetrics } from '../src/lib/mindy/campaign-exclusions';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BROWSE_SOURCES = ['market_intelligence', 'source_feed', 'market_intel_dashboard'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Pull ALL rows past a cutoff with .range() paging (PostgREST caps at 1000). */
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface WindowMetrics {
  label: string;
  browsers: number;
  trackers: number;
  browseTrackRate: number; // % of browsers who also tracked in-window
  pipelineRowsCreated: number; // capped per user
  pipelineRowsRaw: number; // uncapped (shows whales)
  nextActionFillPct: number; // over the capped set (whale-resistant)
  gaveUp: number; // browsed, never tracked (all-time)
  gaveUpPct: number;
}

async function measureWindow(label: string, start: Date, end: Date): Promise<WindowMetrics> {
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // BROWSE: distinct in-app browsers in window
  const evRows = await pageAll<{ user_email: string; event_source: string }>((from, to) =>
    sb
      .from('user_engagement')
      .select('user_email,event_source')
      .in('event_source', BROWSE_SOURCES)
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .range(from, to),
  );
  const browsers = new Set<string>();
  for (const e of evRows) {
    const email = (e.user_email || '').toLowerCase();
    if (email && !isExcludedFromMetrics(email)) browsers.add(email);
  }

  // TRACK: distinct users who created a pipeline row in window + next_action fill
  const ppRows = await pageAll<{ user_email: string; next_action: string | null }>((from, to) =>
    sb
      .from('user_pipeline')
      .select('user_email,next_action')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .range(from, to),
  );
  // Per-user cap so a single power user bulk-tracking hundreds of opps can't
  // dominate the row-level metrics (observed: one account = 761 rows in 14d).
  // Distinct trackers is already whale-proof; this protects next_action fill.
  const PER_USER_CAP = 25;
  const trackers = new Set<string>();
  const perUser: Record<string, { rows: number; filled: number }> = {};
  let rawRows = 0;
  for (const r of ppRows) {
    const email = (r.user_email || '').toLowerCase();
    if (!email || isExcludedFromMetrics(email)) continue;
    rawRows++;
    trackers.add(email);
    const u = (perUser[email] ||= { rows: 0, filled: 0 });
    if (u.rows < PER_USER_CAP) {
      u.rows++;
      if (r.next_action && r.next_action.trim()) u.filled++;
    }
  }
  let pipelineRows = 0;
  let filled = 0;
  for (const u of Object.values(perUser)) {
    pipelineRows += u.rows;
    filled += u.filled;
  }

  // BROWSE→TRACK: of the window's browsers, how many also tracked in the window.
  let browsedAndTracked = 0;
  for (const email of browsers) if (trackers.has(email)) browsedAndTracked++;

  const gaveUp = browsers.size - browsedAndTracked; // browsed, didn't track (in-window)

  return {
    label,
    browsers: browsers.size,
    trackers: trackers.size,
    browseTrackRate: browsers.size ? (100 * browsedAndTracked) / browsers.size : 0,
    pipelineRowsCreated: pipelineRows,
    pipelineRowsRaw: rawRows,
    nextActionFillPct: pipelineRows ? (100 * filled) / pipelineRows : 0,
    gaveUp,
    gaveUpPct: browsers.size ? (100 * gaveUp) / browsers.size : 0,
  };
}

function fmt(m: WindowMetrics): string {
  return [
    `  ${m.label}`,
    `    browsers (in-app):        ${m.browsers}`,
    `    trackers (new pipeline):  ${m.trackers}`,
    `    browse→track rate:        ${m.browseTrackRate.toFixed(1)}%   ← baseline 4%`,
    `    pipeline rows (raw):      ${m.pipelineRowsRaw}   (capped for fill: ${m.pipelineRowsCreated})`,
    `    next_action fill:         ${m.nextActionFillPct.toFixed(1)}%   ← baseline 24% (whale-capped)`,
    `    browsed-but-never-tracked:${m.gaveUp}  (${m.gaveUpPct.toFixed(1)}% of browsers)`,
  ].join('\n');
}

(async () => {
  const days = parseInt(arg('--days') || '14', 10);
  const sinceArg = arg('--since');

  let recent: { start: Date; end: Date; label: string };
  let prior: { start: Date; end: Date; label: string };

  if (sinceArg) {
    // Split on an explicit ship date: [since .. now] vs [equal window before since].
    const since = new Date(sinceArg + 'T00:00:00Z');
    const now = new Date();
    const spanMs = now.getTime() - since.getTime();
    recent = { start: since, end: now, label: `SINCE ${sinceArg} (post-ship)` };
    prior = {
      start: new Date(since.getTime() - spanMs),
      end: since,
      label: `equal window BEFORE ${sinceArg} (pre-ship)`,
    };
  } else {
    const now = new Date();
    const mid = new Date(now.getTime() - days * 86400000);
    const back = new Date(now.getTime() - 2 * days * 86400000);
    recent = { start: mid, end: now, label: `last ${days}d (recent)` };
    prior = { start: back, end: mid, label: `prior ${days}d (baseline)` };
  }

  console.log('\n=== Track→Act workflow — engagement measurement ===');
  console.log('(customers only; staff/advocate/test excluded)\n');

  const recentM = await measureWindow(recent.label, recent.start, recent.end);
  const priorM = await measureWindow(prior.label, prior.start, prior.end);

  console.log(fmt(priorM));
  console.log('');
  console.log(fmt(recentM));

  console.log('\n=== Δ (recent − baseline) ===');
  const d = (a: number, b: number, unit = '') =>
    `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(1)}${unit}`;
  console.log(`  browse→track rate:  ${d(recentM.browseTrackRate, priorM.browseTrackRate, ' pts')}`);
  console.log(`  next_action fill:   ${d(recentM.nextActionFillPct, priorM.nextActionFillPct, ' pts')}`);
  console.log(`  give-up rate:       ${d(recentM.gaveUpPct, priorM.gaveUpPct, ' pts')}  (lower is better)`);
  console.log('');
})().catch((e) => {
  console.error('measure failed:', e);
  process.exit(1);
});
