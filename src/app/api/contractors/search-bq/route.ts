/**
 * GET /api/contractors/search-bq
 *
 * BigQuery-backed contractor search over the recipients table (~317K
 * award-winning federal contractors) — replaces the static 2,768-row JSON
 * for the in-app Contractors panel. Returns real award totals + counts.
 *
 * Params: search, naics, state, sortBy (contract_value|company|contract_count),
 *         limit, offset. Shaped to the panel's existing contractor model.
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchRecipients, recipientSlug } from '@/lib/bigquery/recipients';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Map the panel's sort keys to the BQ search sort keys.
const SORT_MAP: Record<string, 'total_obligated' | 'award_count' | 'recipient_name'> = {
  contract_value: 'total_obligated',
  contract_count: 'award_count',
  company: 'recipient_name',
};

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const search = sp.get('search') || '';
  const naics = sp.get('naics') || '';
  const state = sp.get('state') || '';
  const sortBy = SORT_MAP[sp.get('sortBy') || 'contract_value'] || 'total_obligated';
  const limit = Math.min(Number(sp.get('limit')) || 25, 100);
  const offset = Math.max(Number(sp.get('offset')) || 0, 0);

  try {
    // liveBq: this is the in-app contractor search — hit live BigQuery, don't
    // return [] on a cold cache (the bug that made the panel + lookup show nothing).
    const { rows, total } = await searchRecipients({ search, naics, state, sortBy, limit, offset, liveBq: true });

    // Shape to the panel's contractor model (recipient_name → company, etc.).
    const contractors = rows.map((r) => ({
      uei: r.recipient_uei,
      company: r.recipient_name,
      city: r.city || '',
      state: r.state || '',
      total_contract_value: r.total_obligated,
      contract_value_num: r.total_obligated,
      contract_count: r.award_count,
      agencies_count: r.distinct_agency_count,
      naics_count: r.distinct_naics_count,
      // slug for the public /contractors/[slug] page — use the SAME canonical
      // recipientSlug() the page resolves with, so the link never 404s.
      slug: recipientSlug(r.recipient_name),
      source: 'usaspending',
    }));

    return NextResponse.json({
      success: true,
      source: 'bigquery_recipients',
      totalCount: total,     // full DB size (317K) — for the headline stat
      filteredCount: total,  // matches after filters
      count: contractors.length,
      // The NAICS path uses a pre-aggregated rollup with NO location data, so
      // city/state + the state filter only apply to NAME search. The UI uses
      // this to explain why location/state-filter aren't shown for NAICS.
      locationAvailable: !naics,
      contractors,
    });
  } catch (err) {
    console.error('[contractors/search-bq]', err);
    return NextResponse.json({ success: false, error: 'Contractor search failed' }, { status: 500 });
  }
}
