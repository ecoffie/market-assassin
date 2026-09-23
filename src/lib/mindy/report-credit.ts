/**
 * Single-use report credit (a legacy /access/<CODE> link, redeemed inside Mindy).
 * The browser only HOLDS the code for the session; /api/reports/generate-all decides whether it
 * is valid for the signed-in email and consumes it. See src/app/access/[code]/page.tsx.
 */
export const REPORT_CREDIT_KEY = 'mindy_report_credit';

export function readReportCredit(): string | null {
  try { return sessionStorage.getItem(REPORT_CREDIT_KEY); } catch { return null; }
}

export function clearReportCredit(): void {
  try { sessionStorage.removeItem(REPORT_CREDIT_KEY); } catch { /* storage blocked */ }
}
