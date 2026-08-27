/**
 * GET /api/forecasts/unplaced — forecasts that have NO location to map.
 *
 * The data behind /opportunity-map/unplaced and the two map entry points.
 *
 * WHY THIS EXISTS: 11,174 current/future forecasts (38% of what matches a
 * default search) carry no coordinate, so `getForecastViewportPins` — which is
 * bbox-bound and filters `map_lat IS NOT NULL` — can never return them. The map
 * is the product now, so without a surface like this they are invisible to
 * anyone who does not already know to ask chat or the MCP tool.
 *
 * THE INVERSE FILTER IS THE POINT: `map_lat IS NULL`. Everything else mirrors
 * the map's own filter helper so a user who came from a search sees the same
 * corpus, minus the pins.
 *
 * PAST FISCAL YEARS ARE EXCLUDED by default, same rule as the map and the MCP
 * tool: a buy planned for FY2024 is history, not pipeline. Rows with NO fiscal
 * year are KEPT — unknown timing is not past timing, and most of this corpus is
 * undated.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { applyForecastFilters } from '@/lib/opportunities/map-data';
import { currentFiscalYear } from '@/lib/forecasts/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Agency-facet walk intent. Independent of `limit`.
 * Default (param absent) keeps the historical first-page tally.
 * Only an explicit `includeFacets=false` opts out — Map total-only probes use that.
 */
export function shouldTallyAgencyFacets(
  includeFacetsParam: string | null | undefined,
  offset: number,
): boolean {
  if (includeFacetsParam === 'false') return false;
  return offset === 0;
}

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const COLS = 'external_id, title, source_agency, department, contracting_office, naics_code, '
  + 'naics_description, set_aside_type, fiscal_year, anticipated_quarter, estimated_value_min, '
  + 'estimated_value_max, estimated_value_range, pop_state, pop_city';

/** Future-or-undated only — the same whitelist the MCP query uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function excludePastFy(q: any) {
  const thisFy = currentFiscalYear();
  const future: string[] = [];
  for (let y = thisFy; y <= thisFy + 15; y++) future.push(`fiscal_year.ilike.%${y}%`);
  return q.or(`fiscal_year.is.null,${future.join(',')}`);
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, parseInt(p.get('limit') || '50', 10) || 50));
  const offset = Math.max(0, parseInt(p.get('offset') || '0', 10) || 0);
  // Facet intent is independent of page size. Absent → historical default (tally on
  // first page). Only the literal string "false" opts out.
  const includeFacetsParam = p.get('includeFacets');
  const filters = {
    q: p.get('q'), naics: p.get('naics'), agency: p.get('agency'), state: null,
  };

  const db = sb();
  try {
    // Rows — the inverse of the map's coordinate filter.
    let q = db.from('agency_forecasts')
      .select(COLS, { count: 'exact' })
      .is('map_lat', null);
    q = applyForecastFilters(q, filters);
    q = excludePastFy(q);
    const { data, count, error } = await q
      .order('estimated_value_max', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    // Bind AND check {error} — a failed read must not render as "none exist".
    if (error) {
      console.error('[forecasts/unplaced] query failed:', error.message);
      return NextResponse.json({ success: false, error: 'query failed' }, { status: 500 });
    }

    // Agency facet counts. First page by default; Map total-only probes pass
    // includeFacets=false so they skip the ~11k-row PostgREST walk (measured 3.3s).
    let byAgency: Array<{ agency: string; n: number }> = [];
    if (shouldTallyAgencyFacets(includeFacetsParam, offset)) {
      let fq = db.from('agency_forecasts').select('source_agency').is('map_lat', null);
      fq = applyForecastFilters(fq, { ...filters, agency: null });
      fq = excludePastFy(fq);
      // PostgREST caps a select at 1,000 rows — page it, or the facet counts
      // silently describe only the first 1,000 of ~11k.
      const tally = new Map<string, number>();
      for (let from = 0; ; from += 1000) {
        const { data: rows, error: fErr } = await fq.range(from, from + 999);
        if (fErr) { console.error('[forecasts/unplaced] facet count failed:', fErr.message); break; }
        if (!rows?.length) break;
        for (const r of rows) {
          const a = String((r as { source_agency?: string }).source_agency || '—');
          tally.set(a, (tally.get(a) || 0) + 1);
        }
        if (rows.length < 1000) break;
      }
      byAgency = [...tally.entries()]
        .map(([agency, n]) => ({ agency, n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 12);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forecasts = (data || []).map((r: any) => ({
      id: r.external_id,
      title: r.title,
      agency: r.source_agency ?? null,
      office: r.contracting_office ?? null,
      naics_code: r.naics_code ?? null,
      set_aside: r.set_aside_type ?? null,
      fiscal_year: r.fiscal_year ?? null,
      quarter: r.anticipated_quarter ?? null,
      value_max: r.estimated_value_max ?? null,
      value_range: r.estimated_value_range ?? null,
      // Carried so the page can say WHY there is no pin, from what the agency
      // published — "Cannot be disclosed" and "Nationwide" are different facts.
      pop_state: r.pop_state ?? null,
      pop_city: r.pop_city ?? null,
    }));

    return NextResponse.json({ success: true, total: count ?? forecasts.length, forecasts, byAgency });
  } catch (e) {
    console.error('[forecasts/unplaced]', (e as Error).message);
    return NextResponse.json({ success: false, error: 'unavailable' }, { status: 500 });
  }
}
