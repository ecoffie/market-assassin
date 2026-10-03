/**
 * chatgpt-devmode-report.ts — READ-ONLY server-side evidence for a ChatGPT developer-mode
 * acceptance session (tasks/chatgpt-devmode-acceptance.md).
 *
 * ChatGPT shows the conversation; this shows what Mindy actually did: every call that
 * arrived on /chatgpt/mcp (mcp_call_log.channel = 'chatgpt', #1781), its server-side
 * latency and outcome, the credit ledger, and the commerce invariants (no paywall row,
 * no signup grant, no auto-recharge).
 *
 *   npx tsx scripts/chatgpt-devmode-report.ts --email <acct> --since <ISO> [--until <ISO>] [--json]
 *
 * Writes nothing.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const EMAIL = (arg('--email') || '').toLowerCase();
const SINCE = arg('--since');
const UNTIL = arg('--until') || new Date().toISOString();
const JSON_OUT = args.includes('--json');

const PAGE = 1000;
/** Page a list select with .range() so a large window is never silently capped at 1,000 rows. */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

(async () => {
  if (!EMAIL || !SINCE) {
    console.error('usage: --email <acct> --since <ISO> [--until <ISO>] [--json]');
    process.exit(2);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const all = await fetchAll((from, to) => sb.from('mcp_call_log')
    .select('created_at,tool_name,status,credits_charged,latency_ms,outcome,grounded,degraded,billing_outcome,error_code,channel')
    .eq('user_email', EMAIL).gte('created_at', SINCE).lte('created_at', UNTIL).order('created_at').range(from, to), 'mcp_call_log');
  const chatgpt = all.filter((r) => r.channel === 'chatgpt');
  const other = all.filter((r) => r.channel !== 'chatgpt');

  const ledgerRows = await fetchAll((from, to) => sb.from('mcp_credit_ledger').select('created_at,delta,reason,tool_name,channel,balance_after')
    .eq('user_email', EMAIL).gte('created_at', SINCE).lte('created_at', UNTIL).order('created_at').range(from, to), 'mcp_credit_ledger');
  const paywall = await sb.from('mcp_paywall_attempts').select('id', { count: 'exact', head: true })
    .eq('user_email', EMAIL).gte('created_at', SINCE).lte('created_at', UNTIL);
  if (paywall.error) throw new Error(`mcp_paywall_attempts: ${paywall.error.message}`);
  // unranged-ok: one row by primary key (user_email), maybeSingle
  const balance = await sb.from('mcp_credit_balance').select('balance,chatgpt_spend_since_recharge').eq('user_email', EMAIL).maybeSingle();
  if (balance.error) throw new Error(`mcp_credit_balance: ${balance.error.message}`);

  const byTool = new Map<string, typeof chatgpt>();
  for (const r of chatgpt) byTool.set(r.tool_name, [...(byTool.get(r.tool_name) ?? []), r]);
  const tools = [...byTool.entries()].sort().map(([tool, rows]) => {
    const lat = rows.map((r) => r.latency_ms).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    const outcomes: Record<string, number> = {};
    for (const r of rows) outcomes[r.outcome ?? 'null'] = (outcomes[r.outcome ?? 'null'] ?? 0) + 1;
    return {
      tool, calls: rows.length, latency_n: lat.length,
      p50_ms: pct(lat, 50), p90_ms: pct(lat, 90), max_ms: lat.length ? lat[lat.length - 1] : null,
      over_45s: lat.filter((v) => v > 45_000).length, over_60s: lat.filter((v) => v > 60_000).length,
      outcomes, credits: rows.reduce((s, r) => s + (r.credits_charged ?? 0), 0),
    };
  });

  const report = {
    email: EMAIL, window: { since: SINCE, until: UNTIL },
    chatgpt_calls: chatgpt.length,
    non_chatgpt_calls_in_window: other.length,
    tools,
    calls: chatgpt,
    ledger: {
      rows: ledgerRows,
      chatgpt_debits: ledgerRows.filter((r) => r.channel === 'chatgpt').reduce((s, r) => s + r.delta, 0),
      non_chatgpt_debits: ledgerRows.filter((r) => r.delta < 0 && r.channel !== 'chatgpt').reduce((s, r) => s + r.delta, 0),
      grants: ledgerRows.filter((r) => r.delta > 0),
    },
    invariants: {
      paywall_attempts: paywall.count,
      signup_grants: ledgerRows.filter((r) => r.reason === 'signup_grant').length,
      auto_recharge_grants: ledgerRows.filter((r) => r.reason === 'auto_recharge').length,
    },
    balance_now: balance.data,
  };

  if (JSON_OUT) { console.log(JSON.stringify(report, null, 1)); return; }
  console.log(`\nChatGPT dev-mode report — ${EMAIL}\n  window ${SINCE} → ${UNTIL}`);
  console.log(`  chatgpt calls: ${chatgpt.length}   non-chatgpt calls in window: ${other.length}\n`);
  console.log('  tool                          n   p50ms   p90ms   maxms  >45s >60s  outcomes');
  for (const t of tools) {
    console.log(`  ${t.tool.padEnd(28)} ${String(t.calls).padStart(3)} ${String(t.p50_ms ?? '-').padStart(7)} ${String(t.p90_ms ?? '-').padStart(7)} ${String(t.max_ms ?? '-').padStart(7)} ${String(t.over_45s).padStart(5)} ${String(t.over_60s).padStart(4)}  ${JSON.stringify(t.outcomes)}`);
  }
  console.log(`\n  ledger: chatgpt debits ${report.ledger.chatgpt_debits}, other debits ${report.ledger.non_chatgpt_debits}, grants ${report.ledger.grants.length}`);
  console.log(`  invariants: paywall_attempts=${report.invariants.paywall_attempts} signup_grants=${report.invariants.signup_grants} auto_recharge=${report.invariants.auto_recharge_grants}`);
  console.log(`  balance now: ${JSON.stringify(report.balance_now)}\n`);
})().catch((e) => { console.error('REPORT FAILED:', e.message); process.exit(1); });
