/**
 * /api/admin/llm-cost — LLM cost dashboard (#37). Surfaces per-user + per-tool
 * spend so expensive users/tools are visible BEFORE a surprise bill (Eric:
 * acquisition needs provable unit economics).
 *
 * GET ?password=...&days=30
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { USER_MONTHLY_LLM_BUDGET_USD } from '@/lib/llm/usage-cost';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const pw = request.nextUrl.searchParams.get('password');
  if (pw !== (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const days = Math.min(Number(request.nextUrl.searchParams.get('days') || 30), 90);
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const supabase = sb();
  const { data, error } = await supabase
    .from('llm_usage_log')
    .select('user_email, tool, provider, model, prompt_tokens, completion_tokens, cost_usd, created_at')
    .gte('created_at', since)
    .limit(50000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data || [];

  const sum = (arr: typeof rows, k: 'cost_usd' | 'prompt_tokens' | 'completion_tokens') =>
    arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);

  // By tool.
  const byTool: Record<string, { cost: number; calls: number; tokens: number }> = {};
  // By user.
  const byUser: Record<string, { cost: number; calls: number }> = {};
  // By provider.
  const byProvider: Record<string, { cost: number; calls: number }> = {};
  for (const r of rows) {
    const t = r.tool || 'unknown';
    byTool[t] = byTool[t] || { cost: 0, calls: 0, tokens: 0 };
    byTool[t].cost += Number(r.cost_usd) || 0; byTool[t].calls++; byTool[t].tokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
    if (r.user_email) {
      byUser[r.user_email] = byUser[r.user_email] || { cost: 0, calls: 0 };
      byUser[r.user_email].cost += Number(r.cost_usd) || 0; byUser[r.user_email].calls++;
    }
    const p = r.provider || 'unknown';
    byProvider[p] = byProvider[p] || { cost: 0, calls: 0 };
    byProvider[p].cost += Number(r.cost_usd) || 0; byProvider[p].calls++;
  }

  const round = (n: number) => Number(n.toFixed(4));
  const topUsers = Object.entries(byUser)
    .map(([email, v]) => ({ email, cost: round(v.cost), calls: v.calls, overBudget: v.cost >= USER_MONTHLY_LLM_BUDGET_USD }))
    .sort((a, b) => b.cost - a.cost).slice(0, 25);

  return NextResponse.json({
    success: true,
    windowDays: days,
    totalCostUsd: round(sum(rows, 'cost_usd')),
    totalCalls: rows.length,
    totalTokens: sum(rows, 'prompt_tokens') + sum(rows, 'completion_tokens'),
    monthlyBudgetPerUserUsd: USER_MONTHLY_LLM_BUDGET_USD,
    usersOverBudget: topUsers.filter(u => u.overBudget).length,
    byTool: Object.entries(byTool).map(([tool, v]) => ({ tool, cost: round(v.cost), calls: v.calls, tokens: v.tokens })).sort((a, b) => b.cost - a.cost),
    byProvider: Object.entries(byProvider).map(([provider, v]) => ({ provider, cost: round(v.cost), calls: v.calls })).sort((a, b) => b.cost - a.cost),
    topUsers,
  });
}
