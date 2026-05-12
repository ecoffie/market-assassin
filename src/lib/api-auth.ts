import { NextRequest } from 'next/server';
import {
  getMarketAssassinAccessResilient,
  hasBriefingsAccessResilient,
  hasContentGeneratorAccessResilient,
  hasContractorDbAccessResilient,
  hasOHProAccessResilient,
  hasRecompeteAccessResilient,
} from '@/lib/kv-resilience';

// Legacy imports for backward compatibility (now with try-catch fallback)
import { hasBriefingAccess } from '@/lib/access-codes';

export interface AuthResult {
  authenticated: boolean;
  email: string | null;
  error?: string;
}

export type MIAccessTier = 'free' | 'pro' | 'team' | 'enterprise' | 'none';
export type MIStaffRole = 'none' | 'staff' | 'admin';

export interface MIAccessSources {
  marketAssassin: boolean;
  marketAssassinPremium: boolean;
  contentReaper: boolean;
  opportunityHunterPro: boolean;
  recompete: boolean;
  contractorDb: boolean;
  briefings: boolean;
}

export interface MIAuthResult {
  tier: MIAccessTier;
  email: string | null;
  isStaff?: boolean;
  staffRole?: MIStaffRole;
  sources?: MIAccessSources;
  error?: string;
}

/**
 * Extract user email from cookie or request body.
 * Checks `ma_access_email` cookie first, then `userEmail` in body.
 */
export function getEmailFromRequest(
  request: NextRequest,
  body?: Record<string, unknown>
): string | null {
  // Check cookie first
  const cookieEmail = request.cookies.get('ma_access_email')?.value;
  if (cookieEmail) return cookieEmail.toLowerCase();

  // Fall back to request body
  const bodyEmail = body?.userEmail as string | undefined;
  if (bodyEmail) return bodyEmail.toLowerCase();

  return null;
}

/**
 * Verify that an email has Market Assassin access via resilient KV layer.
 * Uses: Local Cache → KV (with circuit breaker) → Supabase fallback
 */
export async function verifyMAAccess(email: string | null): Promise<AuthResult> {
  if (!email) {
    return { authenticated: false, email: null, error: 'Email required for access verification' };
  }

  const hasAccess = !!(await getMarketAssassinAccessResilient(email));
  if (!hasAccess) {
    return { authenticated: false, email, error: 'No Market Assassin access found for this email' };
  }

  return { authenticated: true, email };
}

function parseEmailList(value: string | undefined): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getStaffRole(email: string): MIStaffRole {
  const normalizedEmail = email.toLowerCase();
  const domain = normalizedEmail.split('@')[1] || '';
  const configuredStaff = parseEmailList(process.env.MI_STAFF_EMAILS);
  const configuredAdmins = parseEmailList(process.env.MI_ADMIN_EMAILS);

  if (normalizedEmail === 'eric@govcongiants.com' || configuredAdmins.has(normalizedEmail)) {
    return 'admin';
  }

  if (
    domain === 'govcongiants.com'
    || domain === 'govcongiants.com'
    || configuredStaff.has(normalizedEmail)
  ) {
    return 'staff';
  }

  return 'none';
}

/**
 * Verify Market Intelligence access level.
 * - 'pro': Has any legacy paid GovCon tool or MI/briefings access.
 * - staff/admin is tracked separately from the customer tier.
 * - 'free': Any email (free MI surface)
 * - 'none': No email provided
 */
export async function verifyMIAccess(email: string | null): Promise<MIAuthResult> {
  if (!email) {
    return { tier: 'none', email: null, error: 'Email required for access' };
  }

  const normalizedEmail = email.toLowerCase();

  // Use resilient functions with LRU cache + circuit breaker + Supabase fallback
  const [
    marketAssassinAccess,
    hasContentReaper,
    hasOpportunityHunterPro,
    hasRecompete,
    hasContractorDb,
    hasBriefings,
    hasLegacyBriefing,
  ] = await Promise.all([
    getMarketAssassinAccessResilient(normalizedEmail),
    hasContentGeneratorAccessResilient(normalizedEmail),
    hasOHProAccessResilient(normalizedEmail),
    hasRecompeteAccessResilient(normalizedEmail),
    hasContractorDbAccessResilient(normalizedEmail),
    hasBriefingsAccessResilient(email),
    hasBriefingAccess(normalizedEmail), // Legacy function still has its own fallback
  ]);

  const staffRole = getStaffRole(normalizedEmail);
  const sources: MIAccessSources = {
    marketAssassin: !!marketAssassinAccess,
    marketAssassinPremium: marketAssassinAccess?.tier === 'premium',
    contentReaper: hasContentReaper,
    opportunityHunterPro: hasOpportunityHunterPro,
    recompete: hasRecompete,
    contractorDb: hasContractorDb,
    briefings: hasBriefings || hasLegacyBriefing,
  };

  const hasUnifiedProAccess = Object.values(sources).some(Boolean) || staffRole !== 'none';

  if (hasUnifiedProAccess) {
    return {
      tier: 'pro',
      email: normalizedEmail,
      isStaff: staffRole !== 'none',
      staffRole,
      sources,
    };
  }

  // Free tier for any email
  return {
    tier: 'free',
    email: normalizedEmail,
    isStaff: staffRole !== 'none',
    staffRole,
    sources,
  };
}
