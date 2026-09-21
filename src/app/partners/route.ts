/**
 * GET /partners → 308 /gov/apex
 *
 * The APEX page moved to /gov/apex (2026-08-16) so the NAPEX conference QR prints
 * one clean URL under the /gov namespace. Permanent redirect: printed collateral,
 * the gov nav, and any existing inbound link must keep working — and 308 preserves
 * the ?source=napex2026 attribution query.
 *
 * MUST stay dynamic. A previous version was `force-static`, which made Next
 * evaluate the route at BUILD time and bake the build machine's origin into the
 * Location header — production served `308 -> http://localhost:3000/gov/apex`,
 * sending every scanned QR code to a dead URL. The origin has to resolve per
 * request, so this route is never prerendered.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  // Resolve against the incoming request URL, not a build-time constant.
  const url = new URL('/gov/apex', req.url);
  url.search = req.nextUrl.search; // keep conference attribution
  return NextResponse.redirect(url, 308);
}
