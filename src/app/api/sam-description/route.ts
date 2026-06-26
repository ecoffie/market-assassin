/**
 * Lazy-fetch the real description text for a SAM.gov opportunity.
 *
 * SAM stores most descriptions as a separate API URL pointer
 * (api.sam.gov/.../noticedesc?noticeid=...) rather than inline text,
 * so the sam_opportunities.description column often holds the URL
 * itself. This endpoint:
 *
 *   1. Looks up the opportunity in the sam_opportunities cache.
 *   2. If description is already real text, returns it.
 *   3. If description is a URL, fetches it from SAM with our API key,
 *      caches the resolved text back into the row, and returns it.
 *
 * GET /api/sam-description?noticeId=<sam notice id>
 *
 * No auth — descriptions are public data SAM.gov serves freely.
 * Rate is bounded by SAM's per-key quota; the cache means each
 * description is fetched at most once.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRotatedSAMKey, getAvailableSAMKeys } from '@/lib/sam/utils';
import { samHtmlToText, looksLikeHtml } from '@/lib/sam/description-text';
import { fetchNoticeDescription, isDescriptionLink } from '@/lib/sam/notice-description';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_DESCRIPTION_LENGTH = 50000; // safety cap

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function isHttpUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

export async function GET(request: NextRequest) {
  const noticeId = request.nextUrl.searchParams.get('noticeId')?.trim();
  if (!noticeId) {
    return NextResponse.json({ success: false, error: 'noticeId is required' }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data: row, error: lookupError } = await supabase
    .from('sam_opportunities')
    .select('id, notice_id, description')
    .eq('notice_id', noticeId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { success: false, error: `lookup failed: ${lookupError.message}` },
      { status: 500 }
    );
  }
  if (!row) {
    return NextResponse.json({ success: false, error: 'opportunity not found' }, { status: 404 });
  }

  const cached = typeof row.description === 'string' ? row.description.trim() : '';

  // Already real text in the cache — return without hitting SAM. But
  // an earlier fetch may have stored the raw HTML; clean it on read
  // (and write the cleaned form back so we only do this once per row).
  if (cached && !isHttpUrl(cached)) {
    if (looksLikeHtml(cached)) {
      const cleaned = samHtmlToText(cached).slice(0, MAX_DESCRIPTION_LENGTH);
      void supabase
        .from('sam_opportunities')
        .update({ description: cleaned })
        .eq('notice_id', noticeId)
        .then((res) => {
          if (res.error) console.warn('[sam-description] cache rewrite failed:', res.error.message);
        });
      return NextResponse.json({
        success: true,
        noticeId,
        description: cleaned,
        source: 'cache+cleaned',
      });
    }
    return NextResponse.json({
      success: true,
      noticeId,
      description: cached,
      source: 'cache',
    });
  }

  // Need to resolve from SAM. Use the stored noticedesc URL if we have one, else
  // build the request from notice_id. fetchNoticeDescription handles both.
  //
  // CRITICAL (Eric, Jun 26 2026): try EVERY configured key, not just today's
  // rotated one. SAM enforces a per-key DAILY quota, so one key can be 429 while
  // another is fine. The old code used a single rotated key and, when it was
  // throttled, surfaced the 429 as "no description URL on file for this
  // opportunity" — the SAM Synopsis silently broke whenever the day's key was hot.
  const keys = getAvailableSAMKeys();
  if (keys.length === 0) {
    return NextResponse.json({ success: false, error: 'SAM API key not configured' }, { status: 500 });
  }
  // Start from today's rotated key so load still spreads, then fall through the rest.
  const startKey = getRotatedSAMKey();
  const orderedKeys = [startKey, ...keys.filter((k) => k && k !== startKey)].filter(Boolean);

  const linkOrId = cached && isDescriptionLink(cached) ? cached : noticeId;
  let lastStatus = 0;
  let sawRateLimit = false;

  for (const key of orderedKeys) {
    try {
      const cleaned = (await fetchNoticeDescription(linkOrId, key)).slice(0, MAX_DESCRIPTION_LENGTH);
      // 200 with an empty body = SAM genuinely has no description for this notice.
      // No other key will differ, so stop here.
      if (!cleaned) {
        return NextResponse.json(
          { success: false, error: 'SAM.gov has no description text for this opportunity' },
          { status: 404 },
        );
      }
      void supabase
        .from('sam_opportunities')
        .update({ description: cleaned })
        .eq('notice_id', noticeId)
        .then((res) => {
          if (res.error) console.warn('[sam-description] cache write failed:', res.error.message);
        });
      return NextResponse.json({ success: true, noticeId, description: cleaned, source: 'sam.gov' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/noticedesc (\d+)/);
      if (m) lastStatus = Number(m[1]);
      if (lastStatus === 429) sawRateLimit = true;
      // try the next key
    }
  }

  // Every key failed. Distinguish throttling (transient, the Retry button helps)
  // from a real upstream error so the UI can say something honest.
  if (sawRateLimit) {
    return NextResponse.json(
      { success: false, error: 'SAM.gov is rate-limiting our keys right now — tap Retry in a moment.' },
      { status: 429 },
    );
  }
  console.error(`[sam-description] all ${orderedKeys.length} keys failed for ${noticeId} (last status ${lastStatus})`);
  return NextResponse.json(
    { success: false, error: `SAM.gov did not return a description (status ${lastStatus || 'unknown'})` },
    { status: 502 },
  );
}
