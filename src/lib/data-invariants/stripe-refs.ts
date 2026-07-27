/**
 * Stripe reference scanner — the billing half of the data-invariants watch.
 *
 * WHY: money-shaped constants live in TWO systems (our code + Stripe) and drift
 * silently. Nothing throws when a price is archived or a payment link is
 * deactivated — the button still renders, and the customer hits a dead checkout.
 * The 2026-07-19 MCP repricing archived four top-up SKUs in Stripe; the config
 * row still pointed at one of them eight days later (found 2026-07-27).
 *
 * This module extracts every Stripe id/URL referenced in the SOURCE, so the
 * invariant probes can ask Stripe whether each one is still real and active.
 * Source-scanning (not a hand-maintained list) is deliberate: a hardcoded list
 * would itself be a duplicate that drifts — the exact bug class being guarded.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'backups']);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\./.test(entry)) out.push(p);
  }
  return out;
}

function sourceFiles(): string[] {
  // cwd is the app root in both the Vercel runtime and a local tsx run.
  return walk(join(process.cwd(), 'src'));
}

/** Every `price_…` id referenced anywhere in src/. */
export function referencedPriceIds(): string[] {
  const ids = new Set<string>();
  for (const f of sourceFiles()) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bprice_1[A-Za-z0-9]{10,}/g)) ids.add(m[0]);
  }
  return [...ids].sort();
}

/** Every https://buy.stripe.com/… payment link referenced anywhere in src/. */
export function referencedPaymentLinks(): string[] {
  const urls = new Set<string>();
  for (const f of sourceFiles()) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+/g)) urls.add(m[0]);
  }
  return [...urls].sort();
}

/**
 * Payment links KNOWN to live outside this Stripe account's payment-link list.
 * Measured 2026-07-27: the Opportunity Hunter "One-Time - $99" button resolves
 * (HTTP 200) but is absent from paymentLinks.list — almost certainly created on a
 * different/older Stripe account. Allowlisted so the invariant reports genuinely
 * NEW orphans instead of alerting forever on a known one; revisit when that page
 * is next touched.
 */
export const KNOWN_EXTERNAL_LINKS = new Set<string>([
  'https://buy.stripe.com/7sIaGqevYeIcdri147',
]);
