import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/forecasts-preview  — PUBLIC, no auth, NO BigQuery.
 *
 * A safe teaser of the forecast database for the public SEO pages
 * (govcongiants.com/data/forecasts). Reads ONLY Supabase `agency_forecasts`
 * (Eric's constraint: keep BigQuery to a minimum — this touches zero BQ).
 *
 * Returns the REAL total count + a small sample of real forecasts (agency,
 * title, value range, fiscal year, NAICS). It deliberately does NOT return
 * descriptions, contracting-office contacts, or the full set — that stays the
 * paid Mindy Pro asset. The public page shows these rows as proof, then gates
 * the rest.
 *
 * Query params:
 *   - limit: sample size (default 6, max 12)
 *   - naics: optional NAICS prefix filter (for /data/forecasts/[naics] later)
 *
 * Cache: CDN-cacheable (s-maxage) so the funnels ISR fetch + any direct hits
 * don't repeatedly scan the table.
 */
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface PreviewRow {
  agency: string;
  title: string;
  value: string;
  fiscalYear: string;
  naics: string;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(params.get('limit') || '6', 10) || 6, 12);
  const naics = params.get('naics')?.trim();

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Total count (head-only — no rows pulled, cheap).
    let countQuery = supabase
      .from('agency_forecasts')
      .select('id', { count: 'exact', head: true });
    if (naics) countQuery = countQuery.ilike('naics_code', `${naics}%`);
    const { count: totalCount } = await countQuery;

    // Distinct source-agency count, for the "X agencies" stat. Pull a slim
    // column set and dedupe in-process (table is ~7.7k rows, trivial).
    const { data: agencyRows } = await supabase
      .from('agency_forecasts')
      .select('source_agency')
      .limit(10000);
    const agencyCount = new Set((agencyRows || []).map((r) => r.source_agency).filter(Boolean)).size;

    // Sample teaser rows — prefer ones with a real title + value so the preview
    // looks substantive. Order by estimated value desc when present.
    let sampleQuery = supabase
      .from('agency_forecasts')
      .select('source_agency, title, estimated_value_range, estimated_value_max, fiscal_year, naics_code')
      .not('title', 'is', null)
      .order('estimated_value_max', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (naics) sampleQuery = sampleQuery.ilike('naics_code', `${naics}%`);
    const { data: sampleRows } = await sampleQuery;

    const sample: PreviewRow[] = (sampleRows || []).map((r) => ({
      agency: r.source_agency || '—',
      title: r.title || 'Upcoming procurement',
      value: r.estimated_value_range
        || (r.estimated_value_max ? fmt$(r.estimated_value_max) : 'TBD'),
      fiscalYear: r.fiscal_year || '',
      naics: r.naics_code || '',
    }));

    return NextResponse.json(
      {
        success: true,
        totalCount: totalCount || 0,
        agencyCount,
        sample,
      },
      {
        headers: {
          // Cache at the edge for 6h, serve-stale for a day. Keeps repeated
          // hits off Supabase.
          'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400',
        },
      },
    );
  } catch (err) {
    console.error('[forecasts-preview] error', err);
    return NextResponse.json(
      { success: false, totalCount: 0, agencyCount: 0, sample: [] },
      { status: 200 }, // soft-fail so the public page can fall back gracefully
    );
  }
}

function fmt$(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}
