/**
 * GET /api/app/company-detail?uei=<UEI>&email=<email>
 *
 * The ONE-CALL feed for the Opportunity Map company drawer (Companies dataset).
 * Mirrors /api/app/opportunity-detail for opps: the drawer JS fetches this once
 * and renders every section (award history, top agencies, NAICS, set-asides,
 * location, similar companies) from the response.
 *
 * MI-token authed — the same gate as /api/app/contacts-map (the Companies map is
 * a signed-in feature). Returns { success, company } or an honest 404.
 *
 * `city`/`state` may be passed through from the map pin (already geocoded) as a
 * fallback for the rare firm whose BQ profile row lacks a clean HQ location.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getCompanyDetail } from '@/lib/bigquery/company-detail';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const email = (p.get('email') || '').trim().toLowerCase();

  const auth = requireMIAuthSession(request, email || null);
  if (!auth.ok) return auth.response;

  const uei = (p.get('uei') || '').trim();
  if (!uei) {
    return NextResponse.json({ success: false, error: 'uei required' }, { status: 400 });
  }

  try {
    const company = await getCompanyDetail(uei);
    if (!company) {
      return NextResponse.json({ success: false, error: 'Company not found' }, { status: 404 });
    }
    // Pin-passed location fallback: the map already geocoded city/state, so use it
    // when the BQ profile row didn't carry a clean HQ location (never overrides a
    // real profile value — profile wins, this only fills a blank).
    if (!company.location) {
      const city = (p.get('city') || '').trim();
      const state = (p.get('state') || '').trim().toUpperCase();
      if (city && /^[A-Z]{2}$/.test(state)) { company.city = city; company.state = state; company.location = `${city}, ${state}`; company.locApprox = false; }
      else if (/^[A-Z]{2}$/.test(state)) { company.state = state; company.location = state; company.locApprox = true; }
    }
    return NextResponse.json({ success: true, company });
  } catch (e) {
    console.error('[company-detail] error:', (e as Error).message);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
