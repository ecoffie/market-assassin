/**
 * Contractor Database buyer repair — manifest item A1. Idempotent, sends NO email.
 *
 *   npx tsx scripts/release/legacy-retirement/repair-db-buyer.mts --session <cs_live_…>            # verify only
 *   npx tsx scripts/release/legacy-retirement/repair-db-buyer.mts --session <cs_live_…> --go --record <file.json>
 *   npx tsx scripts/release/legacy-retirement/repair-db-buyer.mts --rollback <file.json> --go
 *
 * The email is taken from the PAID Stripe checkout session — never typed — so the grant can only
 * land on the account that actually paid. Refuses unless the session is complete + paid, came
 * from the Contractor Database link, contains the Contractor Database product, and has no full
 * refund. If `dbaccess:` already exists it does NOTHING (idempotent re-run). The write IS
 * `createDatabaseToken()` — the helper the admin route uses (dbtoken:<token>, dbaccess:<email>,
 * db:all) — WITHOUT the customer email that /api/admin/grant-database-access always sends.
 * Output masks the email.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import Stripe from 'stripe';
import { kv } from '@vercel/kv';
import { createDatabaseToken } from '../../../src/lib/access-codes';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DB_LINK = 'plink_1SlcMfK5zyiZ50PBVn60ByyO';
const DB_PRODUCT = 'prod_Tj4VbFiOz1VzyL';

const args = process.argv.slice(2);
const val = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const GO = args.includes('--go');
const mask = (e: string) => { const [u, h] = e.split('@'); return `${u[0]}***${u.length > 1 ? u[u.length - 1] : ''}@${h}`; };

async function main() {
  const rb = val('--rollback');
  if (rb) {
    const rec = JSON.parse(readFileSync(rb, 'utf8')) as { email: string; token: string };
    const cur = await kv.get<{ token?: string }>(`dbaccess:${rec.email}`);
    if (!cur || cur.token !== rec.token) { console.error(`REFUSED: dbaccess for ${mask(rec.email)} is not the grant this record created — not touching it.`); process.exit(1); }
    console.log(`${GO ? 'REMOVE' : 'would remove'} dbaccess/dbtoken created for ${mask(rec.email)}`);
    if (GO) {
      await kv.del(`dbaccess:${rec.email}`); await kv.del(`dbtoken:${rec.token}`); await kv.lrem('db:all', 0, rec.email);
      console.log(`✓ removed; dbaccess now ${(await kv.get(`dbaccess:${rec.email}`)) === null ? 'absent' : 'PRESENT (check!)'}`);
    }
    return;
  }

  const sessionId = val('--session');
  if (!sessionId?.startsWith('cs_')) { console.error('--session <cs_…> required'); process.exit(2); }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const cs = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price', 'payment_intent'] });
  const email = (cs.customer_details?.email || cs.customer_email || '').toLowerCase().trim();
  const products = (cs.line_items?.data || []).map((l) => (typeof l.price?.product === 'string' ? l.price.product : l.price?.product?.id));
  const pi = cs.payment_intent as Stripe.PaymentIntent | null;
  const refunds = pi ? (await stripe.refunds.list({ payment_intent: pi.id, limit: 100 })).data.filter((r) => r.status === 'succeeded') : [];
  const refunded = refunds.reduce((a, r) => a + r.amount, 0);

  const checks: Array<[string, boolean]> = [
    ['session complete + paid', cs.status === 'complete' && cs.payment_status === 'paid'],
    ['came from the Contractor Database link', cs.payment_link === DB_LINK],
    ['contains the Contractor Database product', products.includes(DB_PRODUCT)],
    ['payment succeeded', pi?.status === 'succeeded'],
    ['not fully refunded', refunded < (cs.amount_total || 0)],
    ['has a buyer email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)],
  ];
  for (const [n, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${n}`);
  console.log(`  session ${cs.id} · ${new Date(cs.created * 1000).toISOString()} · $${(cs.amount_total || 0) / 100} · refunded $${refunded / 100} · buyer ${email ? mask(email) : '?'}`);
  if (checks.some(([, ok]) => !ok)) { console.error('REFUSED: payment evidence incomplete. Nothing changed.'); process.exit(1); }

  const existing = await kv.get(`dbaccess:${email}`);
  console.log(`  current dbaccess: ${existing === null ? 'ABSENT' : 'present'}`);
  if (existing !== null) { console.log('✓ already has Contractor Database access — no-op (idempotent).'); return; }

  if (!GO) { console.log('\nDry run — would grant dbaccess (no email). Add --go --record <file.json> to apply.'); return; }
  const record = val('--record');
  if (!record) { console.error('--go requires --record <file.json>'); process.exit(2); }
  if (existsSync(record)) { console.error(`refusing to overwrite existing record ${record}`); process.exit(2); }

  const { token, createdAt } = await createDatabaseToken(email);
  writeFileSync(record, JSON.stringify({ at: createdAt, session: cs.id, email, token }, null, 2));

  const after = await kv.get<{ token?: string }>(`dbaccess:${email}`);
  const ok = after?.token === token && (await kv.get(`dbtoken:${token}`)) !== null;
  console.log(`${ok ? '✓' : '✗'} after: dbaccess present with the new token for ${mask(email)} (no email sent)`);
  console.log(`Rollback: npx tsx scripts/release/legacy-retirement/repair-db-buyer.mts --rollback ${record} --go`);
  if (!ok) process.exitCode = 1;
}
main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
