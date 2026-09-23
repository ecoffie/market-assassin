/**
 * ACCEPTANCE — Opportunity Share Attribution, one synthetic journey end to end, in a REAL browser
 * against a REAL server (local production build) and the REAL database.
 *
 *   User A shares opportunity X            → listing_share gets share_id S
 *   anonymous browsers B1..B4 open the link → arrival records S + X + anon B
 *   each B becomes an account through one auth class (Google-class and Microsoft-class via
 *     mi-session, email via mindy-complete-signup, password via mi-login)
 *                                          → anonymous attribution is associated with the account
 *   one account activates within 7 days and purchases (inside a ROLLED-BACK transaction — no
 *     synthetic revenue or saves ever persist)
 *                                          → the funnel query attributes the purchase to S, X, A
 *
 * Plus the negative controls: direct / alert / briefing / saved-search / plain listing links are
 * not share; a fake sh and a real sh lifted onto another opportunity attribute nothing; a second
 * share does not move first touch; visitors who never sign up stay anonymous.
 *
 * Only the Google/Microsoft CONSENT SCREENS are not driven (cannot run headless): those accounts
 * carry app_metadata.provider google/azure and obtain a real Supabase session, which then goes
 * through the same mi-session route a real OAuth return uses.
 *
 * Writes a handful of clearly synthetic rows (share-attribution-acceptance+…@getmindy.ai, fresh
 * anon ids) and DELETES every one of them at the end, then proves the counts are zero.
 *
 *   npx tsx scripts/acceptance/share-attribution-e2e.mts            # dry: prints the plan
 *   E2E_BASE=http://localhost:3999 npx tsx scripts/acceptance/share-attribution-e2e.mts --go
 */
import 'dotenv/config';
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

const GO = process.argv.includes('--go');
const BASE = process.env.E2E_BASE || 'http://localhost:3999';
const X = process.env.E2E_X || '1d0334b6ca824be59e69f4965cee4262';
const Y = process.env.E2E_Y || '164e0be63e4b481796eb2b28c1238189';
const RUN = Date.now().toString(36);
const mail = (tag: string) => `share-attribution-acceptance+${tag}-${RUN}@getmindy.ai`;
const SHARER = mail('sharer');
const CLASSES = [
  { key: 'google', provider: 'google', route: 'mi-session' },
  { key: 'microsoft', provider: 'azure', route: 'mi-session' },
  { key: 'email', provider: 'email', route: 'mindy-complete-signup' },
  { key: 'password', provider: 'email', route: 'mi-login' },
] as const;

