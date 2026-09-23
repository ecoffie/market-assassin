/**
 * ACCEPTANCE — legacy Market Assassin / Unified-MI retirement, authenticated, in a real browser,
 * against a local dev build of THIS checkout, with ZERO production writes.
 *
 *   npx tsx scripts/acceptance/legacy-retirement/run.mts --out <dir>
 *
 * What is real: the Next.js app from this checkout (routing, proxy, /app, API routes, access
 * resolution code), production Supabase READS for anything that is not a fixture, and headless
 * Chrome. What is substituted, and why:
 *   • KV → a local Upstash-protocol fake seeded with fixture grants (no real KV contact at all);
 *   • Supabase → a proxy that serves fixture identities locally, forwards other GET/HEADs, and
 *     ABSORBS every write (counted in the report — the run fails if any write is forwarded);
 *   • Postgres, Redis TCP, QStash, Resend/SMTP, Stripe, GHL, Slack, Twilio, Apify, LLM, SAM,
 *     BigQuery, the planner DB → blanked for the dev server, so none of them can be reached;
 *   • the session signing secret → a harness-only random value, so a fixture session minted
 *     here is worthless against production.
 * The credential step itself (typing a password / an OAuth consent screen) is NOT driven:
 * the browser receives the same `mi_beta_auth_token` that /api/auth/mi-login issues, signed
 * by the server's own `createMIAuthSessionToken`. Everything after that is the real app.
 *
 * Adam and Andre are NOT used, read, or impersonated. Fixtures are synthetic (@acceptance.invalid).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page, type HTTPResponse } from 'puppeteer';
import { FIXTURES, kvSeed } from './fixtures.mjs';
import { startFakeKv, startReadOnlySupabase } from './stubs.mjs';

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const argOut = process.argv.indexOf('--out');
const OUT = resolve(argOut > -1 ? process.argv[argOut + 1] : join(ROOT, 'tmp', 'legacy-retirement-acceptance'));
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.ACCEPT_PORT || 3218);
const KV_PORT = 18901;
const SB_PORT = 18902;
const BASE = `http://localhost:${PORT}`;
const SECRET = randomBytes(24).toString('hex');

function envFromFile(name: string): string {
  const line = readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return (line || '').slice(name.length + 1).replace(/^["']|["']$/g, '').trim();
}

const BLANK = [
  'DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_HOST',
  'POSTGRES_PASSWORD', 'POSTGRES_USER', 'POSTGRES_DATABASE', 'REDIS_URL', 'KV_URL',
  'QSTASH_TOKEN', 'QSTASH_URL', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY',
  'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_PORT',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_TEST_SECRET_KEY', 'STRIPE_TEST_WEBHOOK_SECRET',
  'GHL_API_KEY', 'GHL_LOCATION_ID', 'GHL_INBOUND_WEBHOOK_SECRET', 'SLACK_BOT_TOKEN', 'SLACK_LEAD_WEBHOOK_URL',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'APIFY_TOKEN',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'BRIEFING_ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'PERPLEXITY_API_KEY',
  'SERPER_API_KEY', 'GOVINFO_API_KEY', 'SAM_API_KEY', 'SAM_API_KEY_1', 'SAM_API_KEY_2', 'SAM_API_KEY_BACKUP',
  'GCP_SA_JSON', 'NEXT_PUBLIC_PLANNER_SUPABASE_URL', 'PLANNER_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_REPLICA_URL',
  'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_TARGET_ENV', 'NEXT_PUBLIC_GA_ID', 'NEXT_PUBLIC_GOOGLE_ADS_ID',
];

async function waitFor(url: string, ms = 240_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url, { redirect: 'manual' }); if (r.status < 500) return; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`timeout waiting for ${url}`);
}

type Check = { name: string; pass: boolean; detail: unknown };
const results: Record<string, { checks: Check[] }> = {};
const check = (who: string, name: string, pass: boolean, detail: unknown) => {
  (results[who] ||= { checks: [] }).checks.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} [${who}] ${name}`, pass ? '' : String(JSON.stringify(detail ?? null)).slice(0, 300));
};

async function settle(page: Page) {
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 45_000 }).catch(() => {});
}
async function goto(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await settle(page);
  const u = new URL(page.url());
  return { path: u.pathname, search: u.search, panel: u.searchParams.get('panel') };
}
const text = (page: Page) => page.evaluate(() => document.body?.innerText || '');
/** Wait until the client has rendered past the "Loading Mindy…" splash (slow under Rosetta). */
async function rendered(page: Page, pattern: RegExp, ms = 120_000) {
  await page.waitForFunction(
    (src: string) => new RegExp(src, 'i').test(document.body?.innerText || '') && !/Loading Mindy/i.test(document.body?.innerText || ''),
    { timeout: ms, polling: 500 }, pattern.source,
  ).catch(() => {});
}
/** The entitlement the app itself sees, asked with the page's own session. */
const entitlement = (page: Page, email: string) => page.evaluate(async (e) => {
  const r = await fetch(`/api/access/check?email=${encodeURIComponent(e)}`, {
    headers: { 'x-mi-auth-token': localStorage.getItem('mi_beta_auth_token') || '' },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}, email);

async function signIn(page: Page, email: string, token: string) {
  // Exactly what a successful /api/auth/mi-login leaves in the browser.
  await page.evaluate((e, t) => {
    localStorage.setItem('mi_beta_auth_token', t);
    localStorage.setItem('mi_beta_email', e);
    localStorage.setItem('mi_beta_authenticated_at', new Date().toISOString());
  }, email, token);
}

async function main() {
  const supabaseUpstream = envFromFile('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseUpstream) throw new Error('NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
  const kv = await startFakeKv(KV_PORT, kvSeed());
  const sb = await startReadOnlySupabase(SB_PORT, supabaseUpstream);

  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(PORT), NODE_ENV: 'development' };
  for (const k of BLANK) env[k] = '';
  Object.assign(env, {
    KV_REST_API_URL: `http://127.0.0.1:${KV_PORT}`, KV_REST_API_TOKEN: 'acceptance', KV_REST_API_READ_ONLY_TOKEN: 'acceptance',
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`, SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`,
    TWO_FACTOR_SECRET: SECRET, ADMIN_PASSWORD: SECRET, CRON_SECRET: SECRET,
    MINDY_TRIAL_OPEN: 'off',               // a trial must not mask the entitlement under test
    NEXT_TELEMETRY_DISABLED: '1',
  });
  // Stale build output would carry the production Supabase URL inlined into client bundles.
  if (existsSync(join(ROOT, '.next'))) rmSync(join(ROOT, '.next'), { recursive: true, force: true });
  const dev: ChildProcess = spawn('npx', ['next', 'dev', '-p', String(PORT)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const devLog: string[] = [];
  dev.stdout?.on('data', (d) => devLog.push(String(d)));
  dev.stderr?.on('data', (d) => devLog.push(String(d)));

  // Sign with the SAME function the server uses, under the harness-only secret.
  process.env.TWO_FACTOR_SECRET = SECRET;
  process.env.ADMIN_PASSWORD = SECRET;
  const { createMIAuthSessionToken } = await import('../../../src/lib/two-factor-session');

  let browser: Browser | null = null;
  try {
    await waitFor(`${BASE}/app`);
    if (process.argv.includes('--serve')) {
      // Debug mode: keep everything up and print fixture sessions for manual probing.
      for (const f of Object.values(FIXTURES)) console.log(`TOKEN ${f.email} ${createMIAuthSessionToken(f.email)}`);
      console.log(`SERVING ${BASE} (Ctrl-C to stop)`);
      setInterval(() => writeFileSync(join(OUT, 'stats.json'), JSON.stringify({ sb: sb.stats, kv: kv.log }, null, 2)), 2000);
      await new Promise(() => {});
    }
    // Warm the routes so compile time does not eat the journey timeouts.
    for (const p of ['/app', '/welcome', '/api/access/check?email=x', '/api/pipeline?email=x']) await fetch(`${BASE}${p}`).catch(() => {});
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

    for (const [key, f] of Object.entries(FIXTURES)) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1366, height: 900 });
      const pipelineBodies: string[] = [];
      page.on('response', async (r: HTTPResponse) => {
        const u = r.url();
        try {
          if (u.includes('/api/pipeline?')) pipelineBodies.push(await r.text());
        } catch { /* body unavailable on redirects */ }
      });
      if (f.maCookie) {
        await page.setCookie({ name: 'ma_access_email', value: f.maCookie, domain: 'localhost', path: '/', httpOnly: true });
      }

      // 1) Logged out, via the legacy entry this account shape actually had.
      const entry = key === 'ma-purchaser' ? '/federal-market-assassin'
        : key === 'legacy-comp' ? '/briefings?panel=pipeline'
        : '/briefings?welcome=true';
      const out = await goto(page, entry);
      await rendered(page, /Sign in to Mindy/);
      const outText = await text(page);
      check(key, `logged-out ${entry} lands on /app sign-in`, out.path === '/app' && /Sign in to Mindy/i.test(outText), out);
      check(key, 'no legacy UI rendered', !/Government Contracting Intelligence Tools|Launch Market Research Tool|Please purchase below/i.test(outText), null);
      await page.screenshot({ path: join(OUT, `${key}-1-logged-out.png`) });

      // 2) Sign in, then the same URL: /app's own normal landing applies.
      await signIn(page, f.email, createMIAuthSessionToken(f.email));
      const after = await goto(page, `${out.path}${out.search}`);
      await rendered(page, /My Pursuits|Market Research|Today/);
      const landed = new URL(page.url());
      const ent = await entitlement(page, f.email);
      const body = (ent.body || {}) as { tier?: string; needsOnboarding?: boolean; access?: { legacy_sources?: Record<string, boolean> } };
      check(key, 'destination after login is the current /app (profiled → no onboarding detour)', landed.pathname === '/app', { ...after, final: landed.pathname + landed.search });
      check(key, `entitlement resolves to ${f.expectTier}`, ent.status === 200 && body.tier === f.expectTier, { status: ent.status, tier: body.tier, needsOnboarding: body.needsOnboarding, legacy_sources: body.access?.legacy_sources });
      if (key === 'ma-purchaser') {
        check(key, 'the Pro tier comes from the legacy ma: grant (not from briefings)', !!body.access?.legacy_sources?.marketAssassinPremium && !body.access?.legacy_sources?.briefings, body.access?.legacy_sources);
      }
      const ui = await text(page);
      check(key, `sidebar ${f.expectTier === 'pro' ? 'shows no' : 'shows an'} "Upgrade to Pro" CTA`, /Upgrade to Pro/i.test(ui) === (f.expectTier !== 'pro'), null);
      await page.screenshot({ path: join(OUT, `${key}-2-after-login.png`) });

      // 3) Deep links preserved into /app panels.
      for (const [from, panel] of [
        ['/federal-market-assassin', 'research'],
        ['/bd-assist', 'pipeline'],
        ['/briefings?tab=forecasts', 'forecasts'],
      ] as const) {
        const d = await goto(page, from);
        check(key, `deep link ${from} → /app?panel=${panel}`, d.path === '/app' && d.panel === panel, d);
      }

      // 4) Relevant access on the Market Research panel.
      await goto(page, '/app?panel=research');
      await rendered(page, /Market Research/);
      const rt = await text(page);
      await page.screenshot({ path: join(OUT, `${key}-3-research.png`) });
      check(key, 'Market Research panel renders', /Market Research/i.test(rt), rt.slice(0, 200));

      // 5) Representative saved work: the fixture pursuit comes back through /api/pipeline.
      await goto(page, '/app?panel=pipeline');
      await rendered(page, /Fixture saved pursuit/);
      const pt = await text(page);
      await page.screenshot({ path: join(OUT, `${key}-4-pipeline.png`) });
      const title = `Fixture saved pursuit (${f.email.split('@')[0]})`;
      const apiHas = pipelineBodies.some((b) => b.includes(title));
      check(key, 'saved pursuit returned by /api/pipeline for this identity', apiHas, pipelineBodies.at(-1)?.slice(0, 300));
      check(key, 'saved pursuit visible in the Pipeline panel', pt.includes(title), pt.slice(0, 300));

      // 6) Back/refresh: no legacy URL enters history, no loop.
      await page.goto(`${BASE}/briefings?panel=research`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page);
      const hist = await page.evaluate(() => ({ path: location.pathname, len: history.length }));
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null); await settle(page);
      const back = new URL(page.url()).pathname;
      check(key, 'refresh stays on /app; back never returns to a legacy path', hist.path === '/app' && !/^\/(briefings|federal-market-assassin|market-assassin)/.test(back), { hist, back });

      await ctx.close();
    }

    // 7) The anonymous shared-password holder keeps the legacy tool (flagged gap).
    {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setCookie({ name: 'ma_access_email', value: 'authorized-user', domain: 'localhost', path: '/', httpOnly: true });
      const r = await goto(page, '/federal-market-assassin');
      await page.screenshot({ path: join(OUT, 'anonymous-password-holder.png') });
      check('anonymous-password-holder', 'keeps /federal-market-assassin (no identity for /app to honour)', r.path === '/federal-market-assassin', r);
      await ctx.close();
    }
  } finally {
    writeFileSync(join(OUT, 'dev-server.log'), devLog.join(''));
    if (browser) await browser.close();
    dev.kill('SIGTERM');
    kv.server.close();
    sb.server.close();
  }

  const writes = sb.stats;
  const summary = {
    ranAt: new Date().toISOString(),
    base: BASE,
    supabase: { forwardedReads: writes.forwardedReads, fixtureServed: writes.fixtureServed, absorbedWrites: writes.absorbedWrites, forwardedWrites: writes.forwardedWrites, absorbedSample: writes.absorbed.slice(0, 40) },
    kv: { commands: kv.log.commands, writesHeldInMemory: kv.log.writes, realKvContacted: false },
    results,
  };
  const failed = Object.values(results).flatMap((r) => r.checks).filter((c) => !c.pass);
  const noProdWrites = writes.forwardedWrites === 0;
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(OUT, 'dev-server.log'), devLog.join(''));
  console.log(`\n${failed.length ? '✗' : '✓'} ${Object.values(results).flatMap((r) => r.checks).length - failed.length} passed, ${failed.length} failed · supabase writes forwarded: ${writes.forwardedWrites} (absorbed ${writes.absorbedWrites}) · report: ${join(OUT, 'report.json')}`);
  process.exit(failed.length || !noProdWrites ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
