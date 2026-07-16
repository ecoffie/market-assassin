/**
 * Founders Lifetime seat counter.
 *
 * "Founders" = actual **Mindy lifetime purchases** ($2,997 bootcamp + $4,997
 * Founders, the Mindy products) + **Ultimate Giant** bundle owners (grandfathered
 * lifetime). Capped at 100 (FOUNDERS_LIFETIME_CAP).
 *
 * The count requires a full Stripe charge scan (~30-60s), so it is NEVER computed
 * in a page/request. A cron (`/api/cron/founders-seats-refresh`) recomputes it and
 * caches the result in KV; the public API + landing page read the cache (fast).
 */
import { kv } from '@vercel/kv';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { FOUNDERS_LIFETIME_CAP } from './lifetime-pricing';

const KV_KEY = 'founders:seats';
// $2,997 bootcamp + $4,997 Founders — the actual Mindy lifetime products.
const LIFETIME_CENTS = new Set([299700, 499700]);
// Exclude old course/coaching + MANUAL-INVOICE charges that happen to be
// $2,997/$4,997 (NOT Mindy). Real Mindy lifetime is sold via payment links (blank/
// checkout description); a "Payment for Invoice" at $4,997 is a coaching invoice
// (e.g. Candice Prentiss, Jan 2026), not a Founders purchase.
const NOT_MINDY = /coaching|accelerator|academy|challenge|partner|blueprint|target market|group coaching|invoice/i;
const ULTIMATE_BUNDLES = ['ultimate', 'ultimate-govcon-bundle', 'complete'];

export interface FoundersSeats {
  cap: number;
  taken: number;
  remaining: number;
  mindyLifetime: number;
  ultimateGiant: number;
  computedAt: string | null;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Fast: read the cached count from KV. Falls back to all-seats-open if unset. */
export async function getFoundersSeats(): Promise<FoundersSeats> {
  try {
    const cached = await kv.get<FoundersSeats>(KV_KEY);
    if (cached && typeof cached.taken === 'number') {
      return { ...cached, cap: FOUNDERS_LIFETIME_CAP, remaining: Math.max(0, FOUNDERS_LIFETIME_CAP - cached.taken) };
    }
  } catch { /* KV down → fall through */ }
  return { cap: FOUNDERS_LIFETIME_CAP, taken: 0, remaining: FOUNDERS_LIFETIME_CAP, mindyLifetime: 0, ultimateGiant: 0, computedAt: null };
}

/** Slow: full recompute against live Stripe + Supabase. Cron-only. */
export async function refreshFoundersSeats(): Promise<FoundersSeats> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const supabase = getSupabase();
  if (!stripeKey || !supabase) throw new Error('Stripe/Supabase not configured');
  const stripe = new Stripe(stripeKey);

  // customer id → email
  const custEmail = new Map<string, string>();
  for await (const c of stripe.customers.list({ limit: 100 })) {
    if (c.livemode !== false && c.email) custEmail.set(c.id, c.email.toLowerCase());
  }

  // Mindy lifetime buyers + Ultimate-by-charge
  const lifetime = new Set<string>();
  const ultimate = new Set<string>();
  for await (const x of stripe.charges.list({ limit: 100 })) {
    if (!(x.status === 'succeeded' && x.paid && !x.refunded && (x.amount_refunded || 0) === 0 && x.livemode !== false)) continue;
    const email = (x.customer && custEmail.get(x.customer as string))
      || (x.billing_details?.email || '').toLowerCase()
      || (x.receipt_email || '').toLowerCase();
    if (!email) continue;
    const desc = x.description || '';
    const year = new Date(x.created * 1000).getFullYear();
    if (LIFETIME_CENTS.has(x.amount) && year >= 2026 && !NOT_MINDY.test(desc)) lifetime.add(email);
    if (/ultimate/i.test(desc)) ultimate.add(email);
  }

  // Ultimate Giant from classification + purchases ledger
  for (let from = 0; from < 40000; from += 1000) {
    const { data } = await supabase.from('customer_classifications').select('email').eq('classification', 'ultimate_giant').range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data as { email: string }[]) if (r.email) ultimate.add(r.email.toLowerCase());
    if (data.length < 1000) break;
  }
  // product_id, NOT bundle: this Supabase's `purchases` has no `bundle` column
  // (that's govcon-shop's schema — separate instance). The slug we want lives in
  // product_id, and it holds exactly the ULTIMATE_BUNDLES values
  // ('ultimate-govcon-bundle'). Querying `bundle` returned 42703 every run, so
  // `data` was null, the loop broke immediately, and the purchases ledger
  // contributed ZERO Ultimate owners — undercounting `taken` and overstating
  // `remaining` on a capped offer. Errors are surfaced (not swallowed) for the
  // same reason: a stale seat count is recoverable, a confidently wrong one is not.
  for (let from = 0; from < 40000; from += 1000) {
    const { data, error } = await supabase.from('purchases').select('user_email').in('product_id', ULTIMATE_BUNDLES).range(from, from + 999);
    if (error) throw new Error(`founders-seats: purchases lookup failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as { user_email: string }[]) if (r.user_email) ultimate.add(r.user_email.toLowerCase());
    if (data.length < 1000) break;
  }

  const founders = new Set<string>([...lifetime, ...ultimate]);
  const result: FoundersSeats = {
    cap: FOUNDERS_LIFETIME_CAP,
    taken: founders.size,
    remaining: Math.max(0, FOUNDERS_LIFETIME_CAP - founders.size),
    mindyLifetime: lifetime.size,
    ultimateGiant: ultimate.size,
    computedAt: new Date().toISOString(),
  };
  try { await kv.set(KV_KEY, result); } catch { /* KV write best-effort */ }
  return result;
}
