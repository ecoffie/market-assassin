/**
 * /api/mcp/account — everything the getmindy.ai/mcp dashboard needs in one read.
 *
 * GET (requireUserAuth) →
 *   { balance, tools[] (name+credits), recentCalls[] (last 50), usage }
 * where `usage` is a 30-day rollup for the Overview charts:
 *   { windowDays, totalCredits, totalCalls, byTool[], byDay[], capped }.
 * Keys themselves come from /api/mcp/keys; this is balance + usage.
 *
 * `shadow_*` rows (the extraction-guard audit trail) are an internal artifact — they
 * pair with a real call's row — so they're excluded from every count/chart/log here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';
import { getBalance } from '@/lib/mcp/credits';
import { listMcpTools } from '@/lib/mcp/tool-registry';
import { getWriteClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;
const ROW_CAP = 2000; // bound the read for a heavy power user; usage totals note when hit.

interface CallRow { tool_name: string; status: string; credits_charged: number | null; created_at: string }

export async function GET(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [balance, callsRes] = await Promise.all([
    getBalance(email),
    getWriteClient()
      .from('mcp_call_log')
      .select('tool_name, status, credits_charged, created_at')
      .eq('user_email', email)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(ROW_CAP),
  ]);

  const allRows = (callsRes.data ?? []) as CallRow[];
  // Drop the guard's shadow audit rows — they're not user-facing calls.
  const rows = allRows.filter((r) => !String(r.status).startsWith('shadow_'));

  // 30-day rollups: spend per tool + spend per day.
  const byToolMap = new Map<string, { calls: number; credits: number }>();
  const byDayMap = new Map<string, { calls: number; credits: number }>();
  let totalCredits = 0;
  for (const r of rows) {
    const cr = r.credits_charged || 0;
    totalCredits += cr;
    const t = byToolMap.get(r.tool_name) ?? { calls: 0, credits: 0 };
    t.calls += 1; t.credits += cr;
    byToolMap.set(r.tool_name, t);
    const day = r.created_at.slice(0, 10); // YYYY-MM-DD (UTC)
    const d = byDayMap.get(day) ?? { calls: 0, credits: 0 };
    d.calls += 1; d.credits += cr;
    byDayMap.set(day, d);
  }

  const byTool = [...byToolMap.entries()]
    .map(([tool, v]) => ({ tool, calls: v.calls, credits: v.credits }))
    .sort((a, b) => b.credits - a.credits || b.calls - a.calls);
  const byDay = [...byDayMap.entries()]
    .map(([date, v]) => ({ date, calls: v.calls, credits: v.credits }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const tools = listMcpTools().map((t) => {
    const fn = t.function as { name: string; description?: string };
    return { name: fn.name, description: fn.description ?? '', credits: (t._credits as number) ?? 0 };
  });

  return NextResponse.json({
    success: true,
    balance,
    tools,
    recentCalls: rows.slice(0, 50),
    usage: {
      windowDays: WINDOW_DAYS,
      totalCredits,
      totalCalls: rows.length,
      byTool,
      byDay,
      capped: allRows.length >= ROW_CAP,
    },
  });
}
