/**
 * Cron: submit the most-recent opportunity URLs to IndexNow (Phase 5) so new
 * pages get indexed fast instead of waiting for a crawl. Steady-state — runs
 * after new opps sync. Schedule via cron_jobs row (rule #5).
 *   GET /api/cron/indexnow-submit?limit=500
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { opportunitySlug, isIndexableOpp } from '@/lib/seo/opportunities';
import { submitToIndexNow } from '@/lib/seo/indexnow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '500', 10), 10000);
  try {
    // Most-recently-posted active, indexable opps → their public URLs.
    const { data } = await supabase
      .from('sam_opportunities')
      .select('notice_id, title, description, sow_text')
      .eq('active', true)
      .not('description', 'is', null)
      .order('posted_date', { ascending: false })
      .limit(limit);
    const urls = (data || [])
      .filter(isIndexableOpp)
      .map((r) => `${SITE_URL}/opportunity/${opportunitySlug(r.title, r.notice_id)}`);
    const result = await submitToIndexNow(urls);
    return NextResponse.json({ success: result.ok, ...result, message: `submitted ${result.submitted} URLs (status ${result.status})` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'indexnow submit failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
