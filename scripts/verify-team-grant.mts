/**
 * PR 4B acceptance — Team funding seam, proven on DISPOSABLE fixtures.
 *
 * Creates its own org + subscription + pool, exercises the grant, and removes every
 * row it made. It NEVER touches the real Team customer: that provisioning is a
 * separate, explicitly-approved step.
 *
 *   npx tsx scripts/verify-team-grant.mts
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
const { grantTeamPool, teamGrantKey, TEAM_GRANT_REASON } = await import('../src/lib/mcp/team-grant');
const { TEAM_MONTHLY_CREDITS } = await import('../src/lib/mcp/packages');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const STAMP = Date.now();
const SUB_ID = `sub_TEAMTEST_${STAMP}`;
const CUS_ID = `cus_TEAMTEST_${STAMP}`;
const MEMBER = `teamgrant+${STAMP}@example.invalid`;
const MONTH = '2099-01'; // far-future month: cannot collide with a real grant key

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`); }
};

const made: { org?: string; pool?: string } = {};

async function cleanup() {
  await db.from('mcp_pool_grants').delete().like('grant_key', `team:${SUB_ID}:%`);
  await db.from('mcp_credit_ledger').delete().eq('user_email', MEMBER);
  await db.from('mcp_credit_ledger').delete().like('actor_email', 'system:team-monthly').eq('charged_pool_id', made.pool ?? '00000000-0000-0000-0000-000000000000');
  if (made.pool) await db.from('mcp_credit_ledger').delete().eq('charged_pool_id', made.pool);
  await db.from('mcp_credit_balance').delete().eq('user_email', MEMBER);
  if (made.pool) await db.from('mcp_credit_pool').delete().eq('pool_id', made.pool);
  if (made.org) {
    await db.from('org_members').delete().eq('org_id', made.org);
    await db.from('organizations').delete().eq('id', made.org);
  }
  await db.from('stripe_subscriptions').delete().eq('id', SUB_ID);
  await db.from('stripe_customers').delete().eq('id', CUS_ID);
}

async function main() {
  console.log('\nPR 4B acceptance — Team pool funding (disposable fixtures)\n');
  check(`Team allowance is still ${TEAM_MONTHLY_CREDITS}`, TEAM_MONTHLY_CREDITS === 1000,
    `got ${TEAM_MONTHLY_CREDITS}`);

  // Fixtures
  await db.from('stripe_customers').insert({ id: CUS_ID, email: MEMBER, created_at: new Date().toISOString() });
  await db.from('stripe_subscriptions').insert({
    id: SUB_ID, customer_id: CUS_ID, status: 'active', plan_amount: 49900,
    plan_interval: 'month', created_at: new Date().toISOString(),
  });
  // The member keeps a PERSONAL balance throughout — it must never be touched.
  await db.from('mcp_credit_balance').insert({ user_email: MEMBER, balance: 777 });

  // ── 1. No org linked → named skip, not a silent no-op ─────────────────────
  let r = await grantTeamPool(SUB_ID, 49900, MONTH);
  check('no linked org → skipped:no_org_linked', r.applied === false && r.skipped === 'no_org_linked',
    JSON.stringify(r));

  // ── 2. Org linked but no pool → named skip (a provisioning gap, visible) ──
  const { data: org, error: oe } = await db.from('organizations').insert({
    name: 'Team Grant Test Org', slug: `tg-test-${STAMP}`,
    stripe_subscription_id: SUB_ID, stripe_customer_id: CUS_ID, billing_email: MEMBER,
  }).select().single();
  if (oe) throw new Error(`org insert: ${oe.message}`);
  made.org = org.id;
  await db.from('org_members').insert({ org_id: org.id, user_email: MEMBER, role: 'org_admin', status: 'active' });

  r = await grantTeamPool(SUB_ID, 49900, MONTH);
  check('org linked, no pool → skipped:no_pool (gap is visible)',
    r.applied === false && r.skipped === 'no_pool', JSON.stringify(r));

  // ── 3. Pool exists → funds it ─────────────────────────────────────────────
  const { data: pool } = await db.from('mcp_credit_pool').insert({ org_id: org.id, balance: 0 }).select().single();
  made.pool = pool!.pool_id;

  r = await grantTeamPool(SUB_ID, 49900, MONTH);
  check('funds the pool with TEAM_MONTHLY_CREDITS',
    r.applied === true && r.newBalance === TEAM_MONTHLY_CREDITS, JSON.stringify(r));

  // ── 4. Idempotent: a second run grants nothing ────────────────────────────
  const again = await grantTeamPool(SUB_ID, 49900, MONTH);
  // unranged-ok: .single() on mcp_credit_pool PK (pool_id) — one row by construction.
  const { data: afterTwice } = await db.from('mcp_credit_pool').select('balance').eq('pool_id', made.pool!).single();
  check('second run is an idempotent no-op',
    again.applied === false && again.skipped === 'already_granted' && afterTwice?.balance === TEAM_MONTHLY_CREDITS,
    `applied=${again.applied} balance=${afterTwice?.balance}`);

  // ── 5. CONCURRENCY: parallel cron runs cannot double-grant ────────────────
  const nextMonth = '2099-02';
  const races = await Promise.all(Array.from({ length: 8 }, () => grantTeamPool(SUB_ID, 49900, nextMonth)));
  const appliedCount = races.filter((x) => x.applied).length;
  // unranged-ok: .single() on mcp_credit_pool PK (pool_id) — one row by construction.
  const { data: afterRace } = await db.from('mcp_credit_pool').select('balance').eq('pool_id', made.pool!).single();
  check('8 concurrent grants → exactly ONE applies',
    appliedCount === 1 && afterRace?.balance === TEAM_MONTHLY_CREDITS * 2,
    `applied=${appliedCount} balance=${afterRace?.balance}`);

  // ── 6. Ledger provenance ──────────────────────────────────────────────────
  const { data: led } = await db.from('mcp_credit_ledger')
    .select('reason, delta, charged_pool_id, actor_email, balance_after')
    .eq('charged_pool_id', made.pool!).order('created_at', { ascending: false }).limit(1).maybeSingle();
  check('ledger reason is team_monthly', led?.reason === TEAM_GRANT_REASON, JSON.stringify(led));
  check('ledger carries charged_pool_id + actor_email',
    led?.charged_pool_id === made.pool && Boolean(led?.actor_email), JSON.stringify(led));
  check('ledger delta equals the allowance', led?.delta === TEAM_MONTHLY_CREDITS);

  // ── 7. PERSONAL BALANCE UNTOUCHED — no migration, no fallback ─────────────
  // unranged-ok: .single() on mcp_credit_balance PK (user_email) — one row by construction.
  const { data: personal } = await db.from('mcp_credit_balance').select('balance').eq('user_email', MEMBER).single();
  check('member personal balance UNTOUCHED by Team funding', personal?.balance === 777,
    `expected 777, got ${personal?.balance}`);

  // ── 8. Key shape + no email-keyed logic ───────────────────────────────────
  check('idempotency key is team:<subscription_id>:<YYYY-MM>',
    teamGrantKey(SUB_ID, MONTH) === `team:${SUB_ID}:${MONTH}`, teamGrantKey(SUB_ID, MONTH));
  const src = (await import('node:fs')).readFileSync('src/lib/mcp/team-grant.ts', 'utf8');
  check('grant path never resolves an org by email',
    !/\.eq\('billing_email'|\.eq\('user_email'/.test(src));

  // ── 9. A Pro-priced subscription must not fund a Team pool ────────────────
  const proAttempt = await grantTeamPool(SUB_ID, 14900, '2099-03');
  check('Pro-priced subscription → skipped:not_team_price',
    proAttempt.applied === false && proAttempt.skipped === 'not_team_price', JSON.stringify(proAttempt));

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => { console.error('\n✗ harness error:', e instanceof Error ? e.message : e); fail++; })
  .finally(async () => {
    await cleanup();
    const { count } = await db.from('mcp_credit_pool').select('*', { count: 'exact', head: true });
    const { count: grants } = await db.from('mcp_pool_grants').select('*', { count: 'exact', head: true });
    console.log(`cleanup done · pools: ${count} · pool grants: ${grants}`);
    process.exit(fail === 0 ? 0 : 1);
  });
