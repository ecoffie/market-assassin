/**
 * /api/cron/warm-contractor-pages — hourly KV cache warmer for the
 * contractor SEO pages the sitemap advertises.
 *
 * The sitemap↔page cache contract: sitemap.ts emits ~12K
 * /contractors/<slug> URLs from getTopRecipientsForSitemap() (which
 * self-warms, cacheOnly:false), but contractors/[slug]/page.tsx resolves
 * each slug cache-ONLY (seoLiveBqEnabled() gates the live-BQ fallback
 * OFF — crawler-driven cold scans of the long tail exhausted the BQ
 * daily quota in June 2026, see src/lib/seo/live-bq.ts). So a slug whose
 * per-slug KV keys are cold renders notFound() → GSC reports a 404 for a
 * URL our own sitemap advertises.
 *
 * This cron is the ONLY warmer for those keys. Each run walks a
 * BATCH_SIZE slice of the sitemap's contractor set (same thin-content
 * gate as sitemap.ts) using a persistent KV cursor, calls the exact
 * functions the page calls with liveBq=true so a cache miss runs one BQ
 * scan and writes the 90-day KV entry, then revalidatePath()s the page
 * so any previously cached ISR 404 is regenerated.
 *
 * Cost safety: bounded by BATCH_SIZE/run — ~200 slugs × ~8 keyed queries
 * each. crawl traffic stays cache-only; nothing here changes
 * seoLiveBqEnabled, cacheOnly defaults, or DATA_VERSION.
 *
 * Schedule: hourly (vercel.json). Auth: x-vercel-cron header or
 * Bearer CRON_SECRET (also accepts ?password=ADMIN_PASSWORD for manual
 * runs).
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { kv } from '@vercel/kv';
import {
  getTopRecipientsForSitemap,
  getRollupOrSingleBySlug,
  getYearlyTotalsForRecipient,
  getYearlyByAgencyForRecipient,
  getTopAgenciesForRecipient,
  getTopNaicsForRecipient,
  getRecentAwardsForRecipient,
  getExecutivesForRecipient,
  recipientSlug,
} from '@/lib/bigquery/recipients';
import { WARM_QUEUE_KEY } from '@/lib/seo/served-slugs';
import {
  WARM_PRIORITY_KEY, WARM_PRIORITY_PER_RUN, WARM_PRIORITY_DAILY_CAP, warmDailyKey, isThinContractor,
} from '@/lib/seo/warm-priority';
import { bqResultState } from '@/lib/bigquery/cache';
import { seoCacheKeys } from '@/lib/bigquery/recipients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // matches refresh-bq-rollups — bounded by BATCH_SIZE, not the full set

// Slugs warmed per run. ~200/hour → a full pass over ~12K sitemap slugs
// takes ~60 runs ≈ 2.5 days, far inside the 90-day KV TTL, so everything
// the sitemap advertises stays warm continuously.
const BATCH_SIZE = 200;

// Persistent walk cursor — which index into the sitemap slug list the
// next run starts at. Wraps to 0 at the end of the set.
const CURSOR_KEY = 'cron:warm-contractor-pages:cursor';

// Slugs drained per run from the warm-miss queue (seo:warm:queue:contractor-slugs).
// Every public page that answers 5xx because its data is cold queues its slug; this drain
// is what guarantees that 5xx is temporary (≤ ~1h for the first 25, 600/day). Bounded so a
// crawler walking junk slugs cannot turn the queue into a BigQuery bill: a junk slug costs
// only the identity lookup (~115 MB) and then resolves to a cached "not found".
const QUEUE_DRAIN_PER_RUN = 25;

function authorized(request: NextRequest): boolean {
  // No `x-vercel-cron` header check: any client can send it. Vercel cron sends
  // `Authorization: Bearer CRON_SECRET` (set in production), as does the dispatcher.
  const auth = request.headers.get('authorization');
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const pw = request.nextUrl.searchParams.get('password');
  if (pw && pw === (process.env.ADMIN_PASSWORD)) return true;
  return false;
}

/** The exact slug set the sitemap advertises: same source, same gate. */
async function sitemapSlugs(): Promise<string[]> {
  const recipients = await getTopRecipientsForSitemap();
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const c of recipients) {
    if (!c.recipient_name) continue;
    const slug = recipientSlug(c.recipient_name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    // Thin-content gate — MUST match sitemap.ts / the page's noindex predicate.
    if ((c.total_obligated || 0) < 25000 || (c.award_count || 0) < 2) continue;
    slugs.push(slug);
  }
  return slugs;
}

