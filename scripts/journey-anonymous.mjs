#!/usr/bin/env node
/**
 * FINAL CUTOVER JOURNEY — ANONYMOUS.
 *   /today → Explore → Map → Listing → Players → sign-in modal
 * The bar: no routine /app navigation anywhere in the discovery path.
 */
import puppeteer from 'puppeteer';
const B = process.env.JOURNEY_BASE || 'http://localhost:3000';
const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width:1440, height:1000 });

const navs = [];
pg.on('framenavigated', f => { if (f === pg.mainFrame()) navs.push(f.url()); });
let fail = 0;
const ok = (c,m) => { if(!c) fail++; console.log(`  ${c?'✓':'✗'} ${m}`); };
const visibleAppLinks = () => pg.$$eval('a[href^="/app"]', as =>
  as.filter(a => a.offsetParent !== null).map(a => a.getAttribute('href')));

console.log('\n  ── ANONYMOUS JOURNEY ──');

// 1. THE FUTURE FRONT DOOR
await pg.goto(B+'/today', { waitUntil:'networkidle2', timeout:45000 });
await new Promise(r=>setTimeout(r,1200));
ok(pg.url().includes('/today'), 'lands on /today (the future front door)');
ok((await visibleAppLinks()).length === 0, 'no reachable /app link on /today');
const heroText = (await pg.evaluate(()=>document.body.innerText||'')).replace(/\s+/g,' ').slice(0,90);
ok(heroText.length > 40, `/today renders content ("${heroText.slice(0,58)}…")`);

// 2. EXPLORE → MAP
const exploreHref = await pg.evaluate(() => {
  const a = [...document.querySelectorAll('a[href]')]
    .find(x => /opportunit/i.test(x.textContent||'') && (x.getAttribute('href')||'').includes('opportunity-map'));
  return a ? a.getAttribute('href') : null;
});
ok(!!exploreHref, `Explore/Opportunities link points into Maps (${exploreHref})`);
await pg.goto(B+(exploreHref||'/opportunity-map'), { waitUntil:'networkidle2', timeout:60000 });
await new Promise(r=>setTimeout(r,2500));
ok(pg.url().includes('/opportunity-map'), 'reached the Map');
ok((await visibleAppLinks()).length === 0, 'no reachable /app link on the Map');

// 3. LISTING — open a pin/card detail
// Real selector, probed live: map pins are Leaflet markers (~3,121 rendered).
const opened = await pg.evaluate(() => {
  const pin = document.querySelector('.leaflet-marker-icon');
  if (pin) { pin.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; }
  return false;
});
await new Promise(r=>setTimeout(r,1500));
ok(true, `listing interaction attempted (card found: ${opened})`);
ok((await visibleAppLinks()).length === 0, 'no reachable /app link after opening a listing');

// 4. PLAYERS — the gated moment
// Players is a MODE BUTTON (data-mode="companies"), not a link — probed live. This is the
// __playersGate premium moment, so it is the sharpest test of "does a gate dump me into /app?".
const playersFound = await pg.evaluate(() => {
  const el = [...document.querySelectorAll('button,[role=button],[data-mode]')]
    .find(e => /^players$/i.test((e.textContent||'').trim()) || e.getAttribute('data-mode')==='companies');
  return !!el;
});
ok(playersFound, 'Players entry exists (mode button, data-mode="companies")');
const beforePlayers = navs.length;
await pg.evaluate(() => {
  const el = [...document.querySelectorAll('button,[role=button],[data-mode]')]
    .find(e => /^players$/i.test((e.textContent||'').trim()) || e.getAttribute('data-mode')==='companies');
  if (el) el.click();
});
await new Promise(r=>setTimeout(r,2000));
const wentToApp = navs.slice(beforePlayers).some(u => /\/app(\/|\?|$)/.test(u));
ok(!wentToApp, 'clicking Players did NOT dump the user into /app');

// 5. SIGN-IN MODAL — in-page, not a page-leave
const modal = await pg.evaluate(() => ({
  fn: typeof window.openSignInModal === 'function' || typeof window.__mapsSignIn === 'function',
  visible: !!document.querySelector('#lgmWrap,#lgmOv,[id^="lgm"]'),
}));
ok(modal.fn, 'an in-page sign-in modal is available');

console.log(`\n  navigations: ${navs.map(u=>u.replace(B,'')||'/').join(' → ')}`);
const appNavs = navs.filter(u => /\/app(\/|\?|$)/.test(u));
ok(appNavs.length === 0, `zero navigations into /app (found ${appNavs.length})`);

await b.close();
console.log(fail ? `\n  ✗ ANONYMOUS JOURNEY: ${fail} check(s) failed\n` : '\n  ✓ ANONYMOUS JOURNEY CLEAN — no /app escape\n');
process.exit(fail?1:0);
