/**
 * GET /api/admin/set-aside-stats
 *
 * Live set-aside readout from our SAM opportunity cache — the demo claim that's
 * unarguable because it's our own real-time data (Eric, Jun 26). Measures the
 * RIGHT denominator: true biddable solicitations (Solicitation + Combined
 * Synopsis/Solicitation), excluding Sources Sought / Special Notices and the
 * DLA parts-buy "Award Notice" noise that pollutes a naive set-aside rate.
 *
 * Returns: how many active biddable solicitations are set aside for small business
 * vs full-and-open, plus the data window (freshness).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const BIDDABLE = ['Solicitation', 'Combined Synopsis/Solicitation'];

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ success: false, error: 'Database not configured' }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // head-count helpers (no rows pulled).
  const headCount = async (build: (q: ReturnType<typeof base>) => ReturnType<typeof base>): Promise<number | null> => {
    try {
      const { count, error } = await build(base());
      return error ? null : (count ?? null);
    } catch { return null; }
  };
  const base = () => supabase.from('sam_opportunities').select('id', { count: 'exact', head: true });

  const [activeTotal, biddableTotal, biddableSetAside] = await Promise.all([
    headCount((q) => q.eq('active', true)),
    headCount((q) => q.eq('active', true).in('notice_type', BIDDABLE)),
    // "Set aside" = a real set-aside code (not null / '' / NONE).
    headCount((q) => q.eq('active', true).in('notice_type', BIDDABLE)
      .not('set_aside_code', 'is', null).neq('set_aside_code', '').neq('set_aside_code', 'NONE')),
  ]);

  // Freshness window (newest + oldest posted among active).
  const postedRange = async (asc: boolean): Promise<string | null> => {
    try {
      const { data } = await supabase
        .from('sam_opportunities')
        .select('posted_date')
        .eq('active', true)
        .not('posted_date', 'is', null)
        .order('posted_date', { ascending: asc })
        .limit(1)
        .maybeSingle();
      return (data?.posted_date as string) || null;
    } catch { return null; }
  };
  const [newest, oldest] = await Promise.all([postedRange(false), postedRange(true)]);

  const biddable = biddableTotal ?? 0;
  const setAside = biddableSetAside ?? 0;
  const open = Math.max(0, biddable - setAside);
  const pct = (n: number) => (biddable > 0 ? Math.round((n / biddable) * 1000) / 10 : 0);

  return NextResponse.json(
    {
      success: true,
      generatedAt: new Date().toISOString(),
      window: { newestPosted: newest, oldestPosted: oldest },
      activeTotal,
      biddable: {
        total: biddable,
        setAside,
        setAsidePct: pct(setAside),
        fullAndOpen: open,
        fullAndOpenPct: pct(open),
      },
      // The honest framing: ~half of biddable solicitations are set aside, yet small
      // business wins only ~28% of DOLLARS (SBA FY2024) — the set-asides skew small;
      // big contracts stay full-and-open. The DLA parts-buy 'Award Notice' bucket is
      // excluded (it's not set-aside-eligible competed work).
      dollarShareSmallBusinessPct: 28.8,
    },
    { headers: { 'Cache-Control': 'private, max-age=600' } },
  );
}
