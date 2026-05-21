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
import { getRotatedSAMKey } from '@/lib/sam/utils';
import { samHtmlToText, looksLikeHtml } from '@/lib/sam/description-text';

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

  // Need to resolve the URL.
  if (!cached || !isHttpUrl(cached)) {
    return NextResponse.json({
      success: false,
      error: 'no description URL on file for this opportunity',
    }, { status: 404 });
  }

  const apiKey = getRotatedSAMKey();
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'SAM API key not configured' },
      { status: 500 }
    );
  }

  // Append the api_key (or include it as query param) — SAM.gov noticedesc
  // accepts the key as a query param like every other v2 endpoint.
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(cached);
    if (!upstreamUrl.searchParams.has('api_key')) {
      upstreamUrl.searchParams.set('api_key', apiKey);
    }
  } catch {
    return NextResponse.json(
      { success: false, error: 'stored description URL is not parseable' },
      { status: 500 }
    );
  }

  let fetched: Response;
  try {
    fetched = await fetch(upstreamUrl.toString(), {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    console.error('[sam-description] fetch failed:', err);
    return NextResponse.json(
      { success: false, error: 'could not reach SAM.gov' },
      { status: 502 }
    );
  }

  if (!fetched.ok) {
    return NextResponse.json(
      { success: false, error: `SAM.gov returned ${fetched.status}` },
      { status: 502 }
    );
  }

  // SAM's noticedesc endpoint returns JSON like { description: "..." }
  // or sometimes returns the text body directly. Handle both.
  let descriptionText: string | null = null;
  const contentType = fetched.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await fetched.json().catch(() => null);
    if (payload && typeof payload === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = payload as any;
      descriptionText = typeof p.description === 'string'
        ? p.description
        : typeof p.body === 'string'
        ? p.body
        : typeof p.text === 'string'
        ? p.text
        : null;
    }
  }
  if (!descriptionText) {
    const text = await fetched.text().catch(() => '');
    descriptionText = text || null;
  }

  if (!descriptionText) {
    return NextResponse.json(
      { success: false, error: 'SAM.gov returned no description text' },
      { status: 502 }
    );
  }

  // SAM's noticedesc endpoint returns HTML markup (<p>, <ul>, <li>,
  // <strong>, &nbsp;, etc.). Convert to readable plain text before
  // storing so the UI doesn't render raw tags.
  const cleaned = samHtmlToText(descriptionText).slice(0, MAX_DESCRIPTION_LENGTH);

  // Cache the resolved text back into the row so future requests hit
  // the cache path. Fire-and-forget — if the update fails (RLS, etc.)
  // we still return the text to the caller.
  void supabase
    .from('sam_opportunities')
    .update({ description: cleaned })
    .eq('notice_id', noticeId)
    .then((res) => {
      if (res.error) {
        console.warn('[sam-description] cache write failed:', res.error.message);
      }
    });

  return NextResponse.json({
    success: true,
    noticeId,
    description: cleaned,
    source: 'sam.gov',
  });
}
