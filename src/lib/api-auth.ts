import { NextRequest } from 'next/server';
import { hasMarketAssassinAccess } from '@/lib/access-codes';
import { hasBriefingsAccess } from '@/lib/briefings/access';

export interface AuthResult {
  authenticated: boolean;
  email: string | null;
  error?: string;
}

export type MIAccessTier = 'free' | 'pro' | 'none';

export interface MIAuthResult {
  tier: MIAccessTier;
  email: string | null;
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
 * Verify that an email has Market Assassin access via KV.
 */
export async function verifyMAAccess(email: string | null): Promise<AuthResult> {
  if (!email) {
    return { authenticated: false, email: null, error: 'Email required for access verification' };
  }

  const hasAccess = await hasMarketAssassinAccess(email);
  if (!hasAccess) {
    return { authenticated: false, email, error: 'No Market Assassin access found for this email' };
  }

  return { authenticated: true, email };
}

/**
 * Verify Market Intelligence access level.
 * - 'pro': Has MA access OR briefings access (paid features)
 * - 'free': Any email (4 free reports)
 * - 'none': No email provided
 */
export async function verifyMIAccess(email: string | null): Promise<MIAuthResult> {
  if (!email) {
    return { tier: 'none', email: null, error: 'Email required for access' };
  }

  // Check for pro access (MA or briefings)
  const [hasMA, hasBriefings] = await Promise.all([
    hasMarketAssassinAccess(email),
    hasBriefingsAccess(email),
  ]);

  if (hasMA || hasBriefings) {
    return { tier: 'pro', email };
  }

  // Free tier for any email
  return { tier: 'free', email };
}
