/**
 * Prepaid (off-Stripe) monthly credit entitlements — a customer who paid for Pro outside
 * Stripe (invoice, Wave, wire) receives the Pro monthly allowance for a fixed run of
 * calendar months, then it stops. Table: mcp_prepaid_entitlements
 * (supabase/migrations/20261005_mcp_prepaid_entitlements.sql).
 *
 * Granted by /api/cron/grant-mcp-pro-credits, which runs daily:
 *   • CURRENT month — the entitlement joins the normal audience (no-stacking resolver,
 *     Team-supersedes-Pro check) and is claimed under monthlyGrantKey(). A missed daily
 *     run inside the month is recovered by the next one.
 *   • PAST months still owed — catchUpPrepaidMonths() grants any month inside the window
 *     that has no claim at all (e.g. the job was down across a month boundary). Bounded by
 *     the window, so it can never grant past last_month or before first_month.
 *
 * Every path claims pro:<email>:<YYYY-MM> through applyCreditOnce, so a retry, a catch-up
 * and a later Stripe Pro subscription all collide on the same key: at most one grant per
 * account per month.
 */
import { getWriteClient } from '@/lib/supabase/server-clients';
import { applyCreditOnce } from './credits';

export interface PrepaidEntitlement {
  id: string;
  userEmail: string;
  monthlyCredits: number;
  /** YYYY-MM, inclusive. */
  firstMonth: string;
  /** YYYY-MM, inclusive. */
  lastMonth: string;
  accessStartsOn: string;
  accessEndsOn: string;
}

