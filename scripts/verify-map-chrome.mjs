#!/usr/bin/env node
/**
 * verify-map-chrome — the public design system must not change the signed-in product.
 *
 * Compares the computed styles of the Opportunity Map chrome and the /app sign-in screen
 * between a base host (prod) and a candidate host, in two states:
 *   signed-out  no token: the "Log In" pill
 *   signed-in   a syntactically valid MI token in localStorage, so the account script paints
 *               the initials avatar (the /api/app/me call is rejected, which leaves the
 *               initials in place on both hosts)
 * Writes candidate screenshots to --out. Exit 1 on any computed-style difference.
 *
 * Run:  node scripts/verify-map-chrome.mjs --base https://getmindy.ai --head http://localhost:3100
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const BASE = arg('base', 'https://getmindy.ai');
const HEAD = arg('head', 'http://localhost:3100');
const OUT = arg('out', '.tmp-public-site/map-chrome');
mkdirSync(OUT, { recursive: true });

const ROUTES = ['/opportunity-map', '/opportunity-map/saved', '/opportunity-map/favorites', '/opportunity-map/pursuits', '/app'];
const SELECTORS = ['html', 'body', '.zhead', '.zh-logo span', '.zh-left a', '.zrail', '#mindyAcctBtn', '#mindyAcctBtn .mindy-acct-ini', 'main', 'h1', 'h2', 'button', 'input'];
const PROPS = ['backgroundColor', 'backgroundImage', 'color', 'fontFamily', 'fontWeight', 'fontSize', 'borderTopColor', 'borderRadius', 'width', 'height', 'colorScheme'];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FAKE_TOKEN = `${b64({ email: 'chrome.check@example.com', exp: 4102444800 })}.c2lnbmF0dXJl`;

async function capture(browser, host, route, signedIn, shot) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  if (signedIn) {
    await page.evaluateOnNewDocument((t) => {
      try {
        localStorage.setItem('mi_beta_auth_token', t);
      } catch {}
    }, FAKE_TOKEN);
  }
  const resp = await page.goto(host + route, { waitUntil: 'networkidle2', timeout: 90000 }).catch((e) => ({ status: () => `error ${e.message}` }));
  await new Promise((r) => setTimeout(r, 1500));
  const styles = await page.evaluate((sels, props) => {
    const out = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const s = getComputedStyle(el);
      out[sel] = Object.fromEntries(props.map((p) => [p, s[p]]));
      if (sel === '#mindyAcctBtn') out[sel].text = el.textContent.trim();
    }
    return out;
  }, SELECTORS, PROPS);
  if (shot) await page.screenshot({ path: shot });
  await page.close();
  return { status: resp.status(), styles };
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const results = [];
  let failed = false;
  try {
    for (const route of ROUTES) {
      for (const signedIn of [false, true]) {
        const state = signedIn ? 'signed-in' : 'signed-out';
        const name = `${route.replace(/^\//, '').replace(/\//g, '-')}-${state}.png`;
        const base = await capture(browser, BASE, route, signedIn, null);
        const head = await capture(browser, HEAD, route, signedIn, join(OUT, name));
        const diffs = [];
        if (base.status !== head.status) diffs.push(`status ${base.status} → ${head.status}`);
        for (const sel of new Set([...Object.keys(base.styles), ...Object.keys(head.styles)])) {
          const a = base.styles[sel], b = head.styles[sel];
          if (!a || !b) {
            diffs.push(`${sel} present on ${a ? 'base' : 'head'} only`);
            continue;
          }
          for (const k of Object.keys(a)) if (a[k] !== b[k]) diffs.push(`${sel} ${k}: ${a[k]} → ${b[k]}`);
        }
        results.push({ route, state, compared: Object.keys(head.styles).length, diffs });
        if (diffs.length) failed = true;
        console.log(`${diffs.length ? '✗' : '✓'} ${route} [${state}] ${Object.keys(head.styles).length} elements compared${diffs.length ? '' : ', identical'}`);
        for (const d of diffs.slice(0, 15)) console.log(`    ${d}`);
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
