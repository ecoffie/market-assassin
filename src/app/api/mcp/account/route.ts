/**
 * /api/mcp/account — everything the getmindy.ai/mcp dashboard needs in one read.
 *
 * GET (requireUserAuth) → { balance, tools[] (name+credits), packages[], recentCalls[] }.
 * Keys themselves come from /api/mcp/keys; this is balance + usage + the price/pack tables.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserAuth } from '@/lib/api-auth';
import { getBalance } from '@/lib/mcp/credits';
import { listMcpTools } from '@/lib/mcp/tool-registry';
import { CREDIT_PACKAGES } from '@/lib/mcp/packages';
import { getWriteClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireUserAuth(request);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const email = auth.email.toLowerCase();

  const [balance, callsRes] = await Promise.all([
    getBalance(email),
    getWriteClient()
      .from('mcp_call_log')
      .select('tool_name, status, credits_charged, created_at')
      .eq('user_email', email)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const tools = listMcpTools().map((t) => {
    const fn = t.function as { name: string; description?: string };
    return { name: fn.name, description: fn.description ?? '', credits: (t._credits as number) ?? 0 };
  });

  return NextResponse.json({
    success: true,
    balance,
    tools,
    packages: CREDIT_PACKAGES,
    recentCalls: callsRes.data ?? [],
  });
}
