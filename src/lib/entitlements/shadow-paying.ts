import { isInternalTestAccount } from '@/lib/mindy/campaign-exclusions';

/** Sources that never mean "this account pays", for any account. */
const NEVER_PAYING_SOURCES = new Set(['mcp_credit_balance', 'staff', 'advocate', 'trial']);

/**
 * Whether an account counts as PAYING in the R2 entitlement shadow report.
 *
 * A `manual_grant` is a comp: on a staff account or an internal test account it is not
 * payment, so it must not make that account look like a paying customer. For any other
 * account a manual grant still counts, as before (changing that is a policy decision).
 */
export function shadowAccountIsPaying(email: string, sources: readonly string[]): boolean {
  const compOnly = sources.includes('staff') || isInternalTestAccount(email);
  return sources.some((x) => !NEVER_PAYING_SOURCES.has(x) && !(compOnly && x === 'manual_grant'));
}
