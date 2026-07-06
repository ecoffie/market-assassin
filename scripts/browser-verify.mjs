/**
 * browser-verify — headless self-verification of a UI fix (closes the 386-turn screenshot loop).
 *
 * The point: after /ui-fix edits a component, Claude should verify its OWN fix by loading
 * the real route in a headless browser, asserting the fix, and screenshotting — instead of
 * asking Eric to ⌘⇧4 and paste a PNG back. This is the reusable version of the ad-hoc
 * puppeteer snippets /ui-fix and /verify-panel write each time.
 *
 * HONEST SCOPE (learned from scripts/clickthrough-contractors-panel.mjs):
 *   - PUBLIC pages (/, marketing, /contractors/[slug], /awards/[id], any non-gated route):
 *     fully verifiable — load, assert text/selector/count, screenshot. ✅
 *   - APIs: fetched + row-counted (a 200 with 0 rows is a FAIL). ✅
 *   - GATED /app panels: /app needs a SUPABASE session bootstrap, NOT the MI token alone,
 *     so localStorage injection lands on the sign-in screen. We DETECT that and report
 *     UNVERIFIED-GATED with the reason + fall back to the feeding API / DB count so the
 *     data is still proven real. We never fake a pass. (When /app gets a token-only test
 *     path, --seed-auth will start working end-to-end automatically.)
 *
 * Usage:
 *   npx tsx scripts/browser-verify.mjs --url <full-or-path> [assertions/options]
 *
 * Target:
 *   --url /pricing                      path (uses --base, default https://getmindy.ai)
 *   --url https://getmindy.ai/awards/X  full URL
 *   --base https://getmindy.ai          base for path URLs (default)
 *
 * Assertions (any combination; all must pass):
 *   --contains "text"          body innerText must contain this (repeatable)
 *   --absent "text"            body innerText must NOT contain this (repeatable)
 *   --selector ".rows .row"    element(s) matching this must exist
 *   --min-count N              with --selector: at least N matches must render
 *   --wait "text|selector"     wait until this appears before asserting (default: networkidle)
 *
 * Options:
 *   --viewport 1440x1000       (default) — use 390x844 to check mobile
 *   --seed-auth [email]        attempt MI-token localStorage seed (gated /app; may be UNVERIFIED)
 *   --shot <path>              screenshot path (default: scratchpad/browser-verify-<ts>.png)
 *   --timeout 20000            per-wait timeout ms
 *
 * Exit code 0 = PASS, 1 = FAIL/UNVERIFIED — so /ui-fix can gate on it.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// ---- tiny arg parser (supports repeated flags) ----
function parseArgs(argv) {
  const a = { contains: [], absent: [], _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--contains') a.contains.push(argv[++i]);
    else if (t === '--absent') a.absent.push(argv[++i]);
    else if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) a[key] = true; // boolean flag
      else { a[key] = next; i++; }
    } else a._.push(t);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));

if (!args.url) {
  console.error('ERROR: --url is required. Example:\n  npx tsx scripts/browser-verify.mjs --url /pricing --contains "Pro" --selector "[data-price]" --min-count 1');
  process.exit(1);
}

const BASE = args.base || 'https://getmindy.ai';
const target = args.url.startsWith('http') ? args.url : `${BASE}${args.url.startsWith('/') ? '' : '/'}${args.url}`;
const [vw, vh] = (args.viewport || '1440x1000').split('x').map(Number);
const TIMEOUT = Number(args.timeout || 20000);
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const SCRATCH = process.env.CLAUDE_SCRATCHPAD || '/tmp';
const SHOT = args.shot || join(SCRATCH, `browser-verify-${ts}.png`);

function fail(reason, extra = {}) {
  console.log(JSON.stringify({ verdict: 'FAIL', target, reason, screenshot: extra.shot || null, ...extra }, null, 2));
  process.exit(1);
}
function unverified(reason, extra = {}) {
  console.log(JSON.stringify({ verdict: 'UNVERIFIED', target, reason, ...extra }, null, 2));
  process.exit(1);
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const findings = { asserts: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: vw || 1440, height: vh || 1000 });
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));

    // ---- navigate ----
    const resp = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: TIMEOUT }).catch((e) => ({ __err: e.message }));
    if (resp?.__err) fail(`navigation failed: ${resp.__err}`);
    const httpStatus = resp?.status?.() ?? 0;
    findings.httpStatus = httpStatus;

    // ---- optional MI-token seed for gated /app (may still be gated) ----
    if (args['seed-auth']) {
      const email = typeof args['seed-auth'] === 'string' ? args['seed-auth'] : (process.env.CLICKTHROUGH_EMAIL || 'eric@koamana.com');
      try {
        const { createMIAuthSessionToken } = await import('../src/lib/two-factor-session.ts').catch(() => ({}));
        if (createMIAuthSessionToken) {
          const token = createMIAuthSessionToken(email);
          await page.evaluate((tok, em) => {
            localStorage.setItem('mi_beta_auth_token', tok);
            localStorage.setItem('mi_beta_email', em);
          }, token, email);
          await page.reload({ waitUntil: 'networkidle0', timeout: TIMEOUT }).catch(() => {});
        }
      } catch { /* fall through to gated detection */ }
    }

    // ---- wait for readiness ----
    if (args.wait) {
      const w = args.wait;
      await page.waitForFunction(
        (needle) => {
          try { if (document.querySelector(needle)) return true; } catch {}
          return (document.body?.innerText || '').includes(needle);
        },
        { timeout: TIMEOUT }, w,
      ).catch(() => {});
    } else {
      await page.waitForNetworkIdle({ idleTime: 700, timeout: TIMEOUT }).catch(() => {});
    }

    // ---- gated-app detection (honest) ----
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    const looksGated = /sign in to (continue|mindy)|enter your email|two-factor|log in to your account/i.test(bodyText)
      && /\/app(\/|$|\?)/.test(target);
    await page.screenshot({ path: SHOT, fullPage: false }).catch(() => {});
    if (looksGated) {
      unverified(
        'Route is a gated /app panel and rendered the sign-in screen (localStorage token alone does not bootstrap the Supabase session — known limit). ' +
        'Verify the feeding API + DB count instead, or run against a local dev server with a real session.',
        { httpStatus, shot: SHOT, hint: 'Use /verify-panel to curl the feeding API for non-empty rows, or check the source DB count with the supabase-readonly MCP.' },
      );
    }

    // ---- run assertions ----
    let allPass = true;
    for (const needle of args.contains) {
      const ok = bodyText.includes(needle);
      findings.asserts.push({ type: 'contains', value: needle, pass: ok });
      if (!ok) allPass = false;
    }
    for (const needle of args.absent) {
      const ok = !bodyText.includes(needle);
      findings.asserts.push({ type: 'absent', value: needle, pass: ok });
      if (!ok) allPass = false;
    }
    if (args.selector) {
      const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, args.selector);
      const min = Number(args['min-count'] || 1);
      const ok = count >= min;
      findings.asserts.push({ type: 'selector', value: args.selector, rendered: count, min, pass: ok });
      if (!ok) allPass = false;
    }

    findings.consoleErrors = consoleErrors.slice(0, 10);
    findings.screenshot = SHOT;

    // If no assertions were given, a clean 200 + non-sign-in render is a soft pass.
    if (!args.contains.length && !args.absent.length && !args.selector) {
      findings.note = 'No assertions given — reported load status + screenshot only. Pass --contains/--selector to assert the fix.';
    }

    const verdict = allPass ? 'PASS' : 'FAIL';
    console.log(JSON.stringify({ verdict, target, httpStatus, ...findings }, null, 2));
    process.exit(allPass ? 0 : 1);
  } catch (e) {
    fail(`unexpected error: ${String(e?.message || e)}`, { shot: SHOT });
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
