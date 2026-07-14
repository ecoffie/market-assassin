/**
 * /api/cron/warm-seo-bq — controlled pre-warm of the SEO BigQuery KV cache.
 *
 * WHY: the public SEO pages read their data cache-only (see src/lib/seo/live-bq.ts
 * — crawler cold-scans drained the BQ daily quota, so live scanning is gated OFF
 * by default). With cold-scanning off, an unwarmed contractor/award page 404s.
 * This cron is the CONTROLLED alternative to crawler cold-scans: it pre-populates
 * the exact KV keys the pages read, from a bounded set of scans, so the
 * high-value pages render 200 while the public switch stays OFF and random
 * long-tail URLs stay cheap (cold → 404, no scan).
 *
 * Because the BQ cache TTL is 90 days, this is a SLOW-cadence job (weekly is
 * plenty; it mainly needs to re-run after a DATA_VERSION bump wipes the cache —
 * see the $2,075 June-2026 cost-spike note in src/lib/bigquery/cache.ts).
 *
 * What it warms (bounded, env-tunable):
 *   - Contractor overview HEADERS (`rollup:by-slug:*`) — ONE scan warms the top
 *     WARM_CONTRACTORS_LIMIT contractors → their pages render 200 (name + total
 *     obligated). Sub-section charts (~GB each) are deliberately NOT warmed.
 *   - Award detail (`awards:detail:*`) — top WARM_AWARDS_LIMIT ids, partition-
 *     pruned ~15MB each, warmed in resumable batches of WARM_AWARDS_BATCH.
 *
 * Modes: ?mode=preview (DEFAULT — reports what it WOULD warm + a rough byte
 * estimate, no scans/writes) · ?mode=execute (does the warming).
 * Target: ?target=all (default) | contractors | awards.
 * Resumable: ?offset=N for the awards batch; response returns { remaining,
 * nextOffset } so the dispatcher window continues until drained.
 *
 * Auth: x-vercel-cron header, or Bearer CRON_SECRET, or ?password=ADMIN_PASSWORD.
 */
import { NextRequest, NextResponse } from 'next/server';
import { bulkWarmRollupHeaders } from '@/lib/bigquery/recipients';
import { getTopAwardIdsForStatic, getAwardById } from '@/lib/bigquery/awards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Conservative defaults — Vercel KV free tier caps ~10K commands/day, so keep a
// full cycle's writes (contractors + awards) comfortably under that.
const CONTRACTORS_LIMIT = Number(process.env.WARM_CONTRACTORS_LIMIT ?? 3000);
const AWARDS_LIMIT = Number(process.env.WARM_AWARDS_LIMIT ?? 2000);
const AWARDS_BATCH = Number(process.env.WARM_AWARDS_BATCH ?? 500);
const CONCURRENCY = Number(process.env.WARM_CONCURRENCY ?? 8);
// The build-time generateStaticParams already warms this id-list key; reuse it
// so we don't re-run the ~20GB ranking scan unless the list is genuinely cold.
const AWARD_ID_LIST_SIZE = 10000;
const SOFT_BUDGET_MS = 240_000;

function authorized(request: NextRequest): boolean {
  if (request.headers.get('x-vercel-cron') === '1') return true;
  const auth = request.headers.get('authorization');
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const pw = request.nextUrl.searchParams.get('password');
  if (pw && pw === process.env.ADMIN_PASSWORD) return true;
  return false;
}

/** Warm `ids` via getAwardById(force) with a small concurrency pool, honoring a
 * soft deadline. Returns how many were processed + how many resolved (warmed). */
async function warmAwardBatch(
  ids: string[],
  deadline: number,
): Promise<{ processed: number; warmed: number }> {
  let processed = 0;
  let warmed = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length && Date.now() < deadline) {
      const i = cursor++;
      processed++;
      try {
        const award = await getAwardById(ids[i], { force: true });
        if (award) warmed++;
      } catch {
        /* individual failure is a cache miss, not fatal — keep going */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  return { processed, warmed };
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const mode = sp.get('mode') === 'execute' ? 'execute' : 'preview';
  const target = (sp.get('target') as 'all' | 'contractors' | 'awards') || 'all';
  const offset = Math.max(0, Number(sp.get('offset') ?? 0) || 0);
  const doContractors = target === 'all' || target === 'contractors';
  const doAwards = target === 'all' || target === 'awards';
  const deadline = Date.now() + SOFT_BUDGET_MS;

  if (mode === 'preview') {
    // Rough byte estimates only — no scans, no writes.
    const awardsWarmCount = Math.min(AWARDS_LIMIT, AWARD_ID_LIST_SIZE);
    return NextResponse.json({
      success: true,
      mode: 'preview',
      target,
      contractors: doContractors
        ? { limit: CONTRACTORS_LIMIT, est_scan: '~1 scan of recipients_rollup (≤5 GiB cap), warms that many rollup:by-slug headers' }
        : null,
      awards: doAwards
        ? {
            warmCount: awardsWarmCount,
            batch: AWARDS_BATCH,
            est_bytes: `id-list ~20GB once if cold, then ~15MB/detail × ${awardsWarmCount} ≈ ${Math.round((awardsWarmCount * 15) / 1024)}GB across batches`,
          }
        : null,
      note: 'Add &mode=execute to warm. Awards resume via &offset=<nextOffset> until remaining=0.',
    });
  }

  const result: Record<string, unknown> = { success: true, mode: 'execute', target };

  // Contractors: a single bulk scan — only on the first pass (offset 0) so awards
  // resume runs don't re-scan the rollup table.
  if (doContractors && offset === 0) {
    try {
      const c = await bulkWarmRollupHeaders(CONTRACTORS_LIMIT);
      result.contractors = { ...c, limit: CONTRACTORS_LIMIT };
    } catch (err) {
      result.contractors = { error: err instanceof Error ? err.message : String(err) };
    }
  } else if (doContractors) {
    result.contractors = { skipped: 'offset>0 (already warmed on the offset=0 pass)' };
  }

  // Awards: resumable batches over the top-N ids.
  if (doAwards) {
    try {
      // Reuse the build-warmed id-list key; force a one-time ranking scan only if
      // it's genuinely cold (and only on the first pass).
      let ids = await getTopAwardIdsForStatic(AWARD_ID_LIST_SIZE);
      if (ids.length === 0 && offset === 0) {
        ids = await getTopAwardIdsForStatic(AWARD_ID_LIST_SIZE, { force: true });
      }
      const targetIds = ids.slice(0, AWARDS_LIMIT);
      const batch = targetIds.slice(offset, offset + AWARDS_BATCH);
      const { processed, warmed } = await warmAwardBatch(batch, deadline);
      const nextOffset = offset + processed;
      const remaining = Math.max(0, targetIds.length - nextOffset);
      result.awards = {
        total: targetIds.length,
        offset,
        processed,
        warmed,
        remaining,
        nextOffset: remaining > 0 ? nextOffset : null,
      };
    } catch (err) {
      result.awards = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return NextResponse.json(result);
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
