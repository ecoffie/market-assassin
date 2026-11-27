/**
 * The connect outcome, handed from the OAuth callback to the Ask Mindy file control through a short-lived cookie.
 * The app rewrites its address to ?panel= before the chat panel mounts, which dropped ?connect= (acceptance
 * 2026-11-25), so the customer never saw "connected" or why it failed. Outcome, provider and a sanitized reason
 * code only: no ids, tokens or account details. Read once, then cleared.
 */
export const RESULT_COOKIE = 'mindy_ca_result';

const code = (v: string | null | undefined) => String(v || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);

export function resultCookieValue(params: Record<string, string>): string {
  return [params.connect === 'ok' ? 'ok' : 'error', code(params.provider), code(params.reason)].join('.');
}

export interface ConnectResult { status: 'ok' | 'error'; provider: 'google' | 'microsoft' | null; reason: string }

export function parseResultCookie(cookieHeader: string): ConnectResult | null {
  const raw = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${RESULT_COOKIE}=`));
  if (!raw) return null;
  const [status, provider, reason] = decodeURIComponent(raw.slice(RESULT_COOKIE.length + 1)).split('.');
  if (status !== 'ok' && status !== 'error') return null;
  return { status, provider: provider === 'google' || provider === 'microsoft' ? provider : null, reason: code(reason) };
}
