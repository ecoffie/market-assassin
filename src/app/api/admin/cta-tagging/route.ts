/**
 * GET /api/admin/cta-tagging?password=...
 * Internal QA — CTA tag counts by area + confidence.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Pure read-only analytics (GET, head-count queries, no writes) → read replica.
  const supabase = getReadClient();

  const [
    { data: ctas },
    { count: taggedOpps },
    { count: untaggedActive },
    { data: tagRows, error: tagErr },
  ] = await Promise.all([
    supabase.from('cta_codes').select('cta_id, name, short_name, priority_order').order('priority_order'),
    supabase.from('opportunity_cta_tags').select('notice_id', { count: 'exact', head: true }),
    supabase
      .from('sam_opportunities')
      .select('*', { count: 'exact', head: true })
      .eq('active', true)
      .is('cta_tagged_at', null),
    supabase.from('opportunity_cta_tags').select('cta_id, confidence'),
  ]);

  if (tagErr) {
    return NextResponse.json({
      error: tagErr.message,
      hint: 'Run supabase/migrations/20260613_cta_filters.sql then scripts/backfill-cta-tags.ts',
    }, { status: 500 });
  }

  const byCta = new Map<string, { total: number; high: number; medium: number; low: number }>();
  for (const row of tagRows || []) {
    const cur = byCta.get(row.cta_id) || { total: 0, high: 0, medium: 0, low: 0 };
    cur.total += 1;
    if (row.confidence === 'high') cur.high += 1;
    else if (row.confidence === 'medium') cur.medium += 1;
    else cur.low += 1;
    byCta.set(row.cta_id, cur);
  }

  return NextResponse.json({
    success: true,
    summary: {
      totalTagRows: taggedOpps ?? 0,
      activeOppsAwaitingTag: untaggedActive ?? 0,
    },
    byCta: (ctas || []).map((c) => ({
      ...c,
      counts: byCta.get(c.cta_id) || { total: 0, high: 0, medium: 0, low: 0 },
    })),
  });
}
