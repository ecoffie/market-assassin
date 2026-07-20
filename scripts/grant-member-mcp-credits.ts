/**
 * Existing-member MCP credit reset + grant (GOS Decision #019 + clawback, 2026-07-20).
 *
 * SETS every special-balance account to its correct allocation (claws the accidental
 * 1,000s DOWN, tops low ones UP). Recurring credits require a recurring payment.
 *
 *   • Active Pro sub ($149/mo)   → SET 250
 *   • Active Team sub ($499/mo)  → SET 750
 *   • Lifetime / Founders        → SET 200   (incl. clawing grandfathered 1,000 → 200)
 *   • Comp / testimonial         → SET 200   (incl. 500 → 200)
 *   • Any OTHER account @ 1,000  → SET 200   ("no one should have 1,000" — catch-all)
 *   • Internal team              → KEEP (25,000, untouched)
 *   • Granted / comp / free @ 0  → NOT TOUCHED (they keep their one-time signup 100)
 *
 * Priority when an account matches more than one group: internal(keep) > active sub > lifetime
 * > comp > catch-all. Ledger reason 'member_credit_reset'. SET = delta via grant/debit, so it's
 * idempotent (re-running converges) and can go both directions.
 *
 * DRY RUN by default — prints current → target for every affected account.
 *   npx tsx scripts/grant-member-mcp-credits.ts          # preview
 *   npx tsx scripts/grant-member-mcp-credits.ts --go      # apply
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const GO = process.argv.includes('--go');
const LIFETIME_CENTS = new Set([299700, 499700]);
const ULTIMATE_BUNDLES = ['ultimate', 'ultimate-govcon-bundle', 'complete'];
const PRO_AMOUNTS = new Set([14900, 149000, 4900]);
const TEAM_AMOUNTS = new Set([49900, 499000]);
const T = { PRO: 250, TEAM: 750, LIFETIME: 200, COMP: 200, CATCHALL: 200 };

async function main() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { getBalance, grantCredits, debitCredits } = await import('../src/lib/mcp/credits');
  const { INTERNAL_TEAM_EMAILS } = await import('../src/lib/api-auth');
  const { COMP_TESTIMONIAL_EMAILS } = await import('../src/lib/mindy/campaign-exclusions');

  const internal = new Set([...INTERNAL_TEAM_EMAILS, 'branden@govcongiants.com', 'eric@govcongiants.com'].map((e) => e.toLowerCase()));
  const comp = new Set([...COMP_TESTIMONIAL_EMAILS].map((e) => e.toLowerCase()));

  // customer id → email
  const custEmail = new Map<string, string>();
  for await (const c of stripe.customers.list({ limit: 100 })) if (c.livemode !== false && c.email) custEmail.set(c.id, c.email.toLowerCase());

  // active app subs
  const proSubs = new Set<string>(), teamSubs = new Set<string>();
  for await (const s of stripe.subscriptions.list({ status: 'active', limit: 100 })) {
    const amt = s.items.data[0]?.price?.unit_amount ?? 0;
    const email = typeof s.customer === 'string' ? custEmail.get(s.customer) : undefined;
    if (!email) continue;
    if (PRO_AMOUNTS.has(amt)) proSubs.add(email); else if (TEAM_AMOUNTS.has(amt)) teamSubs.add(email);
  }

  // lifetime / founders
  const lifetime = new Set<string>();
  for await (const x of stripe.charges.list({ limit: 100 })) {
    if (!(x.status === 'succeeded' && x.paid && !x.refunded && (x.amount_refunded || 0) === 0 && x.livemode !== false)) continue;
    const email = (x.customer && custEmail.get(x.customer as string)) || (x.billing_details?.email || '').toLowerCase() || (x.receipt_email || '').toLowerCase();
    if (!email) continue;
    if (LIFETIME_CENTS.has(x.amount) && new Date(x.created * 1000).getFullYear() >= 2026) lifetime.add(email);
    if (/ultimate/i.test(x.description || '')) lifetime.add(email);
  }
  for (let from = 0; from < 40000; from += 1000) {
    const { data } = await supabase.from('purchases').select('user_email').in('product_id', ULTIMATE_BUNDLES).range(from, from + 999);
    if (!data?.length) break; for (const r of data as { user_email: string }[]) if (r.user_email) lifetime.add(r.user_email.toLowerCase()); if (data.length < 1000) break;
  }
  for (let from = 0; from < 40000; from += 1000) {
    const { data } = await supabase.from('customer_classifications').select('email').eq('classification', 'ultimate_giant').range(from, from + 999);
    if (!data?.length) break; for (const r of data as { email: string }[]) if (r.email) lifetime.add(r.email.toLowerCase()); if (data.length < 1000) break;
  }

  // any remaining account still holding 1,000 (catch-all clawback)
  const holders1000 = new Set<string>();
  const { data: bal1000 } = await supabase.from('mcp_credit_balance').select('user_email').eq('balance', 1000);
  for (const r of (bal1000 || []) as { user_email: string }[]) holders1000.add(r.user_email.toLowerCase());

  // resolve each affected email → target (priority: internal keep > sub > lifetime > comp > catch-all)
  const targets = new Map<string, { target: number; group: string }>();
  const set = (email: string, target: number, group: string) => { if (!internal.has(email) && !targets.has(email)) targets.set(email, { target, group }); };
  for (const e of proSubs) set(e, T.PRO, 'pro-sub');
  for (const e of teamSubs) set(e, T.TEAM, 'team-sub');
  for (const e of lifetime) set(e, T.LIFETIME, 'lifetime');
  for (const e of comp) set(e, T.COMP, 'comp');
  for (const e of holders1000) set(e, T.CATCHALL, 'other@1000');

  console.log(`\n=== Member MCP credit reset — ${GO ? 'EXECUTE' : 'DRY RUN'} ===`);
  console.log(`pro-sub=${proSubs.size} team-sub=${teamSubs.size} lifetime=${lifetime.size} comp=${comp.size} other@1000=${holders1000.size}`);
  console.log(`internal team KEPT (untouched): ${[...internal].length} accounts\n`);

  let up = 0, down = 0, noop = 0;
  const rows = [...targets.entries()];
  for (const [email, { target, group }] of rows) {
    const current = await getBalance(email);
    const delta = target - current;
    const arrow = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '0';
    console.log(`  ${current} → ${target}  (${arrow})  ${email}  [${group}]`);
    if (GO && delta !== 0) { if (delta > 0) await grantCredits(email, delta, 'member_credit_reset'); else await debitCredits(email, -delta, { reason: 'member_credit_reset', toolName: 'reset' }); }
    if (delta > 0) up++; else if (delta < 0) down++; else noop++;
  }
  console.log(`\n${GO ? 'APPLIED' : 'WOULD APPLY'} — ${rows.length} accounts · ${up} up · ${down} down · ${noop} already-correct.`);
  if (!GO) console.log('DRY RUN — nothing changed. Re-run with --go to execute.');
}

main().catch((e) => { console.error(e); process.exit(1); });
