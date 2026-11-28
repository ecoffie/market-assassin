/**
 * GET    /api/app/market-reports/<id>?email= — the OWNER's view of their report, whatever its public link
 *        status. The owner keeps access after the link is revoked or expires (Eric, 2026-11-22). Returns the
 *        same rendered HTML the hosted page shows, plus the link status.
 * DELETE /api/app/market-reports/<id>?email= — the ONLY path that removes a report. Revoking or expiring a
 *        link never deletes it.
 * Strong auth; not-yours and missing get the identical 404 (src/lib/market/report-owner-api.ts).
 */
import { NextResponse } from 'next/server';
import { deleteOwnedMarketReport, getOwnedMarketReport } from '@/lib/market/report-store';
import { renderStoredReportHtml } from '@/lib/market/stored-report-html';
import { NO_STORE, REPORT_ID_RE, linkView, ownerNotFound, requireOwner, siteOrigin } from '@/lib/market/report-owner-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const who = await requireOwner(request);
  if ('response' in who) return who.response;
  const { id } = await ctx.params;
  if (!REPORT_ID_RE.test(id || '')) return ownerNotFound();
  const report = await getOwnedMarketReport(id, who.email);
  if (!report?.payload) return ownerNotFound();
  let html: string;
  try {
    html = renderStoredReportHtml(report);
  } catch (err) {
    console.error('[market-reports] owner render failed for', id, err);
    return NextResponse.json({ success: false, error: 'render_failed' }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ success: true, report: linkView(report, siteOrigin()), html }, { status: 200, headers: NO_STORE });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const who = await requireOwner(request);
  if ('response' in who) return who.response;
  const { id } = await ctx.params;
  if (!REPORT_ID_RE.test(id || '')) return ownerNotFound();
  const ok = await deleteOwnedMarketReport(id, who.email);
  if (!ok) return ownerNotFound();
  return NextResponse.json({ success: true, deleted: true }, { status: 200, headers: NO_STORE });
}
