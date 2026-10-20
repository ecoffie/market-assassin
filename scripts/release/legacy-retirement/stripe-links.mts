/**
 * Legacy-retirement Stripe payment-link actions — manifest items S1–S7.
 *
 *   npx tsx scripts/release/legacy-retirement/stripe-links.mts                 # --check (read-only, default)
 *   npx tsx scripts/release/legacy-retirement/stripe-links.mts --apply         # prints the plan, changes nothing
 *   npx tsx scripts/release/legacy-retirement/stripe-links.mts --apply --go --record <file.json>
 *   npx tsx scripts/release/legacy-retirement/stripe-links.mts --rollback <file.json> --go
 *
 * Reads STRIPE_SECRET_KEY from .env.local — no secret ever appears on the command line.
 * Every mutation is preceded by a re-verification of what the link sells: a link whose line items
 * no longer match the manifest is REFUSED, not changed. After applying, every link is re-read and
 * asserted. The record file holds the exact prior `active` + `after_completion` for rollback.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import Stripe from 'stripe';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const MINDY_PRO_PRODUCT = 'prod_UI5RXVGKsdywuf';
const NEW_PRO_REDIRECT = 'https://getmindy.ai/app';

/** Links to DEACTIVATE — each must sell exactly these retired products and nothing else. */
const DEACTIVATE: Array<{ id: string; label: string; products: string[] }> = [
  { id: 'plink_1TBXg2K5zyiZ50PBp5xvOJP2', label: 'S1 Alert Pro $19/mo', products: ['prod_U9rOClXY6MFcRu'] },
  { id: 'plink_1SlcMfK5zyiZ50PBVn60ByyO', label: 'S2 Federal Contractor Database $497', products: ['prod_Tj4VbFiOz1VzyL'] },
  { id: 'plink_1SxuVtK5zyiZ50PBmxd7LM9F', label: 'S3 Ultimate Giant Bundle (DISCOUNT) $1,497', products: ['prod_TrU0CviMWdDTnj'] },
  { id: 'plink_1TND04K5zyiZ50PBQ1WruM46', label: 'S4 Ultimate Giant Bundle (DISCOUNT) $500', products: ['prod_TrU0CviMWdDTnj'] },
  { id: 'plink_1SzGrLK5zyiZ50PBS9w6qvI7', label: 'S5 Upgrade to Tool Bundle $500', products: ['prod_TxBDjSHrFeL0sE'] },
];
/** Links to KEEP ACTIVE, redirect only — each must sell only Mindy Pro. */
const REDIRECT: Array<{ id: string; label: string }> = [
  { id: 'plink_1TTYfRK5zyiZ50PBkZ4mukPq', label: 'S6 Mindy Pro $149/mo' },
  { id: 'plink_1TTYhlK5zyiZ50PBGhvWwBLq', label: 'S7 Mindy Pro $1,490/yr' },
];

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const val = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const GO = flag('--go');

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('STRIPE_SECRET_KEY missing from .env.local'); process.exit(2); }
const stripe = new Stripe(key);

type Snapshot = { id: string; active: boolean; after: Stripe.PaymentLink.AfterCompletion; products: string[] };
async function snapshot(id: string): Promise<Snapshot> {
  const l = await stripe.paymentLinks.retrieve(id);
  const items = await stripe.paymentLinks.listLineItems(id, { limit: 100 });
  const products = items.data.map((x) => (typeof x.price?.product === 'string' ? x.price.product : x.price?.product?.id ?? '?'));
  return { id, active: l.active, after: l.after_completion, products };
}
const afterUrl = (a: Stripe.PaymentLink.AfterCompletion) => (a.type === 'redirect' ? a.redirect?.url : a.type);
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

