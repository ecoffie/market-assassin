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

function authorized(request: NextRequest): boolean {
  if (request.headers.get('x-vercel-cron') === '1') return true;
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

async function warmSlug(slug: string): Promise<'warmed' | 'skipped'> {
  // Warm the slug-resolution key first (the page's 404 gate). liveBq=true
  // is what turns a cache miss into a BQ scan + KV write.
  const rollup = await getRollupOrSingleBySlug(slug, true);
  if (!rollup) return 'skipped'; // slug genuinely doesn't resolve

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

  // A previous cold crawl may have cached a 404 via ISR — force
  // regeneration now that the data keys are warm.
  revalidatePath(`/contractors/${slug}`);
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
  });
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
