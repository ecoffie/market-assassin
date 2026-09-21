/**
 * Reconcile paid entitlements: active qualifying Stripe subscription ⇒ paid tier.
 *
 * Dry by default. `--go` writes.
 *
 * The RULE lives in src/lib/billing/paid-entitlement.ts (unit-tested, 13 cases)
 * so this script and the daily digest check evaluate the SAME logic — a rule that
 * exists twice drifts, and the two copies disagree exactly when it matters.
 *
 * Stripe is the authority. Our `stripe_customer_id` column is populated on 23 of
 * 10,599 profiles, so any check that starts from our side under-reports by ~80%
 * (measured: 22 subscribers found our way vs 103 in Stripe). This walks Stripe
 * and matches on email.
 *
 * WRITES ARE INSERT-OR-UPGRADE, NEVER A BLIND OVERWRITE:
 *   • no classification row  → INSERT at the earned tier
 *   • row on a free tier     → UPDATE to the earned tier
 *   • row already paid       → LEFT ALONE (a lifetime/comp must not be downgraded)
 */
import { createClient } from '@supabase/supabase-js';
import { findMismatches, PAID_ACCESS, type StripeSub } from '../src/lib/billing/paid-entitlement';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SK = process.env.STRIPE_SECRET_KEY!;
const H = { Authorization: `Bearer ${SK}` };
const GO = process.argv.includes('--go');

/** Paged read. PostgREST silently caps an unranged select at 1,000 rows — that
 *  cap changed the verdict three separate times on 2026-08-19, so every list read
 *  in a script that WRITES must be explicitly ranged. */
async function allRows<T>(build: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function stripeList(path: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let startingAfter = '';
  for (let page = 0; page < 20; page++) {
    const u = new URL(`https://api.stripe.com/v1/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set('limit', '100');
    if (startingAfter) u.searchParams.set('starting_after', startingAfter);
    const j = await (await fetch(u, { headers: H })).json();
    if (j.error) throw new Error(`stripe ${path}: ${j.error.message}`);
    const data = (j.data || []) as Record<string, unknown>[];
    out.push(...data);
    if (!j.has_more || !data.length) break;
    startingAfter = data[data.length - 1].id as string;
  }
  return out;
}

async function main() {
  // Products first: subscriptions carry a product ID, and Stripe refuses to expand
  // price.product on a subscription list (>4 levels deep), so we join by hand.
  const products = new Map<string, string>();
  for (const p of await stripeList('products', {})) products.set(p.id as string, (p.name as string) || '');

  const rawSubs = await stripeList('subscriptions', { status: 'active', 'expand[]': 'data.customer' });
  const subs: StripeSub[] = [];
  for (const s of rawSubs) {
    const items = (s.items as { data: Record<string, unknown>[] })?.data || [];
    const price = (items[0]?.price || {}) as Record<string, unknown>;
    const customer = s.customer as { email?: string } | string | null;
    const email = typeof customer === 'object' && customer?.email ? customer.email : '';
    if (!email) continue;
    subs.push({
      email,
      productName: products.get(price.product as string) || '(unknown)',
      amount: ((price.unit_amount as number) || 0) / 100,
      interval: ((price.recurring as { interval?: string })?.interval as 'month' | 'year') || 'once',
    });
  }

  const classRows = await allRows<{ email: string; briefings_access: string }>((f, t) =>
    sb.from('customer_classifications').select('email, briefings_access').range(f, t));
  const accessByEmail = new Map(classRows.map((c) => [(c.email || '').toLowerCase().trim(), c.briefings_access]));

  const mismatches = findMismatches(subs, accessByEmail);

  console.log(`stripe active subs ${subs.length} · classifications ${classRows.length}`);
  console.log(`MISMATCHED (entitled but not on a paid tier): ${mismatches.length}\n`);
  for (const m of mismatches.slice().sort((a, b) => b.amount - a.amount)) {
    console.log(`  ${m.email.padEnd(42)} ${String(m.currentAccess ?? 'NO ROW').padEnd(13)} → ${m.targetAccess.padEnd(13)} ${m.productName} $${m.amount}/${m.interval}`);
  }

  if (!GO) { console.log('\nDRY RUN — pass --go to write.'); return; }

  let inserted = 0, upgraded = 0, failed = 0;
  for (const m of mismatches) {
    if (m.currentAccess === null) {
      const { error } = await sb.from('customer_classifications').insert({
        email: m.email,
        classification: 'mi_subscription',
        briefings_access: m.targetAccess,
        briefings_expiry: null,             // null = never expires, matching existing paid rows
        has_active_subscription: true,
        classification_version: 3,
      });
      if (error && error.code !== '23505') { console.error(`  insert failed ${m.email}: ${error.message}`); failed++; }
      else inserted++;
    } else if (!PAID_ACCESS.has(m.currentAccess)) {
      // Upgrade only from a FREE tier. classification is left as-is: it may carry
      // real provenance (ultimate_giant, standalone) that briefings_access alone
      // does not express, and overwriting it would lose that.
      const { error } = await sb.from('customer_classifications')
        .update({ briefings_access: m.targetAccess, has_active_subscription: true })
        .eq('email', m.email);
      if (error) { console.error(`  update failed ${m.email}: ${error.message}`); failed++; }
      else upgraded++;
    }
  }
  console.log(`\n✓ inserted ${inserted} · upgraded ${upgraded}${failed ? ` · FAILED ${failed}` : ''}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
