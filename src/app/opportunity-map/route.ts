/**
 * GET /opportunity-map — serves Eric's evc-opportunity-map prototype VERBATIM (its exact
 * HTML/CSS/JS from template.html), with the static OPPS array swapped for LIVE opportunities.
 * We only adapt our data into the shape the prototype's JS expects; nothing about the design
 * is rebuilt.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getMapOpportunities } from '@/lib/opportunities/map-data';
import { OPPORTUNITY_MAP_TEMPLATE } from './template-html';

export const dynamic = 'force-dynamic';

// ?embed=1 → map only (hide the sidebar/rail/scoreboard) so the SAME map can be dropped
// full-bleed into the /home-v5 hero box. It's the real map, not a preview.
// Embed = map only, sized to the iframe (kill the 100vh/min-height:560 chain that leaves the
// map zero-height inside a shorter iframe → blank box), controls hidden.
const EMBED_CSS = '<style>html,body{height:100%!important;min-height:0!important}'
  + '.app{grid-template-columns:0 minmax(0,1fr)!important;height:100%!important;min-height:0!important}'
  + '.mapwrap{height:100%!important;border:0}#map{height:100%!important}'
  + '.panel,.railbtn,.sbtoggle,.sb,.maptop{display:none!important}</style>';
// Force Leaflet to re-measure once the iframe has its real size (else tiles render blank).
const EMBED_JS = "<script>window.addEventListener('load',function(){[200,600,1200].forEach(function(t){setTimeout(function(){try{map.invalidateSize();fitView();}catch(e){}},t);});});</script>";

// Our set-aside group key → the token the prototype's setKey()/cardHTML expect.
const SET_TO_EVC: Record<string, string> = {
  SDVOSB: 'SDVOSB', SB: 'SB', '8A': '8(a)', WOSB: 'WOSB', HZ: 'HUBZone', OTHER: 'Other', NONE: 'None',
};

// Clean the raw department into a short, readable agency label for the card.
function cleanAgency(dept: string): string {
  const d = (dept || '').replace(/,?\s*DEPARTMENT OF( THE)?/i, '').replace(/DEPARTMENT OF( THE)?\s*/i, '').trim();
  return d.replace(/\b([A-Z])([A-Z0-9'&./-]*)/g, (_, a, b) => a + b.toLowerCase()) || dept;
}

// A "Commodity buys" toggle injected into the filter bar (no self-filtering — default SHOWS
// all; the user opts to hide FSC micro-buys). Sits alongside the template's own filters.
const FSC_TOGGLE = '<button class="fbtn" id="fscToggle" title="FSC parts/commodity micro-buys">Commodity buys: shown</button>';

// Full-page CSS overrides (kept out of the verbatim template): (1) sheet-label readability
// — grid items default to min-width:auto so nowrap labels overflow their cell; let them wrap.
// (2) filter bar WRAPS to a 2nd row instead of hiding filters off-screen behind a scroll.
// (3) a set-aside color legend on the map.
const PAGE_CSS = '<style>'
  + '.opt{min-width:0;align-items:flex-start}'
  + '.opt .cbx,.opt .swatch{margin-top:2px}'
  + '.opt .lbl{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.25;word-break:break-word}'
  + '.sheet{max-height:48vh;overflow-y:auto}'
  // Filters wrap (no more horizontal-scroll hiding Set-aside & beyond).
  + '.fscroll{flex-wrap:wrap!important;overflow-x:visible!important;row-gap:7px}'
  // Set-aside color legend, bottom-left of the map.
  + '.setlegend{position:absolute;left:12px;bottom:12px;z-index:500;background:rgba(255,255,255,.95);'
  + 'border:1px solid var(--line);border-radius:10px;padding:8px 11px;box-shadow:0 2px 12px rgba(0,0,0,.09);'
  + 'display:flex;flex-wrap:wrap;gap:4px 12px;max-width:280px;font:500 11px Inter,system-ui,sans-serif}'
  + '.setlegend .sl-t{width:100%;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.05em;font-size:9.5px;margin-bottom:1px}'
  + '.setlegend span{display:inline-flex;align-items:center;gap:4px;color:var(--ink)}'
  + '.setlegend i{width:9px;height:9px;border-radius:50%;display:inline-block}'
  // "Save to pursuits" button (styled like the template's .act/.pva anchors) + demoted SAM link.
  + '.act.savep,.pva.savep{cursor:pointer;font:inherit;font-weight:600}'
  + '.savep.saved{color:#22a06b!important;border-color:#22a06b!important;background:#f0fdf7!important}'
  + '.act.samlink,.pva.samlink{color:var(--sub);font-size:11px;font-weight:500}'
  // Progress/gamification widget removed for now (Eric, 2026-07-25).
  + '.sbtoggle,.sb{display:none!important}'
  // Old list-collapse toggle (.railbtn) was pinned to the old left-panel edge (left:392px) and
  // floated in the middle of the map in the new layout — remove it (cards stay always-visible).
  + '.railbtn{display:none!important}'
  + '</style>';

// Loaded right after leaflet.js (before the template's map script): setColorFor(). It MUST be a
// hoisted global here because the template's render() (which we rewrite to call it) runs before
// the </body> viewport script; its body reads SETGROUPS/cv, which exist by call time. Pins now
// encode SET-ASIDE eligibility (the GovCon bid axis), not the old service-line category that
// never matched our NAICS-sector names (→ everything was gray).
const EARLY_INJECT = '<script>function setColorFor(o){if(o&&o.set===\'HUBZone\')return \'#f59e0b\';'
  + 'try{for(var i=0;i<SETGROUPS.length;i++){if(SETGROUPS[i].match(o.set))return cv(SETGROUPS[i].col);}}catch(e){}'
  + 'return (typeof cv===\'function\')?cv(\'--sec\'):\'#64748b\';}</script>';

// Zillow-style layout: top search+filters bar, thin far-left icon rail, center map, right cards.
// Achieved by re-gridding .app into areas and moving the filter bar into the top bar (JS). All
// of the template's render()/markers/filters/cards logic is untouched — only containers move.
const ZLAYOUT_CSS = '<style>'
  // Brand font: match the Mindy app (Inter) — drop the template's Space Grotesk display face.
  + ':root{--disp:"Inter",system-ui,-apple-system,sans-serif!important}'
  + '.snapt,.osec-h,.brand{font-family:"Inter",system-ui,-apple-system,sans-serif!important;letter-spacing:-.01em}'
  // Grid gains a full-width top HEADER row for the Mindy logo, above the search/filter row.
  + '.app{grid-template-columns:50px minmax(0,1fr) 404px!important;grid-template-rows:52px auto minmax(0,1fr)!important;'
  + 'grid-template-areas:"zhead zhead zhead" "zrail ztop ztop" "zrail zmap zcards"!important;transition:none!important}'
  + '.app.collapsed{grid-template-columns:50px minmax(0,1fr) 0px!important}'
  // Mindy header bar
  + '.zhead{grid-area:zhead;display:flex;align-items:center;gap:12px;padding:0 18px;border-bottom:1px solid var(--line);background:#fff;z-index:20}'
  + '.zhead img{height:27px;width:auto;display:block}'
  + '.zhead .zh-sep{width:1px;height:22px;background:var(--line)}'
  + '.zhead .zh-t{font:600 14px "Inter",system-ui,sans-serif;color:var(--ink)}'
  + '.zhead .zh-live{margin-left:auto;font:600 11px "Inter",system-ui,sans-serif;color:#22a06b;display:inline-flex;align-items:center;gap:6px;letter-spacing:.02em}'
  // far-left icon rail
  + '.zrail{grid-area:zrail;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:2px;padding:14px 0;z-index:10}'
  + '.zrail a{display:flex;flex-direction:column;align-items:center;gap:3px;font:600 9px/1.1 Inter,system-ui,sans-serif;color:var(--sub);text-decoration:none;padding:9px 3px;border-radius:9px;width:48px;text-align:center}'
  + '.zrail a:hover{background:var(--wash);color:var(--ink)}.zrail a.on{color:var(--ink)}'
  + '.zrail svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}'
  // top bar (search + the moved filters)
  + '.ztop{grid-area:ztop;position:relative;display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--line);background:#fff;z-index:9;min-width:0}'
  + '.zsearch{flex:0 1 330px;min-width:170px;max-width:32vw;display:flex;align-items:center;gap:8px;border:1.5px solid var(--line);border-radius:11px;padding:0 12px;height:42px;background:#fff}'
  + '.zsearch svg{width:16px;height:16px;stroke:var(--sub);fill:none;stroke-width:2;flex:none}'
  + '.zsearch input{border:0;outline:0;flex:1;min-width:0;font:500 13.5px Inter,system-ui,sans-serif;background:transparent;color:var(--ink)}'
  + '.mapwrap{grid-area:zmap!important}'
  + '.panel{grid-area:zcards!important;border-right:0!important;border-left:1px solid var(--line)!important}'
  // the filter bar, once moved into the top bar: strip its panel chrome, keep on one row
  + '.ztop .fbar{border:0!important;padding:0!important;margin:0!important;background:transparent!important;flex:0 1 auto;min-width:0}'
  + '.ztop .fbar .fscroll{flex-wrap:nowrap!important;overflow-x:auto!important;row-gap:0;min-width:0}'
  // Hard overflow guard: the filter bar must scroll inside its area, never widen the page and
  // push the left rail off-screen. Reduced rail (Eric).
  + 'html,body{overflow-x:hidden!important}'
  + '.app{max-width:100vw!important;overflow:hidden!important}'
  // filter sheets become dropdown overlays (a top bar can't push content down like the old panel)
  + '.ztop .fbar .sheet{position:absolute!important;top:calc(100% + 6px);left:18px;z-index:900;background:#fff;'
  + 'border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.14);padding:14px 16px;'
  + 'min-width:300px;max-width:540px;margin-top:0!important;max-height:62vh;overflow-y:auto}'
  + '</style>';

// Icon rail + top search bar. The template's .fbar (filters) is appended into .ztop by JS.
const ZRAIL_HTML = '<nav class="zrail">'
  + '<a href="/app" title="Back to Mindy"><svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>Mindy</a>'
  + '<a class="on" title="Opportunity Map"><svg viewBox="0 0 24 24"><path d="M9 4L3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5 9 4z"/><path d="M9 4v14M15 6.5v14"/></svg>Map</a>'
  + '<a href="/app?panel=pursuits" title="My Pursuits"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>Pursuits</a>'
  + '<a href="/app?panel=alerts" title="Alerts"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>Alerts</a>'
  + '</nav>';
const ZTOP_HTML = '<div class="ztop"><div class="zsearch">'
  + '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>'
  + '<input id="zsearchInput" placeholder="Search opportunities, agencies, keywords…" autocomplete="off"></div></div>';
// Mindy brand header bar (top, full width) — the wordmark + product name, Zillow-style.
const ZHEAD_HTML = '<header class="zhead">'
  + '<a href="/app" title="Mindy"><img src="/brand/mindy-logo-wordmark.svg" alt="Mindy AI"/></a>'
  + '<span class="zh-sep"></span><span class="zh-t">Federal Opportunity Map</span>'
  + '<span class="zh-live">● Live · SAM.gov</span></header>';

// Set-aside color legend overlaid on the map (so color = eligibility is self-explanatory).
const LEGEND_HTML = '<div class="setlegend"><div class="sl-t">Set-aside eligibility</div>'
  + '<span><i style="background:#22a06b"></i>SDVOSB</span>'
  + '<span><i style="background:#3b82f6"></i>Small Biz</span>'
  + '<span><i style="background:#8b5cf6"></i>8(a)</span>'
  + '<span><i style="background:#ef4444"></i>WOSB</span>'
  + '<span><i style="background:#f59e0b"></i>HUBZone</span>'
  + '<span><i style="background:#64748b"></i>Open</span>'
  + '<span style="width:100%;color:var(--sub);font-size:10px;gap:5px"><i style="background:#fff;border:1.5px solid #94a3b8"></i>hollow = buying office (place of performance not specified)</span></div>';

// Viewport-driven data layer (Airbnb/Google): the template ships a static SSR pin set; this
// swaps it for a live bbox fetch on every pan/zoom against /api/app/opportunity-map. Reuses
// the template's own render()/markers/list-sync verbatim — only the DATA source changes.
// The header is promoted to a dynamic "N of TOTAL" hero (reacts to filters + viewport, the
// Zillow/Airbnb convention); SDVOSB/closing is demoted to a small secondary line. select() is
// wrapped so clicking a card whose pin is inside a cluster zooms to reveal it first.
const VIEWPORT_JS = `<script>
(function(){
  var SETMAP={SDVOSB:'SDVOSB',SB:'SB','8A':'8(a)',WOSB:'WOSB',HZ:'HUBZone',OTHER:'Other',NONE:'None'};
  var HIDE_FSC=false, TOTAL=0, CAPPED=false, busy=false, t=null, t2=null, Q='';
  // Zillow layout: move the filter bar up into the top search bar, then re-measure the map.
  try{ var zt=document.querySelector('.ztop'), zf=document.querySelector('.fbar');
    if(zt&&zf){ zt.appendChild(zf); setTimeout(function(){try{map.invalidateSize();}catch(e){}},80); } }catch(e){}
  function clean(d){ return (d||'').replace(/,?\\s*DEPARTMENT OF( THE)?/i,'').replace(/DEPARTMENT OF( THE)?\\s*/i,'').trim().replace(/\\b([A-Z])([A-Z0-9'&.\\/-]*)/g,function(_,a,b){return a+b.toLowerCase();})||d; }
  function toRow(p){ return {src:'SAM',naics:p.naics,cat:p.cat,title:p.title,agency:clean(p.agency),set:SETMAP[p.set]||'None',loc:p.loc,close:(p.close||'').slice(0,10),sol:p.sol||p.id,nid:p.id,uiLink:p.uiLink,lat:p.lat,lng:p.lng,locSrc:p.locSrc}; }
  function bbox(){ var b=map.getBounds(); return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(function(n){return n.toFixed(4);}).join(','); }
  function updateHeader(){
    if(!TOTAL)return;
    var shown=(typeof rows!=='undefined'&&rows)?rows.length:OPPS.length;
    var sum=document.getElementById('sumline');
    if(sum)sum.innerHTML=shown.toLocaleString()+' <span style="color:var(--sub);font-weight:400">of '+TOTAL.toLocaleString()+' active opportunities'+(CAPPED?' (zoom in for more)':'')+'</span>';
    var sd=0,soon=0;
    for(var i=0;i<OPPS.length;i++){var o=OPPS[i];if(setKey(o.set)==='SDVOSB')sd++;var d=daysOut(o);if(d>=0&&d<=7)soon++;}
    var rc=document.getElementById('rescount');
    if(rc)rc.innerHTML='<span style="font-weight:400;color:var(--sub)">'+sd+' SDVOSB \\u00b7 '+soon+' closing this week</span>';
  }
  // Wrap render() so the header refreshes after every draw (pan AND client-side filter).
  var _render=render; render=function(){ _render(); updateHeader(); };
  function fetchView(){
    if(busy)return; busy=true;
    var url='/api/app/opportunity-map?bbox='+bbox()+'&status=active'+(HIDE_FSC?'&hideCommodity=1':'')+(Q?'&q='+encodeURIComponent(Q):'');
    fetch(url).then(function(r){return r.json();}).then(function(d){ busy=false;
      if(!d||!d.success)return;
      TOTAL=d.totalForFilters||0; CAPPED=!!d.capped;
      OPPS=(d.pins||[]).map(toRow);
      render();
    }).catch(function(){busy=false;});
  }
  map.on('moveend',function(){ clearTimeout(t); t=setTimeout(fetchView,450); });
  var zsi=document.getElementById('zsearchInput');
  if(zsi)zsi.addEventListener('input',function(){ clearTimeout(t2); t2=setTimeout(function(){ Q=zsi.value.trim(); fetchView(); },400); });
  var tg=document.getElementById('fscToggle');
  if(tg)tg.onclick=function(){ HIDE_FSC=!HIDE_FSC; tg.classList.toggle('active',HIDE_FSC); tg.textContent=HIDE_FSC?'Commodity buys: hidden':'Commodity buys: shown'; fetchView(); };
  setTimeout(fetchView,300); // first live load replaces the SSR set with the true viewport + real total
})();
</script>`;

// "Save to pursuits" — capture an opp into the user's My Pursuits pipeline. The map page is
// same-origin as the app, so it reads the MI auth token from localStorage (x-mi-auth-token) and
// the token's own email (which /api/pipeline validates against) then POSTs /api/pipeline. Degrades
// to "Sign in to save" if there's no session. GOS thesis: capture the customer.
const SAVE_JS = `<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function decodeEmail(t){ try{ var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); return (j.email||'').toLowerCase().trim(); }catch(e){return '';} }
  function email(t){ var e=decodeEmail(t); if(e)return e; try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  window.savePursuit=function(btn){
    if(btn.dataset.saved==='1')return;
    var t=tok(); var em=t?email(t):'';
    if(!t||!em){ btn.textContent='Sign in to save'; return; }
    var sol=btn.dataset.sol, o=null;
    try{ o=(OPPS||[]).find(function(x){return x.sol===sol;}); }catch(e){}
    if(!o)return;
    btn.textContent='Saving\\u2026'; btn.disabled=true;
    fetch('/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},
      body:JSON.stringify({user_email:em,title:o.title,notice_id:o.sol,solicitation_number:o.sol,agency:o.agency,naics_code:o.naics,response_deadline:o.close,source:'opportunity_map'})})
    .then(function(r){return r.json().catch(function(){return {};});}).then(function(d){
      var dup=d&&d.error&&/alread|exist|duplicate/i.test(d.error);
      if((d&&!d.error)||dup){ btn.textContent=dup?'\\u2713 In pursuits':'\\u2713 Saved'; btn.classList.add('saved'); btn.dataset.saved='1'; }
      else { btn.textContent='Try again'; btn.disabled=false; }
    }).catch(function(){ btn.textContent='Try again'; btn.disabled=false; });
  };
})();
</script>`;

// Opportunity detail DRAWER (Zillow card → detail page). Section #1 Snapshot for now; sections
// #2–14 (AI Pursuit Brief, Where, Contacts, Requirements, History, …) will render below it.
// Fetches /api/app/opportunity-detail?id=<notice_id>. Card click opens it (see the onclick swap).
const DRAWER_CSS = '<style>'
  + '.viewdet{color:var(--sub);font-weight:600;font-size:12px}'
  // Drawer fills the MAP area (between the 50px icon rail and the 404px cards column) and slides
  // in from the left — so the card list stays visible and clicking another card updates it.
  + '.oppbd{position:fixed;top:52px;left:50px;right:404px;bottom:0;background:rgba(17,28,38,.06);z-index:1400;opacity:0;pointer-events:none;transition:opacity .2s}'
  + '.oppbd.show{opacity:1}'
  + '.oppdrawer{position:fixed;top:52px;left:50px;right:404px;height:calc(100vh - 52px);height:calc(100dvh - 52px);background:#fff;z-index:1500;'
  + 'box-shadow:8px 0 40px rgba(0,0,0,.14);transform:translateX(-104%);transition:transform .28s cubic-bezier(.4,0,.2,1);'
  + 'overflow-y:auto;display:flex;flex-direction:column}'
  + '.oppdrawer.show{transform:none}'
  + '@media(max-width:1100px){.oppdrawer,.oppbd{left:0;right:0}}'
  + '.oppx{position:sticky;top:12px;align-self:flex-end;margin:12px 18px 0;width:34px;height:34px;border-radius:50%;'
  + 'border:1px solid var(--line);background:#fff;cursor:pointer;font-size:15px;z-index:2;display:grid;place-items:center;flex:none}'
  + '.oppbody{padding:2px 30px 44px;max-width:800px;width:100%}'
  + '.oppload{padding:70px 26px;text-align:center;color:var(--sub);font-size:14px}'
  + '.snaphero{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}'
  + '.badge-nt{display:inline-block;font:700 10.5px Inter,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;padding:4px 9px;border-radius:6px;background:var(--wash);color:var(--sub)}'
  + '.badge-dl{display:inline-block;font:700 11px Inter,system-ui,sans-serif;padding:4px 9px;border-radius:6px;background:#fef2f2;color:#d92d20}'
  + '.badge-dl.cool{background:#f0fdf7;color:#22a06b}'
  + '.snapt{font:700 22px/1.28 "Space Grotesk",Inter,system-ui,sans-serif;color:var(--ink);margin:8px 0 5px}'
  + '.snapmeta{color:var(--sub);font-size:13.5px;margin-bottom:15px}.snapmeta b{color:var(--ink);font-weight:600}'
  + '.snapgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;border:1px solid var(--line);border-radius:12px;padding:15px 17px}'
  + '.snapgrid .k{font:700 10.5px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}'
  + '.snapgrid .v{font-size:14px;font-weight:600;color:var(--ink);margin-top:2px}'
  + '.oppsoon{margin-top:26px;color:var(--faint);font-size:12px;border-top:1px dashed var(--line);padding-top:14px}'
  // detail sections
  + '.osec{margin-top:26px}'
  + '.osec-h{font:700 15px "Space Grotesk",Inter,system-ui,sans-serif;color:var(--ink);margin-bottom:11px}'
  + '.osec-b{font-size:13.5px;line-height:1.6;color:#374151;white-space:pre-wrap;word-break:break-word}'
  + '.osec-empty{font-size:13px;color:var(--faint)}'
  + '.osec-sub{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--sub);margin-bottom:7px}'
  + '.osec-b.clamp{max-height:210px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 74%,transparent);mask-image:linear-gradient(#000 74%,transparent)}'
  + '.osec-more{margin-top:9px;font:600 12.5px Inter,system-ui,sans-serif;color:var(--jan);background:none;border:0;cursor:pointer;padding:0}'
  + '.ocontact{border:1px solid var(--line);border-radius:11px;padding:12px 14px;margin-top:9px}'
  + '.ocontact .nm{font-weight:700;color:var(--ink);font-size:13.5px}'
  + '.ocontact .ti{color:var(--sub);font-size:12px;margin-top:1px}'
  + '.ocontact .row{margin-top:7px;font-size:12.5px}.ocontact a{color:var(--jan);text-decoration:none}'
  + '.odoc{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--hair);font-size:13px}'
  + '.odoc a{color:var(--jan);text-decoration:none;font-weight:600}'
  + '.oact{position:sticky;bottom:0;display:flex;gap:9px;flex-wrap:wrap;margin-top:26px;padding:14px 0 4px;background:linear-gradient(transparent,#fff 22%);border-top:1px solid var(--line)}'
  + '.oact .b{flex:1;min-width:130px;text-align:center;padding:11px 12px;border-radius:10px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;text-decoration:none;border:1px solid var(--line);background:#fff;color:var(--ink)}'
  + '.oact .b.pri{background:var(--ink);color:#fff;border-color:var(--ink)}'
  + '.oact .b.saved{color:#22a06b;border-color:#22a06b;background:#f0fdf7}'
  + '</style>';

const DRAWER_HTML = '<div class="oppbd" id="oppBd"></div>'
  + '<aside class="oppdrawer" id="oppDrawer"><button class="oppx" id="oppX" aria-label="Close">\u2715</button>'
  + '<div class="oppbody" id="oppBody"></div></aside>';

const DRAWER_JS = `<script>
(function(){
  var bd=document.getElementById('oppBd'), dr=document.getElementById('oppDrawer'), body=document.getElementById('oppBody'), xb=document.getElementById('oppX');
  var CUR=null;
  function close(){ dr.classList.remove('show'); bd.classList.remove('show'); }
  if(xb)xb.onclick=close; if(bd)bd.onclick=close;
  document.addEventListener('keydown',function(e){ if(e.key==='Escape')close(); });
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function due(d){ if(!d)return ''; var n=Math.ceil((new Date(d)-new Date())/86400000); if(n<0)return 'closed'; if(n===0)return 'due today'; if(n===1)return '1 day left'; return n+' days left'; }
  function longDate(d){ if(!d)return '\\u2014'; try{ return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }catch(e){return d;} }
  function sec(title,inner){ return '<div class="osec"><div class="osec-h">'+title+'</div>'+inner+'</div>'; }
  function empty(msg){ return '<div class="osec-empty">'+msg+'</div>'; }

  function snapshot(o){
    var n=o.deadline?Math.ceil((new Date(o.deadline)-new Date())/86400000):null;
    var cls=(n!=null&&n<=7)?'badge-dl':'badge-dl cool';
    return '<div class="snaphero">'
      + (o.noticeType?'<span class="badge-nt">'+esc(o.noticeType)+'</span>':'')
      + (o.deadline?'<span class="'+cls+'">'+esc(due(o.deadline))+'</span>':'')
      + '</div>'
      + '<div class="snapt">'+esc(o.title)+'</div>'
      + '<div class="snapgrid">'
      + '<div><div class="k">Set-aside</div><div class="v">'+esc(o.setAsideLabel||'Open')+'</div></div>'
      + '<div><div class="k">NAICS</div><div class="v">'+esc(o.naics||'\\u2014')+(o.category?' \\u00b7 '+esc(o.category):'')+'</div></div>'
      + '<div><div class="k">PSC</div><div class="v">'+esc(o.psc||'\\u2014')+'</div></div>'
      + '<div><div class="k">Response due</div><div class="v">'+longDate(o.deadline)+'</div></div>'
      + '<div><div class="k">Posted</div><div class="v">'+longDate(o.posted)+'</div></div>'
      + '<div><div class="k">Solicitation</div><div class="v" style="font-family:var(--mono,monospace);font-size:12.5px">'+esc(o.solicitation||'\\u2014')+'</div></div>'
      + '</div>';
  }
  // Buying organization — the agency hierarchy + place of performance, in its OWN section
  // (SAM shows this as a prominent block; it was easy to miss as a grey line under the title).
  function orgSec(o){
    var loc=(o.location.city?o.location.city+', ':'')+(o.location.state||o.location.country||'');
    var cue=o.location.source==='office'?' <span style="color:#94a3b8;font-weight:400;font-size:11px">(buying office)</span>':'';
    return sec('Buying organization','<div class="snapgrid">'
      + '<div><div class="k">Department / agency</div><div class="v">'+esc(o.department||'\\u2014')+'</div></div>'
      + '<div><div class="k">Sub-tier</div><div class="v">'+esc(o.subTier||'\\u2014')+'</div></div>'
      + (o.office?'<div><div class="k">Office</div><div class="v">'+esc(o.office)+'</div></div>':'')
      + '<div><div class="k">Place of performance</div><div class="v">'+esc(loc||'Not specified')+cue+'</div></div>'
      + '</div>');
  }
  function clamp(id,text){
    var long=text.length>620;
    return '<div class="osec-b'+(long?' clamp':'')+'" id="'+id+'">'+esc(text)+'</div>'
      + (long?'<button class="osec-more" onclick="var b=document.getElementById(\\''+id+'\\');var c=b.classList.toggle(\\'clamp\\');this.textContent=c?\\'Show more\\':\\'Show less\\';if(c)b.scrollIntoView({block:\\'nearest\\'});">Show more</button>':'');
  }
  function descSec(o){
    if(!o.synopsis)return sec('Description',empty('No description has been added to this opportunity.'));
    return sec('Description',clamp('synBody',o.synopsis));
  }
  function sowSec(o){
    if(!(o.sow&&o.sow.text))return '';
    return sec('Scope of work'+(o.sow.filename?' \\u00b7 <span style="font-weight:400;color:var(--sub);font-size:12px">'+esc(o.sow.filename)+'</span>':''),clamp('sowBody',o.sow.text));
  }
  function pocCard(c){
    return '<div class="ocontact"><div class="nm">'+esc(c.name||'Contact')+'</div>'
      + (c.title?'<div class="ti">'+esc(c.title)+'</div>':'')
      + '<div class="row">'
      + (c.email?'\\u2709\\ufe0f <a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>':'')
      + (c.email&&c.phone?' \\u00b7 ':'')+(c.phone?'\\u260e\\ufe0f '+esc(c.phone):'')
      + '</div></div>';
  }
  function contactsSec(o){
    var cs=o.contacts||[];
    if(!cs.length)return sec('Contact information',empty('No contact information has been added to this opportunity.'));
    var prim=cs.filter(function(c){return (c.type||'').toLowerCase()==='primary';});
    var alt=cs.filter(function(c){return (c.type||'').toLowerCase()!=='primary';});
    var inner='';
    if(prim.length)inner+='<div class="osec-sub">Primary point of contact</div>'+prim.map(pocCard).join('');
    if(alt.length)inner+='<div class="osec-sub" style="margin-top:14px">Alternative point of contact</div>'+alt.map(pocCard).join('');
    if(!prim.length&&!alt.length)inner=cs.map(pocCard).join('');
    return sec('Contact information',inner);
  }
  function docsSec(o){
    var links=[], atts=[];
    if(o.additionalInfo&&o.additionalInfo.link)links.push('<div class="odoc">\\ud83d\\udd17 <a href="'+esc(o.additionalInfo.link)+'" target="_blank" rel="noopener">Additional information</a></div>');
    if(o.uiLink)links.push('<div class="odoc">\\ud83d\\udd17 <a href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">View the full notice on SAM.gov</a></div>');
    (o.attachments||[]).slice(0,20).forEach(function(a){
      var name=(a&&a.name)||'Attachment', url=(a&&a.url)||'';
      atts.push('<div class="odoc">\\ud83d\\udcc4 '+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(name)+'</a>':esc(name))+'</div>');
    });
    var inner='<div class="osec-sub">Links</div>'+(links.length?links.join(''):empty('No links have been added to this opportunity.'))
      + '<div class="osec-sub" style="margin-top:16px">Attachments</div>'+(atts.length?atts.join(''):empty('No attachments have been added to this opportunity.'));
    return sec('Attachments / links',inner);
  }
  function vendorsSec(o){
    // SAM's Interested Vendors List. We don't cache it (SAM's IVL isn't in the opportunities API
    // and is usually empty), so mirror SAM's empty state and link to the live list.
    return sec('Interested vendors',
      empty('No interested vendors have been added to this opportunity.')
      + (o.uiLink?'<div class="odoc" style="border-bottom:0;margin-top:4px">\\ud83d\\udd17 <a href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">See the interested vendors list on SAM.gov</a></div>':''));
  }
  // Save to pursuits (detail) — mirrors the popup save, using the currently-open opp.
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(t){ try{ var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase():''; }catch(e2){return '';} }
  window.saveCurrentOpp=function(btn){
    if(!CUR||btn.dataset.saved==='1')return;
    var t=tok(), em=t?email(t):'';
    if(!t||!em){ btn.textContent='Sign in to save'; return; }
    btn.textContent='Saving\\u2026';
    fetch('/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},
      body:JSON.stringify({user_email:em,title:CUR.title,notice_id:CUR.id,solicitation_number:CUR.solicitation,agency:CUR.department,naics_code:CUR.naics,response_deadline:CUR.deadline,source:'opportunity_map'})})
    .then(function(r){return r.json().catch(function(){return {};});}).then(function(d){
      var dup=d&&d.error&&/alread|exist|duplicate/i.test(d.error);
      if((d&&!d.error)||dup){ btn.textContent=dup?'\\u2713 In pursuits':'\\u2713 Saved'; btn.classList.add('saved'); btn.dataset.saved='1'; }
      else btn.textContent='Try again';
    }).catch(function(){ btn.textContent='Try again'; });
  };
  function actions(o){
    return '<div class="oact">'
      + '<button class="b pri" onclick="saveCurrentOpp(this)">Save to pursuits</button>'
      + '<a class="b" href="/app?panel=proposal&notice='+encodeURIComponent(o.id)+'" target="_blank" rel="noopener">Draft proposal</a>'
      + (o.uiLink?'<a class="b" href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">View on SAM \\u2197</a>':'')
      + '</div>';
  }
  function render(o){
    CUR=o;
    return snapshot(o)+orgSec(o)+descSec(o)+sowSec(o)+contactsSec(o)+docsSec(o)+vendorsSec(o)
      + '<div class="oppsoon">Coming next to this view: AI Pursuit Brief \\u00b7 past-contract history \\u00b7 expected value range \\u00b7 agency intel \\u00b7 likely teaming partners.</div>'
      + actions(o);
  }
  window.openOppDrawer=function(nid){
    if(!nid)return;
    body.innerHTML='<div class="oppload">Loading\\u2026</div>';
    bd.classList.add('show'); dr.classList.add('show'); dr.scrollTop=0;
    fetch('/api/app/opportunity-detail?id='+encodeURIComponent(nid)).then(function(r){return r.json();}).then(function(d){
      body.innerHTML=(d&&d.success&&d.opp)?render(d.opp):'<div class="oppload">Couldn\\u2019t load this opportunity.</div>';
    }).catch(function(){ body.innerHTML='<div class="oppload">Couldn\\u2019t load this opportunity.</div>'; });
  };
})();
</script>`;

export async function GET(request: NextRequest) {
  const embed = new URL(request.url).searchParams.get('embed');
  let opps: unknown[] = [];
  try {
    const rows = await getMapOpportunities(600);
    opps = rows.map((o) => ({
      src: 'SAM',
      naics: o.naics,
      cat: o.cat,
      title: o.title,
      agency: cleanAgency(o.agency),
      set: SET_TO_EVC[o.set] ?? 'None',
      loc: o.loc,
      close: (o.close || '').slice(0, 10),
      sol: o.sol,
      nid: o.id,
      uiLink: o.uiLink,
      lat: o.lat,
      lng: o.lng,
      locSrc: o.locSrc,
    }));
  } catch {
    opps = [];
  }
  // Make OPPS reassignable so the viewport layer can swap it (embed stays static SSR).
  let html = OPPORTUNITY_MAP_TEMPLATE.replace('const OPPS = __OPPS_JSON__', 'let OPPS = __OPPS_JSON__');
  html = html.replace('__OPPS_JSON__', JSON.stringify(opps));
  if (embed) {
    html = html.replace('</head>', EMBED_CSS + '</head>').replace('</body>', EMBED_JS + '</body>');
  } else {
    // Full page: add a way back to the app (the standalone template has none).
    html = html.replace('<div class="phead">',
      '<div class="phead"><a href="/home-v5" style="display:inline-flex;align-items:center;gap:5px;font:600 12.5px Inter,system-ui,sans-serif;color:#6b7787;text-decoration:none;margin-bottom:9px">← Back to Mindy</a>');
    html = html.replace('</head>', PAGE_CSS + ZLAYOUT_CSS + DRAWER_CSS + '</head>');
    // Zillow layout: inject the icon rail + top search bar as the first children of .app
    // (the grid areas place them; VIEWPORT_JS moves the filter bar up into the top bar).
    html = html.replace('<div class="app">', '<div class="app">' + ZHEAD_HTML + ZRAIL_HTML + ZTOP_HTML);
    // Load setColorFor right after leaflet.js (before the template's map script).
    html = html.replace('<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>',
      '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>' + EARLY_INJECT);
    // Color pins by SET-ASIDE eligibility (fixes the all-gray category mismatch).
    html = html.split('catColor(o.cat)').join('setColorFor(o)');
    // Office-vs-PoP honesty: a pin whose location is the BUYING OFFICE (SAM omitted place of
    // performance) renders HOLLOW — white fill, colored ring — so it's not read as confirmed PoP.
    html = html.replace("color:'#ffffff',weight:2,",
      "color:o.locSrc==='office'?col:'#ffffff',weight:o.locSrc==='office'?2.5:2,");
    html = html.replace("fillColor:col,fillOpacity:o.src==='RECOMPETE'?.72:.95",
      "fillColor:o.locSrc==='office'?'#ffffff':col,fillOpacity:o.locSrc==='office'?0.9:(o.src==='RECOMPETE'?.72:.95)");
    // Honesty label in the popup + list card.
    html = html.replace('<div class="pvmeta"><b>${agency}</b> · ${o.loc}</div>',
      '<div class="pvmeta"><b>${agency}</b> · ${o.loc}${o.locSrc===\'office\'?\' <span style=\"color:#94a3b8\">· buying office (place of performance not specified)</span>\':\'\'}</div>');
    html = html.replace('<span class="loc">${o.loc}</span>',
      '<span class="loc">${o.loc}${o.locSrc===\'office\'?\' · office\':\'\'}</span>');
    // Set-aside color legend on the map.
    html = html.replace('<div id="map"></div>', '<div id="map"></div>' + LEGEND_HTML);
    // Commodity-buys toggle in the filter bar.
    html = html.replace('<button class="clr" id="clrAll">Clear all</button>',
      FSC_TOGGLE + '<button class="clr" id="clrAll">Clear all</button>');
    // CARD (#1 Snapshot): NO action buttons on the card face (Eric). The card is the clickable
    // snapshot; Save/Draft live in the detail drawer. Card actions → a "View details →" hint.
    html = html.replace('<a class="act" href="${samURL(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">SAM.gov</a>',
      '<span class="viewdet">View details →</span>');
    html = html.replace('<a class="act pri" href="${draftURL(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Start drafting</a>', '');
    // POPUP (map-pin quick peek): keep Save to pursuits + Draft proposal + a small SAM link.
    html = html.replace('<a class="pva" href="${samURL(o)}" target="_blank" rel="noopener">View on SAM.gov</a>',
      '<button class="pva savep" data-sol="${o.sol}" onclick="savePursuit(this)">Save to pursuits</button><a class="pva samlink" href="${samURL(o)}" target="_blank" rel="noopener">View on SAM ↗</a>');
    html = html.replace('<a class="pva pri" href="${draftURL(o)}" target="_blank" rel="noopener">Start drafting</a>',
      '<a class="pva pri" href="${draftURL(o)}" target="_blank" rel="noopener">Draft proposal</a>');
    // Card click opens the detail drawer (was: flyTo + popup). Uses the notice_id (o.nid).
    html = html.replace('c.onclick=()=>select(o.sol,true);', 'c.onclick=()=>openOppDrawer(o.nid||o.sol);');
    // Viewport-driven data + dynamic header + save-to-pursuits + detail drawer (last, after globals).
    html = html.replace('</body>', DRAWER_HTML + VIEWPORT_JS + SAVE_JS + DRAWER_JS + '</body>');
  }
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
