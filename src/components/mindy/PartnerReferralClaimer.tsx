'use client';

/**
 * SEC-5d: when a page renders with BOTH a verified Mindy session and a pending partner referral
 * (from /mdeat, /ncmbc or ?ref=), claim it server-side. Covers email setup-link signup, Google
 * OAuth and existing-user sign-in for every React page (mounted in the root layout). The
 * server-rendered Map / Today pages run the same handoff from ACCOUNT_MENU_JS.
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { claimPendingPartnerReferral } from '@/lib/mindy/partner-referral-client';

export default function PartnerReferralClaimer() {
  const pathname = usePathname();
  useEffect(() => {
    void claimPendingPartnerReferral();
  }, [pathname]);
  return null;
}
