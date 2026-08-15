/**
 * /api/cron/precompute-today-intel
 *
 * Warms the Today's Intel cache so NO VISITOR ever pays the compute.
 *
 * Eric 2026-08-15: *"we need to do a precache for the numbers so we are not pulling each time.
 * I would do it the day before or the night before."*
 *
 * WHY THIS EXISTS ON TOP OF THE TTL CACHE. A plain 5-minute TTL still makes SOMEONE eat the slow
 * path every time it expires — and on demo day that someone could be the person demoing. A
 * precompute means the cache is refilled on a schedule, so the expiry is absorbed by a cron rather
 * than by a human waiting on a page. Measured before caching: ~2.8s of server time per request,
 * all of it round-trip latency across three sequential waves.
 *
 * HOW IT STAYS HONEST:
 *  · It calls the SAME compute path the page calls (`refreshTodayIntelCache`) — there is no second
 *    implementation to drift. A precompute that computed its numbers differently from the page
 *    would be worse than no precompute at all.
 *  · It writes through the normal cache helpers, so a degraded read is NOT cached (a failed block
 *    must never be frozen into the front page for a whole TTL).
 *  · It reports what it actually wrote. A 200 that silently cached nothing is the "green build,
 *    broken feature" failure this repo keeps getting bitten by.
 *
 * ⚠️ Registered as a `cron_jobs` ROW, never a vercel.json cron (the 100-cron cap blocks deploys).
 * Order matters: deploy this route → curl it on prod for a real 200 → THEN insert the row.
 */
import { NextRequest, NextResponse } from 'next/server';
import { refreshTodayIntelCache } from '@/lib/today/intel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

/**
 * The canonical cron auth for this repo. The dispatcher invokes job routes with
 * `authorization: Bearer <CRON_SECRET>` + `x-cron-dispatch: 1` (see api/cron/dispatch ~line 197).
 * ⚠️ Do NOT reach for `x-vercel-cron-secret` — nothing sends it, and a route that checks only
 * that header silently falls back to requiring `?password=` in the URL, which is exactly how the
 * live ADMIN_PASSWORD ended up sitting in cron_jobs rows (and therefore in access logs).
 */
function isAuthed(request: NextRequest): boolean {
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const pw = request.nextUrl.searchParams.get('password');
  return (
    (!!CRON_SECRET && bearer === CRON_SECRET) ||
    request.headers.get('x-vercel-cron') === '1' ||
    request.headers.get('x-cron-dispatch') === '1' ||
    (!!ADMIN_PASSWORD && pw === ADMIN_PASSWORD)
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthed(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  try {
    const result = await refreshTodayIntelCache();
    const ms = Date.now() - started;

    // Surface the real outcome. `cached:false` on a 200 means the compute came back DEGRADED and
    // was deliberately not written — the next visitor will compute live (correct, just slower).
    // That distinction is the difference between "the warm-up worked" and "the warm-up ran".
    console.log(
      `[precompute-today-intel] ${ms}ms  cached=${result.cached}  degraded=${result.degraded}  ` +
      `stats=${result.stats}  agencies=${result.agencies}  movers=${result.movers}  featured=${result.featured}`,
    );

    return NextResponse.json({
      success: true,
      cached: result.cached,
      degraded: result.degraded,
      counts: {
        stats: result.stats,
        agencies: result.agencies,
        movers: result.movers,
        featured: result.featured,
      },
      headline: result.headline,
      ms,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[precompute-today-intel] failed:', msg);
    // Non-2xx so the dispatcher records a FAILED job instead of a silent green.
    return NextResponse.json({ success: false, error: msg, ms: Date.now() - started }, { status: 500 });
  }
}
