/**
 * Backfill the `purchases` ledger from Stripe Checkout Sessions.
 *
 * WHY: the Stripe webhook's purchases insert referenced four columns that never existed
 * (stripe_session_id, tier, bundle, metadata). PostgREST rejected every row, the handler
 * logged the error and returned 200, and Stripe recorded each delivery as successful. Net
 * effect: the ledger recorded NOTHING, ever. Measured 2026-07-30 — 154 paid checkout
 * sessions worth $121,824 back to 2024-08-17, and zero rows in `purchases`.
 *
 * Schema fixed in PR #642 (migration 20260730_purchases_ledger_columns). This script
 * reconstructs the missing history from Stripe, which is the system of record.
 *
 * SAFE TO RE-RUN. The unique index uniq_purchases_stripe_session_id makes each session
 * insert-once; a second run reports them as skipped rather than duplicating.
 *
 * Rows are marked so backfilled history is never mistaken for live webhook data:
 *   tier     = 'backfill_unknown'   — the webhook never derived one; we do NOT invent it
 *   metadata = { backfilled: true, backfill_date, source, original_created }
 *   created_at = the ORIGINAL Stripe session timestamp, not now()
 *
 * Usage:
 *   npx tsx scripts/backfill-purchases-from-stripe.ts --dry
 *   npx tsx scripts/backfill-purchases-from-stripe.ts --go
 */

import { config as loadEnv } from 'dotenv';
import Stripe from 'stripe';

// .env.local holds the live keys; plain `dotenv/config` only reads .env.
loadEnv({ path: '.env.local' });
loadEnv();

import { createClient } from '@supabase/supabase-js';

const DRY = !process.argv.includes('--go');
const BACKFILL_DATE = '2026-07-30';

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log(`\n=== purchases backfill  (${DRY ? 'DRY RUN' : 'LIVE WRITE'}) ===\n`);

  // 1. Page to the END of the session list. Stopping early silently shrinks the job —
  //    a first pass capped at 2000 sessions under-reported this by 34 rows / $49k.
  const sessions: Stripe.Checkout.Session[] = [];
  let startingAfter: string | undefined;
  let pages = 0;
  for (;;) {
    const page = await stripe.checkout.sessions.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    sessions.push(...page.data);
    pages++;
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  console.log(`fetched ${sessions.length} checkout sessions across ${pages} pages`);

  const paid = sessions.filter((s) => s.status === 'complete' && s.payment_status === 'paid');
  console.log(`complete + paid: ${paid.length}`);

  // 2. What's already recorded (page it — PostgREST caps at 1000 rows per request).
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('purchases')
      .select('stripe_session_id')
      .not('stripe_session_id', 'is', null)
      .range(from, from + 999);
    if (error) throw new Error(`reading purchases: ${error.message}`);
    (data || []).forEach((r) => r.stripe_session_id && existing.add(r.stripe_session_id));
    if (!data || data.length < 1000) break;
  }
  console.log(`already in purchases: ${existing.size}`);

  const todo = paid.filter((s) => !existing.has(s.id)).sort((a, b) => a.created - b.created);
  const totalCents = todo.reduce((a, s) => a + (s.amount_total || 0), 0);
  console.log(`\nTO INSERT: ${todo.length} rows  ${money(totalCents)}`);
  if (todo.length) {
    console.log(
      `range: ${new Date(todo[0].created * 1000).toISOString().slice(0, 10)}`
      + ` -> ${new Date(todo[todo.length - 1].created * 1000).toISOString().slice(0, 10)}`,
    );
  }

  if (!todo.length) {
    console.log('\nnothing to do — ledger already complete.\n');
    return;
  }

  if (DRY) {
    console.log('\nfirst 5 rows that would be written:');
    for (const s of todo.slice(0, 5)) {
      const email = (s.customer_details?.email || s.customer_email || '').toLowerCase();
      console.log(`   ${new Date(s.created * 1000).toISOString().slice(0, 10)}  ${money(s.amount_total || 0).padStart(11)}  ${email}`);
    }
    console.log('\nDRY RUN — nothing written. Re-run with --go to write.\n');
    return;
  }

  // 3. Write. Sequential + per-row error capture: one bad row must not abort the run,
  //    and a duplicate-key rejection is the unique index working, not a failure.
  let inserted = 0;
  let skippedDup = 0;
  let skippedNoEmail = 0;
  const failures: { session: string; error: string }[] = [];

  for (const [i, s] of todo.entries()) {
    const email = (s.customer_details?.email || s.customer_email || '').toLowerCase().trim();
    if (!email) {
      skippedNoEmail++;
      continue;
    }

    let productId = 'unknown';
    let productName = '';
    try {
      const li = await stripe.checkout.sessions.listLineItems(s.id, { limit: 1 });
      productId = li.data[0]?.price?.id || 'unknown';
      productName = li.data[0]?.description || '';
    } catch {
      // Line items can be unavailable on very old sessions; the row is still worth having.
    }

    const { error } = await sb.from('purchases').insert({
      user_email: email,
      stripe_session_id: s.id,
      stripe_customer_id: typeof s.customer === 'string' ? s.customer : s.customer?.id || null,
      product_id: productId,
      product_name: productName,
      tier: 'backfill_unknown',
      amount_paid: (s.amount_total || 0) / 100,
      status: 'completed',
      metadata: {
        backfilled: true,
        backfill_date: BACKFILL_DATE,
        source: 'stripe_checkout_sessions',
        original_created: new Date(s.created * 1000).toISOString(),
        currency: s.currency,
        mode: s.mode,
      },
      created_at: new Date(s.created * 1000).toISOString(),
    });

    if (error) {
      if (/duplicate key|already exists|uniq_purchases/i.test(error.message)) skippedDup++;
      else failures.push({ session: s.id, error: error.message });
    } else {
      inserted++;
    }

    if ((i + 1) % 25 === 0) console.log(`   ...${i + 1}/${todo.length}`);
  }

  console.log(`\n=== done ===`);
  console.log(`inserted        : ${inserted}`);
  console.log(`skipped (dup)   : ${skippedDup}`);
  console.log(`skipped (email) : ${skippedNoEmail}`);
  console.log(`failed          : ${failures.length}`);
  failures.slice(0, 10).forEach((f) => console.log(`   ${f.session}: ${f.error}`));
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
