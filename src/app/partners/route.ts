/**
 * GET /partners → 308 /gov/apex
 *
 * The APEX page moved to /gov/apex (2026-08-16) so the NAPEX conference QR prints
 * one clean URL under the /gov namespace. Permanent redirect: printed collateral,
 * the gov nav, and any existing inbound link must keep working — and 308 preserves
 * the ?source=napex2026 attribution query.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-static';

export function GET(req: NextRequest) {
  const url = new URL('/gov/apex', req.nextUrl.origin);
  url.search = req.nextUrl.search; // keep conference attribution
  return NextResponse.redirect(url, 308);
}
