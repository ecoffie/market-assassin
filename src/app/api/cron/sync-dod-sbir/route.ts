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
 *
 * Honesty (2026-11-18): api-down / empty corpus MUST NOT report success. The prior reachability gate
 * returned HTTP 200 + success:true while dod_sbir_topics stayed at 0 — a false green. Outcome is
 * decided by decideDodSbirExecuteOutcome; the job is also parked in cron_jobs pending upstream recovery.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchDodSbirPage, type DodSbirTopic } from '@/lib/sbir/dod-sbir';
import { decideDodSbirExecuteOutcome, type DodSbirStop } from '@/lib/sbir/dod-sbir-outcome';
import { reportCronOutcome } from '@/lib/cron-self-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const JOB_NAME = 'sync-dod-sbir';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function heldCount(client: ReturnType<typeof sb>): Promise<number> {
  const { count, error } = await client.from('dod_sbir_topics').select('*', { count: 'exact', head: true });
  if (error || count == null) return 0;
  return count;
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
  let stopped: DodSbirStop = 'last-page';
  const client = sb();

  // Reachability gate: one page up front. api-down is reported as failure (not success) so
  // cron_jobs / cron_job_runs cannot manufacture health over an empty corpus.
  const probe = await fetchDodSbirPage({ scope, rows: PAGE, start: 0 });
  if (probe.rateLimited || probe.degraded) {
    const held = await heldCount(client);
    const outcome = decideDodSbirExecuteOutcome({ stopped: 'api-down', upserted: 0, heldRows: held });
    await reportCronOutcome(JOB_NAME, outcome.cronOutcome, outcome.disclosure);
    return NextResponse.json({
      success: outcome.success, mode, scope, pages: 0, upserted: 0,
      stopped: 'api-down' as const, apiReachable: false,
      heldRows: held,
      disclosure: outcome.disclosure,
      note: outcome.disclosure,
      elapsedMs: Date.now() - started,
    }, { status: outcome.httpStatus });
  }

  // Reuse the reachability probe as the first page (start=0) instead of re-fetching it.
  let firstPage: Awaited<ReturnType<typeof fetchDodSbirPage>> | null = probe;
  while (Date.now() - started < budgetMs) {
    const page = firstPage ?? await fetchDodSbirPage({ scope, rows: PAGE, start });
    firstPage = null;
    if (page.rateLimited) {
      rateLimitHits++;
      if (rateLimitHits >= 3) { stopped = 'rate-limit'; break; }
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }
    if (page.degraded) { stopped = 'error'; break; }
    if (page.raw === 0) { stopped = 'last-page'; break; }
    pages++;

    if (page.rows.length) {
      const byNum = new Map<string, DodSbirTopic>();
      for (const t of page.rows) byNum.set(t.topic_number, t);
      const rows = [...byNum.values()].map((t) => ({ ...t, synced_at: new Date().toISOString() }));
      const { error } = await client.from('dod_sbir_topics').upsert(rows, { onConflict: 'topic_number' });
      if (error) { console.error('[sync-dod-sbir] upsert failed:', error.message); stopped = 'error'; break; }
      upserted += rows.length;
    }
    if (page.raw < PAGE) { stopped = 'last-page'; break; }
    start += PAGE;
  }
  if (stopped === 'last-page' && Date.now() - started >= budgetMs) stopped = 'budget';

  const held = await heldCount(client);
  const outcome = decideDodSbirExecuteOutcome({ stopped, upserted, heldRows: held });
  await reportCronOutcome(JOB_NAME, outcome.cronOutcome, outcome.disclosure || undefined);

  return NextResponse.json({
    success: outcome.success,
    mode, scope, pages, upserted, rateLimitHits, stopped,
    heldRows: held,
    disclosure: outcome.disclosure || undefined,
    nextStart: stopped === 'budget' ? start : 0,
    elapsedMs: Date.now() - started,
  }, { status: outcome.httpStatus });
}
