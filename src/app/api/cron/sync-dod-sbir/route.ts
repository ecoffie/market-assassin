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
 * decided by decideDodSbirExecuteOutcome.
 *
 * Recovery (Eric 2026-11-18): keep this cron ENABLED. A down probe retries a few times inside the
 * run, then returns HTTP 503. The next dispatcher tick drains automatically when the source returns.
 * Do not park sync-dod-sbir for temporary unavailability.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchDodSbirPage, type DodSbirTopic } from '@/lib/sbir/dod-sbir';
import { fetchDodPortalOpenTopics } from '@/lib/sbir/dod-topics-portal';
import {
  decideDodSbirExecuteOutcome,
  probeDodSbirWithRetries,
  type DodSbirStop,
} from '@/lib/sbir/dod-sbir-outcome';
import { reportCronOutcome } from '@/lib/cron-self-report';
import { hasValidCronSecret } from '@/lib/cron/cron-request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const JOB_NAME = 'sync-dod-sbir';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function heldCount(client: ReturnType<typeof sb>): Promise<number | null> {
  const { count, error } = await client.from('dod_sbir_topics').select('*', { count: 'exact', head: true });
  if (error || count == null) return null;
  return count;
}

export async function GET(request: NextRequest) {
  const isVercelCron = hasValidCronSecret(request);
  const authHeader = request.headers.get('authorization');
  const hasSecret = Boolean(process.env.CRON_SECRET) && hasValidCronSecret(request);
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

  // PREVIEW — no writes. The DSIP public list is the source that answered on 2026-11-20.
  // sbir.gov is reported too, because a 403 there is why this cron used to look healthy with 0 rows.
  if (mode === 'preview') {
    const portal = await fetchDodPortalOpenTopics({ pageSize: 5, maxPages: 1 });
    const first = await fetchDodSbirPage({ scope, rows: PAGE, start: 0 });
    return NextResponse.json({
      success: portal.complete, mode, scope,
      portal: {
        complete: portal.complete,
        degraded: portal.degraded,
        reportedTotal: portal.reportedTotal,
        topics_on_page: portal.rows.length,
        error: portal.error,
        sample: portal.rows.slice(0, 3),
      },
      sbirGov: {
        apiReachable: !first.rateLimited && !first.degraded,
        rateLimited: first.rateLimited,
        degraded: first.degraded,
        solicitations_on_page: first.raw,
        topics_on_page: first.rows.length,
      },
      sample: (portal.rows.length ? portal.rows : first.rows).slice(0, 3),
    });
  }

  // EXECUTE — page through under the wall-clock budget, upserting each page. Back off on a rate-limit.
  const started = Date.now();
  let start = 0, upserted = 0, pages = 0, rateLimitHits = 0;
  let stopped: DodSbirStop = 'last-page';
  const client = sb();

  // DSIP public open/pre-release list. sbir.gov stays the fallback and still fails loud.
  const portal = await fetchDodPortalOpenTopics();
  if (portal.complete && portal.rows.length > 0) {
    const byNum = new Map<string, DodSbirTopic>();
    for (const t of portal.rows) byNum.set(t.topic_number, t);
    const rows = [...byNum.values()].map((t) => ({ ...t, synced_at: new Date().toISOString() }));
    const { error } = await client.from('dod_sbir_topics').upsert(rows, { onConflict: 'topic_number' });
    const held = await heldCount(client);
    if (error) {
      const outcome = decideDodSbirExecuteOutcome({ stopped: 'error', upserted: 0, heldRows: held });
      const disclosure = `DSIP topics upsert failed: ${error.message}. ${outcome.disclosure}`;
      await reportCronOutcome(JOB_NAME, outcome.cronOutcome, disclosure);
      return NextResponse.json({
        success: false, mode, scope, source: 'dodsbirsttr.mil',
        pages: portal.pages, upserted: 0, stopped: 'error',
        reportedTotal: portal.reportedTotal, heldRows: held, disclosure,
        elapsedMs: Date.now() - started,
      }, { status: outcome.httpStatus });
    }
    const outcome = decideDodSbirExecuteOutcome({ stopped: 'last-page', upserted: rows.length, heldRows: held });
    const disclosure = `DSIP public topics list: ${rows.length} open/pre-release topics (reported ${portal.reportedTotal}).`;
    await reportCronOutcome(JOB_NAME, outcome.cronOutcome, disclosure);
    return NextResponse.json({
      success: outcome.success, mode, scope, source: 'dodsbirsttr.mil',
      pages: portal.pages, upserted: rows.length, stopped: 'last-page',
      reportedTotal: portal.reportedTotal, heldRows: held, disclosure,
      sample: rows.slice(0, 3).map((t) => t.topic_number),
      elapsedMs: Date.now() - started,
    }, { status: outcome.httpStatus });
  }

  // Reachability gate with controlled retries. api-down is reported as failure (not success)
  // so cron_jobs / cron_job_runs cannot manufacture health over an empty corpus — and the
  // job stays enabled so a later tick recovers when a source returns.
  const { page: probe, attemptsUsed: probeAttempts } = await probeDodSbirWithRetries(
    () => fetchDodSbirPage({ scope, rows: PAGE, start: 0 }),
  );
  if (probe.rateLimited || probe.degraded) {
    const held = await heldCount(client);
    const outcome = decideDodSbirExecuteOutcome({ stopped: 'api-down', upserted: 0, heldRows: held });
    const disclosure =
      `DSIP public list: ${portal.error ?? 'incomplete'}. ${outcome.disclosure} (probeAttempts=${probeAttempts}; cron stays enabled for recovery)`;
    await reportCronOutcome(JOB_NAME, outcome.cronOutcome, disclosure);
    return NextResponse.json({
      success: outcome.success, mode, scope, pages: 0, upserted: 0,
      stopped: 'api-down' as const, apiReachable: false,
      heldRows: held,
      probeAttempts,
      disclosure,
      note: disclosure,
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
    probeAttempts,
    disclosure: outcome.disclosure || undefined,
    nextStart: stopped === 'budget' ? start : 0,
    elapsedMs: Date.now() - started,
  }, { status: outcome.httpStatus });
}
