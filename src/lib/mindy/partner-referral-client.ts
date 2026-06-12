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
