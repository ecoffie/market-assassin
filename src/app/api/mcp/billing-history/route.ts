/**
 * /api/mcp/billing-history — the "receipts" list for the /mcp/account Billing section.
 *
 * GET (token-only, resolveMcpEmail) → { history[] }:
 *   history — every ledger row EXCEPT tool calls, newest first: top-ups, auto-recharges,
 *     allowance grants, free grants AND administrative adjustments (signed). Without the
 *     adjustments the visible rows could not be reconciled with the balance; see
 *     src/lib/mcp/billing-history.ts. Tool-call debits live in Activity.
 *
 * Note on dollars: neither mcp_credit_ledger nor mcp_credit_topups records a USD amount
 * (and a credit count is ambiguous between a one-time pack and a subscription month), so
 * receipts show CREDITS, not dollars.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { toBillingHistory, TOOL_CALL_REASON, type LedgerRow } from '@/lib/mcp/billing-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const ledger = await getWriteClient()
    .from('mcp_credit_ledger')
    .select('id, delta, reason, balance_after, created_at')
    .eq('user_email', email)
    .neq('reason', TOOL_CALL_REASON) // tool calls belong in Activity
    .order('created_at', { ascending: false })
    .limit(50);

  if (ledger.error) {
    return NextResponse.json({ error: 'Could not load billing history' }, { status: 500 });
  }

  const history = toBillingHistory((ledger.data ?? []) as LedgerRow[]);
  return NextResponse.json({ success: true, history });
}
