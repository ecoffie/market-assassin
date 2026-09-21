/**
 * Government-buyer access gate.
 *
 * Wraps requireMIAuthSession (valid MI session) and ADDITIONALLY asserts
 * the user is a gov_buyer. A seller with a valid session must NOT reach
 * the buyer surface, and vice versa.
 *
 * PRD: docs/PRD-gov-buyer-market-research.md §5
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getProfileByEmail } from '@/lib/supabase/user-profiles';

// Government email domains accepted for buyer access. Belt-and-suspenders
// alongside the user_type check: even a hand-provisioned gov_buyer should
// be on a .gov/.mil address.
export function isGovEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return /\.gov$|\.mil$|\.gov\.[a-z]{2,}$/.test(e);
}

interface GovBuyerOk { ok: true; email: string }
interface GovBuyerFail { ok: false; response: NextResponse }

export async function requireGovBuyer(
  request: NextRequest,
  email: string | null,
): Promise<GovBuyerOk | GovBuyerFail> {
  if (!email) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Email required' },
        { status: 400 },
      ),
    };
  }

  // 1) Must hold a valid MI session for this email.
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return { ok: false, response: auth.response };

  // 2) Must be provisioned as a government buyer.
  const profile = await getProfileByEmail(email);
  const userType = (profile as { user_type?: string } | null)?.user_type;
  if (userType !== 'gov_buyer') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: 'Government buyer access required',
          // The UI uses this to redirect a seller who lands here back to
          // the seller surface instead of showing a dead end.
          redirect: '/market-intelligence',
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, email };
}
