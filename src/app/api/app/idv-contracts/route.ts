/**
 * /api/app/idv-contracts — IDV/IDIQ vehicles + task orders for the Expiring
 * Contracts panel (Eric: IDV is the same USASpending data as recompetes, just a
 * different award-type slice — so it's a FILTER here, not a separate section).
 *
 * mode=idv   → IDV/IDIQ vehicles (the parent contracts primes hold)
 * mode=task  → task/delivery orders under those vehicles
 * Both are real USASpending spending_by_award (idv-search.ts), grounded.
 */
import { NextRequest, NextResponse } from 'next/server';
import { searchIDVContracts } from '@/lib/idv-search';
import { fiscalYearTimePeriod } from '@/lib/utils/fiscal-year';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const mode = sp.get('mode') === 'task' ? 'task' : 'idv';
  const naicsCode = (sp.get('naics') || '').split(/[, ]+/)[0] || undefined;
  const pscCode = sp.get('psc') || undefined;
  const agency = sp.get('agency') || undefined;
  const state = sp.get('state') || undefined;
  const minValue = sp.get('minValue') ? Number(sp.get('minValue')) : 0;
  const limit = sp.get('limit') ? Math.min(Number(sp.get('limit')), 100) : 50;
  const page = sp.get('page') ? Number(sp.get('page')) : 1;

  // Default to active vehicles — those with an end date in the future. We pull a
  // wide award window (IDVs are long-lived) and the panel surfaces expiry.
  const fy = fiscalYearTimePeriod();

  try {
    const result = await searchIDVContracts({
      naicsCode, pscCode, agency, state, minValue, limit, page,
      searchType: mode,
      dateFrom: `${Number(fy.end_date.slice(0, 4)) - 4}-10-01`, // last ~5 FY of awards
    });
    return NextResponse.json({ success: true, mode, ...result });
  } catch (err) {
    console.error('[idv-contracts]', err);
    return NextResponse.json({ success: false, error: 'IDV search failed', contracts: [] }, { status: 500 });
  }
}
