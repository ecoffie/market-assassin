/**
 * GET /api/app/market-reports?email= — the signed-in owner's hosted market reports, newest first, each with
 * its link status (live / expired / revoked), expiry and URL. Never the payload.
 * Strong auth; only the caller's own rows (src/lib/market/report-owner-api.ts).
 */
import { NextResponse } from 'next/server';
import { listOwnedMarketReports } from '@/lib/market/report-store';
import { NO_STORE, linkView, requireOwner, siteOrigin } from '@/lib/market/report-owner-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = await requireOwner(request);
  if ('response' in who) return who.response;
  const rows = await listOwnedMarketReports(who.email);
  // Unknown is never zero: a storage failure is a 503, not an empty list.
  if (rows === null) return NextResponse.json({ success: false, error: 'unavailable' }, { status: 503, headers: NO_STORE });
  const origin = siteOrigin();
  return NextResponse.json({ success: true, reports: rows.map((r) => linkView(r, origin)) }, { status: 200, headers: NO_STORE });
}
