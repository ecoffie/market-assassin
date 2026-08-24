#!/usr/bin/env node
/**
 * FINAL CUTOVER JOURNEY — AUTHENTICATED.
 *   /today → Map → Listing → Players → Save → Pursuits → Proposal
 *          → logo → Today → Account → My Pursuits → Proposals → Sign out
 */
import puppeteer from 'puppeteer';
const B = process.env.JOURNEY_BASE || 'http://localhost:3000';
const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width:1440, height:1000 });

const navs=[]; pg.on('framenavigated', f=>{ if(f===pg.mainFrame()) navs.push(f.url()); });
let fail=0; const ok=(c,m)=>{ if(!c)fail++; console.log(`  ${c?'✓':'✗'} ${m}`); };
const visibleAppLinks=()=>pg.$$eval('a[href^="/app"]',as=>
  as.filter(a=>a.offsetParent!==null).map(a=>a.getAttribute('href')));

// A payload-shaped token: the pages decode the email FROM the payload, so a dummy
// string leaves them on the signed-out gate (learned in item 6).
const seed = () => pg.evaluate(() => {
  const p = btoa(JSON.stringify({email:'journey@example.com',exp:Date.now()+900000,authLevel:'2fa'}))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  localStorage.setItem('mi_beta_auth_token', p+'.sig');
  localStorage.setItem('mi_beta_email','journey@example.com');
});

console.log('\n  ── AUTHENTICATED JOURNEY ──');
await pg.goto(B+'/today',{waitUntil:'domcontentloaded'}); await seed();
await pg.goto(B+'/today',{waitUntil:'networkidle2',timeout:45000});
await new Promise(r=>setTimeout(r,1200));
ok(pg.url().includes('/today'),'starts on /today');
ok((await visibleAppLinks()).length===0,'no reachable /app link on /today');

// MAP → LISTING
await pg.goto(B+'/opportunity-map',{waitUntil:'networkidle2',timeout:60000});
await new Promise(r=>setTimeout(r,2500));
const pinned = await pg.evaluate(()=>{ const p=document.querySelector('.leaflet-marker-icon');
  if(p){p.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;} return false; });
await new Promise(r=>setTimeout(r,1200));
ok(pinned,'opened a listing from the map');
ok((await visibleAppLinks()).length===0,'no reachable /app link on Map+listing');

// PLAYERS
await pg.evaluate(()=>{ const el=[...document.querySelectorAll('button,[role=button],[data-mode]')]
  .find(e=>/^players$/i.test((e.textContent||'').trim())||e.getAttribute('data-mode')==='companies'); if(el)el.click(); });
await new Promise(r=>setTimeout(r,1500));
ok(!/\/app(\/|\?|$)/.test(pg.url()),'Players did not navigate into /app');

// PURSUITS → PROPOSAL (the two Maps-native work surfaces)
for (const [path,label] of [['/opportunity-map/pursuits','Pursuits'],['/opportunity-map/proposal','Proposal']]) {
  await pg.goto(B+path,{waitUntil:'networkidle2',timeout:45000});
  await new Promise(r=>setTimeout(r,1200));
  ok(pg.url().includes(path),`${label} reachable natively`);
  ok((await visibleAppLinks()).length===0,`no reachable /app link on ${label}`);
}

// LOGO → TODAY
await pg.goto(B+'/opportunity-map/vault',{waitUntil:'networkidle2',timeout:45000});
await new Promise(r=>setTimeout(r,900));
const logoHref = await pg.evaluate(()=>{ const a=document.querySelector('a.zh-logo')||
  [...document.querySelectorAll('a')].find(x=>x.querySelector('img')); return a?a.getAttribute('href'):null; });
ok(logoHref==='/today',`logo returns to Today's Intel (href=${logoHref})`);

// ACCOUNT MENU → My Pursuits / Proposals
await pg.evaluate(()=>{ const btn=document.getElementById('mindyAcctBtn')||
  document.querySelector('[id^="mindyAcct"]'); if(btn)btn.click(); });
await new Promise(r=>setTimeout(r,600));
const menu = await pg.evaluate(()=>{
  const get=(re)=>{ const a=[...document.querySelectorAll('a[href]')].find(x=>re.test((x.textContent||'').trim())); return a?a.getAttribute('href'):null; };
  return { pursuits:get(/^My Pursuits$/i), proposals:get(/^Proposals$/i) };
});
ok(menu.pursuits==='/opportunity-map/pursuits',`Account → My Pursuits = ${menu.pursuits}`);
ok(menu.proposals==='/opportunity-map/pursuits',`Account → Proposals lands at PURSUITS, not an empty workspace (${menu.proposals})`);

// SIGN OUT
const beforeOut=navs.length;
const clicked=await pg.evaluate(()=>{ const o=document.getElementById('mindyAcctOut'); if(o){o.click();return true;} return false; });
await new Promise(r=>setTimeout(r,2000));
ok(clicked,'Sign out control present');
ok(pg.url().includes('/today'),`sign-out returns to Today's Intel (${pg.url().replace(B,'')})`);
ok(!navs.slice(beforeOut).some(u=>/\/app(\/|\?|$)/.test(u)),'sign-out never routed through /app');

// PROTECTED ROUTE AFTER SIGN-OUT → modal, not stale content
await pg.goto(B+'/opportunity-map/vault',{waitUntil:'networkidle2',timeout:45000});
await new Promise(r=>setTimeout(r,1200));
const after=await pg.evaluate(()=>({
  modal: typeof window.__mapsSignIn==='function',
  // 240, not 80: the sign-in copy sits AFTER the nav chrome, and an 80-char slice cut
  // off before reaching it — the page was correct, the assertion was truncating.
  txt:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,240),
  tok: localStorage.getItem('mi_beta_auth_token'),
}));
ok(!after.tok,'token cleared');
ok(after.modal,'protected route offers the Maps sign-in modal');
ok(/sign in/i.test(after.txt),'shows signed-out content, not stale authenticated content');

const appNavs=navs.filter(u=>/\/app(\/|\?|$)/.test(u));
ok(appNavs.length===0,`zero navigations into /app across the whole journey (found ${appNavs.length})`);
await b.close();
console.log(fail?`\n  ✗ AUTHENTICATED JOURNEY: ${fail} failed\n`:'\n  ✓ AUTHENTICATED JOURNEY CLEAN\n');
process.exit(fail?1:0);
