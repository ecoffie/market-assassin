/**
 * Entitlement mismatch audit — who paid but has the wrong access flags?
 *
 * READ-ONLY. Prints a repair population; writes nothing. `--json` for machine output.
 *
 * ── THE DEFECT THIS FINDS ────────────────────────────────────────────────────
 * `updateAccessFlags()` writes with `.update()` keyed on email. An UPDATE against a
 * profile that does not exist yet matches ZERO rows, returns NO error, and the webhook
 * treats it as success. A customer who pays BEFORE signing up therefore lands with
 * their flags silently unwritten.
 *
 * Measured reproduction (2026-08-03): Quintin's Team webhook fired at 12:20:20; his
 * `user_profiles` row was created at 14:00:53 — 1h40m later. `access_team` was never
 * written. `reconcileEntitlementsFromPurchases()` (shipped 2026-08-16, commit 1bc749c3)
 * closes this going forward by replaying purchases at profile-creation time, so this
 * audit is about the HISTORICAL population created before that fix, plus any account
 * whose profile still does not exist.
 *
 * ── AUTHORITY, AND WHAT IS DELIBERATELY NOT TRUSTED ─────────────────────────
 * Paid status comes from ACTIVE STRIPE SUBSCRIPTIONS and the `purchases` ledger. It is
 * NOT inferred from `user_profiles.tier` or `access_team`, because those are the very
 * fields suspected of being wrong — reading them as authority would make the audit
 * agree with the bug.
 *
 * ⚠️ `tier` IS NOT RUNTIME AUTHORITY AT ALL. Measured: 98 of 104 active paid emails
 * carry tier='free'. The column is simply unmaintained. `resolveAccess()` is the real
 * gate, and it reads KV first, so a wrong profile flag does not necessarily mean a
 * locked-out customer. Both are reported separately: a flag mismatch is a data defect,
 * a `resolveAccess` failure is an outage.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
const { resolveAccess } = await import('../src/lib/access/resolve-access');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const JSON_OUT = process.argv.includes('--json');

const PRO_AMOUNTS = new Set([14900, 149000, 4900]);
const TEAM_AMOUNTS = new Set([49900, 499000]);

/** Page a table to exhaustion. A truncated read here would under-report the defect. */
async function pageAll<T>(table: string, cols: string, build: (q: any) => any = (q) => q): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(db.from(table).select(cols)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

interface Row {
  email: string;
  plan: 'pro' | 'team';
  subscriptionId: string;
  expected: string[];
  current: Record<string, boolean | null>;
  profileExists: boolean;
  runtime: string;
  purchaseTiers: string[];
  proposal: string;
}

async function main() {
  // ── AUTHORITY 1: active Stripe subscriptions (mirrored) ──
  const subs = await pageAll<{ id: string; customer_id: string; plan_amount: number }>(
    'stripe_subscriptions', 'id, customer_id, plan_amount', (q) => q.eq('status', 'active'),
  );
  const custs = await pageAll<{ id: string; email: string }>('stripe_customers', 'id, email');
  const emailOf = new Map(custs.map((c) => [c.id, String(c.email ?? '').toLowerCase()]));

  // Team wins when someone holds both — it is the superset entitlement.
  const paid = new Map<string, { plan: 'pro' | 'team'; subscriptionId: string }>();
  for (const s of subs) {
    const email = emailOf.get(s.customer_id);
    if (!email) continue;
    const amt = Number(s.plan_amount);
    if (TEAM_AMOUNTS.has(amt)) paid.set(email, { plan: 'team', subscriptionId: s.id });
    else if (PRO_AMOUNTS.has(amt) && !paid.has(email)) paid.set(email, { plan: 'pro', subscriptionId: s.id });
  }

  // ── AUTHORITY 2 (second derivation): the purchases ledger ──
  const purchases = await pageAll<{ user_email: string; tier: string | null; status: string }>(
    'purchases', 'user_email, tier, status', (q) => q.eq('status', 'completed'),
  );
  const tiersOf = new Map<string, string[]>();
  for (const p of purchases) {
    const e = String(p.user_email ?? '').toLowerCase();
    if (!e || !p.tier) continue;
    tiersOf.set(e, [...(tiersOf.get(e) ?? []), p.tier]);
  }

  const profiles = await pageAll<{ email: string; access_briefings: boolean | null; access_team: boolean | null; tier: string | null }>(
    'user_profiles', 'email, access_briefings, access_team, tier',
  );
  const profileOf = new Map(profiles.map((p) => [String(p.email ?? '').toLowerCase(), p]));

  const mismatches: Row[] = [];
  let lockedOut = 0;

  for (const [email, { plan, subscriptionId }] of paid) {
    const prof = profileOf.get(email);
    const expected = plan === 'team' ? ['access_team', 'access_briefings'] : ['access_briefings'];
    const missing = expected.filter((f) => !(prof as any)?.[f]);
    if (prof && missing.length === 0) continue; // correctly provisioned

    // Runtime is the truth about lockout — a wrong flag with working KV is a data
    // defect, not an outage. Reporting them as the same thing would misprioritise.
    const runtime = (await resolveAccess(email)).level;
    if (runtime !== 'pro') lockedOut += 1;

    mismatches.push({
      email, plan, subscriptionId, expected,
      current: {
        access_briefings: prof?.access_briefings ?? null,
        access_team: prof?.access_team ?? null,
      },
      profileExists: Boolean(prof),
      runtime,
      purchaseTiers: tiersOf.get(email) ?? [],
      proposal: !prof
        ? 'NO PROFILE — cannot repair by flag write (user_id is NOT NULL, FK to auth.users). Repairs itself at signup via reconcileEntitlementsFromPurchases.'
        : `set ${missing.join(' + ')} = true`,
    });
  }

  const repairable = mismatches.filter((m) => m.profileExists);
  const deferred = mismatches.filter((m) => !m.profileExists);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(), read_only: true,
      active_paid_emails: paid.size, mismatches: mismatches.length,
      repairable: repairable.length, deferred_no_profile: deferred.length,
      currently_locked_out: lockedOut, rows: mismatches,
    }, null, 2));
    return;
  }

  const B = '\x1b[1m', R = '\x1b[0m', D = '\x1b[2m', Y = '\x1b[33m';
  console.log(`\n${B}Entitlement mismatch audit${R} ${D}(read-only — nothing is written)${R}`);
  console.log(`${D}Paid status from ACTIVE Stripe subscriptions + purchases ledger. tier/access_team are NOT trusted as input.${R}\n`);
  console.log(`  active paid emails            : ${paid.size}`);
  console.log(`  MISMATCHED (wrong/no flags)   : ${mismatches.length}`);
  console.log(`    ├ repairable (profile exists): ${repairable.length}`);
  console.log(`    └ deferred (no profile row)  : ${deferred.length}`);
  console.log(`  ${lockedOut === 0 ? '' : Y}currently LOCKED OUT at runtime: ${lockedOut}${R}`);

  if (mismatches.length) {
    console.log(`\n${B}Repair population${R}`);
    for (const m of mismatches.sort((a, b) => a.plan.localeCompare(b.plan))) {
      const masked = m.email.slice(0, 3) + '***@' + m.email.split('@')[1];
      console.log(`\n  ${masked}  ${D}[${m.plan.toUpperCase()}]${R}`);
      console.log(`    subscription : ${m.subscriptionId}`);
      console.log(`    expected     : ${m.expected.join(', ')}`);
      console.log(`    current      : access_briefings=${m.current.access_briefings} · access_team=${m.current.access_team}`);
      console.log(`    profile row  : ${m.profileExists ? 'exists' : 'MISSING'}`);
      console.log(`    purchases    : ${m.purchaseTiers.length ? m.purchaseTiers.join(', ') : '(no mapped tier)'}`);
      console.log(`    runtime      : resolveAccess=${m.runtime}${m.runtime === 'pro' ? ' (not locked out)' : Y + ' ← LOCKED OUT' + R}`);
      console.log(`    proposal     : ${m.proposal}`);
    }
  }

  console.log(`\n${Y}Caveats${R}`);
  console.log(`${Y}  • tier='free' is NOT evidence of a defect — the column is unmaintained (98/104 paid accounts carry it).`);
  console.log('  • A flag mismatch with resolveAccess=pro is a DATA defect, not an outage: KV covers the gate.');
  console.log('  • Accounts with no profile row cannot be repaired by a flag write — user_id is NOT NULL (FK to');
  console.log('    auth.users), so no row can exist before signup. They self-heal via reconcileEntitlementsFromPurchases.');
  console.log(`  • Nothing is written by this script.${R}\n`);
}

main().catch((e) => { console.error(`\n✗ audit failed: ${e instanceof Error ? e.message : e}\n`); process.exit(1); });
