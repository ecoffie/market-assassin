/**
 * Does this account currently receive a RECURRING monthly MCP credit allowance?
 *
 * Derived from what the grant paths actually WROTE, not from what the account looks
 * like it should get. Every recurring path claims a monthly key `pro:<email>:<YYYY-MM>`
 * in `mcp_credit_topups`: the daily grant cron (Pro/Team subs, internal, advocates,
 * prepaid), its sponsored top-up (`<key>:c<ceiling>`, claimed even when 0 is owed) and
 * the app-tier invoice webhook. The cron self-heals daily, so an eligible account holds
 * a claim for the current month — or, early on the 1st before the 09:00 UTC run, for
 * the previous one. MCP credit plans grant per invoice under the invoice id instead,
 * so they are read from the ledger.
 *
 * Used ONLY for display ("Monthly MCP credits: not included with this access").
 * It never grants or gates anything. A read error is `unknown`, which renders nothing:
 * unknown is not "not included".
 */
import { getWriteClient } from '@/lib/supabase/server-clients';
import { isMonthClaimed } from '@/lib/mcp/prepaid-entitlements';

export type RecurringCreditStatus = 'included' | 'not_included' | 'unknown';

const DAY_MS = 86_400_000;
/** A monthly MCP plan invoice renews every ~30 days; an annual one every ~365. */
const MCP_SUB_MONTHLY_WINDOW_DAYS = 40;
const MCP_SUB_ANNUAL_WINDOW_DAYS = 370;

export function currentAndPreviousMonth(now: Date): [string, string] {
  const cur = now.toISOString().slice(0, 7);
  const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [cur, prevDate.toISOString().slice(0, 7)];
}

export async function recurringMonthlyCreditStatus(
  email: string,
  now: Date = new Date(),
): Promise<RecurringCreditStatus> {
  const e = (email || '').trim().toLowerCase();
  if (!e) return 'unknown';
  try {
    const [cur, prev] = currentAndPreviousMonth(now);
    if (await isMonthClaimed(e, cur)) return 'included';
    if (await isMonthClaimed(e, prev)) return 'included';

    const monthlySince = now.getTime() - MCP_SUB_MONTHLY_WINDOW_DAYS * DAY_MS;
    const annualSince = new Date(now.getTime() - MCP_SUB_ANNUAL_WINDOW_DAYS * DAY_MS).toISOString();
    const { data, error } = await getWriteClient()
      .from('mcp_credit_ledger')
      .select('reason, created_at')
      .eq('user_email', e)
      .in('reason', ['mcp_sub_monthly', 'mcp_sub_annual'])
      .gte('created_at', annualSince)
      .limit(50);
    if (error) throw new Error(error.message);
    const live = (data ?? []).some((r) =>
      r.reason === 'mcp_sub_annual' || Date.parse(r.created_at as string) >= monthlySince);
    return live ? 'included' : 'not_included';
  } catch (err) {
    console.error('[mcp:recurring-credit-status] lookup failed:', err);
    return 'unknown';
  }
}

