/**
 * Shared plumbing for the owner routes under /api/app/market-reports (report link controls).
 *
 * The rules, same as the Vault document routes:
 * - STRONG auth for `email` (verifyUserOwnsEmail requireStrongAuth), from a real SESSION only: signed
 *   email-action links (method 'token') are refused. There is no new auth system.
 * - The owner is the verified caller. Every query filters on owner_email inside the query itself.
 * - Not-yours and missing get the IDENTICAL 404 body, with no subject, status or counts, so ids cannot be
 *   probed for metadata.
 * - private, no-store.
 */
import { NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { linkStatus, type SavedReport, type OwnedReportSummary } from './report-store';

export const NO_STORE = { 'Cache-Control': 'private, no-store' };
export const REPORT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const ownerNotFound = () => NextResponse.json({ success: false, error: 'not_found' }, { status: 404, headers: NO_STORE });

/** The verified owner email, or the response to send (400/401). */
export async function requireOwner(request: Request): Promise<{ email: string } | { response: NextResponse }> {
  const email = (new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return { response: NextResponse.json({ success: false, error: 'email_required' }, { status: 400, headers: NO_STORE }) };
  const auth = await verifyUserOwnsEmail(request as never, email, { requireStrongAuth: true });
  if (!auth.authenticated || !auth.email) {
    return { response: NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401, headers: NO_STORE }) };
  }
  // A real signed-in session only (Supabase bearer or the Mindy session header). A signed email-action link
  // (?token=&ts=, method 'token', valid 24 h) must never operate these controls: anyone holding a forwarded
  // alert email could otherwise list, revoke, extend or delete the owner's reports.
  if (auth.method !== 'session') {
    return { response: NextResponse.json({ success: false, error: 'session_required' }, { status: 401, headers: NO_STORE }) };
  }
  return { email: auth.email.toLowerCase() };
}

/** Same origin generate_market_report puts in deliverable.url (src/mcp/tools/market-report.ts). */
export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai').replace(/\/$/, '');
}

/** What the owner sees about one report's link. */
export function linkView(r: OwnedReportSummary | SavedReport, origin: string, nowMs: number = Date.now()) {
  return {
    id: r.id,
    subject: r.subject,
    client_name: r.client_name,
    created_at: r.created_at,
    expires_at: r.expires_at ?? null,
    revoked_at: r.revoked_at ?? null,
    status: linkStatus(r, nowMs),
    url: `${origin}/reports/${r.id}`,
  };
}
