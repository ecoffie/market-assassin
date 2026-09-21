/**
 * GET /api/app/company-detail?uei=<UEI>&email=<email>
 *
 * The ONE-CALL feed for the Opportunity Map company drawer (Companies dataset).
 * Mirrors /api/app/opportunity-detail for opps: the drawer JS fetches this once
 * and renders every section (award history, top agencies, NAICS, set-asides,
 * location, similar companies) from the response.
 *
 * MI-token authed — the same gate as /api/app/contacts-map (the Companies map is
 * a signed-in feature). Returns { success, company } or an honest 404 / 503.
 *
 * `city`/`state` may be passed through from the map pin (already geocoded) as a
 * fallback for the rare firm whose BQ profile row lacks a clean HQ location.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolveCompanyDetail } from '@/lib/bigquery/company-detail';
import { getCachedCerts, certBucketsWithSource, certSourceLabel } from '@/lib/sam/recipient-certs';

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
    const outcome = await resolveCompanyDetail(uei);
    if (outcome.status === 'malformed') {
      return NextResponse.json({ success: false, error: outcome.detail || 'Invalid UEI' }, { status: 400 });
    }
    if (outcome.status === 'unavailable') {
      return NextResponse.json(
        { success: false, error: outcome.detail || 'Warehouse history temporarily unavailable', degraded: true },
        { status: 503 },
      );
    }
    if (outcome.status !== 'ok') {
      return NextResponse.json({ success: false, error: 'Company not found' }, { status: 404 });
    }
    const company = outcome.company;
    // Pin-passed location fallback: the map already geocoded city/state, so use it
    // when the BQ profile row didn't carry a clean HQ location (never overrides a
    // real profile value — profile wins, this only fills a blank).
    if (!company.location) {
      const city = (p.get('city') || '').trim();
      const state = (p.get('state') || '').trim().toUpperCase();
      if (city && /^[A-Z]{2}$/.test(state)) { company.city = city; company.state = state; company.location = `${city}, ${state}`; company.locApprox = false; }
      else if (/^[A-Z]{2}$/.test(state)) { company.state = state; company.location = state; company.locApprox = true; }
    }
    // Cert PROVENANCE for the drawer (Eric #3 on the map, 2026-07-28) — so the company drawer can show
    // "SBA-certified" vs "SAM self-identified" per set-aside, never presenting a self-cert (SDVOSB/WOSB)
    // as the authoritative SBA determination. Chip stays clean; the honest detail lives in the drawer.
    // Cache-only read (getCachedCerts never calls SAM) — absent/unresolved UEI → no block, no harm.
    let cert_provenance: Array<{ cert: string; source: string; source_label: string; authoritative: boolean }> | undefined;
    try {
      const cert = (await getCachedCerts([uei])).get(uei);
      if (cert && cert.found) {
        const bs = certBucketsWithSource(cert);
        if (bs.length) cert_provenance = bs.map((b) => ({
          cert: b.bucket, source: b.source ?? 'sba',
          source_label: certSourceLabel(b.source), authoritative: b.authoritative,
        }));
      }
    } catch { /* provenance is a courtesy — never fail the drawer on it */ }

    return NextResponse.json({ success: true, company, ...(cert_provenance ? { cert_provenance } : {}) });
  } catch (e) {
    console.error('[company-detail] error:', (e as Error).message);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
