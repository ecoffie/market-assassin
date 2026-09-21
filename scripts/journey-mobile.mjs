#!/usr/bin/env node
/**
 * FINAL CUTOVER JOURNEY — MOBILE (one real pass, core path only).
 *   Today → Map → Listing
 * /today is about to become everyone's front door; this is the mobile proof before flipping.
 */
import puppeteer from 'puppeteer';
const B = process.env.JOURNEY_BASE || 'http://localhost:3000';
const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox'] });
const pg = await b.newPage();
// iPhone-class viewport + real mobile UA/touch.
await pg.setViewport({ width:390, height:844, isMobile:true, hasTouch:true, deviceScaleFactor:3 });
await pg.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

const navs=[]; pg.on('framenavigated',f=>{ if(f===pg.mainFrame()) navs.push(f.url()); });
let fail=0; const ok=(c,m)=>{ if(!c)fail++; console.log(`  ${c?'✓':'✗'} ${m}`); };

console.log('\n  ── MOBILE JOURNEY (390x844) ──');

await pg.goto(B+'/today',{waitUntil:'networkidle2',timeout:45000});
await new Promise(r=>setTimeout(r,1500));
ok(pg.url().includes('/today'),'Today loads on mobile');

// Horizontal overflow is the classic mobile break: the page must not scroll sideways.
const overflow = await pg.evaluate(()=>({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
ok(overflow.scrollW <= overflow.clientW + 2,
   `no horizontal overflow on /today (scroll ${overflow.scrollW} vs client ${overflow.clientW})`);

const txt=(await pg.evaluate(()=>document.body.innerText||'')).replace(/\s+/g,' ');
ok(txt.length>60, `Today renders real content ("${txt.slice(0,52)}…")`);

const appLinks=await pg.$$eval('a[href^="/app"]',as=>as.filter(a=>a.offsetParent!==null).map(a=>a.getAttribute('href')));
ok(appLinks.length===0,'no reachable /app link on mobile Today');

// MAP
await pg.goto(B+'/opportunity-map',{waitUntil:'networkidle2',timeout:60000});
await new Promise(r=>setTimeout(r,3000));
ok(pg.url().includes('/opportunity-map'),'Map loads on mobile');
const mapOverflow=await pg.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2);
ok(mapOverflow,'no horizontal overflow on the Map');
const pins=await pg.evaluate(()=>document.querySelectorAll('.leaflet-marker-icon').length);
ok(pins>0,`map renders pins on mobile (${pins})`);

// LISTING
const opened=await pg.evaluate(()=>{ const p=document.querySelector('.leaflet-marker-icon');
  if(p){p.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;} return false; });
await new Promise(r=>setTimeout(r,1500));
ok(opened,'opened a listing on mobile');

const mobileAppLinks=await pg.$$eval('a[href^="/app"]',as=>as.filter(a=>a.offsetParent!==null).map(a=>a.getAttribute('href')));
ok(mobileAppLinks.length===0,'no reachable /app link on mobile Map+listing');
ok(!navs.some(u=>/\/app(\/|\?|$)/.test(u)),'zero navigations into /app on mobile');

await pg.screenshot({path:'/tmp/mobile-today.png'});
await b.close();
console.log(fail?`\n  ✗ MOBILE JOURNEY: ${fail} failed\n`:'\n  ✓ MOBILE JOURNEY CLEAN\n');
process.exit(fail?1:0);
