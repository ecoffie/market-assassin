/**
 * ONE-TIME transfer of Team-derived personal credits into the org pool.
 *
 * 4B-3. Dry-run by default; `--go` executes. NOTHING is written without --go, and the
 * script refuses to run at all unless the org + pool already exist (4B-2).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The live Team billing contact holds 2,000 personal credits whose ledger provenance
 * shows both grants came from TEAM entitlement:
 *   2026-08-03  app_tier_team  +1,000   (Team subscription creation)
 *   2026-09-01  pro_monthly    +1,000   (LABELLED pro, but the TEAM amount — the
 *                                        email-dedupe defect fixed in 4B-1)
 * Once `resolvePayer` routes their calls to the org pool, those 2,000 credits become
 * unreachable: the no-fallback rule means a pool user cannot spend a personal balance.
 * Leaving them there strands paid capacity. Moving them makes the money follow the
 * entitlement it was issued for.
 *
 * ── CONSERVATION IS THE POINT ───────────────────────────────────────────────
 * This creates and destroys NOTHING. It is a paired debit/credit sharing one transfer
 * id, so the two halves are auditable as a single migration and the aggregate delta
 * across both ledgers is exactly 0. If the two halves ever disagree, the run aborts
 * rather than leaving credits invented or vaporised.
 *
 * ⚠️ ORIGINAL LEDGER ROWS ARE NEVER TOUCHED. The August and September grants stay
 * exactly as they are — history is append-only. The transfer is two NEW rows.
 *
 * ⚠️ NO SEPTEMBER TEAM GRANT AFTER THIS. The transferred 2,000 already contains
 * August's and September's Team entitlement. Funding the pool again for 2026-09 would
 * pay September twice. This script therefore CLAIMS the September team grant key as
 * part of the transfer, so the monthly grant path sees it as already satisfied.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
const { teamGrantKey } = await import('../src/lib/mcp/team-grant');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const GO = process.argv.includes('--go');

const TRANSFER_ID = 'team_capacity_migration_2026_09';
const SOURCE_REASONS = ['app_tier_team', 'pro_monthly']; // the two rows that justify it
const MONTHS_COVERED = ['2026-08', '2026-09'];

const money = (n: number) => n.toLocaleString();

async function main() {
  // 1. The live Team subscription — the only resolution path.
  // unranged-ok: .maybeSingle() — there is exactly one active Team subscription, and
  // the script aborts if that is ever untrue rather than silently taking a first row.
  const { data: sub, error: sErr } = await db
    .from('stripe_subscriptions')
    // unranged-ok: exactly one active Team subscription; aborts if that is untrue.
    .select('id, customer_id, plan_amount, status')
    .in('plan_amount', [49900, 499000])
    .eq('status', 'active')
    .maybeSingle();
  if (sErr) throw new Error(`subscription lookup: ${sErr.message}`);
  if (!sub) throw new Error('no active Team subscription found — nothing to migrate');

  // unranged-ok: .maybeSingle() on stripe_customers PK (id) — one row by construction.
  const { data: cust } = await db.from('stripe_customers').select('email').eq('id', sub.customer_id).maybeSingle();
  const billingEmail = (cust?.email as string | undefined)?.toLowerCase();
  if (!billingEmail) throw new Error('billing email not resolvable');

  // 2. Org + pool must already exist (4B-2). This script never provisions.
  // unranged-ok: .maybeSingle() on organizations.stripe_subscription_id, which is UNIQUE.
  const { data: org } = await db.from('organizations')
    // unranged-ok: stripe_subscription_id is UNIQUE — at most one row.
    .select('id, name').eq('stripe_subscription_id', sub.id).maybeSingle();
  const { data: pool } = org
    // unranged-ok: .maybeSingle() on mcp_credit_pool.org_id, which is UNIQUE (one pool per org).
    ? await db.from('mcp_credit_pool').select('pool_id, balance').eq('org_id', org.id).maybeSingle()
    : { data: null };

  // 3. Source rows that JUSTIFY the amount — derived, never hardcoded.
  const { data: rows, error: lErr } = await db
    .from('mcp_credit_ledger')
    .select('id, delta, reason, created_at')
    .eq('user_email', billingEmail)
    .in('reason', SOURCE_REASONS)
    .gt('delta', 0)
    .order('created_at')
    .range(0, 999);
  if (lErr) throw new Error(`ledger read: ${lErr.message}`);
  const justified = (rows ?? []).reduce((a, r) => a + Number(r.delta), 0);

  // unranged-ok: .maybeSingle() on mcp_credit_balance PK (user_email) — one row by construction.
  const { data: bal } = await db.from('mcp_credit_balance')
    // unranged-ok: user_email is the PK — one row by construction.
    .select('balance').eq('user_email', billingEmail).maybeSingle();
  const personalBefore = Number(bal?.balance ?? 0);

  // The transfer is the LESSER of what provenance justifies and what actually remains.
  // If they had spent some, we must not move more than exists — the balance CHECK
  // would reject it, and inventing the difference would be fabrication.
  const amount = Math.min(justified, personalBefore);

  console.log(`\n${GO ? 'EXECUTE' : 'DRY RUN'} — Team capacity migration\n`);
  console.log(`  subscription        : ${sub.id} ($${(Number(sub.plan_amount) / 100).toFixed(0)}/mo, ${sub.status})`);
  console.log(`  billing contact     : ${billingEmail.slice(0, 2)}***@${billingEmail.split('@')[1]}`);
  console.log(`  organization        : ${org ? `${org.name} (${org.id})` : '✗ NOT PROVISIONED'}`);
  console.log(`  pool                : ${pool ? `${pool.pool_id} · balance ${money(Number(pool.balance))}` : '✗ NOT PROVISIONED'}`);
  console.log(`\n  personal balance BEFORE : ${money(personalBefore)}`);
  console.log('  source rows justifying the transfer:');
  for (const r of rows ?? []) {
    console.log(`    ${String(r.created_at).slice(0, 10)}  ${String(r.reason).padEnd(14)} +${money(Number(r.delta))}`);
  }
  console.log(`  justified by provenance : ${money(justified)}`);
  console.log(`  TRANSFER AMOUNT         : ${money(amount)}`);
  console.log(`\n  pool balance BEFORE     : ${money(Number(pool?.balance ?? 0))}`);
  console.log(`  personal AFTER          : ${money(personalBefore - amount)}`);
  console.log(`  pool AFTER              : ${money(Number(pool?.balance ?? 0) + amount)}`);
  console.log(`  AGGREGATE DELTA         : ${(-amount) + amount}  (must be 0)`);
  console.log(`\n  transfer id             : ${TRANSFER_ID}`);
  console.log(`  months covered          : ${MONTHS_COVERED.join(', ')}`);
  console.log(`  september team key      : ${teamGrantKey(sub.id, '2026-09')}`);
  console.log('    ↳ claimed by this transfer, so the monthly grant will NOT fund September again.');

  if (!org || !pool) {
    console.log('\n  ⛔ BLOCKED: organization and pool must be provisioned first (4B-2). No writes.\n');
    process.exit(2);
  }
  if (amount <= 0) {
    console.log('\n  Nothing to transfer.\n');
    return;
  }
  if (personalBefore < amount) {
    throw new Error(`refusing: personal balance ${personalBefore} < transfer ${amount}`);
  }

  if (!GO) {
    console.log('\n  No writes. Re-run with --go to execute.\n');
    return;
  }

  // EXECUTE — paired, idempotent, conserving.
  const { data, error } = await db.rpc('mcp_transfer_personal_to_pool', {
    p_transfer_id: TRANSFER_ID,
    p_user: billingEmail,
    p_pool_id: pool.pool_id,
    p_amount: amount,
    p_team_grant_key: teamGrantKey(sub.id, '2026-09'),
  });
  if (error) throw new Error(`transfer failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  console.log(`\n  applied: ${row?.applied}  personal→${row?.personal_balance}  pool→${row?.pool_balance}\n`);
}

main().catch((e) => {
  console.error(`\n✗ transfer aborted: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