/** The ONE monthly idempotency key shared by every monthly grant path. */
export function monthlyGrantKey(email: string, month: string): string {
  return `pro:${email.toLowerCase().trim()}:${month}`;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Every YYYY-MM from first to last inclusive. */
export function monthsInWindow(firstMonth: string, lastMonth: string): string[] {
  if (!MONTH_RE.test(firstMonth) || !MONTH_RE.test(lastMonth) || lastMonth < firstMonth) return [];
  const out: string[] = [];
  for (let m = firstMonth; m <= lastMonth; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Months owed as of `currentMonth`: inside the window and not in the future. */
export function dueMonths(ent: Pick<PrepaidEntitlement, 'firstMonth' | 'lastMonth'>, currentMonth: string): string[] {
  return monthsInWindow(ent.firstMonth, ent.lastMonth).filter((m) => m <= currentMonth);
}

/**
 * Grant schedule implied by an access window: first month = the month access starts;
 * last month = the month BEFORE the one access ends in (the final partial month is the
 * tail of the last paid month, not a new one). 2026-10-05 → 2027-04-05 = Oct..Mar.
 */
export function scheduleFromAccessWindow(accessStartsOn: string, accessEndsOn: string): { firstMonth: string; lastMonth: string } {
  return { firstMonth: accessStartsOn.slice(0, 7), lastMonth: addMonths(accessEndsOn.slice(0, 7), -1) };
}

/** Mirror of the table's CHECK constraints, so a bad schedule is rejected before the write. */
export function validatePrepaidSchedule(s: {
  firstMonth: string; lastMonth: string; accessStartsOn: string; accessEndsOn: string; monthlyCredits: number;
}): string[] {
  const errors: string[] = [];
  if (!MONTH_RE.test(s.firstMonth) || !MONTH_RE.test(s.lastMonth)) errors.push('months must be YYYY-MM');
  if (s.lastMonth < s.firstMonth) errors.push('last_month precedes first_month');
  if (!(s.monthlyCredits > 0)) errors.push('monthly_credits must be positive');
  if (s.firstMonth !== s.accessStartsOn.slice(0, 7)) errors.push('first_month must be the month access starts');
  const end = s.accessEndsOn.slice(0, 10);
  const lowest = `${addMonths(s.lastMonth, 1)}-01`;
  const beyond = `${addMonths(s.lastMonth, 2)}-01`;
  if (!(end >= lowest && end < beyond)) errors.push(`access_ends_on ${end} must fall in the month after last_month (${addMonths(s.lastMonth, 1)})`);
  return errors;
}

/** Active rows whose window has begun (future-dated schedules are not loaded). */
export async function listActivePrepaidEntitlements(currentMonth: string): Promise<{
  entitlements: PrepaidEntitlement[]; error: string | null;
}> {
  const { data, error } = await getWriteClient()
    .from('mcp_prepaid_entitlements')
    .select('id, user_email, monthly_credits, first_month, last_month, access_starts_on, access_ends_on')
    .eq('status', 'active')
    .lte('first_month', `${currentMonth}-01`);
  if (error) return { entitlements: [], error: error.message };
  return {
    entitlements: (data ?? []).map((r) => ({
      id: String(r.id),
      userEmail: String(r.user_email).toLowerCase().trim(),
      monthlyCredits: Number(r.monthly_credits),
      firstMonth: String(r.first_month).slice(0, 7),
      lastMonth: String(r.last_month).slice(0, 7),
      accessStartsOn: String(r.access_starts_on).slice(0, 10),
      accessEndsOn: String(r.access_ends_on).slice(0, 10),
    })),
    error: null,
  };
}

/**
 * Has ANY grant path claimed this account's month? Matches the add-mode key exactly and
 * the sponsored ceiling claims (`<key>:c<ceiling>`), so a catch-up never stacks on a month
 * some other source already paid. Throws on a read error — unknown is not "unclaimed".
 */
export function claimLikePattern(email: string, month: string): string {
  // `_` and `%` are LIKE wildcards and are legal in an email; escape them so a_b@x.com
  // can never match axb@x.com's claim.
  return `${monthlyGrantKey(email, month).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function isMonthClaimed(email: string, month: string): Promise<boolean> {
  const key = monthlyGrantKey(email, month);
  const { data, error } = await getWriteClient()
    .from('mcp_credit_topups')
    .select('idempotency_key')
    .like('idempotency_key', claimLikePattern(email, month))
    .limit(1);
  if (error) throw new Error(`isMonthClaimed(${key}) failed: ${error.message}`);
  return (data ?? []).length > 0;
}

export interface CatchUpResult {
  granted: { email: string; month: string; credits: number }[];
  alreadyClaimed: number;
  errors: string[];
}

/**
 * Grant PAST months (strictly before currentMonth) that are inside an entitlement's window
 * and have no claim. The current month is deliberately excluded: it goes through the
 * route's normal resolver so the no-stacking rule decides it with every other source.
 */
export async function catchUpPrepaidMonths(
  entitlements: PrepaidEntitlement[],
  currentMonth: string,
  deps: {
    isClaimed?: (email: string, month: string) => Promise<boolean>;
    grant?: (key: string, email: string, credits: number) => Promise<{ applied: boolean }>;
  } = {},
): Promise<CatchUpResult> {
  const isClaimed = deps.isClaimed ?? isMonthClaimed;
  const grant = deps.grant ?? ((key, email, credits) => applyCreditOnce(key, email, credits, 'pro_monthly'));
  const result: CatchUpResult = { granted: [], alreadyClaimed: 0, errors: [] };
  for (const ent of entitlements) {
    for (const month of dueMonths(ent, currentMonth).filter((m) => m < currentMonth)) {
      try {
        if (await isClaimed(ent.userEmail, month)) { result.alreadyClaimed++; continue; }
        const { applied } = await grant(monthlyGrantKey(ent.userEmail, month), ent.userEmail, ent.monthlyCredits);
        if (applied) result.granted.push({ email: ent.userEmail, month, credits: ent.monthlyCredits });
        else result.alreadyClaimed++;
      } catch (err) {
        result.errors.push(`${ent.userEmail} ${month}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return result;
}
