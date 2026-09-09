/**
 * PR 3 acceptance — pool-aware debit, proven against the REAL database.
 *
 * These are the eight behaviours the payer seam must have. They are asserted by
 * EXERCISING the code path (resolve → debit → read the ledger back), not by reading
 * the SQL and agreeing with it. A mock would prove the test author's model of
 * Postgres, and the property that matters most here — two seats cannot overspend one
 * pool — is a property of Postgres, not of this code.
 *
 * SELF-CONTAINED AND SELF-CLEANING: creates a disposable org + pool + membership,
 * exercises them, then removes every row it made. It never touches a real customer,
 * a real pool, or an existing balance. Run it any time; it is read-only with respect
 * to production data.
 *
 *   npx tsx scripts/verify-pool-debit.mts
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
// Env must load before the credit libs construct their clients (see the
// pro-supplement script for the full explanation of this ordering trap).
const { resolvePayer, debitResolvedPayer } = await import('../src/lib/mcp/payer');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const TEST_EMAIL = `pooltest+${Date.now()}@example.invalid`;
const TEST_EMAIL_2 = `pooltest2+${Date.now()}@example.invalid`;
const SUB_ID = `sub_TEST_${Date.now()}`;
const CUS_ID = `cus_TEST_${Date.now()}`;

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const made: { orgs: string[]; pools: string[]; subs: string[]; custs: string[] } =
  { orgs: [], pools: [], subs: [], custs: [] };

async function cleanup() {
  await db.from('mcp_credit_ledger').delete().in('user_email', [TEST_EMAIL, TEST_EMAIL_2]);
  await db.from('mcp_credit_balance').delete().in('user_email', [TEST_EMAIL, TEST_EMAIL_2]);
  for (const p of made.pools) await db.from('mcp_credit_pool').delete().eq('pool_id', p);
  for (const o of made.orgs) {
    await db.from('org_members').delete().eq('org_id', o);
    await db.from('organizations').delete().eq('id', o);
  }
  for (const s of made.subs) await db.from('stripe_subscriptions').delete().eq('id', s);
  for (const c of made.custs) await db.from('stripe_customers').delete().eq('id', c);
}

async function makeOrg(name: string, subId: string, custId: string) {
  const { data: c } = await db.from('stripe_customers')
    .insert({ id: custId, email: TEST_EMAIL, created_at: new Date().toISOString() }).select().single();
  if (c) made.custs.push(custId);
  const { data: s } = await db.from('stripe_subscriptions')
    .insert({ id: subId, customer_id: custId, status: 'active', plan_amount: 49900,
              plan_interval: 'month', created_at: new Date().toISOString() }).select().single();
  if (s) made.subs.push(subId);
  const { data: o, error: oe } = await db.from('organizations')
    .insert({ name, slug: `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              stripe_subscription_id: subId, stripe_customer_id: custId, billing_email: TEST_EMAIL })
    .select().single();
  if (oe) throw new Error(`org insert: ${oe.message}`);
  made.orgs.push(o.id);
  return o.id as string;
}

async function main() {
  console.log('\nPR 3 acceptance — pool-aware debit\n');

  // ── 1. No org/pool → personal path behaves exactly as today ────────────────
  await db.from('mcp_credit_balance').insert({ user_email: TEST_EMAIL, balance: 100 });
  let r = await resolvePayer(TEST_EMAIL);
  check('no org → resolves personal', r.kind === 'personal', `got ${r.kind}`);
  let d = await debitResolvedPayer(TEST_EMAIL, 10, { reason: 'tool_call', toolName: 'test' }, r);
  check('personal debit succeeds', d.ok && d.payer === 'personal' && d.newBalance === 90,
    `ok=${d.ok} payer=${d.payer} bal=${d.newBalance}`);
  const { data: legacyRow } = await db.from('mcp_credit_ledger')
    .select('user_email, charged_pool_id, actor_email, delta')
    .eq('user_email', TEST_EMAIL).order('created_at', { ascending: false }).limit(1).single();
  check('legacy personal ledger semantics intact (charged_pool_id NULL)',
    legacyRow?.charged_pool_id === null && legacyRow?.delta === -10);

  // ── 2. Exactly one eligible org with a funded pool → pool pays ─────────────
  const orgA = await makeOrg('Test Org A', SUB_ID, CUS_ID);
  await db.from('org_members').insert({ org_id: orgA, user_email: TEST_EMAIL, role: 'org_admin', status: 'active' });
  const { data: pool } = await db.from('mcp_credit_pool')
    .insert({ org_id: orgA, balance: 500 }).select().single();
  made.pools.push(pool!.pool_id);

  r = await resolvePayer(TEST_EMAIL);
  check('one eligible org → resolves pool', r.kind === 'pool' && r.poolId === pool!.pool_id, `got ${r.kind}`);

  const personalBefore = 90;
  d = await debitResolvedPayer(TEST_EMAIL, 50, { reason: 'tool_call', toolName: 'test' }, r);
  check('org debit hits the POOL, not personal', d.ok && d.payer === 'pool' && d.newBalance === 450,
    `ok=${d.ok} payer=${d.payer} bal=${d.newBalance}`);

  // unranged-ok: .single() on mcp_credit_balance PK (user_email) — one row by construction.
  const { data: pb } = await db.from('mcp_credit_balance').select('balance').eq('user_email', TEST_EMAIL).single();
  check('personal balance UNTOUCHED during org debit', pb?.balance === personalBefore,
    `expected ${personalBefore}, got ${pb?.balance}`);

  const { data: poolRow } = await db.from('mcp_credit_ledger')
    .select('actor_email, charged_pool_id, delta')
    .eq('charged_pool_id', pool!.pool_id).order('created_at', { ascending: false }).limit(1).single();
  check('ledger records actor_email AND charged_pool_id',
    poolRow?.actor_email === TEST_EMAIL && poolRow?.charged_pool_id === pool!.pool_id && poolRow?.delta === -50,
    JSON.stringify(poolRow));

  // ── 3. Concurrency — two members cannot overspend one pool ────────────────
  await db.from('mcp_credit_pool').update({ balance: 100 }).eq('pool_id', pool!.pool_id);
  await db.from('org_members').insert({ org_id: orgA, user_email: TEST_EMAIL_2, role: 'coach', status: 'active' });
  const rA = await resolvePayer(TEST_EMAIL);
  const rB = await resolvePayer(TEST_EMAIL_2);
  // 10 concurrent calls of 20 against a 100 pool: exactly 5 may win.
  const attempts = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      debitResolvedPayer(i % 2 ? TEST_EMAIL_2 : TEST_EMAIL, 20,
        { reason: 'tool_call', toolName: 'concurrent' }, i % 2 ? rB : rA)
        .then((x) => x.ok).catch(() => false)),
  );
  const won = attempts.filter(Boolean).length;
  // unranged-ok: .single() on mcp_credit_pool PK (pool_id) — one row by construction.
  const { data: afterPool } = await db.from('mcp_credit_pool').select('balance').eq('pool_id', pool!.pool_id).single();
  check('concurrent seats cannot overspend the pool', won === 5 && afterPool?.balance === 0,
    `won=${won} (expected 5), balance=${afterPool?.balance} (expected 0)`);

  // ── 4. Insufficient pool does NOT fall back to personal ───────────────────
  // unranged-ok: .single() on mcp_credit_balance PK (user_email) — one row by construction.
  const { data: pbBefore } = await db.from('mcp_credit_balance').select('balance').eq('user_email', TEST_EMAIL).single();
  d = await debitResolvedPayer(TEST_EMAIL, 25, { reason: 'tool_call', toolName: 'test' }, rA);
  // unranged-ok: .single() on mcp_credit_balance PK (user_email) — one row by construction.
  const { data: pbAfter } = await db.from('mcp_credit_balance').select('balance').eq('user_email', TEST_EMAIL).single();
  check('insufficient pool → refused, NO personal fallback',
    d.ok === false && pbAfter?.balance === pbBefore?.balance,
    `ok=${d.ok} personal ${pbBefore?.balance}→${pbAfter?.balance}`);

  // ── 5. Multiple eligible orgs → selection required, never first-row-wins ──
  const orgB = await makeOrg('Test Org B', `${SUB_ID}_B`, `${CUS_ID}_B`);
  await db.from('org_members').insert({ org_id: orgB, user_email: TEST_EMAIL, role: 'org_admin', status: 'active' });
  const { data: poolB } = await db.from('mcp_credit_pool').insert({ org_id: orgB, balance: 900 }).select().single();
  made.pools.push(poolB!.pool_id);

  r = await resolvePayer(TEST_EMAIL);
  check('two eligible orgs → selection_required', r.kind === 'selection_required', `got ${r.kind}`);
  check('selection_required lists both candidates', (r.candidates?.length ?? 0) === 2);
  let threw = false;
  try { await debitResolvedPayer(TEST_EMAIL, 10, { reason: 'tool_call', toolName: 'test' }, r); }
  catch (e) { threw = (e as Error).message === 'organization_selection_required'; }
  check('debit REFUSES on ambiguity (never picks first row)', threw);
  // unranged-ok: .single() on mcp_credit_pool PK (pool_id) — one row by construction.
  const { data: pbAmb } = await db.from('mcp_credit_pool').select('balance').eq('pool_id', poolB!.pool_id).single();
  check('no pool charged during ambiguity', pbAmb?.balance === 900, `got ${pbAmb?.balance}`);

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => { console.error('\n✗ harness error:', e instanceof Error ? e.message : e); fail++; })
  .finally(async () => {
    await cleanup();
    const { count } = await db.from('mcp_credit_pool').select('*', { count: 'exact', head: true });
    console.log(`cleanup done · mcp_credit_pool rows remaining: ${count}`);
    process.exit(fail === 0 ? 0 : 1);
  });
