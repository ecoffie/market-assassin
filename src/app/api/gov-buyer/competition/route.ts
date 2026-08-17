/**
 * GET /api/gov-buyer/competition
 *
 * Step 3 of the Market Research Workspace — competition for THIS requirement's
 * market, not the whole agency.
 *
 * THE SCOPE PROBLEM THIS SOLVES: `computeCompetitionDepth` was agency-keyed,
 * and the workspace is NAICS-keyed. Reporting a department-wide bidder average
 * next to a NAICS-specific supplier pool invites the reader to treat it as this
 * market's competition, which it is not. USASpending accepts `naics_codes` and
 * a place-of-performance filter alongside the agency filter, so the sample is
 * now drawn from the actual requirement scope — verified 2026-08-17, where a
 * DoD + 236220 sample returned offers on 40 of 40 awards.
 *
 * MATURITY: this surfaces OBS-009, which is **Beta**. The response carries that
 * label so the UI can show it. A contracting officer testing a competition
 * number deserves to know its maturity before it lands in an acquisition file.
 *
 * Query: email, naics (required) · agency (required for a grounded result) ·
 *        state · sampleSize
 * Auth: gov_buyer only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireGovBuyer } from '@/lib/gov-buyer/auth';
import { computeCompetitionDepth } from '@/lib/analytics/competition-depth';
import { METHODOLOGY } from '@/lib/analytics/observatory-methodology';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email');
  const naics = sp.get('naics');

  const auth = await requireGovBuyer(request, email);
  if (!auth.ok) return auth.response;
  if (!naics) {
    return NextResponse.json({ success: false, error: 'naics is required' }, { status: 400 });
  }

  const agency = sp.get('agency') || '';
  const state = sp.get('state') || undefined;
  const sampleSize = Math.min(Math.max(Number(sp.get('sampleSize')) || 100, 20), 100);

  // Competition is measured from a buyer's awards. Without an agency there is
  // nothing to sample, and inventing a nationwide "market competition" figure
  // would be exactly the overclaim this surface avoids elsewhere.
  if (!agency) {
    return NextResponse.json({
      success: true,
      measured: false,
      reason: 'Competition is measured from a buying agency’s award record. Add an agency to the requirement to measure competition for this market.',
      depth: null,
      methodology: null,
    });
  }

  try {
    const depth = await computeCompetitionDepth(agency, sampleSize, { naics, state });

    // OBS-009's registry entry is the source of truth for maturity + limitations.
    // Read from METHODOLOGY directly; the field is `lifecycle`, not `maturity`.
    const obs = METHODOLOGY['OBS-009'];

    return NextResponse.json({
      success: true,
      measured: depth.grounded,
      depth,
      methodology: obs
        ? {
            id: obs.id,
            name: obs.name,
            maturity: obs.lifecycle,   // 'beta' — surfaced so the UI can label it
            version: obs.version,
            dataSources: obs.dataSources,
            limitations: obs.limitations,
            lastMeasured: new Date().toISOString(),
          }
        : null,
    });
  } catch (err) {
    console.error('[gov-buyer/competition]', err);
    return NextResponse.json(
      { success: false, error: 'Competition query failed' },
      { status: 500 },
    );
  }
}
