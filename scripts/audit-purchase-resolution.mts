/**
 * READ-ONLY audit: run the canonical resolver over the ENTIRE live `purchases` ledger
 * and report what resolves, by which evidence, and what genuinely cannot be resolved.
 *
 * Writes nothing. The Stripe catalog is fetched live so the resolver is never fed a
 * hardcoded mapping that can drift from the dashboard.
 *
 *   npx tsx scripts/audit-purchase-resolution.mts [--json]
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
dotenv.config({ path: '.env.local', quiet: true });

const { resolvePurchase } = await import('../src/lib/purchases/resolve-purchase');
type Cat = import('../src/lib/purchases/resolve-purchase').StripeProductCatalog;
type PriceIdx = import('../src/lib/purchases/resolve-purchase').StripePriceIndex;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const JSON_OUT = process.argv.includes('--json');

async function pageAll(table: string, cols: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    const b = data ?? []; out.push(...b);
    if (b.length < 1000) break;
  }
  return out;
}

// Live Stripe catalog — the authority for prod_ ids. Never hardcoded.
const catalog: Cat = {};
const priceIndex: PriceIdx = {};
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' as any });
let starting_after: string | undefined;
for (;;) {
  const page = await stripe.products.list({ limit: 100, active: undefined as any, starting_after });
  for (const p of page.data) {
    catalog[p.id] = { tier: (p.metadata as any)?.tier ?? null, bundle: (p.metadata as any)?.bundle ?? null, name: p.name };
  }
  if (!page.has_more) break;
  starting_after = page.data[page.data.length - 1]?.id;
}

// price_ → prod_ index. Rows store either id depending on which handler wrote them,
// so both must resolve to the same tier or the answer depends on a race.
let priceAfter: string | undefined;
for (;;) {
  const page = await stripe.prices.list({ limit: 100, starting_after: priceAfter });
  for (const pr of page.data) {
    const prodId = typeof pr.product === 'string' ? pr.product : (pr.product as any)?.id;
    if (prodId) priceIndex[pr.id] = prodId;
  }
  if (!page.has_more) break;
  priceAfter = page.data[page.data.length - 1]?.id;
}

const rows = await pageAll('purchases',
  'id,user_email,stripe_session_id,order_id,tier,bundle,product_id,product_name,amount_paid,status,created_at,superseded_by');

const results = rows.map(r => ({ row: r, res: resolvePurchase(r, catalog, priceIndex) }));
const live = results.filter(x => !x.row.superseded_by);
const byEv = (e: string) => live.filter(x => x.res.evidence === e).length;
const unresolved = live.filter(x => !x.res.resolved);

if (JSON_OUT) {
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(), read_only: true,
    stripe_products_in_catalog: Object.keys(catalog).length,
    stripe_prices_indexed: Object.keys(priceIndex).length,
    total_rows: rows.length, superseded: rows.length - live.length, live_rows: live.length,
    resolved: live.length - unresolved.length, unresolved: unresolved.length,
    by_evidence: { explicit_tier: byEv('explicit_tier'), catalog_product: byEv('catalog_product'), stripe_metadata: byEv('stripe_metadata'), stripe_price_product: byEv('stripe_price_product') },
    unresolved_rows: unresolved.map(x => ({
      id: x.row.id, email: x.row.user_email, created_at: x.row.created_at,
      product_id: x.row.product_id, product_name: x.row.product_name,
      raw_amount: x.res.rawAmount, amount_dollars: x.res.amountDollars,
      shape: x.res.shape, session: x.res.sessionId,
      reason: x.res.unresolvedReason, notes: x.res.notes,
    })),
  }, null, 2));
} else {
  const B='\x1b[1m', R='\x1b[0m', D='\x1b[2m', Y='\x1b[33m', G='\x1b[32m';
  console.log(`\n${B}Canonical purchase resolution audit${R} ${D}(read-only)${R}`);
  console.log(`${D}Stripe catalog: ${Object.keys(catalog).length} products · ${Object.keys(priceIndex).length} prices (live)${R}\n`);
  console.log(`  total rows            : ${rows.length}`);
  console.log(`  superseded (excluded) : ${rows.length - live.length}`);
  console.log(`  live rows             : ${live.length}`);
  console.log(`  ${G}RESOLVED              : ${live.length - unresolved.length}${R}`);
  console.log(`  ${unresolved.length ? Y : ''}UNRESOLVED            : ${unresolved.length}${R}`);
  console.log(`\n  by evidence:`);
  console.log(`    E1 explicit_tier    : ${byEv('explicit_tier')}`);
  console.log(`    E2 catalog_product  : ${byEv('catalog_product')}`);
  console.log(`    E3 stripe_metadata  : ${byEv('stripe_metadata')}`);
  console.log(`    E4 price→product    : ${byEv('stripe_price_product')}`);

  if (unresolved.length) {
    console.log(`\n${B}UNRESOLVED — human classification required${R}`);
    for (const x of unresolved.sort((a,b)=>String(a.row.created_at).localeCompare(String(b.row.created_at)))) {
      const e = String(x.row.user_email ?? '');
      const masked = e ? e.slice(0,3) + '***@' + (e.split('@')[1] ?? '?') : '(no email)';
      console.log(`\n  ${masked}  ${D}${String(x.row.created_at).slice(0,10)}${R}`);
      console.log(`    row id     : ${x.row.id}`);
      console.log(`    product    : ${x.row.product_id}  "${x.row.product_name ?? ''}"`);
      console.log(`    amount     : raw=${x.res.rawAmount} → $${x.res.amountDollars ?? '?'}  (${x.res.shape} shape)`);
      console.log(`    identifier : ${x.res.sessionId}`);
      console.log(`    WHY        : ${x.res.unresolvedReason}`);
      for (const n of x.res.notes) console.log(`    note       : ${n}`);
    }
  }
  console.log(`\n${Y}Nothing was written. Historical rows are untouched.${R}\n`);
}
