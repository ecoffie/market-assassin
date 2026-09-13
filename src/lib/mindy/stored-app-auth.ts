/**
 * Client-side MI session keys + the rule that a still-valid 30-day token
 * must not be destroyed because the legacy /app cache (mi_beta_email +
 * authenticated_at < 12h) is missing.
 *
 * Maps-only password login writes `mi_beta_auth_token` and may omit
 * `mi_beta_email`. Hitting /app used to call clearStoredAppAuth() on a
 * failed 12h cache check and wipe a valid token. That is the bug.
 *
 * Explicit sign-out MUST pass { force: true }.
 */

export const MI_AUTH_TOKEN_KEY = 'mi_beta_auth_token';
export const TWO_FACTOR_TOKEN_KEY = 'mi_beta_2fa_token';

function fromBase64Url(value: string): string {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad;
  if (typeof atob === 'function') return atob(b64);
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function readMiTokenPayload(token: string | null | undefined): {
  email?: string;
  exp?: number;
} | null {
  if (!token) return null;
  try {
    const [encoded] = token.split('.');
    if (!encoded) return null;
    const parsed = JSON.parse(fromBase64Url(encoded)) as { email?: string; exp?: number };
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function readMiTokenEmail(token: string | null | undefined): string | null {
  const email = readMiTokenPayload(token)?.email;
  return email ? String(email).toLowerCase().trim() : null;
}

export function isStoredMiTokenUnexpired(token: string | null | undefined): boolean {
  const exp = readMiTokenPayload(token)?.exp;
  return typeof exp === 'number' && exp > Date.now();
}

export function peekStoredMiToken(storage: Pick<Storage, 'getItem'> | null | undefined): {
  token: string | null;
  email: string | null;
  unexpired: boolean;
} {
  const token = storage?.getItem(MI_AUTH_TOKEN_KEY) || null;
  return {
    token,
    email: readMiTokenEmail(token),
    unexpired: isStoredMiTokenUnexpired(token),
  };
}

/**
 * Clear the /app localStorage cache.
 *
 * Default: if the HMAC token is still inside its 30-day TTL, KEEP it.
 * Only an explicit sign-out (`force: true`) or an expired/missing token
 * removes `mi_beta_auth_token`.
 */
export function clearStoredAppAuth(
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null | undefined = typeof window === 'undefined' ? null : window.localStorage,
  opts?: { force?: boolean },
): { keptValidToken: boolean } {
  if (!storage) return { keptValidToken: false };
  const token = storage.getItem(MI_AUTH_TOKEN_KEY);
  const keepToken = !opts?.force && isStoredMiTokenUnexpired(token);
  storage.removeItem('mi_beta_email');
  storage.removeItem('mi_beta_authenticated_at');
  storage.removeItem('mi_beta_2fa_verified_at');
  storage.removeItem(TWO_FACTOR_TOKEN_KEY);
  if (!keepToken) storage.removeItem(MI_AUTH_TOKEN_KEY);
  return { keptValidToken: keepToken };
}
