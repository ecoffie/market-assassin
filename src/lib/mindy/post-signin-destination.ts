/**
 * Where a completed /app sign-in should go.
 *
 * /app is the legacy tool shell. getmindy.ai's new home is Today's Intel
 * (MAPS_HOME_URL, host-rewritten from `/`). Two writers used to leave an
 * advocate in the old shell:
 *
 * 1. Paid MFA is on, and complimentary Pro makes hasProAccess true, so the
 *    Maps password modal hands off to `/app` for the code step — and /app
 *    never followed `?next=`.
 * 2. Magic links and `/signin` land on `/app` with no destination of their own.
 *
 * Advocates are not a billing tier. They skip the paid-MFA handoff and, after
 * a fresh sign-in with no explicit panel, go to the new app. A `?panel=` on
 * /app is an intentional legacy deep link and must stay.
 */
import { isAdvocateAccount } from '@/lib/mindy/advocate-accounts';
import { MAPS_HOME_URL } from '@/lib/mindy/maps-home';
import { isSafeNext, safeNext } from '@/lib/mindy/safe-next';

export function shouldChallengePaidMfa(email: string, enforced: boolean): boolean {
  if (!enforced) return false;
  // Complimentary Pro is not a paid account. Challenging it forces the Maps
  // modal to abandon the new app for the legacy /app code step.
  return !isAdvocateAccount(email);
}

export function postSignInPath(input: {
  email: string;
  next?: string | null;
  panel?: string | null;
}): string | null {
  if (isSafeNext(input.next)) return safeNext(input.next);
  // Explicit legacy panel — settings, pipeline, etc. Do not bounce them.
  if (input.panel && input.panel.trim()) return null;
  if (isAdvocateAccount(input.email)) return MAPS_HOME_URL;
  return null;
}