async function check(): Promise<{ ok: boolean; snaps: Snapshot[] }> {
  let ok = true;
  const snaps: Snapshot[] = [];
  for (const d of DEACTIVATE) {
    const s = await snapshot(d.id); snaps.push(s);
    const sells = same(s.products, d.products);
    ok &&= sells;
    console.log(`${sells ? '✓' : '✗'} ${d.label}  active=${s.active}  sells=${s.products.join(',')}  ${sells ? '(retired product only)' : '← DOES NOT MATCH MANIFEST'}`);
  }
  for (const r of REDIRECT) {
    const s = await snapshot(r.id); snaps.push(s);
    const sells = same(s.products, [MINDY_PRO_PRODUCT]);
    ok &&= sells;
    console.log(`${sells ? '✓' : '✗'} ${r.label}  active=${s.active}  redirect=${afterUrl(s.after)}  sells=${s.products.join(',')}`);
  }
  return { ok, snaps };
}

async function main() {
  const rollbackFile = val('--rollback');
  if (rollbackFile) {
    const rec = JSON.parse(readFileSync(rollbackFile, 'utf8')) as { before: Snapshot[] };
    for (const s of rec.before) {
      console.log(`${GO ? 'RESTORE' : 'would restore'} ${s.id} → active=${s.active}, after=${afterUrl(s.after)}`);
      if (GO) {
        await stripe.paymentLinks.update(s.id, {
          active: s.active,
          after_completion: s.after.type === 'redirect'
            ? { type: 'redirect', redirect: { url: s.after.redirect!.url } }
            : { type: 'hosted_confirmation', ...(s.after.hosted_confirmation?.custom_message ? { hosted_confirmation: { custom_message: s.after.hosted_confirmation.custom_message } } : {}) },
        });
        const now = await snapshot(s.id);
        const back = now.active === s.active && afterUrl(now.after) === afterUrl(s.after);
        console.log(`  ${back ? '✓ restored' : '✗ NOT restored'}  active=${now.active} after=${afterUrl(now.after)}`);
        if (!back) process.exitCode = 1;
      }
    }
    return;
  }

  const { ok, snaps } = await check();
  if (!flag('--apply')) { if (!ok) process.exitCode = 1; return; }
  if (!ok) { console.error('\nREFUSED: a link no longer matches the manifest. Nothing changed.'); process.exit(1); }

  const record = val('--record');
  if (GO && !record) { console.error('--go requires --record <file.json> (the rollback record)'); process.exit(2); }
  if (GO && existsSync(record!)) { console.error(`refusing to overwrite existing record ${record}`); process.exit(2); }
  if (GO) writeFileSync(record!, JSON.stringify({ at: new Date().toISOString(), before: snaps }, null, 2));

  for (const d of DEACTIVATE) {
    console.log(`${GO ? 'DEACTIVATE' : 'would deactivate'} ${d.label} (${d.id})`);
    if (GO) await stripe.paymentLinks.update(d.id, { active: false });
  }
  for (const r of REDIRECT) {
    console.log(`${GO ? 'REDIRECT' : 'would redirect'} ${r.label} (${r.id}) → ${NEW_PRO_REDIRECT}`);
    if (GO) await stripe.paymentLinks.update(r.id, { after_completion: { type: 'redirect', redirect: { url: NEW_PRO_REDIRECT } } });
  }
  if (!GO) { console.log('\nDry run — nothing changed. Add --go --record <file.json> to apply.'); return; }

  // After: re-read every link and assert the intended end state.
  let good = true;
  for (const d of DEACTIVATE) { const s = await snapshot(d.id); const pass = s.active === false; good &&= pass; console.log(`${pass ? '✓' : '✗'} after: ${d.label} active=${s.active}`); }
  for (const r of REDIRECT) { const s = await snapshot(r.id); const pass = s.active && afterUrl(s.after) === NEW_PRO_REDIRECT; good &&= pass; console.log(`${pass ? '✓' : '✗'} after: ${r.label} active=${s.active} redirect=${afterUrl(s.after)}`); }
  console.log(`\nRollback: npx tsx scripts/release/legacy-retirement/stripe-links.mts --rollback ${record} --go`);
  if (!good) process.exitCode = 1;
}
main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
