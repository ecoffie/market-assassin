/**
 * Single-use report credit (a legacy /access/<CODE> link, redeemed inside Mindy).
 * The browser only HOLDS the code; /api/reports/generate-all decides whether it is valid for the
 * signed-in email and consumes it. See src/app/access/[code]/page.tsx.
 *
 * localStorage with a 24h expiry (it was sessionStorage): the customer signs in with a magic link
 * that the email client usually opens in a NEW tab, and sessionStorage is per-tab, so the credit
 * was dropped on the way through sign-in.
 */
export const REPORT_CREDIT_KEY = 'mindy_report_credit';
export const REPORT_CREDIT_TTL_MS = 24 * 60 * 60 * 1000;
const CODE = /^[A-Z0-9-]{4,64}$/;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } };

export function holdReportCredit(code: string | null | undefined, now = Date.now(), s: Store | null = store()): boolean {
  const c = String(code || '').trim().toUpperCase();
  if (!s || !CODE.test(c)) return false;
  try { s.setItem(REPORT_CREDIT_KEY, JSON.stringify({ code: c, at: now })); return true; } catch { return false; }
}

export function readReportCredit(now = Date.now(), s: Store | null = store()): string | null {
  if (!s) return null;
  try {
    const raw = s.getItem(REPORT_CREDIT_KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code?: string; at?: number };
    if (typeof at !== 'number' || now - at > REPORT_CREDIT_TTL_MS || !code || !CODE.test(code)) {
      s.removeItem(REPORT_CREDIT_KEY);
      return null;
    }
    return code;
  } catch { return null; }
}

export function clearReportCredit(s: Store | null = store()): void {
  try { s?.removeItem(REPORT_CREDIT_KEY); } catch { /* storage blocked */ }
}
