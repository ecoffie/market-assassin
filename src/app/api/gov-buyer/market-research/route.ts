/**
 * GET /api/gov-buyer/market-research
 *
 * Reverse search for federal buyers: "find businesses for this requirement."
 * Returns a performance-weighted market-depth count + ranked firms.
 *
 * Query:
 *   email          required — the gov_buyer's email (session-verified)
 *   naics          required — target NAICS (e.g. 541512)
 *   state          optional — 2-letter (e.g. DC)
 *   setAside       optional — normalized label: 8(a)|HUBZone|SDVOSB|WOSB|EDWOSB|Small Business
 *   includeEmerging optional — 'false' to exclude new entrants from the count (default include)
 *   limit          optional — max firms returned (default 200)
 *
 * Auth: gov_buyer only (requireGovBuyer). Sellers get 403 + redirect hint.
 * PRD: docs/PRD-gov-buyer-market-research.md §4, §8
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireGovBuyer } from '@/lib/gov-buyer/auth';
import { runMarketResearch } from '@/lib/gov-buyer/market-research';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email');
  const naics = sp.get('naics');
  const state = sp.get('state') || undefined;
  const setAside = sp.get('setAside') || undefined;
  const includeEmerging = sp.get('includeEmerging') !== 'false';
  const limit = Math.min(Number(sp.get('limit')) || 200, 500);

  const auth = await requireGovBuyer(request, email);
  if (!auth.ok) return auth.response;

  if (!naics) {
    return NextResponse.json(
      { success: false, error: 'naics is required' },
      { status: 400 },
    );
  }

  try {
    const result = await runMarketResearch({ naics, state, setAside, includeEmerging, limit });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[gov-buyer/market-research]', err);
    return NextResponse.json(
      { success: false, error: 'Market research query failed' },
      { status: 500 },
    );
  }
}
