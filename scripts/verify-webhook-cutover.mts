/**
 * POST-CUTOVER VERIFICATION — prove the retired shop webhook stopped writing and the
 * Mindy endpoint fulfils a checkout on its own.
 *
 * READ-ONLY. Writes nothing, changes no Stripe config. Exits non-zero on any failure so
 * a red run cannot be mistaken for a green one.
 *
 *   npx tsx scripts/verify-webhook-cutover.mts --since 2026-09-09T06:17:39Z
 *   npx tsx scripts/verify-webhook-cutover.mts --since <iso> --email <buyer@example.com>
 *   npx tsx scripts/verify-webhook-cutover.mts --since <iso> --json
 *
 * ── THE BASELINE MATTERS ─────────────────────────────────────────────────────
 * `--since` is the cutover instant. Everything is measured AFTER it, so pre-existing
 * legacy rows (137 of them) cannot be mistaken for new ones. Without a baseline this
 * check would either flag ancient history or, worse, pass by looking at nothing.
 *
 * ── WHAT "NO NEW SHOP ROWS" CAN AND CANNOT PROVE ─────────────────────────────
 * Zero new legacy rows is only meaningful if a purchase actually happened. Zero
 * purchases also produces zero legacy rows — an empty window is NOT a passing cutover,
 * it is an untested one. So criterion E is reported as INCONCLUSIVE, never PASS, when
 * no post-cutover purchase exists. That distinction is the whole point: an absence of
 * evidence is not evidence of absence.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local', quiet: true });

const { resolveAccess } = await import('../src/lib/access/resolve-access');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i === -1) return null;
  const a = argv[i];
  return a.includes('=') ? a.split('=').slice(1).join('=') : (argv[i + 1] ?? null);
};
const SINCE = flag('since');
const ONLY_EMAIL = flag('email');
const JSON_OUT = argv.includes('--json');
if (!SINCE) { console.error('\n✗ --since <ISO timestamp> is required (the cutover instant)\n'); process.exit(2); }

type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
const checks: { id: string; name: string; verdict: Verdict; detail: string }[] = [];
const add = (id: string, name: string, verdict: Verdict, detail = '') =>
  checks.push({ id, name, verdict, detail });

async function pageAll(t: string, cols: string, build: (q: any) => any = (q) => q) {
  const out: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await build(db.from(t).select(cols)).range(f, f + 999);
    if (error) throw new Error(`${t}: ${error.message}`);
    const b = data ?? []; out.push(...b); if (b.length < 1000) break;
  }
  return out;
}

// ── Post-cutover purchases ──
let rows = await pageAll('purchases',
  'id,user_email,stripe_session_id,order_id,tier,bundle,product_id,product_name,amount_paid,status,created_at,superseded_by',
  (q) => q.gt('created_at', SINCE));
if (ONLY_EMAIL) rows = rows.filter((r) => String(r.user_email ?? '').toLowerCase() === ONLY_EMAIL.toLowerCase());

const mindyShape = rows.filter((r) => r.stripe_session_id);
const shopShape = rows.filter((r) => !r.stripe_session_id && r.order_id);
// Criterion E, exactly as specified: tier NULL AND order_id like cs_% AND no session id.
const legacyWrites = shopShape.filter((r) => !r.tier && String(r.order_id).startsWith('cs_'));

// ── E: legacy writer stopped ──
if (rows.length === 0) {
  add('E', 'legacy shop writer stopped', 'INCONCLUSIVE',
    'no purchases since cutover — zero legacy rows proves nothing without a real checkout');
} else if (legacyWrites.length === 0) {
  add('E', 'legacy shop writer stopped', 'PASS',
    `${rows.length} post-cutover purchase(s), 0 legacy shop-shape rows`);
} else {
  add('E', 'legacy shop writer stopped', 'FAIL',
    `${legacyWrites.length} NEW legacy row(s): ${legacyWrites.map((r) => r.id).join(', ')}`);
}

// ── B: bookkeeping shape ──
if (rows.length === 0) {
  add('B', 'purchase row is Mindy shape', 'INCONCLUSIVE', 'no post-cutover purchase to inspect');
} else {
  const bad: string[] = [];
  for (const r of rows) {
    if (!r.stripe_session_id) bad.push(`${r.id}: stripe_session_id EMPTY`);
    if (r.order_id && !r.stripe_session_id) bad.push(`${r.id}: order_id used as session substitute`);
    // Mindy stores DOLLARS. A $149 sale landing as 14900 is the cents convention leaking.
    const amt = Number(r.amount_paid);
    if (Number.isFinite(amt) && amt >= 10000) bad.push(`${r.id}: amount_paid=${amt} looks like CENTS, not dollars`);
    if (!r.tier && !r.bundle) bad.push(`${r.id}: neither tier nor bundle populated`);
  }
  add('B', 'purchase row is Mindy shape', bad.length ? 'FAIL' : 'PASS',
    bad.length ? bad.join(' | ') : `${rows.length} row(s): session id set, canonical unit, tier/bundle present`);
}

// ── D: exactly one row per session (no duplicate bookkeeping) ──
if (rows.length === 0) {
  add('D', 'no duplicate purchase rows', 'INCONCLUSIVE', 'no post-cutover purchase to inspect');
} else {
  const bySession = new Map<string, any[]>();
  for (const r of rows.filter((x) => !x.superseded_by)) {
    const k = String(r.stripe_session_id || r.order_id || r.id);
    bySession.set(k, [...(bySession.get(k) ?? []), r]);
  }
  const dupes = [...bySession.entries()].filter(([, v]) => v.length > 1);
  add('D', 'no duplicate purchase rows', dupes.length ? 'FAIL' : 'PASS',
    dupes.length ? dupes.map(([k, v]) => `${k} ×${v.length}`).join(', ')
                 : `${bySession.size} session(s), 1 live row each`);
}

// ── C: entitlement fulfilment, per buyer ──
const buyers = [...new Set(rows.map((r) => String(r.user_email ?? '').toLowerCase()).filter(Boolean))];
const buyerReports: any[] = [];
if (!buyers.length) {
  add('C', 'entitlement fulfilment', 'INCONCLUSIVE', 'no post-cutover buyer to verify');
} else {
  const problems: string[] = [];
  for (const email of buyers) {
    // Bounded deliberately: ONE email, only grants after the cutover instant. A single
    // buyer cannot plausibly accrue 200 grants in a verification window, and the check
    // only asks "did at least one stripe_webhook grant land" — so a cap cannot change
    // the verdict. Explicit .limit() rather than an unbounded read.
    const { data: grants, error: ge } = await db.from('access_grants')
      // unranged-ok: single email + post-cutover window, explicitly capped at 200
      .select('capability,source,tier,actor,created_at')
      .eq('email', email).gt('created_at', SINCE).limit(200);
    if (ge) throw new Error('access_grants: ' + ge.message);
    const { data: prof, error: pe } = await db.from('user_profiles')
      // unranged-ok: user_profiles.email is unique — at most one row by construction
      .select('email,access_briefings,access_team,tier').eq('email', email);
    if (pe) throw new Error('user_profiles: ' + pe.message);
    const { data: ns, error: ne } = await db.from('user_notification_settings')
      // unranged-ok: one settings row per user_email; the check is existence only
      .select('user_email,alerts_enabled,alert_frequency').eq('user_email', email);
    if (ne) throw new Error('user_notification_settings: ' + ne.message);
    const access = await resolveAccess(email);

    const webhookGrants = (grants ?? []).filter((g: any) => g.source === 'stripe_webhook');
    if (!webhookGrants.length) problems.push(`${email}: NO access_grants row from stripe_webhook`);
    // AccessLevel is 'free' | 'pro' only — Team resolves as 'pro' at this seam by
    // design (resolve-access.ts), so 'pro' is the correct expectation for BOTH paid
    // tiers. Asserting a 'team' level here would fail on a working Team account.
    if (access.level !== 'pro') problems.push(`${email}: resolveAccess=${access.level} (expected pro)`);
    if (!ns?.length) problems.push(`${email}: no notification settings row`);

    buyerReports.push({
      email, runtime: access.level, runtime_source: access.source,
      webhook_grants: webhookGrants.length, grant_tiers: webhookGrants.map((g: any) => g.tier),
      profile_exists: Boolean(prof?.length),
      access_briefings: prof?.[0]?.access_briefings ?? null,
      access_team: prof?.[0]?.access_team ?? null,
      settings_row: Boolean(ns?.length),
    });
  }
  add('C', 'entitlement fulfilment', problems.length ? 'FAIL' : 'PASS',
    problems.length ? problems.join(' | ') : `${buyers.length} buyer(s): grant + runtime + settings all present`);
}

const fails = checks.filter((c) => c.verdict === 'FAIL');
const inconclusive = checks.filter((c) => c.verdict === 'INCONCLUSIVE');

if (JSON_OUT) {
  console.log(JSON.stringify({ since: SINCE, read_only: true, checks, buyers: buyerReports,
    post_cutover_purchases: rows.length, mindy_shape: mindyShape.length,
    shop_shape: shopShape.length, legacy_writes: legacyWrites.length,
    overall: fails.length ? 'FAIL' : inconclusive.length ? 'INCONCLUSIVE' : 'PASS' }, null, 2));
} else {
  const B='\x1b[1m',R='\x1b[0m',D='\x1b[2m',G='\x1b[32m',Y='\x1b[33m',Rd='\x1b[31m';
  console.log(`\n${B}Webhook cutover verification${R} ${D}(read-only)${R}`);
  console.log(`${D}since ${SINCE}${ONLY_EMAIL ? ` · email ${ONLY_EMAIL}` : ''}${R}\n`);
  console.log(`  post-cutover purchases : ${rows.length}  ${D}(mindy ${mindyShape.length} · shop ${shopShape.length})${R}`);
  console.log(`  NEW legacy shop rows   : ${legacyWrites.length}\n`);
  for (const c of checks) {
    const col = c.verdict === 'PASS' ? G : c.verdict === 'FAIL' ? Rd : Y;
    const mark = c.verdict === 'PASS' ? '✓' : c.verdict === 'FAIL' ? '✗' : '?';
    console.log(`  ${col}${mark} [${c.id}] ${c.name} — ${c.verdict}${R}`);
    if (c.detail) console.log(`      ${D}${c.detail}${R}`);
  }
  if (buyerReports.length) {
    console.log(`\n${B}Buyers${R}`);
    for (const b of buyerReports) console.log(`  ${JSON.stringify(b)}`);
  }
  console.log(`\n${D}Criteria A (Stripe delivery) is checked in the Stripe dashboard —`);
  console.log(`this script cannot read per-endpoint delivery attempts.${R}`);
  const overall = fails.length ? `${Rd}✗ FAIL` : inconclusive.length ? `${Y}? INCONCLUSIVE` : `${G}✓ PASS`;
  console.log(`\n${overall}${R} — ${checks.length - fails.length - inconclusive.length} pass · ${fails.length} fail · ${inconclusive.length} inconclusive\n`);
  if (fails.length) console.log(`${Rd}${B}ROLLBACK: re-enable we_1Svd6MK5zyiZ50PBcWPS7r2H in Stripe immediately.${R}\n`);
}
process.exit(fails.length ? 1 : 0);
