/**
 * ACCEPTANCE — legacy-product retirement into Mindy, with REAL sign-in, in a real browser,
 * against a local build of THIS checkout, with ZERO production writes.
 *
 *   npx tsx scripts/acceptance/legacy-retirement/run.mts --out <dir> [--prod]
 *
 *   --prod   `next build` + `next start` (a production build of the exact checkout).
 *            Default is `next dev`.
 *
 * REAL in this run: the app from this checkout (routing, proxy, /app, sign-in UI and API
 * routes, 2FA, magic-link generation, OAuth return handling, access resolution, report
 * generation), production Supabase READS for non-fixture data, headless Chrome.
 *
 * ISOLATED (and why):
 *   • Identity provider → a local fake GoTrue that knows ONLY @acceptance.invalid fixtures.
 *     Password grant, magic link (generate_link → verify) and the Google PKCE round-trip are all
 *     served by it. Google's consent screen is the one simulated step: /authorize returns
 *     `?code=` for the chosen identity immediately.
 *   • Mail → a local fake Resend (RESEND_BASE_URL). The test reads the 2FA code and the magic
 *     link from what the app actually sent. Nothing is delivered.
 *   • KV → a local Upstash-protocol fake seeded with fixture grants (the real KV is never used).
 *   • Supabase REST → a proxy: fixture reads/writes are local (writes kept in memory so the app
 *     can read them back), other GETs are forwarded, every other write is absorbed. The run
 *     FAILS if any write is forwarded.
 *   • Postgres, Redis TCP, QStash, SMTP, Stripe, GHL, Slack, Twilio, LLM, SAM, BigQuery → blank.
 *   • Session/2FA signing secret and the Supabase JWT secret → harness-only random values.
 *
 * Adam and Andre are NOT used, read, or impersonated. Every identity is synthetic.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { FIXTURES as RAW_FIXTURES, kvSeed, authUsers } from './fixtures.mjs';
import { startFakeKv, startReadOnlySupabase, startFakeResend } from './stubs.mjs';

interface Fixture {
  email: string; signIn: 'password' | 'magic' | 'google'; password?: string; provider?: string;
  kv: Record<string, unknown>; maCookie: string | null; expectTier: 'pro' | 'free'; legacyEntry: string;
  accessCode?: string; settings?: Record<string, unknown>;
}
type Mail = { to: string; subject: string; html: string; text: string; at: number };
const FIXTURES = RAW_FIXTURES as unknown as Record<string, Fixture>;

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const argOut = process.argv.indexOf('--out');
const OUT = resolve(argOut > -1 ? process.argv[argOut + 1] : join(ROOT, 'tmp', 'legacy-retirement-acceptance'));
mkdirSync(OUT, { recursive: true });
const PROD = process.argv.includes('--prod');
const argOnly = process.argv.indexOf('--only');
const ONLY = argOnly > -1 ? process.argv[argOnly + 1].split(',') : null;   // debugging a subset
const PORT = Number(process.env.ACCEPT_PORT || 3218);
const KV_PORT = 18901, SB_PORT = 18902, MAIL_PORT = 18903;
const BASE = `http://localhost:${PORT}`;
const SB = `http://127.0.0.1:${SB_PORT}`;
const SECRET = randomBytes(24).toString('hex');
const JWT_SECRET = randomBytes(32).toString('hex');

function envFromFile(name: string): string {
  const line = readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return (line || '').slice(name.length + 1).replace(/^["']|["']$/g, '').trim();
}

const BLANK = [
  'DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_HOST',
  'POSTGRES_PASSWORD', 'POSTGRES_USER', 'POSTGRES_DATABASE', 'REDIS_URL', 'KV_URL',
  'QSTASH_TOKEN', 'QSTASH_URL', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY',
  'RESEND_WEBHOOK_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_PORT',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_TEST_SECRET_KEY', 'STRIPE_TEST_WEBHOOK_SECRET',
  'GHL_API_KEY', 'GHL_LOCATION_ID', 'GHL_INBOUND_WEBHOOK_SECRET', 'SLACK_BOT_TOKEN', 'SLACK_LEAD_WEBHOOK_URL',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'APIFY_TOKEN',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'BRIEFING_ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'PERPLEXITY_API_KEY',
  'SERPER_API_KEY', 'GOVINFO_API_KEY', 'SAM_API_KEY', 'SAM_API_KEY_1', 'SAM_API_KEY_2', 'SAM_API_KEY_BACKUP',
  'GCP_SA_JSON', 'NEXT_PUBLIC_PLANNER_SUPABASE_URL', 'PLANNER_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_REPLICA_URL',
  'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_TARGET_ENV', 'NEXT_PUBLIC_GA_ID', 'NEXT_PUBLIC_GOOGLE_ADS_ID',
  'MA_ACCESS_PASSWORD', 'RECOMPETE_ACCESS_PASSWORD', 'LEGACY_SHARED_PASSWORD_ACCESS',
];

async function waitFor(url: string, ms = 600_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url, { redirect: 'manual' }); if (r.status < 500) return; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timeout waiting for ${url}`);
}

type Check = { name: string; pass: boolean; detail: unknown };
const results: Record<string, { checks: Check[] }> = {};
const check = (who: string, name: string, pass: boolean, detail: unknown = null) => {
  (results[who] ||= { checks: [] }).checks.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} [${who}] ${name}`, pass ? '' : String(JSON.stringify(detail ?? null)).slice(0, 400));
};

const text = (page: Page) => page.evaluate(() => document.body?.innerText || '');
async function settle(page: Page) { await page.waitForNetworkIdle({ idleTime: 800, timeout: 45_000 }).catch(() => {}); }
async function rendered(page: Page, pattern: RegExp, ms = 150_000) {
  await page.waitForFunction(
    (src: string) => new RegExp(src, 'i').test(document.body?.innerText || '') && !/Loading Mindy/i.test(document.body?.innerText || ''),
    { timeout: ms, polling: 500 }, pattern.source,
  ).catch(() => {});
}
async function goto(page: Page, path: string) {
  await page.goto(path.startsWith('http') ? path : `${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
  await settle(page);
  const u = new URL(page.url());
  return { path: u.pathname, search: u.search, panel: u.searchParams.get('panel'), url: `${u.pathname}${u.search}` };
}
const loc = (page: Page) => { const u = new URL(page.url()); return { path: u.pathname, panel: u.searchParams.get('panel'), url: `${u.pathname}${u.search}` }; };
const entitlement = (page: Page, email: string) => page.evaluate(async (e) => {
  const r = await fetch(`/api/access/check?email=${encodeURIComponent(e)}`, {
    headers: { 'x-mi-auth-token': localStorage.getItem('mi_beta_auth_token') || '' },
  });
  return { status: r.status, body: await r.json().catch(() => null), hasToken: !!localStorage.getItem('mi_beta_auth_token') };
}, email);

async function clickByText(page: Page, re: RegExp) {
  const ok = await page.evaluate((src: string) => {
    const el = [...document.querySelectorAll('button, a')].find((b) => new RegExp(src, 'i').test((b as HTMLElement).innerText || '')) as HTMLElement | undefined;
    if (!el) return false; el.click(); return true;
  }, re.source);
  if (!ok) throw new Error(`no button matching ${re}`);
}
async function typeInto(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 120_000 });
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(selector, value, { delay: 5 });
}
async function waitForMail(outbox: Mail[], to: string, since: number, re: RegExp, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = [...outbox].reverse().find((x) => x.to.includes(to) && x.at >= since && re.test(`${x.html}\n${x.text}`));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function main() {
  const supabaseUpstream = envFromFile('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseUpstream) throw new Error('NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
  const kv = await startFakeKv(KV_PORT, kvSeed());
  const sb = await startReadOnlySupabase(SB_PORT, supabaseUpstream, { jwtSecret: JWT_SECRET, authUsers: authUsers() as Record<string, { password?: string; provider?: string }> });
  const mail = (await startFakeResend(MAIL_PORT)) as { server: import('node:http').Server; outbox: Mail[] };

  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(PORT), NEXT_TELEMETRY_DISABLED: '1' };
  for (const k of BLANK) env[k] = '';
  Object.assign(env, {
    KV_REST_API_URL: `http://127.0.0.1:${KV_PORT}`, KV_REST_API_TOKEN: 'acceptance', KV_REST_API_READ_ONLY_TOKEN: 'acceptance',
    NEXT_PUBLIC_SUPABASE_URL: SB, SUPABASE_URL: SB,
    RESEND_API_KEY: 're_acceptance', RESEND_BASE_URL: `http://127.0.0.1:${MAIL_PORT}`,
    TWO_FACTOR_SECRET: SECRET, ADMIN_PASSWORD: SECRET, CRON_SECRET: SECRET, SUPABASE_JWT_SECRET: JWT_SECRET,
    MINDY_AUTH_REDIRECT_ORIGIN: BASE, NEXT_PUBLIC_APP_URL: BASE, NEXT_PUBLIC_SITE_URL: BASE,
    MINDY_TRIAL_OPEN: 'off',            // a trial must not mask the entitlement under test
    MFA_ENFORCED_PAID: 'on',            // as in production — paid password logins get a 2FA code
  });

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'next.config.ts', 'public'], { cwd: ROOT }).toString().trim();
  console.log(`checkout ${ROOT}\nHEAD ${head}${dirty ? ' (+ UNCOMMITTED app changes!)' : ' (app tree clean)'}\nmode ${PROD ? 'production build (next build + next start)' : 'next dev'}`);

  if (existsSync(join(ROOT, '.next'))) rmSync(join(ROOT, '.next'), { recursive: true, force: true });
  const devLog: string[] = [];
  let build: { ok: boolean; ms: number } | null = null;
  if (PROD) {
    const t0 = Date.now();
    const b = spawn('npx', ['next', 'build'], { cwd: ROOT, env: { ...env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
    b.stdout?.on('data', (d) => devLog.push(String(d))); b.stderr?.on('data', (d) => devLog.push(String(d)));
    const code: number = await new Promise((r) => b.on('close', r));
    build = { ok: code === 0, ms: Date.now() - t0 };
    writeFileSync(join(OUT, 'next-build.log'), devLog.join(''));
    console.log(`next build → exit ${code} in ${Math.round(build.ms / 1000)}s`);
    if (code !== 0) { kv.server.close(); sb.server.close(); mail.server.close(); process.exit(3); }
  }
  const server: ChildProcess = spawn('npx', ['next', PROD ? 'start' : 'dev', '-p', String(PORT)], {
    cwd: ROOT, env: { ...env, NODE_ENV: PROD ? 'production' : 'development' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d) => devLog.push(String(d)));
  server.stderr?.on('data', (d) => devLog.push(String(d)));

  let browser: Browser | null = null;
  try {
    await waitFor(`${BASE}/app`);
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

    // ── A. Retired routes over HTTP (no browser): status + Location, never the old UI. ──
    if (!ONLY) for (const [from, to] of [
      ['/briefings?welcome=true', '/app'], ['/briefings/dashboard', '/app?panel=dashboard'], ['/bd-assist', '/app?panel=pipeline'],
      ['/federal-market-assassin', '/app?panel=research'], ['/market-assassin-locked', '/app?panel=research'], ['/market-assassin', '/app?panel=research'],
      ['/opportunity-hunter', '/app?panel=research'], ['/prime-lookup.html', '/app?panel=recompetes'], ['/start', '/app'],
      ['/bundles/ultimate', '/pricing'], ['/contractor-database-product', '/pricing'],
    ]) {
      const r = await fetch(`${BASE}${from}`, { redirect: 'manual' });
      const location = r.headers.get('location') || '';
      const got = location ? new URL(location, BASE) : null;
      check('routes', `${from} → ${to}`, [307, 308].includes(r.status) && !!got && `${got.pathname}${got.search}` === to, { status: r.status, location });
    }
    if (!ONLY) {
      const r = await fetch(`${BASE}/recompete`);
      const html = await r.text();
      check('routes', '/recompete keeps its SEO page and shows the Mindy entry (no legacy gate/iframe)', r.status === 200 && html.includes('/app?panel=recompetes') && !/<iframe|verify-recompete/.test(html), { status: r.status });
      const pref = await fetch(`${BASE}/alerts/preferences?upgraded=true`);
      const prefHtml = await pref.text();
      check('routes', '/alerts/preferences (SHARED preference page used by every alert email) still serves, with no Alert Pro branding', pref.status === 200 && !/Alert Pro/i.test(prefHtml), { status: pref.status });
    }

    // ── B. Shared password (MA): which URL/credential, does the source default still work,
    //       and can a normal customer wander into the old tool? ──
    if (!ONLY) {
      const src = readFileSync(join(ROOT, 'src/app/api/verify-ma-password/route.ts'), 'utf8');
      const fallback = (src.match(/MA_ACCESS_PASSWORD \|\| '([^']+)'/) || [])[1] || '';
      const r = await fetch(`${BASE}/api/verify-ma-password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: fallback }) });
      const cookie = r.headers.get('set-cookie') || '';
      check('shared-password', 'with MA_ACCESS_PASSWORD unset (as in production), the SOURCE-CODE default still issues the anonymous cookie', r.status === 200 && /ma_access_email=authorized-user/.test(cookie), { status: r.status, cookieIssued: /authorized-user/.test(cookie) });
      const wrong = await fetch(`${BASE}/api/verify-ma-password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'not-the-password' }) });
      check('shared-password', 'a wrong password is refused', wrong.status === 401, { status: wrong.status });
      const withCookie = await fetch(`${BASE}/federal-market-assassin`, { redirect: 'manual', headers: { cookie: 'ma_access_email=authorized-user' } });
      check('shared-password', 'grace window CLOSED (default): the anonymous cookie is routed to /app like everyone else', withCookie.status === 307 && (withCookie.headers.get('location') || '').includes('/app?panel=research'), { status: withCookie.status, location: withCookie.headers.get('location') });
      const identity = await fetch(`${BASE}/federal-market-assassin`, { redirect: 'manual', headers: { cookie: 'ma_access_email=buyer@acceptance.invalid' } });
      check('shared-password', 'a normal customer (identity cookie) cannot enter the old tool', identity.status === 307, { status: identity.status });
      // What the anonymous cookie actually buys in report generation: free tier only.
      const gen = await fetch(`${BASE}/api/reports/generate-all`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: 'ma_access_email=authorized-user' },
        body: JSON.stringify({ inputs: { naicsCode: '541512', businessType: 'Small Business', veteranStatus: 'Not Applicable', goodsOrServices: 'services' }, selectedAgencies: ['Department of Veterans Affairs'] }),
      });
      const gj = await gen.json().catch(() => ({}));
      check('shared-password', 'the anonymous cookie resolves to FREE-tier reports (the same as a free Mindy account)', gen.status === 200 && gj.accessTier === 'free', { status: gen.status, accessTier: gj.accessTier, error: gj.error });
    }

    // ── C. Each legacy customer shape: legacy entry → REAL sign-in → Mindy. ──
    for (const [key, f] of Object.entries(FIXTURES)) {
      if (ONLY && !ONLY.includes(key)) continue;
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1366, height: 900 });
      if (f.maCookie) await page.setCookie({ name: 'ma_access_email', value: f.maCookie, domain: 'localhost', path: '/', httpOnly: true });

      // 1) logged out, through the entry this shape actually had
      const entry = await goto(page, f.legacyEntry);
      await rendered(page, /Sign in to Mindy|Content|Preferences|Mindy/);
      await page.screenshot({ path: join(OUT, `${key}-1-entry.png`) });
      const entryText = await text(page);
      if (key === 'legacy-comp') {
        check(key, 'Content Reaper entry is a FLAGGED migration gap (no /app equivalent) — not redirected', entry.path.startsWith('/content-generator'), entry);
      } else if (key === 'alert-pro') {
        check(key, 'Alert Pro success URL lands on the shared preferences page (no Alert Pro interface)', entry.path === '/alerts/preferences' && !/Alert Pro/i.test(entryText), entry);
      } else if (key === 'code-holder') {
        check(key, '/access/<code> redeems into Mindy: /app Market Research, email prefilled, credit attached', entry.path === '/app' && entry.panel === 'research' && entry.url.includes('redeem=ACCEPTCODE01'), entry);
      } else {
        check(key, `legacy entry ${f.legacyEntry} lands on Mindy /app sign-in`, entry.path === '/app' && /Sign in to Mindy/i.test(entryText), entry);
      }
      check(key, 'no legacy interface rendered', !/Government Contracting Intelligence Tools|Launch Market Research Tool|Please purchase below|I Have Access/i.test(entryText));

      // 2) REAL sign-in, from /app (keep the panel the entry chose)
      const startPath = entry.path === '/app' ? entry.url : '/app';
      if (entry.path !== '/app') await goto(page, startPath);
      await rendered(page, /Sign in to Mindy/);
      const since = Date.now();
      let method = f.signIn as string;
      if (f.signIn === 'password') {
        await typeInto(page, 'input[name="email"]', f.email);
        await typeInto(page, 'input[name="password"]', f.password!);
        // Submit the PASSWORD form itself (a bare "Sign in" text match also hits the tab button).
        await page.evaluate(() => (document.querySelector('input[name="password"]') as HTMLInputElement | null)?.form?.requestSubmit());
        await page.waitForFunction(() => /Verify & Access Dashboard/.test(document.body.innerText) || !!localStorage.getItem('mi_beta_auth_token'), { timeout: 120_000, polling: 500 }).catch(() => {});
        if (/Verify & Access Dashboard/.test(await text(page))) {
          method = 'password + emailed 2FA code';
          const m = await waitForMail(mail.outbox, f.email, since, /\b\d{6}\b/);
          const otp = m ? (`${m.text}\n${m.html}`.match(/\b(\d{6})\b/) || [])[1] : null;
          check(key, 'paid password login asked for a 2FA code, and the app emailed one', !!otp, { mail: m?.subject });
          if (otp) { await typeInto(page, 'input[placeholder="000000"]', otp); await clickByText(page, /Verify & Access Dashboard/); }
        }
      } else if (f.signIn === 'magic') {
        await typeInto(page, 'input[name="email"]', f.email);
        await clickByText(page, /one-time sign-in link/);
        const m = await waitForMail(mail.outbox, f.email, since, /auth\/v1\/verify/);
        const link = m ? ((m.html.match(/href="([^"]*auth\/v1\/verify[^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&') : '';
        check(key, 'magic link requested from /app and emailed by the app', !!link, { mail: m?.subject });
        if (link) await goto(page, link);
      } else if (f.signIn === 'google') {
        await fetch(`${SB}/__harness/google-identity?email=${encodeURIComponent(f.email)}`);
        await clickByText(page, /Continue with Google/);
      }
      await page.waitForFunction(() => !!localStorage.getItem('mi_beta_auth_token') && !/Loading Mindy/.test(document.body.innerText), { timeout: 180_000, polling: 500 }).catch(() => {});
      await settle(page);
      const landed = loc(page);
      await page.screenshot({ path: join(OUT, `${key}-2-after-sign-in.png`) });
      const ent = await entitlement(page, f.email);
      const body = (ent.body || {}) as { tier?: string; access?: { legacy_sources?: Record<string, boolean> } };
      check(key, `REAL sign-in (${method}) produced a Mindy session`, ent.hasToken && ent.status === 200, { status: ent.status, hasToken: ent.hasToken });
      const expectPanel = f.signIn === 'google' && entry.panel ? entry.panel : null;
      check(key, `destination after sign-in is /app${expectPanel ? `?panel=${expectPanel}` : ''}`, landed.path === '/app' && (!expectPanel || landed.panel === expectPanel), landed);
      check(key, `entitlement resolves to ${f.expectTier}`, body.tier === f.expectTier, { tier: body.tier, legacy_sources: body.access?.legacy_sources });

      if (key === 'ma-purchaser') check(key, 'Pro comes from the legacy ma: grant', !!body.access?.legacy_sources?.marketAssassinPremium && !body.access?.legacy_sources?.briefings, body.access?.legacy_sources);
      if (key === 'alert-pro') {
        check(key, 'Alert Pro is Pro in Mindy through its ospro: grant', !!body.access?.legacy_sources?.opportunityHunterPro, body.access?.legacy_sources);
        const prefs = await page.evaluate(async (e) => {
          const r = await fetch(`/api/alerts/preferences?email=${encodeURIComponent(e)}`, { headers: { 'x-mi-auth-token': localStorage.getItem('mi_beta_auth_token') || '' } });
          return { status: r.status, body: await r.json().catch(() => null) };
        }, f.email);
        const data = (prefs.body as { data?: Record<string, unknown> } | null)?.data;
        check(key, 'alert preferences preserved: daily frequency read back through the same API /app uses', prefs.status === 200 && JSON.stringify(data || {}).includes('daily'), { status: prefs.status, data });
        await goto(page, '/app?panel=alerts');
        await rendered(page, /Daily Alerts|Source Feed/);
        check(key, 'Alerts panel renders in /app', /Daily Alerts|Source Feed/i.test(await text(page)));
      }

      // 3) supported deep links, after sign-in
      for (const [from, panel] of [['/federal-market-assassin', 'research'], ['/opportunity-hunter', 'research'], ['/bd-assist', 'pipeline'], ['/briefings?tab=forecasts', 'forecasts']] as const) {
        const d = await goto(page, from);
        check(key, `deep link ${from} → /app?panel=${panel}`, d.path === '/app' && d.panel === panel, d);
      }

      // 4) Market Research panel (+ the single-use credit for the code holder)
      await goto(page, '/app?panel=research');
      await rendered(page, /Market Research/);
      const rt = await text(page);
      check(key, 'Market Research renders', /Market Research/i.test(rt));
      if (key === 'code-holder') {
        check(key, 'report credit banner is shown in Mindy', /report credit is attached/i.test(rt));
        const redeem = async () => page.evaluate(async (e) => {
          const r = await fetch('/api/reports/generate-all', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-mi-auth-token': localStorage.getItem('mi_beta_auth_token') || '' },
            body: JSON.stringify({
              inputs: { naicsCode: '541512', businessType: 'Small Business', veteranStatus: 'Not Applicable', goodsOrServices: 'services' },
              selectedAgencies: ['Department of Veterans Affairs'], userEmail: e, redeemCode: sessionStorage.getItem('mindy_report_credit') || 'ACCEPTCODE01',
            }),
          });
          const j = await r.json().catch(() => ({}));
          return { status: r.status, accessTier: j.accessTier, redeem: j.redeem, reports: j.report ? Object.keys(j.report) : [], error: j.error };
        }, f.email);
        const first = await redeem();
        check(key, 'redeeming the credit (verified session, own email) yields a FULL (Pro) report once', first.status === 200 && first.accessTier === 'pro' && first.redeem?.ok === true && first.reports.length > 4, first);
        const stored = JSON.parse(kv.store.get('access:ACCEPTCODE01') || '{}');
        check(key, 'the code is consumed server-side after the report is built', stored.used === true, { used: stored.used, usedAt: stored.usedAt });
        const second = await redeem();
        check(key, 'a second use is refused and falls back to the account tier (free)', second.accessTier === 'free' && second.redeem?.ok === false, second);
        const again = await goto(page, '/access/ACCEPTCODE01');
        check(key, 'the used link shows a Mindy "already used" page (no old tool)', again.path === '/access/ACCEPTCODE01' && /already been used/i.test(await text(page)), again);
      }

      // 5) representative saved work
      await goto(page, '/app?panel=pipeline');
      const title = `Fixture saved pursuit (${f.email.split('@')[0]})`;
      await rendered(page, new RegExp(title.replace(/[()]/g, '\\$&')));
      check(key, 'saved pursuit visible in My Pursuits', (await text(page)).includes(title));
      await page.screenshot({ path: join(OUT, `${key}-3-pursuits.png`) });

      // 6) back/refresh never re-enter a legacy page
      await goto(page, '/briefings?panel=research');
      await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page);
      const hist = loc(page);
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null); await settle(page);
      const back = loc(page).path;
      check(key, 'refresh stays on /app; back never returns to a legacy path', hist.path === '/app' && !/^\/(briefings|federal-market-assassin|market-assassin|opportunity-hunter)/.test(back), { hist, back });
      await ctx.close();
    }
  } finally {
    writeFileSync(join(OUT, 'server.log'), devLog.join(''));
    if (browser) await browser.close();
    server.kill('SIGTERM');
    kv.server.close(); sb.server.close(); mail.server.close();
  }

  const summary = {
    ranAt: new Date().toISOString(), head, only: ONLY, appTreeClean: !dirty, mode: PROD ? 'next build + next start' : 'next dev', build,
    supabase: { forwardedReads: sb.stats.forwardedReads, fixtureServed: sb.stats.fixtureServed, absorbedWrites: sb.stats.absorbedWrites, forwardedWrites: sb.stats.forwardedWrites, authCalls: sb.stats.auth.length, authSample: [...new Set(sb.stats.auth)].slice(0, 30) },
    mail: { captured: mail.outbox.length, delivered: 0, subjects: [...new Set(mail.outbox.map((m) => m.subject))] },
    kv: { commands: kv.log.commands, writesHeldInMemory: kv.log.writes, realKvContacted: false },
    results,
  };
  const all = Object.values(results).flatMap((r) => r.checks);
  const failed = all.filter((c) => !c.pass);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(summary, null, 2));
  console.log(`\n${failed.length ? '✗' : '✓'} ${all.length - failed.length} passed, ${failed.length} failed · HEAD ${head.slice(0, 8)} · ${summary.mode} · supabase writes forwarded: ${sb.stats.forwardedWrites} (absorbed ${sb.stats.absorbedWrites}) · mail captured ${mail.outbox.length}, delivered 0 · report: ${join(OUT, 'report.json')}`);
  process.exit(failed.length || sb.stats.forwardedWrites ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
