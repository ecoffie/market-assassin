/**
 * Cron: submit public page URLs to IndexNow (Bing, Yandex, Seznam, Naver). Google does NOT use
 * IndexNow — it discovers these pages through the sitemaps and internal links.
 *
 *   GET /api/cron/indexnow-submit?type=opportunities&limit=500   (default — newest open opps)
 *   GET /api/cron/indexnow-submit?type=offices
 *   GET /api/cron/indexnow-submit?type=forecasts
 *   GET /api/cron/indexnow-submit?type=closed
 *   GET /api/cron/indexnow-submit?type=recompetes
 *
 * The non-default types read the SAME gated lists their sitemaps publish (2026-11-17 page types),
 * so IndexNow is never told about a page the sitemap would not advertise. IndexNow takes at most
 * 10,000 URLs per call; larger families advance a KV cursor so repeated runs walk the whole set
 * and then wrap (`?offset=` overrides it for a manual run).
 *
 * Auth: Bearer CRON_SECRET (what Vercel cron and the cron_jobs dispatcher send) or
 * ?password=ADMIN_PASSWORD for a manual run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { opportunitySlug, isIndexableOpp } from '@/lib/seo/opportunities';
import { submitToIndexNow } from '@/lib/seo/indexnow';
import { SITE_URL } from '@/lib/seo/sitemap-sections';
import {
  INDEXNOW_MAX, INDEXNOW_TYPES, familyUrls, nextSlice, type IndexNowType,
} from '@/lib/seo/indexnow-families';
import { hasValidCronSecret } from '@/lib/cron/cron-request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && hasValidCronSecret(request)) return true;
  const pw = request.nextUrl.searchParams.get('password');
  return !!pw && !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

/** Newest active, indexable opportunities (the original behaviour of this cron). */
async function newestOpportunityUrls(limit: number): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('sam_opportunities')
    .select('notice_id, title, description, sow_text')
    .eq('active', true)
    .not('description', 'is', null)
    .order('posted_date', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`sam_opportunities read failed: ${error.message}`);
  return (data || [])
    .filter(isIndexableOpp)
    .map((r) => `${SITE_URL}/opportunity/${opportunitySlug(r.title, r.notice_id)}`);
}

const cursorKey = (type: IndexNowType) => `cron:indexnow-submit:cursor:${type}`;

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const typeParam = request.nextUrl.searchParams.get('type') || 'opportunities';
  if (!(INDEXNOW_TYPES as readonly string[]).includes(typeParam)) {
    return NextResponse.json({ success: false, error: `unknown type "${typeParam}"`, types: INDEXNOW_TYPES }, { status: 400 });
  }
  const type = typeParam as IndexNowType;

  try {
    if (type === 'opportunities') {
      const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '500', 10) || 500, INDEXNOW_MAX);
      const result = await submitToIndexNow(await newestOpportunityUrls(limit));
      return NextResponse.json(
        { success: result.ok, type, ...result, message: `submitted ${result.submitted} URLs (status ${result.status})` },
        { status: result.ok ? 200 : 502 },
      );
    }

    const urls = await familyUrls(type);
    const offsetParam = request.nextUrl.searchParams.get('offset');
    let offset = 0;
    if (offsetParam !== null) {
      offset = parseInt(offsetParam, 10) || 0;
    } else {
      try { offset = Number(await kv.get<number>(cursorKey(type))) || 0; } catch { offset = 0; }
    }
    const { start, end, next } = nextSlice(urls.length, offset);
    const result = await submitToIndexNow(urls.slice(start, end));
    // Advance only when IndexNow accepted the batch, so a rejected batch is retried next run.
    if (result.ok) {
      try { await kv.set(cursorKey(type), next); } catch { /* cursor is best-effort; next run restarts at 0 */ }
    }
    return NextResponse.json(
      {
        success: result.ok,
        type,
        total: urls.length,
        start,
        end,
        nextOffset: result.ok ? next : start,
        ...result,
        message: `submitted ${result.submitted} of ${urls.length} ${type} URLs (status ${result.status})`,
      },
      { status: result.ok ? 200 : 502 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'indexnow submit failed';
    return NextResponse.json({ success: false, type, error: message }, { status: 500 });
  }
}
