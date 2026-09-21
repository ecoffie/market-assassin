/**
 * Cron: sync DoD SBIR/STTR topics from the official sbir.gov API → dod_sbir_topics (Eric #6, 2026-07-28).
 *
 * search_sbir was NIH-only; this fills the defense gap. The sbir.gov API is rate-limited HARD + can be
 * under maintenance, so this is CACHE-FIRST: the cron pages through DoD open (and future) topics under
 * a wall-clock budget, backs off on a rate-limit, and upserts into dod_sbir_topics. The search reads
 * the table, never the API. Resumable — each run advances `start` and stops on the budget or the last page.
 *
 * Auth: x-vercel-cron OR Bearer CRON_SECRET OR ?password=ADMIN_PASSWORD (same as the other crons).
 * ?mode=preview does ONE page (no writes) so you can see the shape; ?mode=execute drains + upserts.
 * Deploy the route → curl a 200 on prod → THEN add the cron_jobs row (CLAUDE.md #5, never the reverse).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchDodSbirPage, type DodSbirTopic } from '@/lib/sbir/dod-sbir';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasSecret = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const pw = new URL(request.url).searchParams.get('password');
  const hasPw = Boolean(process.env.ADMIN_PASSWORD) && pw === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !hasPw) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const mode = params.get('mode') === 'execute' ? 'execute' : 'preview';
  const scope = (params.get('scope') === 'future' ? 'future' : 'open') as 'open' | 'future';
  const budgetMs = Number.parseInt(params.get('budgetMs') || '120000', 10);
  const PAGE = 100;

  // PREVIEW — one page, no writes: surfaces the live shape + whether the API is reachable right now.
  if (mode === 'preview') {
    const first = await fetchDodSbirPage({ scope, rows: PAGE, start: 0 });
    return NextResponse.json({
      success: true, mode, scope,
      apiReachable: !first.rateLimited && !first.degraded,
      rateLimited: first.rateLimited, degraded: first.degraded,
      solicitations_on_page: first.raw, topics_on_page: first.rows.length,
      sample: first.rows.slice(0, 3),
    });
  }

  // EXECUTE — page through under the wall-clock budget, upserting each page. Back off on a rate-limit.
  const started = Date.now();
  let start = 0, upserted = 0, pages = 0, rateLimitHits = 0;
  let stopped: 'budget' | 'last-page' | 'rate-limit' | 'error' | 'api-down' = 'last-page';
  const client = sb();

  // AUTO-DRAIN REACHABILITY GATE (2026-07-28): this route is fired on a schedule so it drains the
  // instant sbir.gov recovers — but the API has been down for weeks. A cheap ONE-page probe up front
  // lets a down-API run return in ~1 request instead of burning the 3×8s rate-limit backoff every fire.
  // Still returns 200 (not error) so the dispatcher records success and the watchdog stays quiet while
  // the source is down; the real drain runs the moment the probe comes back clean.
  const probe = await fetchDodSbirPage({ scope, rows: PAGE, start: 0 });
  if (probe.rateLimited || probe.degraded) {
    return NextResponse.json({
      success: true, mode, scope, pages: 0, upserted: 0,
      stopped: 'api-down', apiReachable: false,
      note: 'sbir.gov not reachable this run (rate-limited/maintenance) — will drain automatically when it recovers.',
      elapsedMs: Date.now() - started,
    }, { status: 200 });
  }

  // Reuse the reachability probe as the first page (start=0) instead of re-fetching it.
  let firstPage: Awaited<ReturnType<typeof fetchDodSbirPage>> | null = probe;
  while (Date.now() - started < budgetMs) {
    const page = firstPage ?? await fetchDodSbirPage({ scope, rows: PAGE, start });
    firstPage = null;
    if (page.rateLimited) {
      rateLimitHits++;
      if (rateLimitHits >= 3) { stopped = 'rate-limit'; break; } // give up this run; the next fire retries
      await new Promise((r) => setTimeout(r, 8000)); // back off, retry the SAME page
      continue;
    }
    if (page.degraded) { stopped = 'error'; break; }
    if (page.raw === 0) { stopped = 'last-page'; break; } // no more solicitations
    pages++;

    if (page.rows.length) {
      // Dedup by topic_number within the page (a topic can't appear twice), then upsert.
      const byNum = new Map<string, DodSbirTopic>();
      for (const t of page.rows) byNum.set(t.topic_number, t);
      const rows = [...byNum.values()].map((t) => ({ ...t, synced_at: new Date().toISOString() }));
      const { error } = await client.from('dod_sbir_topics').upsert(rows, { onConflict: 'topic_number' });
      if (error) { console.error('[sync-dod-sbir] upsert failed:', error.message); stopped = 'error'; break; }
      upserted += rows.length;
    }
    if (page.raw < PAGE) { stopped = 'last-page'; break; } // short page = done
    start += PAGE;
  }
  if (stopped === 'last-page' && Date.now() - started >= budgetMs) stopped = 'budget';

  return NextResponse.json({
    success: stopped !== 'error',
    mode, scope, pages, upserted, rateLimitHits, stopped,
    nextStart: stopped === 'budget' ? start : 0,
    elapsedMs: Date.now() - started,
  }, { status: stopped === 'error' ? 502 : 200 });
}