type Posted = { eventType: string; email: string; metadata: Record<string, unknown> };
const proof: Record<string, unknown> = { run: RUN, base: BASE, X, Y };
const failures: string[] = [];
const check = (label: string, ok: boolean, detail?: unknown) => {
  (proof.checks ??= [] as unknown[]) && (proof.checks as unknown[]).push({ label, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 220) : ''}`);
  if (!ok) failures.push(label);
};

if (!GO) {
  console.log(`DRY RUN. Would drive ${BASE}/opportunity-map with X=${X}, create 4 synthetic accounts (${CLASSES.map((c) => c.key).join(', ')}),`);
  console.log('write ~20 synthetic user_engagement rows + 4 signup_attribution rows, then delete all of them. Pass --go.');
  process.exit(0);
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anonClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const { createMIAuthSessionToken } = await import('../../src/lib/two-factor-session');

async function page(ctxBrowser: Browser, opts: { token?: string } = {}) {
  const ctx = await ctxBrowser.createBrowserContext();
  const p = await ctx.newPage();
  const posted: Posted[] = [];
  p.on('request', (r) => {
    if (r.url().includes('/api/app/engagement') && r.method() === 'POST') {
      try { posted.push(JSON.parse(r.postData() || '{}')); } catch { /* ignore */ }
    }
  });
  await p.evaluateOnNewDocument((token?: string) => {
    if (token) localStorage.setItem('mi_beta_auth_token', token);
    // Capture what Share copies (headless has no real clipboard).
    try { (Clipboard.prototype as unknown as { writeText: (t: string) => Promise<void> }).writeText = function (t: string) { (window as unknown as { __copied: string }).__copied = t; return Promise.resolve(); }; } catch { /* no Clipboard API */ }
  }, opts.token);
  return { ctx, p, posted };
}

async function waitFor<T>(fn: () => T | undefined | null | false, ms = 30000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 250));
  }
}
const drawerTitle = (p: Page) => p.evaluate(() => {
  const d = document.getElementById('oppDrawer');
  return d ? (d.innerText || '').slice(0, 200) : '';
});
async function cookiesOf(p: Page) {
  const all = await p.browserContext().cookies();
  const pick = (n: string) => all.find((c) => c.name === n)?.value;
  return { mindy_anon: pick('mindy_anon'), gca_attr: pick('gca_attr') };
}

const anonIds: string[] = [];
const createdUsers: { id: string; email: string }[] = [];
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  // ── SHARE ───────────────────────────────────────────────────────────────────
  console.log('\nSHARE');
  const A = await page(browser, { token: createMIAuthSessionToken(SHARER) });
  await A.p.goto(`${BASE}/opportunity-map?opp=${X}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await A.p.waitForFunction(() => { const b = document.getElementById('oppShare'); return !!b && (window as unknown as { CUR?: unknown }).CUR !== undefined; }, { timeout: 90000 }).catch(() => {});
  await A.p.waitForFunction((x: string) => (document.getElementById('oppDrawer')?.innerText || '').length > 20 && document.body.innerHTML.includes(x.slice(0, 8)) , { timeout: 90000 }, X).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await A.p.click('#oppShare');
  const url1 = await A.p.waitForFunction(() => (window as unknown as { __copied?: string }).__copied, { timeout: 15000 }).then((h) => h.jsonValue() as Promise<string>);
  const S = new URL(url1).searchParams.get('sh')!;
  proof.shared_url = url1; proof.S = S;
  check('copied link is ?opp=X&src=share&sh=<uuid>', new URL(url1).searchParams.get('opp') === X && new URL(url1).searchParams.get('src') === 'share' && /^[0-9a-f-]{36}$/.test(S), url1);
  const shareEvt = await waitFor(() => A.posted.find((e) => e.metadata?.action === 'listing_share'));
  check('listing_share carries share_id, notice_id, kind, method; sharer is the authenticated email',
    shareEvt.metadata.share_id === S && shareEvt.metadata.notice_id === X && shareEvt.metadata.kind === 'opp' && shareEvt.metadata.method === 'clipboard' && shareEvt.email === SHARER.toLowerCase(), shareEvt);
  // A second click is a second share event with a different id.
  (await A.p.evaluate(() => { (window as unknown as { __copied?: string }).__copied = ''; }));
  await A.p.click('#oppShare');
  const url1b = await A.p.waitForFunction(() => (window as unknown as { __copied?: string }).__copied, { timeout: 15000 }).then((h) => h.jsonValue() as Promise<string>);
  check('each click is its own share_id', new URL(url1b).searchParams.get('sh') !== S);

  // A also shares Y (used later: another shared opportunity must not move first touch).
  await A.p.goto(`${BASE}/opportunity-map?opp=${Y}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await A.p.waitForFunction((y: string) => document.body.innerHTML.includes(y.slice(0, 8)), { timeout: 90000 }, Y).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  await A.p.evaluate(() => { (window as unknown as { __copied?: string }).__copied = ''; });
  await A.p.click('#oppShare');
  const url2 = await A.p.waitForFunction(() => (window as unknown as { __copied?: string }).__copied, { timeout: 15000 }).then((h) => h.jsonValue() as Promise<string>);
  const S2 = new URL(url2).searchParams.get('sh')!;
  proof.S2 = S2;
  await new Promise((r) => setTimeout(r, 1500));

  // ── ARRIVALS ────────────────────────────────────────────────────────────────
  console.log('\nARRIVAL (4 anonymous browsers via the shared link)');
  const Bs: { key: string; ctx: Awaited<ReturnType<typeof page>>; anon: string; cookies: Awaited<ReturnType<typeof cookiesOf>> }[] = [];
  for (const c of CLASSES) {
    const b = await page(browser);
    await b.p.goto(url1, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const view = await waitFor(() => b.posted.find((e) => e.metadata?.action === 'map_view'), 60000);
    await b.p.waitForFunction(() => /life raft/i.test(document.getElementById('oppDrawer')?.innerText || ''), { timeout: 60000 }).catch(() => {});
    const title = await drawerTitle(b.p);
    const cookies = await cookiesOf(b.p);
    anonIds.push(view.email);
    Bs.push({ key: c.key, ctx: b, anon: view.email, cookies });
    check(`[${c.key}] arrival: map_view entry=share, share_id=S, notice_id=X, anon visitor, first-touch time`,
      view.metadata.entry === 'share' && view.metadata.share_id === S && view.metadata.notice_id === X && /^anon:/.test(view.email) && !!view.metadata.ft_at, view.metadata);
    // Strict: the drawer must show X's own title (the fixture opportunity), not just any content.
    check(`[${c.key}] the shared link opened opportunity X's drawer`, /life raft/i.test(title), title.replace(/\s+/g, ' ').slice(0, 120));
    check(`[${c.key}] mindy_anon + gca_attr cookies written; first_touch names S`,
      decodeURIComponent(cookies.mindy_anon || '') === view.email && JSON.parse(decodeURIComponent(cookies.gca_attr || '{}')).first_touch?.share_id === S);
  }

  // Another shared opportunity (S2 on Y) in B1's browser does not overwrite first touch.
  await Bs[0].ctx.p.goto(url2, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitFor(() => Bs[0].ctx.posted.filter((e) => e.metadata?.action === 'map_view').length >= 2, 60000);
  const ga = JSON.parse(decodeURIComponent((await cookiesOf(Bs[0].ctx.p)).gca_attr || '{}'));
  check('second shared opportunity: first_touch stays S, last_touch moves to S2', ga.first_touch?.share_id === S && ga.last_touch?.share_id === S2, { first: ga.first_touch?.share_id, last: ga.last_touch?.share_id });
  Bs[0].cookies = await cookiesOf(Bs[0].ctx.p);

  // ── CONTROLS ────────────────────────────────────────────────────────────────
  console.log('\nCONTROLS (not share)');
  const randomSh = '00000000-1111-4222-8333-444444444444';
  const controls: [string, string, string][] = [
    ['direct', '/opportunity-map', 'direct'],
    ['plain listing link (alerts/briefings/today)', `/opportunity-map?opp=${X}`, 'listing_link'],
    ['alert link', `/opportunity-map?opp=${X}&src=alert`, 'alert'],
    ['briefing link', `/opportunity-map?src=pursuit_brief`, 'pursuit_brief'],
    ['saved-search link', `/opportunity-map?ss=00000000-0000-4000-8000-000000000000`, 'saved_search'],
    ['malformed sh', `/opportunity-map?opp=${X}&src=share&sh=not-a-share`, 'share_invalid'],
    ['fake well-formed sh', `/opportunity-map?opp=${X}&src=share&sh=${randomSh}`, 'share'],
    ['real sh lifted onto another opportunity', `/opportunity-map?opp=${Y}&src=share&sh=${S}`, 'share'],
  ];
  const controlAnons: Record<string, string> = {};
  for (const [label, path, entry] of controls) {
    const c = await page(browser);
    await c.p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const v = await waitFor(() => c.posted.find((e) => e.metadata?.action === 'map_view'), 60000);
    anonIds.push(v.email); controlAnons[label] = v.email;
    check(`${label}: entry=${entry}`, v.metadata.entry === entry, { entry: v.metadata.entry, share_id: v.metadata.share_id ?? null });
    await c.ctx.close();
  }

  // Engagement writes are async; give the server a moment to persist.
  await new Promise((r) => setTimeout(r, 3000));

  // ── SIGNUP (every auth class) ─────────────────────────────────────────────────
  console.log('\nSIGNUP → anonymous history associated with the account');
  const accounts: Record<string, string> = {};
  for (const b of Bs) {
    const cls = CLASSES.find((c) => c.key === b.key)!;
    const email = mail(cls.key);
    const password = `E2e-${RUN}-${Math.random().toString(36).slice(2)}!`;
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { provider: cls.provider, providers: [cls.provider] },
    });
    if (cErr || !created.user) throw new Error(`createUser failed: ${cErr?.message}`);
    createdUsers.push({ id: created.user.id, email });
    accounts[cls.key] = email;
    const cookie = `mindy_anon=${b.cookies.mindy_anon}; gca_attr=${b.cookies.gca_attr}`;
    let res: Response;
    if (cls.route === 'mi-login') {
      res = await fetch(`${BASE}/api/auth/mi-login`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ email, password }) });
    } else {
      const { data: s, error: sErr } = await anonClient().auth.signInWithPassword({ email, password });
      if (sErr || !s.session) throw new Error(`session failed: ${sErr?.message}`);
      res = await fetch(`${BASE}/api/auth/${cls.route}`, { method: 'POST', headers: { authorization: `Bearer ${s.session.access_token}`, cookie } });
    }
    check(`[${cls.key}] ${cls.route} → ${res.status}`, res.status === 200);
  }
  let attrRows: Record<string, unknown>[] = [];
  for (let i = 0; i < 40; i++) {
    const { data, error } = await admin.from('signup_attribution')
      .select('email, anon_id, share_id, entry, source, first_touch, first_touch_at, claimed_at')
      .in('email', Object.values(accounts)).limit(20);
    if (error) throw new Error(error.message);
    attrRows = data ?? [];
    if (attrRows.length >= CLASSES.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  proof.signup_attribution = attrRows;
  for (const b of Bs) {
    const r = attrRows.find((x) => x.email === accounts[b.key]);
    check(`[${b.key}] signup_attribution: anon_id=B, share_id=S, entry=share, first_touch.share_id=S`,
      !!r && r.anon_id === b.anon && r.share_id === S && r.entry === 'share' && (r.first_touch as Record<string, string>)?.share_id === S, r);
  }

  // Controls that never signed up stay anonymous (no account row names them).
  const { data: ctlRows, error: ctlErr } = await admin.from('signup_attribution').select('email, anon_id').in('anon_id', Object.values(controlAnons)).limit(20);
  if (ctlErr) throw new Error(ctlErr.message);
  check('anonymous visitors who never signed up stay anonymous (no account row)', (ctlRows ?? []).length === 0);

  // Fake / lifted sh never resolve, even if their browser signs up.
  const { resolveFirstShareArrival } = await import('../../src/lib/attribution/share-attribution');
  for (const label of ['fake well-formed sh', 'real sh lifted onto another opportunity']) {
    const r = await resolveFirstShareArrival(admin, controlAnons[label]);
    check(`${label}: resolves to NO share`, r.ok && r.arrival === null, r);
  }

  // ── CHECKOUT carries the share (existing gca_attr → /checkout → KV path) ─────────
  console.log('\nCHECKOUT');
  const ck = await fetch(`${BASE}/checkout/mindy-pro-monthly`, { redirect: 'manual', headers: { cookie: `gca_attr=${Bs[0].cookies.gca_attr}` } });
  const ref = new URL(ck.headers.get('location') || 'http://x').searchParams.get('client_reference_id');
  const { getCheckoutStart } = await import('../../src/lib/purchase-attribution');
  const start = ref ? await getCheckoutStart(ref) : null;
  check('checkout record (what the Stripe webhook joins) carries first_touch share_id=S + notice X',
    (start?.attribution?.first_touch as Record<string, string> | undefined)?.share_id === S && (start?.attribution?.first_touch as Record<string, string> | undefined)?.notice_id === X,
    { status: ck.status, ref, first_touch: start?.attribution?.first_touch });
  if (ref) { const { kv } = await import('@vercel/kv'); await kv.del(`gfd:purchase:mindy:checkout:${ref}`).catch(() => {}); }

  // ── ACTIVATION + PAID + REPORT (rolled back) ─────────────────────────────────
  console.log('\nACTIVATION + PAID + REPORT (inside a transaction that is ROLLED BACK)');
  const sql = readFileSync(join(process.cwd(), 'src/lib/attribution/share-funnel.sql'), 'utf8');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    // google: activates (a saved search) on day 1 and pays.
    await client.query(`INSERT INTO saved_searches (user_email, name, alerts_enabled, created_at)
      SELECT $1, 'e2e activation', false, u.created_at + interval '1 day' FROM auth.users u WHERE lower(u.email) = lower($1)`, [accounts.google]);
    await client.query(`INSERT INTO purchases (user_email, product_id, product_name, amount_paid, status, stripe_session_id, created_at)
      SELECT $1, 'mindy-pro-monthly', 'Mindy Pro (E2E, rolled back)', 149, 'completed', $2, u.created_at + interval '2 days' FROM auth.users u WHERE lower(u.email) = lower($1)`, [accounts.google, `cs_e2e_${RUN}`]);
    // password: acts on day 8 → OUTSIDE the 7-day window, must NOT count as activated.
    await client.query(`INSERT INTO saved_searches (user_email, name, alerts_enabled, created_at)
      SELECT $1, 'e2e late', false, u.created_at + interval '8 days' FROM auth.users u WHERE lower(u.email) = lower($1)`, [accounts.password]);
    const { rows: funnel } = await client.query(`SELECT * FROM (${sql}) f WHERE f.share_id IN ($1, $2)`, [S, S2]);
    proof.funnel = funnel;
    const f = funnel.find((r) => r.share_id === S);
    console.log('   share_id S row:', JSON.stringify(f));
    check('report: share S names opportunity X and sharer User A', f?.notice_id === X && f?.sharer === SHARER.toLowerCase() && f?.method === 'clipboard');
    check('report: 4 unique share visitors (controls with fake/lifted sh excluded)', Number(f?.share_visitors) === 4, f?.share_visitors);
    check('report: 4 signups (one per auth class)', Number(f?.signups) === 4, f?.signups);
    check('report: 1 activated within 7 days (day-8 action excluded)', Number(f?.activated_7d) === 1, f?.activated_7d);
    check('report: 1 paid customer, $149.00 attributed to S / X / User A', Number(f?.paid_customers) === 1 && Number(f?.revenue_cents) === 14900, { paid: f?.paid_customers, revenue_cents: f?.revenue_cents });
    const g = funnel.find((r) => r.share_id === S2);
    check('report: second share S2 (on Y) got the visit but NOT the signup (first touch stays S)', Number(g?.share_visitors) === 1 && Number(g?.signups) === 0, g);
    const { rows: seg } = await client.query(`SELECT notice_id, sharer, method, shared_on, SUM(share_visitors)::int visitors, SUM(signups)::int signups,
        SUM(activated_7d)::int activated_7d, SUM(paid_customers)::int paid, SUM(revenue_cents)::int revenue_cents, COUNT(*)::int shares
      FROM (${sql}) f WHERE f.sharer = $1 GROUP BY 1,2,3,4 ORDER BY 1`, [SHARER.toLowerCase()]);
    proof.segmented = seg;
    console.log('   segmented by opportunity/sharer/method/date:', JSON.stringify(seg));
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
} catch (err) {
  failures.push(`ERROR: ${(err as Error).message}`);
  console.error(err);
} finally {
  await browser.close();
  // ── CLEANUP — every synthetic row, then prove it's gone ─────────────────────────
  console.log('\nCLEANUP');
  const emails = [SHARER, ...CLASSES.map((c) => mail(c.key))].map((e) => e.toLowerCase());
  const owners = [...emails, ...anonIds];
  const del = async (table: string, col: string, vals: string[]) => {
    const { count, error } = await admin.from(table).delete({ count: 'exact' }).in(col, vals);
    if (error) console.error(`  ✗ cleanup ${table}: ${error.message}`);
    return count;
  };
  const cleaned = {
    user_engagement: await del('user_engagement', 'user_email', owners),
    signup_attribution: await del('signup_attribution', 'email', emails),
    user_notification_settings: await del('user_notification_settings', 'user_email', emails),
    user_profiles: await del('user_profiles', 'email', emails),
  };
  for (const u of createdUsers) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  const left: Record<string, number | null> = {};
  for (const [t, col, vals] of [['user_engagement', 'user_email', owners], ['signup_attribution', 'email', emails], ['user_notification_settings', 'user_email', emails], ['user_profiles', 'email', emails]] as const) {
    const { count, error } = await admin.from(t).select('*', { count: 'exact', head: true }).in(col, vals as unknown as string[]);
    left[t] = error ? null : count;
  }
  proof.cleanup = { deleted: cleaned, remaining: left, auth_users_deleted: createdUsers.length };
  console.log('  deleted', JSON.stringify(cleaned), 'remaining', JSON.stringify(left));
  if (Object.values(left).some((n) => n !== 0)) failures.push('cleanup left synthetic rows');
  proof.failures = failures;
  const out = process.env.E2E_PROOF || `share-attribution-e2e-proof-${RUN}.json`;
  writeFileSync(out, JSON.stringify(proof, null, 2));
  console.log(`\n${failures.length ? `✗ ${failures.length} FAILED` : '✓ ALL CHECKS PASSED'} — proof: ${out}`);
  process.exit(failures.length ? 1 : 0);
}
