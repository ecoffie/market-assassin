/**
 * Guarded one-time cleanup: remove Pro from people whose MI Pro / Team subscription has
 * ENDED but who kept access because the live webhook ignored the cancellation.
 *
 *   # 1) Dry run (default). Reads only. Writes a PRIVATE account-level report to --out.
 *   npx tsx --env-file=<.env.local> scripts/revoke-cancelled-app-tier.ts \
 *     --out <private dir outside the repo> [--exclude <file of emails>]
 *
 *   # 2) Execute ONLY the accounts in an approved list produced from a dry run.
 *   npx tsx --env-file=<.env.local> scripts/revoke-cancelled-app-tier.ts \
 *     --out <dir> --exclude <file> --go --approved <dir>/approved.json
 *
 *   # 3) Post-removal verification (fresh process, so no resolver cache).
 *   npx tsx --env-file=<.env.local> scripts/revoke-cancelled-app-tier.ts \
 *     --out <dir> --verify <dir>/approved.json
 *
 * Nothing account-specific lives in this file (the repo is public): exclusions and the
 * approved list are private files passed in, and the per-account report goes to --out.
 * The console prints aggregates only.
 *
 * DISCOVERY is Stripe-first, never the local mirror alone:
 *   - every app-tier (Pro/Team) subscription in Stripe, all statuses, paginated
 *   - every access holder: KV `briefings:*` keys + user_profiles access_briefings/access_team
 * A candidate is an access holder who has ever had an app-tier subscription.
 *
 * ELIGIBLE only when, per account, ALL of:
 *   - every Stripe customer for the email (case-insensitive search) was checked, and every
 *     app-tier subscription is `canceled` with `ended_at` in the past (paid access ended).
 *     active / trialing / past_due / unpaid / incomplete / paused, or a cancel scheduled for
 *     a future period end, means paid access has NOT ended → not eligible.
 *   - at least one app-tier subscription was actually paid and ended (incomplete_expired
 *     alone = never paid through Stripe → access came from somewhere else → review).
 *   - exactly one user_profiles row (ambiguous ownership otherwise)
 *   - no alternative entitlement: staff, advocate, live prepaid, lifetime purchase or
 *     classification, legacy bundle, unexpired time-limited grant, Team access not paid by
 *     an ended Team sub, or Pro via another purchase (the resolver's other sources)
 *   - every one of those checks was ESTABLISHED (any lookup error → not eligible)
 *   - not on the --exclude list
 *
 * --go re-runs every check against the live stores and Stripe immediately before each
 * write, refuses any account not in --approved or whose Stripe customer/subscription ids
 * changed, snapshots the before-state first, is safe to repeat (already-clear accounts
 * are skipped, snapshots are never overwritten), and STOPS the run on the first
 * ambiguous, incomplete, or failed account.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import { appTierOfSubscription, applyRevoke, gatherGuardFacts, revokeBlockReason, LIVE_STATUSES } from '@/lib/billing/revoke-app-tier-on-cancel';

// ---------- args ----------
const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = arg('--out');
const EXCLUDE_FILE = arg('--exclude');
const APPROVED_FILE = arg('--approved');
const VERIFY_FILE = arg('--verify');
const GO = argv.includes('--go');
if (!OUT) throw new Error('--out <private dir outside the repo> is required');
if (path.resolve(OUT).startsWith(path.resolve(process.cwd()))) throw new Error('--out must be OUTSIDE the repo (the report is account-level and private)');
if (GO && !APPROVED_FILE) throw new Error('--go requires --approved <file>');
fs.mkdirSync(path.join(OUT, 'before'), { recursive: true });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const norm = (e: string | null | undefined) => (e || '').toLowerCase().trim();
const excluded = new Set(EXCLUDE_FILE ? fs.readFileSync(EXCLUDE_FILE, 'utf8').split('\n').map(norm).filter(Boolean) : []);

const LIVE = LIVE_STATUSES; // one definition, shared with the webhook

interface StripeState {
  complete: boolean;
  customerIds: string[];
  appSubs: Array<{ id: string; status: string; tier: string; endedAt: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean }>;
  verdict: 'paid_access_ended' | 'still_paid' | 'scheduled_to_cancel' | 'never_paid' | 'no_app_sub' | 'unknown';
  endedTier: 'pro' | 'team' | null;
}

// ---------- Stripe: every customer + every subscription for one email ----------
async function stripeState(email: string): Promise<StripeState> {
  const empty: StripeState = { complete: false, customerIds: [], appSubs: [], verdict: 'unknown', endedTier: null };
  try {
    // Same union as the webhook: exact list (consistent, case-sensitive) + search
    // (case-insensitive, eventually consistent).
    const [listed, searched] = await Promise.all([
      stripe.customers.list({ email, limit: 100 }),
      stripe.customers.search({ query: `email:'${email.replace(/'/g, "\\'")}'`, limit: 100 }),
    ]);
    if (listed.has_more || searched.has_more) return empty;
    const customers = { data: [...new Map([...listed.data, ...searched.data].map((c) => [c.id, c])).values()] };
    const appSubs: StripeState['appSubs'] = [];
    for (const c of customers.data) {
      for await (const s of stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 100 })) {
        const tier = appTierOfSubscription(s);
        if (!tier) continue;
        const item = s.items.data[0] as unknown as { current_period_end?: number };
        const periodEnd = item?.current_period_end ?? (s as unknown as { current_period_end?: number }).current_period_end ?? null;
        appSubs.push({
          id: s.id, status: s.status, tier,
          endedAt: s.ended_at ? new Date(s.ended_at * 1000).toISOString() : null,
          periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          cancelAtPeriodEnd: !!s.cancel_at_period_end || !!s.cancel_at,
        });
      }
    }
    const now = Date.now();
    const live = appSubs.filter((s) => LIVE.has(s.status));
    const paidEnded = appSubs.filter((s) => s.status === 'canceled' && s.endedAt && Date.parse(s.endedAt) <= now);
    let verdict: StripeState['verdict'];
    if (!appSubs.length) verdict = 'no_app_sub';
    else if (live.some((s) => s.cancelAtPeriodEnd)) verdict = 'scheduled_to_cancel';
    else if (live.length) verdict = 'still_paid';
    else if (!paidEnded.length) verdict = 'never_paid';
    else verdict = 'paid_access_ended';
    const latest = [...paidEnded].sort((a, b) => b.endedAt!.localeCompare(a.endedAt!))[0];
    return { complete: true, customerIds: customers.data.map((c) => c.id).sort(), appSubs, verdict, endedTier: (latest?.tier as 'pro' | 'team') ?? null };
  } catch (e) {
    console.error(`[cleanup] Stripe lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    return empty;
  }
}

// ---------- raw store reads (no resolver cache) ----------
async function readStores(email: string) {
  let kvValue: unknown = undefined; let kvOk = true;
  try { kvValue = await kv.get(`briefings:${email}`); } catch { kvOk = false; }
  const prof = await sb.from('user_profiles').select('*').ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`));
  const notif = await sb.from('user_notification_settings').select('user_email, briefings_enabled, paid_status, updated_at').eq('user_email', email);
  const cls = await sb.from('customer_classifications').select('email, briefings_access, has_active_subscription, updated_at').eq('email', email);
  const ok = kvOk && !prof.error && !notif.error && !cls.error;
  const profiles = (prof.data ?? []) as Array<Record<string, unknown>>;
  return {
    ok,
    kvKey: kvValue != null && kvValue !== undefined,
    kvValue,
    profiles,
    notif: notif.data ?? [],
    classification: cls.data ?? [],
    errors: [!kvOk && 'kv', prof.error?.message, notif.error?.message, cls.error?.message].filter(Boolean),
  };
}

type Stores = Awaited<ReturnType<typeof readStores>>;

// ---------- full per-account evaluation ----------
async function evaluate(email: string, opts: { resolver: boolean }) {
  const reasons: string[] = [];
  const [st, stores] = await Promise.all([stripeState(email), readStores(email)]);
  if (!st.complete) reasons.push('incomplete:stripe');
  if (!stores.ok) reasons.push(`incomplete:stores(${stores.errors.join(',')})`);
  if (excluded.has(email)) reasons.push('excluded_pending_review');
  if (st.complete && st.verdict !== 'paid_access_ended') reasons.push(`stripe:${st.verdict}`);
  if (stores.profiles.length !== 1) reasons.push(`ambiguous_ownership:profile_rows=${stores.profiles.length}`);

  const p = stores.profiles[0];
  if (p?.briefings_expires_at && Date.parse(String(p.briefings_expires_at)) > Date.now()) reasons.push('time_limited_grant_active');
  if (p?.access_team && st.endedTier !== 'team') reasons.push('team_access_from_other_source');

  const facts = await gatherGuardFacts(sb, stripe, email, null);
  const block = revokeBlockReason(facts);
  if (block) reasons.push(block.startsWith('guard_unknown') ? `incomplete:${block}` : block);

  let resolver: { tier: string; otherSources: string[] } | null = null;
  if (opts.resolver) {
    try {
      const r = await verifyMIAccess(email);
      const otherSources = Object.entries(r.sources ?? {}).filter(([k, v]) => v && k !== 'briefings').map(([k]) => k);
      resolver = { tier: r.tier, otherSources };
      if (otherSources.length) reasons.push(`pro_via_other_purchase:${otherSources.join('+')}`);
    } catch { reasons.push('incomplete:resolver'); }
  }

  const holds = stores.kvKey || stores.profiles.some((r) => r.access_briefings || r.access_team);
  return { email, eligible: reasons.length === 0 && holds, holds, reasons, stripe: st, stores, resolver };
}

const accountId = (e: string) => createHash('sha256').update(e).digest('hex').slice(0, 12);

// ---------- discovery ----------
async function discover(): Promise<{ candidates: string[]; holderKv: Set<string>; holderProfile: Set<string>; profileRows: number; appSubEmails: Set<string> }> {
  // 1) Every app-tier subscription in Stripe, all statuses.
  const appSubEmails = new Set<string>();
  for await (const s of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] })) {
    if (!appTierOfSubscription(s)) continue;
    const c = s.customer as Stripe.Customer | Stripe.DeletedCustomer;
    if (!('deleted' in c && c.deleted)) { const e = norm((c as Stripe.Customer).email); if (e) appSubEmails.add(e); }
  }
  // 2) Access holders: KV keys.
  const holderKv = new Set<string>();
  for await (const key of kv.scanIterator({ match: 'briefings:*', count: 1000 })) {
    const e = norm(String(key).slice('briefings:'.length));
    if (e.includes('@')) holderKv.add(e);
  }
  // 3) Access holders: profile flags (paginated past the 1,000-row cap).
  const holderProfile = new Set<string>(); let profileRows = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('user_profiles').select('email').or('access_briefings.eq.true,access_team.eq.true').range(from, from + 999);
    if (error) throw new Error(`user_profiles scan failed: ${error.message}`);
    for (const r of data ?? []) { profileRows++; holderProfile.add(norm(r.email)); }
    if (!data || data.length < 1000) break;
  }
  const candidates = [...new Set([...holderKv, ...holderProfile])].filter((e) => appSubEmails.has(e)).sort();
  return { candidates, holderKv, holderProfile, profileRows, appSubEmails };
}

function tally(rows: Array<{ eligible: boolean; reasons: string[] }>) {
  const t: Record<string, number> = {};
  for (const r of rows) for (const x of r.eligible ? ['ELIGIBLE'] : r.reasons) { const k = x.replace(/=\d+$/, '=N'); t[k] = (t[k] ?? 0) + 1; }
  return t;
}

// ---------- modes ----------
async function dryRun() {
  const d = await discover();
  const rows = [];
  for (const email of d.candidates) rows.push(await evaluate(email, { resolver: true }));
  const eligible = rows.filter((r) => r.eligible);
  const approved = eligible.map((r) => ({
    email: r.email,
    account: accountId(r.email),
    customerIds: r.stripe.customerIds,
    subIds: r.stripe.appSubs.map((s) => s.id).sort(),
    tier: r.stripe.endedTier,
  }));
  fs.writeFileSync(path.join(OUT!, 'dry-run-report.json'), JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
  fs.writeFileSync(path.join(OUT!, 'approved.proposed.json'), JSON.stringify(approved, null, 2));
  console.log(JSON.stringify({
    mode: 'DRY RUN (no writes)',
    discovery: {
      stripe_app_tier_emails: d.appSubEmails.size,
      kv_briefings_keys: d.holderKv.size,
      profile_rows_with_access: d.profileRows,
      unique_profile_emails_with_access: d.holderProfile.size,
      candidates_unique_accounts: d.candidates.length,
      candidates_with_kv_key: rows.filter((r) => r.stores.kvKey).length,
      candidates_with_profile_flag: rows.filter((r) => r.stores.profiles.some((p) => p.access_briefings || p.access_team)).length,
      candidates_kv_only: rows.filter((r) => r.stores.kvKey && !r.stores.profiles.some((p) => p.access_briefings || p.access_team)).length,
      candidates_profile_only: rows.filter((r) => !r.stores.kvKey && r.stores.profiles.some((p) => p.access_briefings || p.access_team)).length,
      candidate_profile_rows: rows.reduce((n, r) => n + r.stores.profiles.length, 0),
    },
    outcome: tally(rows),
    eligible: eligible.length,
    report: path.join(OUT!, 'dry-run-report.json'),
  }, null, 2));
}

async function execute() {
  const approved: Array<{ email: string; account: string; customerIds: string[]; subIds: string[]; tier: 'pro' | 'team' }> =
    JSON.parse(fs.readFileSync(APPROVED_FILE!, 'utf8'));
  const log = path.join(OUT!, 'applied.jsonl');
  let done = 0, skipped = 0;
  for (const a of approved) {
    const email = norm(a.email);
    // Re-check EVERYTHING now: raw stores, every Stripe customer/sub, every alternative
    // entitlement, and the resolver's other Pro sources. The resolver's 30s cache is empty
    // for this account (first read in this process), so it reflects the live stores.
    const ev = await evaluate(email, { resolver: true });
    if (!ev.holds) { skipped++; fs.appendFileSync(log, JSON.stringify({ account: a.account, email, result: 'already_clear', at: new Date().toISOString() }) + '\n'); continue; }
    const sameIds = JSON.stringify(ev.stripe.customerIds) === JSON.stringify(a.customerIds)
      && JSON.stringify(ev.stripe.appSubs.map((s) => s.id).sort()) === JSON.stringify(a.subIds);
    if (!sameIds) throw new Error(`STOP ${a.account}: Stripe customer/subscription ids changed since approval`);
    if (!ev.eligible) throw new Error(`STOP ${a.account}: no longer eligible: ${ev.reasons.join(', ')}`);

    const snap = path.join(OUT!, 'before', `${a.account}.json`);
    if (!fs.existsSync(snap)) fs.writeFileSync(snap, JSON.stringify({ email, at: new Date().toISOString(), stores: ev.stores, stripe: ev.stripe }, null, 2));

    const failures = await applyRevoke(sb, email, a.tier);
    const after: Stores = await readStores(email);
    const clear = after.ok && !after.kvKey && after.profiles.every((p) => !p.access_briefings && (a.tier !== 'team' || !p.access_team));
    fs.appendFileSync(log, JSON.stringify({ account: a.account, email, result: clear && !failures.length ? 'revoked' : 'FAILED', failures, at: new Date().toISOString() }) + '\n');
    if (!clear || failures.length) throw new Error(`STOP ${a.account}: write incomplete: ${failures.join('; ') || 'store still grants access'}`);
    done++;
  }
  console.log(JSON.stringify({ mode: 'EXECUTED', revoked: done, already_clear: skipped, next: 'run --verify in a fresh process' }, null, 2));
}

async function verify() {
  const approved: Array<{ email: string; account: string }> = JSON.parse(fs.readFileSync(VERIFY_FILE!, 'utf8'));
  const out = [];
  for (const a of approved) {
    const r = await verifyMIAccess(norm(a.email)); // fresh process: no 30s access cache
    out.push({ account: a.account, email: a.email, tier: r.tier, briefings: !!r.sources?.briefings, pass: r.tier === 'free' && !r.sources?.briefings });
  }
  fs.writeFileSync(path.join(OUT!, 'verify.json'), JSON.stringify(out, null, 2));
  const failed = out.filter((x) => !x.pass).length;
  console.log(JSON.stringify({ mode: 'VERIFY', checked: out.length, pass: out.length - failed, fail: failed }, null, 2));
  if (failed) process.exit(1);
}

(VERIFY_FILE ? verify() : GO ? execute() : dryRun()).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
