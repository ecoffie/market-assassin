/**
 * Backfill briefing entitlement for customers the old PRICE-BAND classifier
 * stranded.
 *
 * BACKGROUND
 * classifyCustomer() in the Stripe webhook inferred briefings_access from 2025
 * bundle price bands. Today's Mindy-line products match none of them, so buyers
 * landed on 'none' — or got no classification row — and silently received zero
 * briefings. Audit 2026-08-15: 76 of 115 paying customers ($32,694) affected.
 * The webhook now decides from the PRODUCT (lib/briefings/product-entitlement),
 * so NEW purchases are correct; this script repairs the existing ones.
 *
 * WHAT IT WILL AND WILL NOT TOUCH
 *  • Grants only where product-entitlement says the purchase earns it.
 *  • NEVER overrides an explicit briefings_access='excluded' — someone set that
 *    on purpose; a backfill silently undoing it is how trust in the flag dies.
 *  • NEVER re-enables is_active=false. That reads as an opt-out, and mailing an
 *    opt-out is a spam complaint, not a fix.
 *  • Skips accounts with no targeting — the briefing would be generic.
 *  • --enable is SEPARATE from the grant. Granting entitlement changes no
 *    email; flipping briefings_enabled starts real mail to people who have been
 *    silent for weeks. Those are different risks, so they are different flags.
 *
 * USAGE
 *   npx tsx scripts/backfill-briefing-entitlement.ts              # dry run
 *   npx tsx scripts/backfill-briefing-entitlement.ts --go         # grant only
 *   npx tsx scripts/backfill-briefing-entitlement.ts --go --enable --limit 5
 *                                                                 # canary wave
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { briefingEntitlementForExisting, isGrandfathered } from '../src/lib/briefings/product-entitlement';

// Load .env.local directly. Sourcing it through the shell mangles values that
// contain '=' or quotes (a JWT service key is exactly that shape) and yields a
// confusing "Invalid API key" rather than a missing-var error.
for (const file of ['.env.local', '.env']) {
  const f = path.join(process.cwd(), file);
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    // `vercel env pull` writes values wrapped in quotes with a LITERAL \n
    // suffix; left in, they produce "Invalid API key" instead of a clear error.
    // The file can also define a key twice — last occurrence wins, matching
    // dotenv/shell behaviour, so a stale earlier line cannot shadow the real one.
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '').trim();
    if (v) process.env[k] = v;
  }
}

const GO = process.argv.includes('--go');
const ENABLE = process.argv.includes('--enable');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? Number(limitArg.split('=')[1] ?? process.argv[process.argv.indexOf(limitArg) + 1]) : Infinity;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

/** PostgREST caps a select at 1000 rows — page or silently lose the tail. */
async function all<T>(table: string, sel: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(sel).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

async function main() {
  const purchases = await all<{ user_email: string; amount_paid: number; product_name: string }>(
    'purchases', 'user_email, amount_paid, product_name');
  const classifications = await all<{ email: string; briefings_access: string | null; briefings_expiry: string | null; classification: string | null }>(
    'customer_classifications', 'email, briefings_access, briefings_expiry, classification');
  const settings = await all<{ user_email: string; is_active: boolean | null; briefings_enabled: boolean | null; naics_codes: unknown[] | null; keywords: unknown[] | null; agencies: unknown[] | null }>(
    'user_notification_settings', 'user_email, is_active, briefings_enabled, naics_codes, keywords, agencies');
  // Delivery history = the grandfather signal. Anyone we have been sending to
  // keeps receiving, whatever they bought; see product-entitlement.ts.
  // RECENCY, not lifetime count: 1,455 addresses appear in briefing_log but
  // only 135 received one in the last 30 days. Grandfathering on "ever
  // received" would revive 1,320 dormant accounts.
  const log = await all<{ user_email: string; briefing_date: string | null }>('briefing_log', 'user_email, briefing_date');
  const lastBriefing = new Map<string, string>();
  for (const r of log) {
    const e = String(r.user_email || '').toLowerCase().trim();
    const d = String(r.briefing_date || '');
    if (!e || !d) continue;
    if (!lastBriefing.has(e) || d > lastBriefing.get(e)!) lastBriefing.set(e, d);
  }
  const today = new Date();
  const daysSince = (email: string): number | null => {
    const d = lastBriefing.get(email);
    if (!d) return null;
    // briefing_date is forward-dated relative to email_sent_at, so clamp at 0.
    return Math.max(0, Math.round((today.getTime() - new Date(d).getTime()) / 86400000));
  };

  const byCustomer = new Map<string, Array<{ product_name: string; amount_paid: number }>>();
  for (const p of purchases) {
    const e = String(p.user_email || '').toLowerCase().trim();
    if (!e) continue;
    (byCustomer.get(e) ?? byCustomer.set(e, []).get(e)!).push({ product_name: p.product_name, amount_paid: p.amount_paid });
  }
  const cls = new Map(classifications.map((c) => [String(c.email).toLowerCase().trim(), c]));
  const nset = new Map(settings.map((s) => [String(s.user_email).toLowerCase().trim(), s]));

  const OK = new Set(['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);
  const now = Date.now();
  const alreadyEntitled = (e: string) => {
    const c = cls.get(e);
    if (!c || c.briefings_access === 'excluded') return false;
    if (!OK.has(c.briefings_access || '')) return false;
    if (c.briefings_expiry && new Date(c.briefings_expiry).getTime() <= now) return false;
    return true;
  };

  const grants: Array<{ email: string; access: string; enable: boolean; classification: string; alreadyEntitled: boolean; grandfathered: boolean }> = [];
  const skipped: Record<string, string[]> = {};
  const skip = (why: string, e: string) => { (skipped[why] ??= []).push(e); };

  // Iterate over PURCHASERS ∪ RECIPIENTS. Driving off purchases alone missed 8
  // accounts with zero purchase rows that were receiving up to 96 briefings
  // each on lapsed grants — grandfathering is about delivery history, and
  // plenty of recipients never bought anything.
  const candidates = new Set<string>([...byCustomer.keys(), ...lastBriefing.keys()]);
  for (const email of candidates) {
    const items = byCustomer.get(email) ?? [];
    const grant = briefingEntitlementForExisting(items, daysSince(email));
    if (!grant.earns) continue;
    if (cls.get(email)?.briefings_access === 'excluded') { skip("explicitly 'excluded' — left alone", email); continue; }

    // NOTE: do NOT skip on alreadyEntitled here. Entitlement and delivery are
    // two separate repairs, and the entitlement pass runs first — so by the
    // time the --enable wave runs, every account is "already entitled". Short-
    // circuiting on it made the enable wave silently select nothing.
    const hasEntitlement = alreadyEntitled(email);

    const isGrandfather = isGrandfathered(daysSince(email));
    const s = nset.get(email);
    if (!s) { skip('no notification_settings row — needs onboarding, not a grant', email); continue; }
    if (s.is_active === false) { skip('opted out (is_active=false)', email); continue; }
    const targeting = (s.naics_codes?.length ?? 0) + (s.keywords?.length ?? 0) + (s.agencies?.length ?? 0);
    // A generic briefing is a reason not to START someone. It is NOT a reason to
    // cut off someone already receiving one.
    if (targeting === 0 && !isGrandfather) { skip('no targeting — briefing would be generic', email); continue; }

    // `classification` is NOT NULL. Preserve whatever the account already has —
    // it describes WHO they are and is not ours to rewrite. Only a brand-new
    // row needs a value, and 'mi_subscription' is the existing vocabulary term
    // that pairs with subscription-level briefings access.
    const existing = cls.get(email)?.classification;
    const needsEnable = s.briefings_enabled !== true;
    // Nothing left to do for this account: entitled AND already receiving.
    if (hasEntitlement && !needsEnable) { skip('already entitled and enabled', email); continue; }
    // Entitled but not enabled, and the caller did not ask to enable.
    if (hasEntitlement && !ENABLE) { skip('entitled; needs --enable to start delivery', email); continue; }

    grants.push({
      email,
      access: grant.access,
      alreadyEntitled: hasEntitlement,
      enable: ENABLE && needsEnable,
      classification: existing || (grant.access === 'lifetime' ? 'standalone' : 'mi_subscription'),
      grandfathered: isGrandfather,
    });
  }

  grants.sort((a, b) => a.email.localeCompare(b.email));
  const wave = grants.slice(0, LIMIT);

  console.log(`\n=== briefing entitlement backfill — ${GO ? 'LIVE' : 'DRY RUN'} ===`);
  console.log(`accounts to act on: ${grants.length}${wave.length < grants.length ? ` (this wave: ${wave.length})` : ''}`);
  console.log(`  new entitlement grants: ${wave.filter((g) => !g.alreadyEntitled).length}`);
  console.log(`  grandfathered (already receiving; kept regardless of product): ${wave.filter((g) => g.grandfathered).length}`);
  console.log(`briefings_enabled flips in this wave: ${wave.filter((g) => g.enable).length}${ENABLE ? '' : '  (--enable not set: entitlement only, no new mail)'}`);
  for (const g of wave) console.log(`  ${g.email.padEnd(40)} access=${g.access}${g.alreadyEntitled ? ' (already)' : ''}${g.grandfathered ? ' [grandfathered]' : ''}${g.enable ? '  +ENABLE (starts real mail)' : ''}`);
  console.log('\nskipped:');
  for (const [why, list] of Object.entries(skipped)) console.log(`  ${String(list.length).padStart(3)}  ${why}`);

  if (!GO) { console.log('\nDry run — nothing written. Re-run with --go to apply.\n'); return; }

  let ok = 0, failed = 0;
  for (const g of wave) {
    // Only touch the classification row when entitlement is actually missing.
    const { error: cErr } = g.alreadyEntitled ? { error: null } : await sb.from('customer_classifications').upsert({
      email: g.email,
      classification: g.classification, // NOT NULL; preserved when the row exists
      briefings_access: g.access,
      briefings_expiry: null, // product-based access is not time-boxed
      classification_version: 3,
    }, { onConflict: 'email' });
    if (cErr) { console.error(`  FAIL ${g.email}: ${cErr.message}`); failed++; continue; }

    if (g.enable) {
      const { error: nErr } = await sb.from('user_notification_settings')
        .update({ briefings_enabled: true }).eq('user_email', g.email);
      if (nErr) { console.error(`  FAIL(enable) ${g.email}: ${nErr.message}`); failed++; continue; }
    }
    ok++;
  }
  console.log(`\napplied: ${ok} | failed: ${failed}`);
  console.log('Verify: re-run the drift query, and confirm briefing_log rows appear after the next send.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
