/**
 * Who may use Ask Mindy (chat, chat sessions, chat documents, cited source docs).
 *
 * Pro (paid, lifetime, Team or an active trial) OR verified staff. Staff hold Team capabilities
 * (entitlements/policy.ts, LOCKED 2026-10-04), but the chat routes checked hasProAccess() alone,
 * which never looks at staff: a company account with no paid grant got "upgrade" (2026-11-24).
 *
 * CALL ONLY WITH AN EMAIL THE CALLER HAS PROVED (verifyUserOwnsEmail). getStaffRole() decides
 * from the email string, so an unproven email must never reach it (see verifyMIAccess).
 */
import { getStaffRole } from '@/lib/access/staff-role';
import { hasProAccess } from '@/lib/access/resolve-access';

export async function canUseAskMindy(verifiedEmail: string): Promise<boolean> {
  if (getStaffRole(verifiedEmail) !== 'none') return true;
  return hasProAccess(verifiedEmail);
}
