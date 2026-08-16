/**
 * GET /opportunity-map/market — Market research, CONTINUED FROM THE MAP.
 *
 * Eric 2026-08-02: "when you are on the map and search you should be able to CONTINUE your search
 * into the market research section. But it ORIGINATES FROM THE MAP." So this is NOT the old
 * standalone /market-explorer hub (which linked to old-dark /contractors + 404 firm slugs). It is
 * a MAP SUB-VIEW — same top nav + same left rail as /opportunity-map/saved + /favorites (Market
 * active) — that RECEIVES the current map search/filters as URL query params and runs the market
 * report for exactly that search:
 *
 *   /opportunity-map/market?q=roofing&state=FL&naics=238160&agency=…&setAside=…
 *
 * It calls the SAME /api/app/market-report the saved-search "Run report" uses (who's buying · who
 * holds it · recompetes · forecasts · who to call), and renders it with the SAME renderer. The map
 * rail's "Market" item builds this URL live from window.__mindyViewCtx() (the map's real Q+FILT),
 * so the search carries over with zero retyping. Empty search → the browse hub (top agencies + top
 * markets), which deep-links BACK INTO the map (?agency= / ?naics=), never to the old pages.
 *
 * Chrome MIRRORS opportunity-map/saved/route.ts (which mirrors favorites, which mirrors the map
 * ZHEAD/ZRAIL). Keep them in sync. The account avatar is shared verbatim via ./account-menu.
 */
import { NextResponse } from 'next/server';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../account-menu';
import { AGENCIES_SEO } from '@/data/agencies-seo';
import { NAICS_TOP_100 } from '@/data/naics-top100';

export const dynamic = 'force-dynamic';

// Browse-hub fallback data (empty search) — the curated sets that already power /agencies + /naics.
// Static + tiny, no cold BQ scan on the hub. Each row deep-links BACK INTO THE MAP so the user
// stays in the map app (Eric: it must be integrated with the map, not a separate reference site).
const TOP_AGENCIES = [...AGENCIES_SEO]
  .filter((a) => a.fy26BudgetB)
  .sort((a, b) => (b.fy26BudgetB ?? 0) - (a.fy26BudgetB ?? 0))
  .slice(0, 12)
  .map((a) => ({ name: a.name, abbr: a.abbreviation, budget: a.fy26BudgetB as number }));
const TOP_NAICS = [...NAICS_TOP_100]
  .sort((a, b) => b.totalValue - a.totalValue)
  .slice(0, 12)
  .map((n) => ({ code: n.code, title: n.title, value: n.totalValue, contractors: n.contractorCount }));

function fmtB(n: number): string { return `$${n.toLocaleString()}B`; }
function fmtV(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(0)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
}

