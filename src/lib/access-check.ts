/**
 * Access Check Utility
 *
 * This module provides functions to check user access to products
 * using cookies (client-side) and database (server-side).
 *
 * Cookie Names (matching your database columns):
 * - access_hunter_pro: "true" if user has Opportunity Hunter Pro
 * - access_content_standard: "true" if user has Content Generator standard
 * - access_content_full_fix: "true" if user has Content Generator Full Fix
 * - access_assassin_standard: "true" if user has Market Assassin standard
 * - access_assassin_premium: "true" if user has Market Assassin premium
 * - access_recompete: "true" if user has Recompete access
 * - access_contractor_db: "true" if user has Contractor Database access
 * - access_email: the user's email (for reference)
 */

// Product access cookie names (matching your database columns)
export const ACCESS_COOKIES = {
  HUNTER_PRO: 'access_hunter_pro',
  CONTENT_STANDARD: 'access_content_standard',
  CONTENT_FULL_FIX: 'access_content_full_fix',
  ASSASSIN_STANDARD: 'access_assassin_standard',
  ASSASSIN_PREMIUM: 'access_assassin_premium',
  RECOMPETE: 'access_recompete',
  CONTRACTOR_DB: 'access_contractor_db',
  ACCESS_EMAIL: 'access_email',
} as const;

export type ProductAccessType =
  | 'access_hunter_pro'
  | 'access_content_standard'
  | 'access_content_full_fix'
  | 'access_assassin_standard'
  | 'access_assassin_premium'
  | 'access_recompete'
  | 'access_contractor_db';

/**
 * Client-side: Check if a cookie is set
 */
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }
  return null;
}

/**
 * Client-side: Check if user has access to a product (via cookies)
 */
export function hasAccessCookie(accessType: ProductAccessType): boolean {
  const value = getCookie(accessType);
  return value === 'true';
}

/**
 * Client-side: Get all access flags from cookies
 */
export function getAllAccessFromCookies(): {
  access_hunter_pro: boolean;
  access_content_standard: boolean;
  access_content_full_fix: boolean;
  access_assassin_standard: boolean;
  access_assassin_premium: boolean;
  access_recompete: boolean;
  access_contractor_db: boolean;
  email: string | null;
} {
  return {
    access_hunter_pro: hasAccessCookie('access_hunter_pro'),
    access_content_standard: hasAccessCookie('access_content_standard'),
    access_content_full_fix: hasAccessCookie('access_content_full_fix'),
    access_assassin_standard: hasAccessCookie('access_assassin_standard'),
    access_assassin_premium: hasAccessCookie('access_assassin_premium'),
    access_recompete: hasAccessCookie('access_recompete'),
    access_contractor_db: hasAccessCookie('access_contractor_db'),
    email: getCookie(ACCESS_COOKIES.ACCESS_EMAIL),
  };
}

/**
 * Client-side: Check Market Assassin access with tier
 */
export function checkMarketAssassinAccess(): {
  hasAccess: boolean;
  tier: 'standard' | 'premium' | null;
} {
  const hasPremium = hasAccessCookie('access_assassin_premium');
  const hasStandard = hasAccessCookie('access_assassin_standard');

  if (hasPremium) {
    return { hasAccess: true, tier: 'premium' };
  }
  if (hasStandard) {
    return { hasAccess: true, tier: 'standard' };
  }
  return { hasAccess: false, tier: null };
}

/**
 * Client-side: Check Content Generator access with tier
 */
export function checkContentGeneratorAccess(): {
  hasAccess: boolean;
  tier: 'standard' | 'full_fix' | null;
} {
  const hasFullFix = hasAccessCookie('access_content_full_fix');
  const hasStandard = hasAccessCookie('access_content_standard');

  if (hasFullFix) {
    return { hasAccess: true, tier: 'full_fix' };
  }
  if (hasStandard) {
    return { hasAccess: true, tier: 'standard' };
  }
  return { hasAccess: false, tier: null };
}

/**
 * Clear all access cookies (for logout)
 */
export function clearAccessCookies(): void {
  if (typeof document === 'undefined') return;

  const cookies = Object.values(ACCESS_COOKIES);
  cookies.forEach(cookieName => {
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  });
}

/**
 * Redirect to activation page if no access
 * Use this in useEffect or route handlers
 */
export function redirectToActivate(returnUrl?: string): void {
  if (typeof window === 'undefined') return;

  const url = new URL('/activate', window.location.origin);
  if (returnUrl) {
    url.searchParams.set('return', returnUrl);
  }
  window.location.href = url.toString();
}

/**
 * Product-specific access check helpers
 */
export const Access = {
  // Opportunity Hunter Pro
  hunterPro: () => hasAccessCookie('access_hunter_pro'),

  // Content Generator
  contentStandard: () => hasAccessCookie('access_content_standard'),
  contentFullFix: () => hasAccessCookie('access_content_full_fix'),
  contentGenerator: () => hasAccessCookie('access_content_standard') || hasAccessCookie('access_content_full_fix'),

  // Market Assassin
  assassinStandard: () => hasAccessCookie('access_assassin_standard'),
  assassinPremium: () => hasAccessCookie('access_assassin_premium'),
  marketAssassin: () => hasAccessCookie('access_assassin_standard') || hasAccessCookie('access_assassin_premium'),

  // Other products
  recompete: () => hasAccessCookie('access_recompete'),
  contractorDb: () => hasAccessCookie('access_contractor_db'),
};
