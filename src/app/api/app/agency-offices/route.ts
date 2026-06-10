/**
 * /api/app/agency-offices?agency=Department of the Navy&naics=238
 *
 * Office-level drill-down for the Market Research All Agencies table — surfaces
 * the real buying offices (NAVFAC Mid-Atlantic, USACE districts) inside a broad
 * sub-agency for a NAICS. From the BQ awards table (only NAICS-keyed source).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getOfficesForAgencyNaics } from '@/lib/bigquery/agencies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const agency = (request.nextUrl.searchParams.get('agency') || '').trim();
  const naics = (request.nextUrl.searchParams.get('naics') || '').trim();
  if (!agency || !naics) {
    return NextResponse.json({ success: false, error: 'agency and naics required' }, { status: 400 });
  }

  try {
    const offices = await getOfficesForAgencyNaics(agency, naics, 12, true); // liveBq: authed Mindy
    return NextResponse.json({
      success: true,
      offices: offices.map(o => ({
        name: o.awarding_office,
        code: o.awarding_office_code,
        total: o.total_amount,
        awards: o.award_count,
      })),
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message, offices: [] }, { status: 500 });
  }
}
