/**
 * PR 4A acceptance — the payer resolver is IN the production call path, and with zero
 * pools every existing customer still takes the personal path unchanged.
 *
 * This is the "prove no regression" step. The wiring is only worth shipping if a
 * normal MCP call is provably identical to before — same debit, same ledger shape,
 * same paywall behaviour, no new refusals.
 *
 * Runs `runMeteredTool` itself (the real production entry point), not a reimplementation.
 *
 *   npx tsx scripts/verify-payer-wiring.mts
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
// Env before the credit/metering libs construct their clients.
const { runMeteredTool } = await import('../src/lib/mcp/metered');
const { resolvePayer } = await import('../src/lib/mcp/payer');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TEST_EMAIL = `wiretest+${Date.now()}@example.invalid`;

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`); }
};

async function cleanup() {
  await db.from('mcp_call_log').delete().eq('user_email', TEST_EMAIL);
  await db.from('mcp_credit_ledger').delete().eq('user_email', TEST_EMAIL);
  await db.from('mcp_credit_balance').delete().eq('user_email', TEST_EMAIL);
  await db.from('mcp_paywall_attempts').delete().eq('user_email', TEST_EMAIL);
}

async function main() {
  console.log('\nPR 4A acceptance — resolver wired, personal path unchanged\n');

  // Precondition that makes this whole PR safe: no pools exist, so nothing can take
  // the pool branch. If this ever fails, the "behaviour-neutral" claim is void.
  const { count: pools } = await db.from('mcp_credit_pool').select('*', { count: 'exact', head: true });
  check('PRECONDITION: production has zero pools', pools === 0, `found ${pools}`);

  await db.from('mcp_credit_balance').insert({ user_email: TEST_EMAIL, balance: 100 });

  // 1) An ordinary user resolves PERSONAL through the real resolver.
  const r = await resolvePayer(TEST_EMAIL);
  check('ordinary user resolves personal', r.kind === 'personal', `got ${r.kind}`);

  // 2) A real metered call through the production entry point.
  const ctx = { userEmail: TEST_EMAIL, apiKeyId: null } as Parameters<typeof runMeteredTool>[2];
  const out = await runMeteredTool('get_balance', {}, ctx);
  check('free tool still succeeds and bills 0', out.ok === true && out.creditsCharged === 0,
    `ok=${out.ok} charged=${out.creditsCharged}`);

  // 3) A PRICED call: debit must match the old behaviour exactly.
  const priced = await runMeteredTool('search_sam_opportunities', { keyword: 'test', limit: 1 }, ctx);
  // unranged-ok: .single() on mcp_credit_balance PK (user_email) — one row by construction.
  const { data: bal } = await db.from('mcp_credit_balance').select('balance').eq('user_email', TEST_EMAIL).single();
  const charged = Number(priced.creditsCharged ?? 0);
  const pricedErr = priced.ok === false ? priced.error : undefined;
  check('priced call succeeded', priced.ok === true, JSON.stringify(pricedErr ?? {}));
  check('debit matches old behaviour (balance = 100 - charged)',
    bal?.balance === 100 - charged, `charged=${charged} balance=${bal?.balance}`);
  check('no new refusal for an ordinary user',
    priced.ok === true && pricedErr?.code !== 'billing_account_unresolved');

  // 4) The ledger row must look exactly like a legacy personal row.
  const { data: row } = await db.from('mcp_credit_ledger')
    .select('user_email, actor_email, charged_pool_id, delta, reason')
    .eq('user_email', TEST_EMAIL).order('created_at', { ascending: false }).limit(1).maybeSingle();
  check('ledger charged_pool_id = NULL (personal path)', row ? row.charged_pool_id === null : charged === 0,
    JSON.stringify(row));
  check('ledger reason is tool_call', row ? row.reason === 'tool_call' : charged === 0);

  // 5) PAYWALL still works: drain the balance and confirm the existing refusal,
  //    NOT the new billing_account_unresolved.
  await db.from('mcp_credit_balance').update({ balance: 0 }).eq('user_email', TEST_EMAIL);
  const broke = await runMeteredTool('search_sam_opportunities', { keyword: 'test', limit: 1 }, ctx);
  const code = broke.ok === false ? broke.error?.code : undefined;
  check('empty balance still yields insufficient_credits (paywall intact)',
    broke.ok === false && code === 'insufficient_credits', `code=${code}`);
  const { count: attempts } = await db.from('mcp_paywall_attempts')
    .select('*', { count: 'exact', head: true }).eq('user_email', TEST_EMAIL);
  check('paywall attempt still recorded (resume behaviour intact)', (attempts ?? 0) >= 1, `attempts=${attempts}`);

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => { console.error('\n✗ harness error:', e instanceof Error ? e.message : e); fail++; })
  .finally(async () => {
    await cleanup();
    const { count } = await db.from('mcp_credit_pool').select('*', { count: 'exact', head: true });
    console.log(`cleanup done · pools: ${count}`);
    process.exit(fail === 0 ? 0 : 1);
  });
