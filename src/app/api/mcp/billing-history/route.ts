/**
 * /api/mcp/billing-history — the "receipts" list for the /mcp/account Billing section.
 *
 * GET (token-only, resolveMcpEmail) → { history[] }: every CREDIT ADDITION (delta > 0)
 * from mcp_credit_ledger, newest first — top-ups, auto-recharges, Pro allowance, and
 * the free signup/complimentary grants. Debits (tool calls) live in Activity, not here.
 *
 * Note on dollars: neither mcp_credit_ledger nor mcp_credit_topups records a USD amount
 * (and a credit count is ambiguous between a one-time pack and a subscription month), so
 * receipts show CREDITS, not dollars. Capturing per-event USD would need storing it at
 * grant time — a later enhancement.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';
import { getWriteClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ledger reason → a label a person recognizes. */
const REASON_LABEL: Record<string, string> = {
  stripe_topup: 'Credit top-up',
  auto_recharge: 'Auto-recharge',
  pro_monthly: 'MCP Pro — monthly credits',
  mcp_sub_monthly: 'MCP Pro — monthly',
  mcp_sub_annual: 'MCP Pro — annual',
  signup_grant: 'Free signup credits',
  admin_grant: 'Complimentary credits',
};

/** Genuinely-free grants (no purchase behind them). Everything else — top-up,
 *  auto-recharge, Pro allowance, subscription grants — sits under a paid plan. */
const FREE_REASONS = new Set(['signup_grant', 'admin_grant']);

function labelFor(reason: string): string {
  return REASON_LABEL[reason] ?? reason.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export async function GET(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { data, error } = await getWriteClient()
    .from('mcp_credit_ledger')
    .select('id, delta, reason, balance_after, created_at')
    .eq('user_email', email)
    .gt('delta', 0) // credit ADDITIONS only — debits (tool calls) belong in Activity
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: 'Could not load billing history' }, { status: 500 });
  }

  const history = (data ?? []).map((r) => ({
    id: r.id as string,
    date: r.created_at as string,
    reason: r.reason as string,
    label: labelFor(r.reason as string),
    credits: r.delta as number,
    balanceAfter: r.balance_after as number,
    free: FREE_REASONS.has(r.reason as string),
  }));

  return NextResponse.json({ success: true, history });
}
