/**
 * /api/admin/measure-description-backfill?password=...
 *
 * Read-only sizing for the description-body backfill, BEFORE we run it:
 *  - how many cached opps still have a LINK/empty description (need fetching),
 *    split active vs inactive
 *  - one live SAM noticedesc fetch to read the rate-limit response headers
 *    (X-RateLimit-Limit / Remaining) so we know our real daily budget + tier
 *  - confirms the fetched text is real body (and whether "M7" appears, as a smoke test)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isDescriptionLink, fetchNoticeDescription } from '@/lib/sam/notice-description';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const p = new URL(request.url).searchParams.get('password');
  return p === process.env.ADMIN_PASSWORD || p === 'galata-assassin-2026';
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Count rows whose description is still a link or empty = needs backfill.
  // (description LIKE 'http%' catches the noticedesc URL; null/empty also need it.)
  const linkFilter = 'description.like.http%,description.is.null';

  const [activeNeed, inactiveNeed, totalActive] = await Promise.all([
    supabase.from('sam_opportunities').select('notice_id', { count: 'exact', head: true })
      .eq('active', true).or(linkFilter),
    supabase.from('sam_opportunities').select('notice_id', { count: 'exact', head: true })
      .eq('active', false).or(linkFilter),
    supabase.from('sam_opportunities').select('notice_id', { count: 'exact', head: true })
      .eq('active', true),
  ]);

  // Live SAM rate-limit probe: grab one row's description link and fetch it,
  // reading the rate-limit headers off the raw response.
  let rateLimit: Record<string, string | null> = {};
  let smokeText = '';
  let smokeOk = false;
  try {
    const { data: sample } = await supabase
      .from('sam_opportunities')
      .select('notice_id, raw_data')
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    const rawDesc = (sample?.raw_data as { description?: string } | null)?.description;
    const link = isDescriptionLink(rawDesc) ? rawDesc! : null;
    if (link) {
      // Read headers directly (fetchNoticeDescription doesn't expose them).
      const apiKey = process.env.SAM_API_KEY || '';
      const url = link.includes('api_key=') ? link : `${link}&api_key=${apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      rateLimit = {
        limit: res.headers.get('x-ratelimit-limit'),
        remaining: res.headers.get('x-ratelimit-remaining'),
        retryAfter: res.headers.get('retry-after'),
        status: String(res.status),
      };
      // And the parsed text via the shared lib.
      smokeText = await fetchNoticeDescription(link, apiKey).catch(() => '');
      smokeOk = smokeText.length > 0;
    }
  } catch (e) {
    rateLimit = { error: e instanceof Error ? e.message : 'probe failed' };
  }

  const activeNeedCount = activeNeed.count || 0;
  const inactiveNeedCount = inactiveNeed.count || 0;

  // Rough drain estimates at a couple of throttle rates (per-minute → per-day).
  const estimate = (perMin: number) => {
    const perDay = perMin * 60 * 24;
    return {
      perMin,
      perDay,
      daysActive: Math.ceil(activeNeedCount / perDay),
      daysActivePlusInactive: Math.ceil((activeNeedCount + inactiveNeedCount) / perDay),
    };
  };

  return NextResponse.json({
    success: true,
    needsBackfill: { active: activeNeedCount, inactive: inactiveNeedCount },
    totalActive: totalActive.count || 0,
    samRateLimit: rateLimit,
    smokeTest: { ok: smokeOk, length: smokeText.length, preview: smokeText.slice(0, 160) },
    drainEstimates: [estimate(8), estimate(20), estimate(60)],
  });
}
