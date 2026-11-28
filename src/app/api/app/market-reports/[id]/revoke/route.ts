/**
 * POST /api/app/market-reports/<id>/revoke?email= — the owner withdraws the public link now: /reports/<id>
 * and its PDF answer 410 from then on. The report itself is kept, and the owner can still open it.
 * Strong auth; not-yours and missing get the identical 404.
 */
import { NextResponse } from 'next/server';
import { getOwnedMarketReport, revokeOwnedReportLink } from '@/lib/market/report-store';
import { NO_STORE, REPORT_ID_RE, linkView, ownerNotFound, requireOwner, siteOrigin } from '@/lib/market/report-owner-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const who = await requireOwner(request);
  if ('response' in who) return who.response;
  const { id } = await ctx.params;
  if (!REPORT_ID_RE.test(id || '')) return ownerNotFound();
  const report = await getOwnedMarketReport(id, who.email);
  if (!report) return ownerNotFound();
  if (report.revoked_at) {
    return NextResponse.json({ success: true, report: linkView(report, siteOrigin()) }, { status: 200, headers: NO_STORE });
  }
  const now = Date.now();
  if (!(await revokeOwnedReportLink(id, who.email, now))) {
    return NextResponse.json({ success: false, error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
  const updated = { ...report, revoked_at: new Date(now).toISOString() };
  return NextResponse.json({ success: true, report: linkView(updated, siteOrigin(), now) }, { status: 200, headers: NO_STORE });
}
