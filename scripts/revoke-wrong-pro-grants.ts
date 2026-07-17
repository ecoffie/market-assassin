/**
 * Revoke the Pro monthly credits that were granted to the wrong audience.
 *
 *   npx tsx scripts/revoke-wrong-pro-grants.ts          # dry-run (default-safe)
 *   npx tsx scripts/revoke-wrong-pro-grants.ts --go     # execute
 *
 * ---------------------------------------------------------------------------
 * WHAT HAPPENED
 *
 * The grant cron's audience was supposed to be KV `briefings:<email>` holders —
 * the real paid/lifetime Pro gate, ~76 people. #201 ("grant Pro monthly credits
 * to KV briefings holders, not the beta cohort") landed at 2026-07-15 03:09:49
 * UTC to enforce exactly that.
 *
 * The cron fired at 03:10:27 — THIRTY-EIGHT SECONDS later, before the Vercel
 * build finished — and ran the OLD code:
 *
 *     2026-07-15 03:10 UTC   284 grants
 *     2026-07-15 03:11 UTC   404 grants   → 688 = the beta cohort
 *     2026-07-15 09:01 UTC    24 grants   → the KV holders, on the new build
 *     2026-07-16 09:00 UTC     1 grant
 *
 * #201's own commit message predicted the number: "the ~688-user beta cohort
 * (NOT paid Pro) — granting them would give away ~688k metered credits/month."
 * It gave away 713,000, because the fix missed the cron by 38 seconds.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES
 *
 * KEEP  = KV `briefings:<email>` holders (paid subscriber / lifetime). Scanned
 *         live from KV, never hardcoded — the KV gate IS the policy.
 * REVOKE = every other pro_monthly recipient.
 *
 * Per account it debits min(granted, balance) with reason 'admin_revoke', so:
 *   - a balance can NEVER go negative (mcp_debit_credits is
 *     `UPDATE ... WHERE balance >= amount`, atomic; it refuses rather than
 *     overdraws), and
 *   - signup grants and Stripe top-ups SURVIVE. We only claw back the
 *     pro_monthly amount, not everything the account holds. There is one real
 *     stripe_topup on record; it must not be touched.
 *
 * Idempotent in practice: once revoked, balance-granted <= 0, so a re-run
 * computes a 0 debit and no-ops.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { Client } from 'pg';
import { kv } from '@vercel/kv';

/**
 * debitCredits is imported DYNAMICALLY, after config() above has run.
 *
 * Not a style choice. src/lib/supabase/server-clients.ts captures its env at
 * MODULE LOAD:
 *     const PRIMARY_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
 * ESM imports are hoisted, so a static `import ... from '@/lib/mcp/credits'`
 * evaluates that module BEFORE dotenv runs → PRIMARY_URL is undefined → every
 * call dies with "supabaseUrl is required". The `!` hides it from tsc.
 *
 * This bit the first run of this script: 637/637 failed. Nothing was debited
 * (mcp_debit_credits is atomic and refused), so it failed safe — but any script
 * importing app libs that read env at module scope has the same landmine.
 */
async function loadDebit() {
  const { debitCredits } = await import('@/lib/mcp/credits');
  return debitCredits;
}

const GO = process.argv.includes('--go');

/** The KEEP list. Fails CLOSED: a KV error must revoke nobody, never everybody. */
async function keepList(): Promise<Set<string>> {
  const keep = new Set<string>();
  let cursor = 0;
  do {
    const [next, keys] = await kv.scan(cursor, { match: 'briefings:*', count: 500 });
    cursor = Number(next);
    for (const k of keys as string[]) {
      if (k.startsWith('briefings:rollout:')) continue;
      const e = k.slice('briefings:'.length).toLowerCase();
      if (e.includes('@')) keep.add(e);
    }
  } while (cursor !== 0);
  return keep;
}

const mask = (e: string) => e.replace(/(.{3}).*(@.*)/, '$1***$2');

async function main() {
  const keep = await keepList();
  if (keep.size === 0) {
    // A KV outage would otherwise look like "nobody is paid" → revoke everyone.
    console.error('✗ KV returned ZERO briefings holders. Refusing to run — that would revoke the paid cohort too.');
    process.exit(1);
  }
  console.log(`\n=== revoke wrong pro_monthly grants  (${GO ? 'EXECUTE' : 'DRY-RUN — no writes'}) ===\n`);
  console.log(`  KEEP (KV briefings = paid/lifetime): ${keep.size}`);

  const c = new Client({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30_000,
  });
  await c.connect();

  const { rows } = await c.query<{ user_email: string; granted: number; balance: number }>(`
    SELECT l.user_email,
           SUM(CASE WHEN l.reason='pro_monthly' THEN l.delta ELSE 0 END)::int AS granted,
           COALESCE(b.balance,0)::int AS balance
    FROM mcp_credit_ledger l
    LEFT JOIN mcp_credit_balance b ON b.user_email = l.user_email
    WHERE l.user_email IN (SELECT user_email FROM mcp_credit_ledger WHERE reason='pro_monthly')
    GROUP BY l.user_email, b.balance`);
  await c.end();

  const targets = rows
    .filter((r) => !keep.has(r.user_email.toLowerCase()))
    .map((r) => ({ ...r, remove: Math.max(0, Math.min(r.granted, r.balance)) }))
    .filter((r) => r.remove > 0);

  const total = targets.reduce((s, r) => s + r.remove, 0);
  console.log(`  pro_monthly recipients            : ${rows.length}`);
  console.log(`  REVOKE (not in KV)                : ${targets.length}`);
  console.log(`  credits to remove                 : ${total.toLocaleString()}`);
  console.log(`  floored at 0 (spent > grant)      : ${rows.filter((r) => !keep.has(r.user_email.toLowerCase()) && r.balance < r.granted).length}`);

  if (!GO) {
    console.log(`\n  Dry run. Nothing written. To execute:\n\n      npx tsx scripts/revoke-wrong-pro-grants.ts --go\n`);
    return;
  }

  const debitCredits = await loadDebit();

  // Prove the client is actually wired BEFORE touching 637 accounts: a 0-credit
  // debit is a documented no-op that always succeeds. If env is unloaded this
  // throws here, on nobody, instead of failing 637 times.
  await debitCredits(targets[0].user_email, 0, { reason: 'admin_revoke_preflight', toolName: 'preflight' });
  console.log(`  preflight: credits client is live ✓\n`);

  let done = 0, removed = 0;
  const failed: string[] = [];
  for (const t of targets) {
    try {
      const res = await debitCredits(t.user_email, t.remove, { reason: 'admin_revoke', toolName: 'admin_revoke' });
      if (!res.ok) {
        // Balance moved under us (raced with a tool call). Nothing was debited —
        // report it rather than pretend, and re-run to catch it.
        failed.push(`${t.user_email}: debit refused (balance moved)`);
        continue;
      }
      removed += t.remove;
      done++;
      if (done % 100 === 0) console.log(`    … ${done}/${targets.length}`);
    } catch (e) {
      failed.push(`${t.user_email}: ${(e as Error).message}`);
    }
  }

  console.log(`\n  ✓ revoked ${done}/${targets.length} accounts, ${removed.toLocaleString()} credits removed`);
  if (failed.length) {
    console.error(`\n  ✗ ${failed.length} FAILED (nothing debited for these):`);
    for (const f of failed.slice(0, 10)) console.error(`      ${mask(f.split(':')[0])}: ${f.split(': ')[1]}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}\n`);
  process.exit(1);
});
