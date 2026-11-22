/**
 * POST /api/app/market-reports/<id>/extend?email=  body { days: 30 | 90 | 365 } — push the link's expiry
 * out from the later of now and the current expiry. There is no "never" option (Eric, 2026-11-22).
 * - A revoked link cannot be extended (409 link_revoked).
 * - A link with no expiry (created before link controls) has nothing to extend (409 link_has_no_expiry).
 * Strong auth; not-yours and missing get the identical 404.
 */
import { NextResponse } from 'next/server';
import { extendedExpiry, getOwnedMarketReport, REPORT_EXTEND_DAYS, setOwnedReportExpiry } from '@/lib/market/report-store';
import { NO_STORE, REPORT_ID_RE, linkView, ownerNotFound, requireOwner, siteOrigin } from '@/lib/market/report-owner-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const who = await requireOwner(request);
  if ('response' in who) return who.response;
  const { id } = await ctx.params;
  if (!REPORT_ID_RE.test(id || '')) return ownerNotFound();
  const body = (await request.json().catch(() => null)) as { days?: unknown } | null;
  const days = Number(body?.days);
  if (!(REPORT_EXTEND_DAYS as readonly number[]).includes(days)) {
    return NextResponse.json({ success: false, error: 'invalid_days', allowed: REPORT_EXTEND_DAYS }, { status: 400, headers: NO_STORE });
  }
  const report = await getOwnedMarketReport(id, who.email);
  if (!report) return ownerNotFound();
  if (report.revoked_at) return NextResponse.json({ success: false, error: 'link_revoked' }, { status: 409, headers: NO_STORE });
  if (!report.expires_at) return NextResponse.json({ success: false, error: 'link_has_no_expiry' }, { status: 409, headers: NO_STORE });
  const now = Date.now();
  const expires_at = extendedExpiry(report.expires_at, days, now);
  if (!(await setOwnedReportExpiry(id, who.email, expires_at))) {
    return NextResponse.json({ success: false, error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ success: true, report: linkView({ ...report, expires_at }, siteOrigin(), now) }, { status: 200, headers: NO_STORE });
}
