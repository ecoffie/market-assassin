#!/usr/bin/env node
/**
 * PRODUCTION VERIFICATION OF THE APEX ITSELF — not /today.
 *
 * The cutover is only real if `getmindy.ai/` behaves like the product's front door. Verifying
 * /today would prove nothing: it worked before the flip too. Every check below hits the APEX.
 *
 * FAIL CLOSED: if the apex does not serve Today's Intel, canonical ownership is wrong, or a
 * normal journey escapes to /app, this exits non-zero — roll back the routing change rather
 * than repairing unrelated things during a cutover.
 */
import puppeteer from 'puppeteer';

const APEX = process.env.APEX || 'https://getmindy.ai';
let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? '✓' : '✗'} ${m}`); };

console.log(`\n  ── APEX CUTOVER VERIFICATION (${APEX}) ──\n`);

// ── 1. The apex serves Today's Intel, and owns its own canonical ──────────────────────────
const res = await fetch(APEX + '/', { redirect: 'follow' });
const html = await res.text();
ok(res.status === 200, `apex returns HTTP ${res.status}`);
ok(/what changed in federal contracting today|Today's Intel/i.test(html),
   'apex renders Today\'s Intel');

const canonical = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
const ogUrl = (html.match(/<meta property="og:url" content="([^"]*)"/) || [])[1];
const norm = (u) => (u || '').replace(/\/$/, '');
ok(norm(canonical) === norm(APEX), `canonical = apex (got ${canonical})`);
ok(norm(ogUrl) === norm(APEX), `og:url = apex (got ${ogUrl})`);

// ── 2. /mindy-landing survives as rollback insurance and no longer claims the apex ────────
const ml = await fetch(APEX + '/mindy-landing');
const mlHtml = await ml.text();
const mlCanon = (mlHtml.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
ok(ml.status === 200, `/mindy-landing still directly reachable (HTTP ${ml.status})`);
ok(norm(mlCanon) !== norm(APEX), `/mindy-landing released the apex (canonical ${mlCanon})`);

// ── 3. /today still reachable, canonicalizing TO the apex ────────────────────────────────
const td = await fetch(APEX + '/today', { redirect: 'follow' });
const tdHtml = await td.text();
const tdCanon = (tdHtml.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
ok(td.status === 200, `/today still reachable (HTTP ${td.status})`);
ok(norm(tdCanon) === norm(APEX), `/today canonicalizes TO the apex (got ${tdCanon})`);

// ── 4. Browser journeys FROM THE APEX ────────────────────────────────────────────────────
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

async function journey(label, viewport, authed) {
  const pg = await b.newPage();
  await pg.setViewport(viewport);
  const navs = [], errors = [];
  pg.on('framenavigated', f => { if (f === pg.mainFrame()) navs.push(f.url()); });
  pg.on('pageerror', e => errors.push(String(e).slice(0, 90)));

  await pg.goto(APEX + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  if (authed) {
    await pg.evaluate(() => {
      const p = btoa(JSON.stringify({ email: 'apex@example.com', exp: Date.now() + 9e5, authLevel: '2fa' }))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem('mi_beta_auth_token', p + '.sig');
      localStorage.setItem('mi_beta_email', 'apex@example.com');
    });
    await pg.goto(APEX + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  }
  await new Promise(r => setTimeout(r, 1500));

  // The logo must point home — at the apex now, not /today.
  const logo = await pg.evaluate(() => {
    const a = document.querySelector('a.zh-logo') || [...document.querySelectorAll('a')].find(x => x.querySelector('img'));
    return a ? a.getAttribute('href') : null;
  });

  // Mobile: the page must not scroll sideways.
  const overflow = await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);

  // Into the Map, then open a listing.
  await pg.goto(APEX + '/opportunity-map', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  const pins = await pg.evaluate(() => document.querySelectorAll('.leaflet-marker-icon').length);
  await pg.evaluate(() => { const p = document.querySelector('.leaflet-marker-icon'); if (p) p.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 1200));

  const appLinks = await pg.$$eval('a[href^="/app"]', as => as.filter(a => a.offsetParent !== null).map(a => a.getAttribute('href')));
  const appNavs = navs.filter(u => /\/app(\/|\?|$)/.test(u));

  console.log(`\n  ${label}:`);
  ok(logo === '/', `    logo → / (got ${logo})`);
  if (viewport.isMobile) ok(overflow, '    no horizontal overflow at 390px');
  ok(pins > 0, `    map renders pins (${pins})`);
  ok(appLinks.length === 0, `    no reachable /app link (${appLinks.length})`);
  ok(appNavs.length === 0, `    zero navigations into /app`);
  ok(errors.length === 0, `    zero page errors${errors.length ? ' — ' + errors[0] : ''}`);
  await pg.close();
}

await journey('ANONYMOUS (desktop)', { width: 1440, height: 1000 }, false);
await journey('AUTHENTICATED (desktop)', { width: 1440, height: 1000 }, true);
await journey('MOBILE (390x844)', { width: 390, height: 844, isMobile: true, hasTouch: true }, false);

await b.close();
console.log(fail
  ? `\n  ✗ APEX VERIFICATION FAILED (${fail}) — ROLL BACK the routing change.\n`
  : '\n  ✓ APEX CUTOVER VERIFIED — getmindy.ai/ is the product.\n');
process.exit(fail ? 1 : 0);
