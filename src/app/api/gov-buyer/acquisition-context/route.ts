/**
 * GET /api/gov-buyer/acquisition-context
 *
 * Procurement History + Market Signals for the Market Research Workspace —
 * Steps 4 and 5 of tasks/PRD-market-research-workspace.md.
 *
 * Orchestration only: reads the award record (`recompete_opportunities`) and
 * the grounded SAM events read. No new metric, no new table.
 *
 * Query:
 *   email          required — the gov_buyer's email (session-verified)
 *   naics          required — target NAICS (e.g. 541512)
 *   agency         optional — narrows history AND unlocks engagement events
 *   state          optional — 2-letter place of performance
 *   keyword        optional — matches PSC / NAICS description
 *   horizonMonths  optional — look-ahead for events + recompetes (1-12, default 6)
 *   limit          optional — history rows returned (default 25, max 100)
 *
 * Auth: gov_buyer only (requireGovBuyer), same gate as the sibling
 * market-research route. Sellers get 403 + redirect hint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireGovBuyer } from '@/lib/gov-buyer/auth';
import { getAcquisitionContext } from '@/lib/gov-buyer/acquisition-context';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email');
  const naics = sp.get('naics');

  const auth = await requireGovBuyer(request, email);
  if (!auth.ok) return auth.response;

  if (!naics) {
    return NextResponse.json(
      { success: false, error: 'naics is required' },
      { status: 400 },
    );
  }

  try {
    const result = await getAcquisitionContext({
      naics,
      agency: sp.get('agency') || undefined,
      state: sp.get('state') || undefined,
      keyword: sp.get('keyword') || undefined,
      horizonMonths: Number(sp.get('horizonMonths')) || undefined,
      limit: Number(sp.get('limit')) || undefined,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[gov-buyer/acquisition-context]', err);
    return NextResponse.json(
      { success: false, error: 'Acquisition context query failed' },
      { status: 500 },
    );
  }
}
