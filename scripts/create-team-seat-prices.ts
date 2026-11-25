/**
 * Create the Stripe prices for Team by seats (2026-11-24, PR #2430). Run ONCE by Eric, after he
 * approves the seat proposal:
 *
 *   npx tsx scripts/create-team-seat-prices.ts          # dry run: shows what it would create
 *   npx tsx scripts/create-team-seat-prices.ts --go     # creates the prices
 *
 * Creates 8 recurring prices (2, 3, 4, 5 users × monthly, annual) on the Mindy app product
 * (prod_UI5RXVGKsdywuf), so cancellations and access work exactly like Team today. Amounts come
 * from src/lib/billing/team-seat-plans.ts (the single source), never typed here.
 *
 * Safe to re-run: each price has a lookup_key (mindy_team_<N>_seats_<month|year>). A price that
 * already exists is reused, never duplicated, and never changed (Stripe prices cannot be edited).
 * If an existing price's amount differs from the plan, the script stops and says so.
 *
 * Prints the 8 env lines to set in Vercel (Production), then a redeploy turns them on. The seat
 * picker itself stays hidden until NEXT_PUBLIC_TEAM_SEAT_PRICING=on is also set.
 *
 * Needs STRIPE_SECRET_KEY (read from .env.local, then .env). Tells you whether it is a LIVE or a
 * TEST key before doing anything.
 */
import { config as loadEnv } from 'dotenv';
import Stripe from 'stripe';

loadEnv({ path: '.env.local' });
loadEnv();

import { TEAM_SEAT_PLANS } from '../src/lib/billing/team-seat-plans';
import { MINDY_APP_PRODUCT } from '../src/lib/billing/app-subscription-end';

const GO = process.argv.includes('--go');
const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

async function main() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set (looked in .env.local and .env).');
  const mode = key.startsWith('sk_live') || key.startsWith('rk_live') ? 'LIVE' : 'TEST';
  console.log(`Stripe key: ${mode} mode. ${GO ? 'Creating prices.' : 'Dry run (add --go to create).'}\n`);

  const stripe = new Stripe(key);
  const product = await stripe.products.retrieve(MINDY_APP_PRODUCT);
  if (product.deleted) throw new Error(`Product ${MINDY_APP_PRODUCT} is deleted.`);
  console.log(`Product: ${product.name} (${product.id})\n`);

  const envLines: string[] = [];
  for (const plan of TEAM_SEAT_PLANS) {
    for (const interval of ['month', 'year'] as const) {
      const cents = (interval === 'month' ? plan.monthlyUsd : plan.annualUsd) * 100;
      const lookupKey = `mindy_team_${plan.seats}_seats_${interval}`;
      const envName = `STRIPE_TEAM_${plan.seats}_SEATS_${interval === 'month' ? 'MONTHLY' : 'ANNUAL'}_PRICE`;
      const label = `Team · ${plan.seats} users · ${usd(cents)} / ${interval}`;

      const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
      const existing = found.data[0];
      if (existing) {
        if (existing.unit_amount !== cents || existing.recurring?.interval !== interval) {
          throw new Error(`${lookupKey} already exists at ${usd(existing.unit_amount ?? 0)}/${existing.recurring?.interval}, not ${usd(cents)}/${interval}. Stopping; nothing changed for it.`);
        }
        console.log(`exists   ${label}  ${existing.id}`);
        envLines.push(`${envName}=${existing.id}`);
        continue;
      }
      if (!GO) {
        console.log(`would create  ${label}  (lookup_key ${lookupKey})`);
        envLines.push(`${envName}=<created on --go>`);
        continue;
      }
      const price = await stripe.prices.create({
        product: MINDY_APP_PRODUCT,
        currency: 'usd',
        unit_amount: cents,
        recurring: { interval },
        lookup_key: lookupKey,
        nickname: `Mindy Team · ${plan.seats} users · ${interval === 'month' ? 'monthly' : 'annual'}`,
        metadata: {
          type: 'mindy_team_seats',
          seats: String(plan.seats),
          interval,
          tier: interval === 'month' ? 'team_monthly' : 'team_annual',
          credits_per_month: String(plan.credits),
        },
      });
      console.log(`created  ${label}  ${price.id}`);
      envLines.push(`${envName}=${price.id}`);
    }
  }

  console.log('\nSet these in Vercel → market-assassin → Settings → Environment Variables (Production), then redeploy:\n');
  for (const l of envLines) console.log(l);
  console.log('\nThe seat picker stays hidden until NEXT_PUBLIC_TEAM_SEAT_PRICING=on is also set.');
}

main().catch((e) => {
  console.error(`\nFAILED: ${(e as Error).message}`);
  process.exit(1);
});