type WarmResult = 'warmed' | 'skipped' | 'thin' | 'failed';

async function warmSlug(slug: string, opts: { skipThin?: boolean } = {}): Promise<WarmResult> {
  // Warm the slug-resolution key first (the page's 404 gate). liveBq=true
  // is what turns a cache miss into a BQ scan + KV write.
  const rollup = await getRollupOrSingleBySlug(slug, true);
  if (!rollup) return 'skipped'; // slug genuinely doesn't resolve

  // Thin contractors render noindex: their sections buy nothing. Identity is cached either way.
  if (opts.skipThin && isThinContractor(rollup.total_obligated, rollup.award_count)) return 'thin';
  const ueis = rollup.child_ueis;
  const rollupUei = rollup.rollup_uei;

  // The same sub-section reads contractors/[slug]/page.tsx makes, in
  // parallel, all liveBq=true so cold keys get scanned + cached.
  await Promise.all([
    getYearlyTotalsForRecipient(ueis, rollupUei, true),
    getYearlyByAgencyForRecipient(ueis, rollupUei, true),
    getTopAgenciesForRecipient(ueis, rollupUei, 10, true),
    getTopNaicsForRecipient(ueis, rollupUei, 25, true),
    getTopNaicsForRecipient(ueis, rollupUei, 10, true),
    getRecentAwardsForRecipient(ueis, rollupUei, 25, true),
    getExecutivesForRecipient(ueis, rollupUei, true),
  ]);

  // queryCached swallows BigQuery errors into a 'failed' mark. A failed core section means the
  // warm did not happen (quota exhausted, most likely): report it so the drain stops.
  if (bqResultState(seoCacheKeys.recentAwards(rollupUei, 25), 0) === 'failed') return 'failed';

  // A previous cold crawl may have cached a 404 via ISR — force
  // regeneration now that the data keys are warm.
  revalidatePath(`/contractors/${slug}`);
  revalidatePath(`/contractors/${slug}/contracts`);
  return 'warmed';
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slugs = await sitemapSlugs();
  if (slugs.length === 0) {
    return NextResponse.json({ success: false, error: 'sitemap slug set empty' }, { status: 500 });
  }

  let cursor = 0;
  try {
    cursor = Number((await kv.get<number>(CURSOR_KEY)) ?? 0) || 0;
  } catch (err) {
    console.warn('[warm-contractor-pages] cursor read failed, starting at 0:', err);
  }
  if (cursor >= slugs.length) cursor = 0; // set shrank since last run — wrap

  const batch = slugs.slice(cursor, cursor + BATCH_SIZE);
  const nextCursor = cursor + BATCH_SIZE >= slugs.length ? 0 : cursor + BATCH_SIZE;

  let warmed = 0;
  let skipped = 0;
  const failures: Array<{ slug: string; error: string }> = [];

  // 1. Drain the PRIORITY queue first (src/lib/seo/warm-priority.ts): highest score first, bounded
  //    per run and per UTC day, stopping at the first BigQuery failure. Each slug is removed only
  //    when processed; a failure puts it back at its score, so progress is checkpointed in KV.
  const priority = { drained: 0, warmed: 0, thin: 0, skipped: 0, stoppedBy: null as string | null, depthAfter: null as number | null };
  try {
    const used = Number(await kv.get<number>(warmDailyKey())) || 0;
    const room = Math.max(0, Math.min(WARM_PRIORITY_PER_RUN, WARM_PRIORITY_DAILY_CAP - used));
    if (room === 0) priority.stoppedBy = 'daily cap reached';
    const popped = room ? ((await kv.zpopmax<string>(WARM_PRIORITY_KEY, room)) as unknown[]) : [];
    // zpopmax returns [member, score, member, score, ...]
    const items: Array<{ slug: string; score: number }> = [];
    for (let i = 0; i + 1 < popped.length; i += 2) items.push({ slug: String(popped[i]), score: Number(popped[i + 1]) });
    for (let i = 0; i < items.length; i++) {
      const { slug, score } = items[i];
      let r: WarmResult;
      try { r = await warmSlug(slug, { skipThin: true }); } catch { r = 'failed'; }
      priority.drained++;
      if (r === 'failed') {
        // Stop: put this and every unprocessed item back at its score.
        const back = items.slice(i).flatMap((x) => [{ score: x.score, member: x.slug }]);
        if (back.length) await kv.zadd(WARM_PRIORITY_KEY, back[0], ...back.slice(1));
        priority.stoppedBy = `BigQuery failure at ${slug}`;
        failures.push({ slug, error: 'section warm failed (BigQuery)' });
        break;
      }
      if (r === 'warmed') priority.warmed++;
      if (r === 'thin') priority.thin++;
      if (r === 'skipped') priority.skipped++;
      try { await kv.srem(WARM_QUEUE_KEY, slug); } catch { /* the set is the compatibility record */ }
    }
    if (priority.warmed) {
      const n = await kv.incrby(warmDailyKey(), priority.warmed);
      if (n === priority.warmed) await kv.expire(warmDailyKey(), 26 * 3600);
    }
    priority.depthAfter = await kv.zcard(WARM_PRIORITY_KEY);
  } catch (err) {
    priority.stoppedBy = `priority queue unavailable: ${err instanceof Error ? err.message : err}`;
  }

  // 1b. Then recorded misses not yet scored (legacy set), at the old bounded rate.
  let queued: string[] = [];
  let queueDepthAfter: number | null = null;
  if (!priority.stoppedBy?.startsWith('BigQuery')) {
    try {
      const popped = await kv.spop<string[]>(WARM_QUEUE_KEY, QUEUE_DRAIN_PER_RUN);
      queued = Array.isArray(popped) ? popped : popped ? [popped as unknown as string] : [];
    } catch (err) {
      console.warn('[warm-contractor-pages] warm-miss queue unreadable:', err);
    }
  }
  let queueWarmed = 0;
  for (const slug of queued) {
    try {
      const r = await warmSlug(slug, { skipThin: true });
      if (r === 'warmed') queueWarmed++;
      if (r === 'failed') { await kv.sadd(WARM_QUEUE_KEY, slug); break; }
    } catch (err) {
      failures.push({ slug, error: err instanceof Error ? err.message : String(err) });
      try { await kv.sadd(WARM_QUEUE_KEY, slug); } catch { /* best effort */ }
    }
  }
  try {
    queueDepthAfter = await kv.scard(WARM_QUEUE_KEY);
  } catch { /* reported as null */ }

  // 2. Then the steady sitemap walk.
  for (const slug of batch) {
    try {
      const result = await warmSlug(slug);
      if (result === 'warmed') warmed++;
      else skipped++;
    } catch (err) {
      failures.push({ slug, error: err instanceof Error ? err.message : String(err) });
    }
  }

  try {
    await kv.set(CURSOR_KEY, nextCursor);
  } catch (err) {
    console.warn('[warm-contractor-pages] cursor write failed:', err);
  }

  return NextResponse.json({
    success: failures.length === 0,
    totalSlugs: slugs.length,
    cursor,
    nextCursor,
    batchSize: batch.length,
    warmed,
    skipped,
    failed: failures.length,
    failures: failures.slice(0, 20),
    priority,
    queue: { drained: queued.length, warmed: queueWarmed, depthAfter: queueDepthAfter },
  });
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
