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
 * Honesty (2026-11-18): a down or unrecognized source must not report success. #2167's
 * decideDodSbirExecuteOutcome rejects every empty corpus. This route uses classifyDodSbirSync,
 * which still fails api-down / shape-change / parser-empty / partial, and allows success on a
 * zero only when the body is a parsed empty solicitation list (emptyEvidence).
 * The historical response field for a down probe remains stopped: 'api-down'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchDodSbirPage, classifyDodSbirSync, type DodSbirListEvidence, type DodSbirTopic } from '@/lib/sbir/dod-sbir';
import { reportCronOutcome } from '@/lib/cron-self-report';

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

  const started = Date.now();
  let start = 0, upserted = 0, pages = 0, rateLimitHits = 0;
  let stopped: 'budget' | 'last-page' | 'rate-limit' | 'error' | 'api-down' = 'last-page';
  const client = sb();

  const probe = await fetchDodSbirPage({ scope, rows: PAGE, start: 0 });
  let solicitationsSeen = 0;
  let topicsSeen = 0;
  let emptyListEvidence: DodSbirListEvidence | null = null;
  if (probe.rateLimited || probe.degraded) {
    stopped = probe.rateLimited ? 'api-down' : 'error';
  } else {
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
      if (page.listEvidence && page.raw === 0) emptyListEvidence = page.listEvidence;
      solicitationsSeen += page.raw;
      topicsSeen += page.rows.length;
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
  }

  const classified = classifyDodSbirSync({
    stopped, pages, upserted, solicitationsSeen, topicsSeen, emptyListEvidence,
  });
  const heldRows = await heldCount(client);
  const note = classified.outcome === 'source_unavailable'
    ? 'sbir.gov not reachable this run (rate-limited, maintenance, or blocked). Not a successful ingest and not an empty catalog. Do not tell the customer there are no opportunities.'
    : classified.outcome === 'empty_verified'
      ? `Source returned a parsed empty list (${classified.emptyEvidence}). Zero topics is success only because that evidence is present.`
      : classified.outcome === 'parser_empty'
        ? 'The source returned solicitations but zero citable topics. The feed shape may have changed; this is not an empty market.'
        : classified.outcome === 'partial'
          ? 'The run stopped before the catalog finished. Records already written stay written; this is not a complete ingest.'
          : classified.outcome === 'ingest_error'
            ? 'The source did not return a usable solicitation list (HTTP error, network failure, unrecognized body, or a failed write). Not an empty catalog.'
            : null;
  await reportCronOutcome(
    JOB_NAME,
    classified.cronOutcome,
    classified.success ? undefined : (note ?? classified.outcome),
  );
  return NextResponse.json({
    success: classified.success,
    status: classified.outcome,
    mode, scope, pages, upserted, rateLimitHits,
    // Historical field name kept so a down probe is still identifiable: stopped: 'api-down'
    stopped,
    recordsReceived: classified.recordsReceived,
    emptyEvidence: classified.emptyEvidence,
    heldRows,
    apiReachable: classified.outcome !== 'source_unavailable',
    note,
    nextStart: stopped === 'budget' ? start : 0,
    elapsedMs: Date.now() - started,
  }, { status: classified.httpStatus });
}
