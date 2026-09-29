/**
 * One-time migration: existing Team subscriber(s) → pooled team credits.
 * PRD: tasks/PRD-pooled-team-credits.md (decision 5).
 *
 *   npx tsx scripts/migrate-team-credits-to-pool.ts            # DRY RUN (default): audit only, no writes
 *   npx tsx scripts/migrate-team-credits-to-pool.ts --email x   # limit to one subscriber
 *   npx tsx scripts/migrate-team-credits-to-pool.ts --go        # EXECUTE (needs Eric's approval first)
 *   ... --email x --allow-pro-overlap                            # proceed for ONE subscriber who also holds Pro,
 *                                                                #   after a human verified the grants (recorded in audit)
 *
 * For each ACTIVE Team subscription (Stripe is the source of truth):
 *   1. Replays the subscriber's ledger to find their REMAINING TEAM-ENTITLEMENT credits
 *      (src/lib/mcp/team-pool-migration.ts — FIFO, allowance-first, purchases excluded),
 *      capped by the real allowance (balance − purchased_balance).
 *   2. --go only: provisions the pooled org (team defaults) + owner membership + pool,
 *      moves exactly that amount with mcp_transfer_personal_to_pool (idempotent on
 *      `pool_migration:<subscription>`; purchased credits cannot move — the SQL refuses),
 *      and records this month's allowance as ALREADY PAID to the pool, so the month's
 *      replenishment cannot grant it a second time.
 *
 * Unrelated personal credits (signup, referral, admin, comp) and purchased credits stay
 * personal. Every step is written to mcp_pool_credit_grants.details as the audit record.
 *
 * Refuses (skips, reported) any subscriber whose Team credits can't be told apart from a
 * Pro allowance — e.g. they also hold an active Pro subscription — rather than guess.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const TEAM_AMOUNTS = new Set([49900, 499000]);
const PRO_AMOUNTS = new Set([14900, 149000, 4900]);

async function main() {
  const args = process.argv.slice(2);
  const go = args.includes('--go');
  const allowProOverlap = args.includes('--allow-pro-overlap');
  if (allowProOverlap && !args.includes('--email')) throw new Error('--allow-pro-overlap requires --email (one verified subscriber at a time)');
  const onlyEmail = (() => {
    const i = args.indexOf('--email');
    return i >= 0 ? (args[i + 1] || '').toLowerCase().trim() : '';
  })();

  const Stripe = (await import('stripe')).default;
  const { createClient } = await import('@supabase/supabase-js');
  const { computeTeamEntitlement, planTeamTransfer } = await import('../src/lib/mcp/team-pool-migration');
  const { provisionPooledOrg, poolReplenishKey, monthKey, findPooledOrgBySubscription } = await import('../src/lib/mcp/team-pools');

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error('STRIPE_SECRET_KEY missing');
  const stripe = new Stripe(stripeKey);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Every active subscription, grouped by customer email, so a Team buyer who ALSO holds
  // Pro is detected (their pro:<email>:<month> grants are then ambiguous).
  const byEmail = new Map<string, { subId: string; amount: number; start: number; customerId: string | null }[]>();
  for await (const s of stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.customer'] })) {
    const cust = s.customer;
    const email = (cust && typeof cust !== 'string' && !cust.deleted ? cust.email : null)?.toLowerCase().trim();
    if (!email) continue;
    const list = byEmail.get(email) ?? [];
    list.push({
      subId: s.id,
      amount: s.items.data[0]?.price?.unit_amount ?? 0,
      start: s.start_date,
      customerId: typeof cust === 'string' ? cust : cust?.id ?? null,
    });
    byEmail.set(email, list);
  }

  const month = monthKey();
  const results: unknown[] = [];

  for (const [email, subs] of byEmail) {
    if (onlyEmail && email !== onlyEmail) continue;
    const team = subs.find((s) => TEAM_AMOUNTS.has(s.amount));
    if (!team) continue;
    const hasPro = subs.some((s) => PRO_AMOUNTS.has(s.amount));
    const teamStartIso = new Date(team.start * 1000).toISOString();

    const { data: bal, error: bErr } = await db
      .from('mcp_credit_balance')
      .select('balance, purchased_balance') // unranged-ok: one row, keyed by user_email (PK)
      .eq('user_email', email)
      .maybeSingle();
    if (bErr) throw new Error(`balance read failed for ${email}: ${bErr.message}`);

    const ledger: { created_at: string; delta: number; reason: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('mcp_credit_ledger')
        .select('created_at, delta, reason')
        .eq('user_email', email)
        .order('created_at', { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`ledger read failed for ${email}: ${error.message}`);
      ledger.push(...((data ?? []) as typeof ledger));
      if (!data || data.length < 1000) break;
    }

    const isTeamGrant = (e: { reason: string; created_at: string }) =>
      e.reason === 'app_tier_team' || (e.reason === 'pro_monthly' && e.created_at >= teamStartIso);
    const report = computeTeamEntitlement(ledger, isTeamGrant);
    const balance = Number(bal?.balance ?? 0);
    const purchased = Number(bal?.purchased_balance ?? 0);
    const plan = planTeamTransfer(report, balance, purchased);
    const teamGrantedThisMonth = ledger
      .filter((e) => e.delta > 0 && isTeamGrant(e) && e.created_at.slice(0, 7) === month)
      .reduce((s, e) => s + e.delta, 0);

    const row: Record<string, unknown> = {
      email, subscriptionId: team.subId, teamStart: teamStartIso,
      balance, purchased, actualAllowance: plan.actualAllowance,
      replay: report, replayMismatch: plan.replayMismatch,
      transferAmount: plan.amount, teamGrantedThisMonth, month,
      action: 'dry-run',
    };

    if (hasPro && !allowProOverlap) {
      row.action = 'SKIPPED: also holds an active Pro subscription — Team credits are not separable; resolve manually';
      results.push(row);
      continue;
    }
    if (!bal) {
      row.action = 'SKIPPED: no personal balance row';
      results.push(row);
      continue;
    }

    if (go) {
      const prov = await provisionPooledOrg({
        subscriptionId: team.subId, customerId: team.customerId, ownerEmail: email, planKey: 'team',
      });
      row.provision = prov;
      if (plan.amount > 0) {
        const { data, error } = await db.rpc('mcp_transfer_personal_to_pool', {
          p_key: `pool_migration:${team.subId}`,
          p_user: email,
          p_pool_id: prov.poolId,
          p_amount: plan.amount,
          p_details: {
            rule: 'FIFO allowance-first replay; Team grants = app_tier_team + pro_monthly since team start; capped by balance - purchased_balance',
            proOverlap: hasPro ? 'subscriber also holds Pro; grants verified by a human as Team before running (--allow-pro-overlap)' : null,
            replay: report, balance, purchased, teamStart: teamStartIso, migratedAt: new Date().toISOString(),
          },
        });
        if (error) throw new Error(`transfer failed for ${email}: ${error.message}`);
        row.transfer = Array.isArray(data) ? data[0] : data;
      }
      // This month's allowance was already paid (personally, now moved). Claim the
      // month's replenishment at the configured ceiling so it is not granted again.
      const org = await findPooledOrgBySubscription(team.subId);
      if (org && teamGrantedThisMonth > 0) {
        const claimKey = `${poolReplenishKey(org.orgId, month)}:c${org.monthlyCredits}`;
        const { error } = await db
          .from('mcp_pool_credit_grants')
          .upsert(
            {
              idempotency_key: claimKey, pool_id: org.poolId,
              credits: Math.min(teamGrantedThisMonth, org.monthlyCredits),
              reason: 'pool_monthly_migrated', source_email: email,
              details: { note: 'allowance for this month was granted personally before pooling and moved by the migration' },
            },
            { onConflict: 'idempotency_key', ignoreDuplicates: true },
          );
        if (error) throw new Error(`month claim failed for ${email}: ${error.message}`);
        row.monthClaimed = claimKey;
      }
      row.action = 'EXECUTED';
    }
    results.push(row);
  }

  console.log(JSON.stringify({ mode: go ? 'EXECUTE' : 'DRY-RUN', month, subscribers: results.length, results }, null, 2));
  if (!go) console.error('\nDry run only. Nothing was written. Re-run with --go after approval.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
