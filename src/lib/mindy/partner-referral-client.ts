'use client';

const STORAGE_KEY = 'mindy_partner_ref';
const COOKIE_KEY = 'mindy_partner_ref';
const COOKIE_MAX_AGE_DAYS = 30;

export function normalizePartnerRef(raw: string | null | undefined): string {
  return (raw || '').trim().toUpperCase();
}

export function storePartnerRef(code: string): void {
  const normalized = normalizePartnerRef(code);
  if (!normalized) return;
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined') {
    const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(normalized)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  }
}

export function capturePartnerRefFromSearchParams(
  searchParams: URLSearchParams | { get: (key: string) => string | null },
): string | null {
  const ref = normalizePartnerRef(searchParams.get('ref') || searchParams.get('code'));
  if (ref) {
    storePartnerRef(ref);
    return ref;
  }
  return getStoredPartnerRef();
}

export function getStoredPartnerRef(): string | null {
  try {
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage) return normalizePartnerRef(fromStorage);
  } catch {
    // ignore
  }
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`));
  return match ? normalizePartnerRef(decodeURIComponent(match[1])) : null;
}

/** Drop the pending referral from BOTH transports (localStorage + cookie). */
export function clearStoredPartnerRef(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined') {
    document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
  }
}

const CLAIM_THROTTLE_KEY = 'mindy_partner_ref_claim_at';
const CLAIM_THROTTLE_MS = 20_000;
let claimInFlight = false;

export type PendingClaimResult = 'none' | 'claimed' | 'cleared' | 'kept' | 'throttled';

/**
 * SEC-5d: hand a pending partner referral to the server once a VERIFIED session exists.
 * Browser storage is transport only — the server takes the identity from the session token and
 * validates the code. The pending code is cleared only when the server says the outcome is
 * terminal (claimed / already claimed / invalid / active Pro); a retryable outcome
 * (profile_required, 401, 5xx, network) keeps it so a later page load can retry.
 */
export async function claimPendingPartnerReferral(
  fetchImpl: typeof fetch = fetch,
): Promise<PendingClaimResult> {
  const code = getStoredPartnerRef();
  if (!code) return 'none';
  let token: string | null = null;
  try {
    token = localStorage.getItem('mi_beta_auth_token');
  } catch {
    token = null;
  }
  if (!token) return 'none';
  if (claimInFlight) return 'throttled';
  try {
    const last = Number(sessionStorage.getItem(CLAIM_THROTTLE_KEY) || 0);
    if (last && Date.now() - last < CLAIM_THROTTLE_MS) return 'throttled';
    sessionStorage.setItem(CLAIM_THROTTLE_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable — the in-flight flag still prevents a burst
  }
  claimInFlight = true;
  try {
    const res = await fetchImpl('/api/app/partner-referral/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mi-auth-token': token },
      body: JSON.stringify({ code }),
    });
    const j = (await res.json().catch(() => null)) as { clearPending?: boolean; status?: string } | null;
    if (j && j.clearPending === true) {
      clearStoredPartnerRef();
      return j.status === 'claimed' ? 'claimed' : 'cleared';
    }
    return 'kept';
  } catch {
    return 'kept';
  } finally {
    claimInFlight = false;
  }
}