const HUB_AGENCIES_JSON = JSON.stringify(TOP_AGENCIES);
const HUB_NAICS_JSON = JSON.stringify(TOP_NAICS.map((n) => ({ ...n, valueLabel: fmtV(n.value) })));
void fmtB; // (agency budgets are pre-formatted client-side below)

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Market research — Mindy</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#2563eb;--jan:#2563eb;--green:#137a41;--red:#e5484d}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased}
  /* ── App chrome: top nav + left rail (mirror of opportunity-map ZHEAD/ZRAIL) ── */
  .zhead{position:sticky;top:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid var(--line);background:#fff;z-index:40}
  .zh-left,.zh-right{display:flex;align-items:center;gap:22px}
  .zh-left a{font:700 16px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}
  .zh-right a{font:700 15px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}
  .zh-left a:hover,.zh-right a:hover{color:var(--jan)}
  /* Defensive: any icon in the top nav is line-art, never a filled black blob (a rail-style SVG
     without this rendered as a solid black shape colliding with the logo — Eric 2026-08-02). */
  .zh-left a svg,.zh-right a svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;vertical-align:middle}
  .zh-left a.ask{display:inline-flex;align-items:center;gap:6px;color:var(--jan)}
  .zh-left a.ask svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:2}
  .zh-logo{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;text-decoration:none}
  .zh-logo img{height:25px;width:auto;display:block}
  .zh-logo span{font:700 19px "Inter",system-ui,sans-serif;color:var(--ink);letter-spacing:-.02em}
  @media(max-width:1000px){.zh-left,.zh-right{gap:14px}.zh-left a:nth-child(n+4),.zh-right a:first-child{display:none}}
  .zrail{position:fixed;left:0;top:52px;width:64px;height:calc(100vh - 52px);height:calc(100dvh - 52px);
    background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:2px;padding:14px 0;z-index:30;overflow:hidden}
  .zrail a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--sub);text-decoration:none;padding:8px 2px;border-radius:11px;width:56px;min-height:48px}
  .zrail a:hover{background:var(--wash);color:var(--ink)}.zrail a.on{color:var(--jan);background:#eff5ff}
  .zrail svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .zrail a span{font:600 10px Inter,system-ui,sans-serif;letter-spacing:.01em;line-height:1}
  .zrail-sep{width:34px;height:1px;background:var(--line);margin:6px auto}
  /* content area sits right of the 64px rail */
  .main{margin-left:64px}
  .wrap{max-width:960px;margin:0 auto;padding:30px 24px 64px}
  .kick{font:700 11px Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--jan)}
  h1{font-size:30px;font-weight:800;letter-spacing:-.02em;margin:6px 0 6px}
  .sub{color:var(--sub);font-size:15px;max-width:70ch}
  /* the market-scope chips (what search carried over from the map) */
  .scope{display:flex;flex-wrap:wrap;gap:7px;margin:16px 0 4px}
  .scope .sc{display:inline-flex;align-items:center;font:600 12.5px Inter,sans-serif;color:#1e3a8a;background:#eef3ff;border:1px solid #dbe6ff;border-radius:8px;padding:6px 11px;white-space:nowrap}
  .scope .newbtn{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font:700 13px Inter,sans-serif;color:var(--jan);text-decoration:none}
  .scope .newbtn:hover{text-decoration:underline}
  /* the inline report box (mirrors saved-search .rptbox) */
  .rptbox{margin-top:20px;border:1px solid var(--green);border-radius:14px;overflow:hidden;background:#fbfefc}
  .rptbox .top{height:3px;background:var(--green)}
  .rptbox .in{padding:18px 20px}
  .rptrun{display:flex;align-items:center;gap:12px;color:var(--sub);font:500 14px Inter,sans-serif}
  .rptspin{width:22px;height:22px;border:2.5px solid var(--line);border-top-color:var(--green);border-radius:50%;animation:rsp 1s linear infinite;flex:none}
  @keyframes rsp{to{transform:rotate(360deg)}}
  .rpthd{font:700 11px Inter,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:var(--sub);margin-bottom:12px;display:flex;align-items:center;gap:8px}
  .rptkpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
  @media(max-width:620px){.rptkpi{grid-template-columns:repeat(2,1fr)}}
  .rptkpi .c{border:1px solid var(--line);border-radius:10px;padding:11px 13px;background:#fff}
  .rptkpi .k{font:600 9.5px Inter,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:var(--faint)}
  .rptkpi .v{font:800 19px Inter,sans-serif;margin-top:4px;letter-spacing:-.02em;color:var(--ink)}
  .rptkpi .v.g{color:var(--green)} .rptkpi .v.m{color:var(--faint);font-size:13px;font-weight:700}
  .rptkpi .n{font:400 9px Inter,sans-serif;color:var(--faint);margin-top:2px}
  /* clickable Forecasts KPI + the inline coming-work list */
  .rptkpi .c.ce{cursor:pointer;text-align:left;transition:border-color .12s,box-shadow .12s;font-family:inherit}
  .rptkpi .c.ce:hover:not([disabled]){border-color:var(--jan);box-shadow:0 2px 10px -5px rgba(37,99,235,.4)}
  .rptkpi .c.ce[disabled]{cursor:default;opacity:.7}
  #fcList{display:none;margin:-4px 0 14px}
  .fcload{font:500 12.5px Inter,sans-serif;color:var(--faint);padding:10px 2px}
  .fcrows{border:1px solid var(--line);border-radius:11px;overflow:hidden}
  .fcrow{display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid var(--hair)}
  .fcrow:last-child{border-bottom:0}
  .fcrow:hover{background:var(--wash)}
  .fcm{flex:1;min-width:0}
  .fct{font:700 13px Inter,sans-serif;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fcs{font:500 11.5px Inter,sans-serif;color:var(--faint);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fcv{flex:none;font:800 13px Inter,sans-serif;color:var(--green)}
  .fcmore{font:500 11.5px Inter,sans-serif;color:var(--faint);padding:9px 2px 0}.fcmore a{color:var(--jan);font-weight:700;text-decoration:none}
  .rptcontacts{border:1px solid var(--line);border-radius:10px;background:#fff;padding:12px 14px;margin-bottom:14px}
  .rptcontacts .h{font:700 10px Inter,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);margin-bottom:8px}
  .rptcontacts .pc{display:flex;align-items:center;gap:10px;padding:5px 0;flex-wrap:wrap}
  .rptcontacts .pn{font:600 12.5px Inter,sans-serif;color:var(--ink);flex:1;min-width:120px}
  .rptcontacts .pn span{display:block;font:400 10px Inter,sans-serif;color:var(--faint)}
  .rptcontacts .pe{font:600 11.5px ui-monospace,Menlo,monospace;color:var(--green);text-decoration:none;white-space:nowrap}
  .rptcontacts .pe:hover{text-decoration:underline}
  .rptshare{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .rptshare input{flex:1;min-width:220px;font:11.5px ui-monospace,Menlo,monospace;color:var(--sub);background:#fff;border:1px solid var(--line);border-radius:8px;padding:9px 12px}
  .rptshare .cp{border:0;border-radius:8px;padding:9px 14px;font:700 12px Inter,sans-serif;background:var(--green);color:#fff;cursor:pointer}
  .rptshare .op{border:1px solid var(--green);color:var(--green);border-radius:8px;padding:9px 14px;font:700 12px Inter,sans-serif;text-decoration:none;background:none}
  .rptnote{font:400 11.5px Inter,sans-serif;color:var(--faint);margin:12px 0 0;line-height:1.55}
  .rptwarn{background:#fdf1e3;border:1px solid #f0c894;border-radius:8px;padding:10px 12px;font:400 11.5px Inter,sans-serif;color:#7a4b12;margin-top:12px}
  .rpterr{font:500 13px Inter,sans-serif;color:var(--red);padding:6px 0}
  .rptups{text-align:center;padding:10px 4px}
  .rptups h4{font:800 15px Inter,sans-serif;margin:0 0 6px;color:var(--ink)}
  .rptups p{font:500 12.5px Inter,sans-serif;color:var(--sub);margin:0 0 14px}
  .rptups a{display:inline-block;background:var(--green);color:#fff;text-decoration:none;border-radius:9px;padding:10px 20px;font:700 13px Inter,sans-serif}
  .signin{padding:8px 0;color:var(--sub);font:500 14px Inter,sans-serif}.signin a{color:var(--jan);font-weight:700;text-decoration:none}
  /* ── Browse hub (empty search) ── */
  .hub{margin-top:26px}
  .hubsec{margin-top:26px}
  .hubhd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px}
  .hubhd h2{font:800 18px Inter,sans-serif;letter-spacing:-.01em}
  .hubhd a{font:700 13px Inter,sans-serif;color:var(--jan);text-decoration:none}.hubhd a:hover{text-decoration:underline}
  .hubgrid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
  @media(max-width:640px){.hubgrid{grid-template-columns:1fr}}
  .hubrow{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--line);border-radius:11px;background:#fff;padding:13px 15px;text-decoration:none;transition:border-color .14s,box-shadow .14s}
  .hubrow:hover{border-color:#c4cfda;box-shadow:0 3px 12px -5px rgba(16,24,40,.16)}
  .hubrow .l{min-width:0}
  .hubrow .t{font:700 14px Inter,sans-serif;color:var(--ink);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hubrow .t .mono{font-family:ui-monospace,Menlo,monospace;color:var(--jan)}
  .hubrow .s{font:500 12px Inter,sans-serif;color:var(--faint);display:block;margin-top:2px}
  .hubrow .amt{font:800 14px Inter,sans-serif;flex:none}
  .hubrow .amt.b{color:var(--jan)} .hubrow .amt.g{color:var(--green)}
  ${ACCOUNT_MENU_CSS}
</style></head><body>
<header class="zhead">
  <nav class="zh-left">
    <a href="/opportunity-map">Opportunities</a>
    <a href="/opportunity-map?mode=buyers">Players</a>
    <a href="/opportunity-map/pursuits">Pursuits</a>
    <a href="/opportunity-map/reports">Markets</a>
    <a class="ask" href="/opportunity-map"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Ask Mindy</a>
  </nav>
  <a href="/app" title="Mindy" class="zh-logo"><img src="/brand/mindy-logo-icon.png" alt=""/><span>Mindy</span></a>
  <nav class="zh-right">
    <a href="/bid">Bid with confidence</a>
    <a href="/pricing">Pricing</a>
    ${ACCOUNT_MENU_HTML}
  </nav>
</header>
<nav class="zrail">
  <a href="/opportunity-map" title="Map"><svg viewBox="0 0 24 24"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg><span>Map</span></a>
  <a href="/opportunity-map/saved" title="Watchlist — saved searches &amp; new matches"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Watchlist</span></a>
  <a href="/opportunity-map/favorites" title="Saved — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Saved</span></a>
  <a href="/opportunity-map/pursuits" title="Pursuits — opportunities you are actively working"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Pursuits</span></a>
</nav>
<div class="main">
<div class="wrap">
  <div class="kick">Market research · from your map search</div>
  <h1 id="mktH1">Who's buying &amp; winning</h1>
  <div class="sub" id="mktSub">Who buys it, who wins it, spending, recompetes, forecasts and who to call — for exactly the search you ran on the map.</div>
  <div class="scope" id="mktScope"></div>
  <div id="mktBody"></div>
</div>
</div>
<script>
(function(){
  var HUB_AGENCIES=${HUB_AGENCIES_JSON}, HUB_NAICS=${HUB_NAICS_JSON};
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  var body=document.getElementById('mktBody'), scopeEl=document.getElementById('mktScope'), h1=document.getElementById('mktH1'), subEl=document.getElementById('mktSub');
  var SET={SDVOSB:'SDVOSB',SB:'Small Business','8A':'8(a)',WOSB:'WOSB',HZ:'HUBZone',OTHER:'Other'};

  // Read the market scope from the URL — these are the SAME keys the map's filters use, passed
  // straight through by the rail's "Market" link (built from window.__mindyViewCtx()).
  var P=new URLSearchParams(location.search);
  var scope={ q:(P.get('q')||'').trim(), naics:(P.get('naics')||'').trim(), psc:(P.get('psc')||'').trim(),
    agency:(P.get('agency')||'').trim(), setAside:(P.get('setAside')||P.get('set_aside')||'').trim(), state:(P.get('state')||'').trim().toUpperCase().slice(0,2) };
  // A market needs at least one real axis (keyword / NAICS / PSC) — same rule as the API.
  var naicsCodes=(scope.naics?scope.naics.split(','):[]).map(function(c){return c.trim();}).filter(function(c){return /^[0-9]{6}$/.test(c);});
  var hasMarket=!!(scope.q||naicsCodes.length||scope.psc);

  function scopeChips(){
    var c=[];
    if(scope.q)c.push('\\u201c'+scope.q+'\\u201d');
    if(naicsCodes.length)c.push(naicsCodes.length===1?('NAICS '+naicsCodes[0]):(naicsCodes.length+' NAICS codes'));
    if(scope.psc)c.push('PSC '+scope.psc);
    if(scope.setAside)c.push(scope.setAside.split(',').map(function(k){return SET[k]||k;}).join(', '));
    if(scope.agency)c.push(scope.agency);
    if(scope.state)c.push(scope.state);
    return c;
  }
  // Back to the SAME map search (carry the scope back), so Market ↔ Map is a round trip.
  function backHref(){ var qs=[]; Object.keys(scope).forEach(function(k){ var v=scope[k]; if(v)qs.push(encodeURIComponent(k==='setAside'?'setAside':k)+'='+encodeURIComponent(v)); }); return '/opportunity-map'+(qs.length?'?'+qs.join('&'):''); }
  // Browse ALL matching forecasts (the redesigned Forecasts view), carrying the market scope.
  function forecastsHref(){ var qs=[]; if(scope.q)qs.push('search='+encodeURIComponent(scope.q)); if(naicsCodes.length)qs.push('naics='+encodeURIComponent(naicsCodes.join(','))); if(scope.agency)qs.push('agency='+encodeURIComponent(scope.agency)); if(scope.state)qs.push('state='+encodeURIComponent(scope.state)); return '/opportunity-map/forecasts'+(qs.length?'?'+qs.join('&'):''); }
  scopeEl.innerHTML=(hasMarket?scopeChips().map(function(c){return '<span class="sc">'+h(c)+'</span>';}).join(''):'')
    +'<a class="newbtn" href="'+h(backHref())+'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>Back to map</a>';

  function mnum(n){ n=Number(n)||0; if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B'; if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M'; if(n>=1e3)return '$'+Math.round(n/1e3)+'K'; return '$'+n; }

  // ── Empty search → the browse hub (top agencies + top markets), each deep-linking BACK to the map. ──
  function renderHub(){
    h1.textContent="Browse the federal market";
    subEl.textContent="Pick an agency or market to scope the map — or run a search on the map and come back here to see who buys it and who wins it.";
    var agRows=HUB_AGENCIES.map(function(a){
      return '<a class="hubrow" href="/opportunity-map?agency='+encodeURIComponent(a.name)+'"><span class="l"><span class="t">'+h(a.name)+'</span><span class="s">'+h(a.abbr)+'</span></span><span class="amt b">$'+a.budget.toLocaleString()+'B</span></a>';
    }).join('');
    var nRows=HUB_NAICS.map(function(n){
      return '<a class="hubrow" href="/opportunity-map?naics='+encodeURIComponent(n.code)+'"><span class="l"><span class="t"><span class="mono">'+h(n.code)+'</span> \\u00b7 '+h(n.title)+'</span><span class="s">'+Number(n.contractors||0).toLocaleString()+' contractors</span></span><span class="amt g">'+h(n.valueLabel)+'</span></a>';
    }).join('');
    body.innerHTML='<div class="hub">'
      + '<div class="hubsec"><div class="hubhd"><h2>Top buying agencies</h2></div><div class="hubgrid">'+agRows+'</div></div>'
      + '<div class="hubsec"><div class="hubhd"><h2>Top markets (NAICS)</h2></div><div class="hubgrid">'+nRows+'</div></div>'
      + '</div>';
  }

  function rptErr(msg){ body.innerHTML='<div class="rptbox"><div class="top"></div><div class="in"><div class="rpthd">Market report</div><div class="rpterr">'+h(msg)+'</div></div></div>'; }
  function rptUpsell(url){ body.innerHTML='<div class="rptbox"><div class="top" style="background:#7c5cff"></div><div class="in"><div class="rpthd">Market report</div><div class="rptups"><h4>\\ud83d\\udd12 Market reports are a Pro feature</h4><p>Turn this search into a shareable, client-ready market report \\u2014 who\\u2019s buying, who holds it now, recompetes and forecasts, who to call, in one link.</p><a href="'+h(url||'/market-intelligence')+'">Upgrade to Pro</a></div></div></div>'; }
  function rptOk(d){
    var s=d.summary||{}; var sec=(d&&d.sections)||{};
    var topCo=((sec.competition&&sec.competition.contractors)||[])[0]||null;
    var topAg=((sec.top_agencies)||[])[0]||null;
    var contacts=sec.contacts||null;
    var k1 = topCo ? '<div class="c"><div class="k">Top incumbent</div><div class="v g">'+mnum(topCo.total_obligated)+'</div><div class="n">'+h((topCo.recipient_name||'').split(' ').slice(0,2).join(' '))+'</div></div>'
                   : '<div class="c"><div class="k">Buying agencies</div><div class="v">'+((s.buying_agencies)||0)+'</div><div class="n">in this market</div></div>';
    var k4 = (contacts&&contacts.people&&contacts.people.length)
      ? '<div class="c"><div class="k">Who to call</div><div class="v">'+(s.contacts||contacts.people.length)+'</div><div class="n">'+h((contacts.agency||'').split(',')[0])+'</div></div>'
      : (topAg?('<div class="c"><div class="k">Top buyer</div><div class="v m">'+h((topAg.name||topAg.agency||'').split(',')[0])+'</div><div class="n">'+mnum(topAg.amount||topAg.total)+'</div></div>')
             :('<div class="c"><div class="k">Total market</div><div class="v m">see report</div><div class="n"></div></div>'));
    var contactsPeek='';
    if(contacts&&contacts.people&&contacts.people.length){
      contactsPeek='<div class="rptcontacts"><div class="h">Who to call \\u00b7 '+h((contacts.office||contacts.agency||'').split(',')[0])+'</div>'
        + contacts.people.slice(0,3).map(function(p){
            return '<div class="pc"><span class="pn">'+h(p.name)+'<span>'+h(p.role||'')+'</span></span>'
              + (p.email?'<a class="pe" href="mailto:'+h(p.email)+'">'+h(p.email)+'</a>':'')+'</div>';
          }).join('')
        + '</div>';
    }
    var deg = d.degraded ? '<div class="rptwarn">\\u26a0 One data axis came back thin for this search, so the report notes it rather than showing a fabricated number. For a precise market total, search a 6-digit NAICS on the map.</div>' : '';
    var fcCount=(s.forecasts)||0;
    body.innerHTML='<div class="rptbox"><div class="top"></div><div class="in">'
      + '<div class="rpthd">Market report \\u00b7 '+h(d.subject||'market')+'</div>'
      + '<div class="rptkpi">'+k1
      +   '<div class="c"><div class="k">Recompetes</div><div class="v">'+((s.recompetes)||0)+'</div><div class="n">expiring primes</div></div>'
      // Forecasts KPI is CLICKABLE — expands the actual matching upcoming buys inline (incl. the
      // location-less ones), so "coming work" is real rows, not just a count (Eric 2026-08-02).
      +   '<button class="c ce" id="fcCard"'+(fcCount?'':' disabled')+'><div class="k">Forecasts</div><div class="v">'+fcCount+'</div><div class="n">coming work'+(fcCount?' \\u00b7 show \\u25be':'')+'</div></button>'
      +   k4
      + '</div>'
      + '<div id="fcList"></div>'
      + contactsPeek
      + '<div class="rptshare"><input readonly value="'+h(d.url)+'"><button class="cp">Copy link</button><a class="op" href="'+h(d.url)+'" target="_blank" rel="noopener">Open the full report \\u2197</a></div>'
      + deg
      + '<p class="rptnote">The full page has top agencies, competitors, recompetes, forecasts and who to call. Reading is free \\u2014 every \\u201crespond\\u201d action on it prompts a sign-in (the share loop).</p>'
      + '</div></div>';
    var cp=body.querySelector('.cp'), inp=body.querySelector('input');
    if(cp&&inp)cp.onclick=function(){ inp.select(); try{ (navigator.clipboard&&navigator.clipboard.writeText(inp.value))||document.execCommand('copy'); cp.textContent='Copied \\u2713'; setTimeout(function(){cp.textContent='Copy link';},1600); }catch(e){} };
    var fcCard=document.getElementById('fcCard');
    if(fcCard&&fcCount)fcCard.onclick=function(){ toggleForecasts(document.getElementById('fcList'), fcCard); };
  }

  // Expand the matching UPCOMING FORECASTS inline (placed + location-less), from the forecast-map
  // API with the SAME search scope. Reuses includeUnplaced=1 so the un-mappable ones (~43%) show
  // here too. A national bbox so a nationwide/TBD forecast isn't excluded by geography.
  var _fcLoaded=false;
  function toggleForecasts(box, card){
    if(!box)return;
    if(box.getAttribute('data-open')==='1'){ box.style.display='none'; box.setAttribute('data-open','0'); var n=card&&card.querySelector('.n'); if(n)n.innerHTML='coming work \\u00b7 show \\u25be'; return; }
    box.style.display='block'; box.setAttribute('data-open','1');
    var n=card&&card.querySelector('.n'); if(n)n.innerHTML='coming work \\u00b7 hide \\u25b4';
    if(_fcLoaded)return; _fcLoaded=true;
    box.innerHTML='<div class="fcload">Loading upcoming forecasts\\u2026</div>';
    var qs=['bbox=-179,15,-60,72','includeUnplaced=1'];
    if(scope.q)qs.push('q='+encodeURIComponent(scope.q));
    if(naicsCodes.length)qs.push('naics='+encodeURIComponent(naicsCodes.join(',')));
    if(scope.agency)qs.push('agency='+encodeURIComponent(scope.agency));
    if(scope.state)qs.push('state='+encodeURIComponent(scope.state));
    fetch('/api/app/forecast-map?'+qs.join('&'),{headers:{'x-mi-auth-token':t,'x-user-email':em}})
      .then(function(r){return r.json();})
      .then(function(d){
        var rows=[].concat(d.pins||[]).concat(d.unplaced||[]);
        if(!rows.length){ box.innerHTML='<div class="fcload">No matching forecasts in this market yet.</div>'; return; }
        box.innerHTML='<div class="fcrows">'+rows.slice(0,20).map(function(f){
          var val=f.est?mnum(f.est):'';
          var loc=f.noLoc?('\\u25cb '+f.noLoc):(f.loc||'');
          return '<div class="fcrow"><div class="fcm"><div class="fct">'+h(f.title||'Forecast')+'</div>'
            + '<div class="fcs">'+h(f.agency||'')+(f.naics?(' \\u00b7 NAICS '+h(f.naics)):'')+(f.cat?(' \\u00b7 '+h(String(f.cat).replace(/^Forecast \\u00b7 /,''))):'')+(loc?(' \\u00b7 '+h(loc)):'')+'</div></div>'
            + (val?'<div class="fcv">'+h(val)+'</div>':'')+'</div>';
        }).join('')+'</div>'
        + '<div class="fcmore">'+(rows.length>20?('Showing 20 of '+rows.length+' \\u00b7 '):'')+'<a href="'+h(forecastsHref())+'">browse all matching forecasts \\u2192</a></div>';
      })
      .catch(function(){ box.innerHTML='<div class="fcload">Couldn\\u2019t load forecasts. Try again.</div>'; });
  }

  // ── Auto-run the market report for the carried-over search. ──
  var t=tok(), em=email();
  if(!hasMarket){ renderHub(); return; }
  if(!t||!em){ body.innerHTML='<div class="signin">Please <a href="/app?next='+encodeURIComponent(location.pathname+location.search)+'">sign in</a> to run the market report for this search.</div>'; return; }
  var subject=(naicsCodes.length===1?naicsCodes[0]:naicsCodes.length?(naicsCodes.length+' NAICS codes'):'')||(scope.psc?('PSC '+scope.psc):'')||scope.q||'market';
  body.innerHTML='<div class="rptbox"><div class="top"></div><div class="in"><div class="rptrun"><div class="rptspin"></div><div>Building the '+h(subject)+' report\\u2026 <span style="color:var(--faint)">who\\u2019s buying \\u00b7 who holds it \\u00b7 recompetes \\u00b7 forecasts \\u00b7 who to call</span></div></div></div></div>';
  // Market key priority: NAICS union → PSC → keyword (same as the saved-search Run report).
  var payload={ email:em };
  if(naicsCodes.length){ payload.naics=naicsCodes.join(','); if(scope.psc)payload.psc=scope.psc; }
  else if(scope.psc){ payload.psc=scope.psc; }
  else { payload.keyword=scope.q; }
  if(scope.agency)payload.agency=scope.agency;
  if(scope.setAside)payload.set_aside=scope.setAside;
  if(scope.state)payload.state=scope.state;
  fetch('/api/app/market-report',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},body:JSON.stringify(payload)})
    .then(function(r){ return r.json().then(function(d){ return {status:r.status,d:d}; }); })
    .then(function(res){
      if(res.status===402||(res.d&&res.d.teaser)){ rptUpsell(res.d&&res.d.upgrade_url); return; }
      if(res.status===422||(res.d&&res.d.grounded===false)){ rptErr((res.d&&res.d.error)||'No federal market found for this search.'); return; }
      if(!res.d||!res.d.success||!res.d.url){ rptErr((res.d&&res.d.error)||'Report generation failed. Try again shortly.'); return; }
      rptOk(res.d);
    })
    .catch(function(){ rptErr('Request failed. Check your connection and try again.'); });
})();
</script>
${ACCOUNT_MENU_JS}
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
