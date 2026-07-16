/**
 * /api/mcp/account — everything the getmindy.ai/mcp dashboard needs in one read.
 *
 * GET (requireUserAuth) → { balance, tools[] (name+credits), recentCalls[] }.
 * Keys themselves come from /api/mcp/keys; this is balance + usage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';
import { getBalance } from '@/lib/mcp/credits';
import { listMcpTools } from '@/lib/mcp/tool-registry';
import { getWriteClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

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
    recentCalls: callsRes.data ?? [],
  });
}
