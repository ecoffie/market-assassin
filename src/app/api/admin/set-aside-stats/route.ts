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

  // Socioeconomic categories → their SAM set_aside_code values, with the statutory
  // dollar goal and FY2024 SBA-scorecard achievement (so the page can show the gap
  // between "solicited as a set-aside" (live, ours) and "credited by dollars").
  const CATEGORIES = [
    { key: 'sb', label: 'Total Small Business', codes: ['SBA', 'SBP', 'SB'], goalPct: 23, achievedPct: 28.8 },
    { key: 'sdb', label: '8(a) / SDB', codes: ['8A', '8AN'], goalPct: 13, achievedPct: 12.27 },
    { key: 'wosb', label: 'WOSB / EDWOSB', codes: ['WOSB', 'WOSBSS', 'EDWOSB', 'EDWOSBSS'], goalPct: 5, achievedPct: 4.97 },
    { key: 'hubzone', label: 'HUBZone', codes: ['HZC', 'HZS'], goalPct: 3, achievedPct: 2.75 },
    { key: 'sdvosb', label: 'SDVOSB', codes: ['SDVOSBC', 'SDVOSBS'], goalPct: 5, achievedPct: 5.14 },
  ];

  const [activeTotal, biddableTotal, biddableSetAside, ...categoryCounts] = await Promise.all([
    headCount((q) => q.eq('active', true)),
    headCount((q) => q.eq('active', true).in('notice_type', BIDDABLE)),
    // "Set aside" = a real set-aside code (not null / '' / NONE).
    headCount((q) => q.eq('active', true).in('notice_type', BIDDABLE)
      .not('set_aside_code', 'is', null).neq('set_aside_code', '').neq('set_aside_code', 'NONE')),
    ...CATEGORIES.map((c) => headCount((q) => q.eq('active', true).in('notice_type', BIDDABLE).in('set_aside_code', c.codes))),
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
  const pct2 = (n: number) => (biddable > 0 ? Math.round((n / biddable) * 10000) / 100 : 0);

  const categories = CATEGORIES.map((c, i) => {
    const solicited = categoryCounts[i] ?? 0;
    return {
      key: c.key,
      label: c.label,
      goalPct: c.goalPct,
      achievedPct: c.achievedPct,           // by DOLLARS (SBA FY2024 scorecard)
      solicitedCount: solicited,
      solicitedPct: pct2(solicited),         // share of biddable solicitations that are THIS set-aside (live, ours)
    };
  });

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
      // Per-category: GOAL & DOLLAR achievement vs how often it's actually SOLICITED
      // as that set-aside (live). HUBZone/8(a)/WOSB "meet" the $ goal largely by
      // crediting firms that win full-and-open — they're barely solicited as set-asides.
      categories,
    },
    { headers: { 'Cache-Control': 'private, max-age=600' } },
  );
}
