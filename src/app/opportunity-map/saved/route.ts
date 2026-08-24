/**
 * GET /opportunity-map/saved — the "Morning Brief" (Watchlist).
 *
 * The signed-in user's saved searches as a morning briefing: three grounded KPI tiles
 * (New opportunities · Current matched value · Closing this week) computed server-side by
 * /api/app/watchlist-brief, then one clean card per saved search — a plain-English name, a
 * SMALL muted NAICS/agency line, a grounded "$X.XM in currently matched opportunities" line,
 * a grounded "Today's story" block (DNA strands + recent changes, only lines with count>0),
 * a dynamic CTA ("Explore N New Opportunities →" when new, else "Open Today’s Lens →") + a ⋮
 * menu (Edit rename / Run market report peek / alert frequency / Delete).
 *
 * Every number shown comes from a real DB field via /api/app/watchlist-brief (which reuses
 * the SAME applyMapFilters engine as the alert cron; the "Today's story" strands are tallied
 * from opportunity_dna_keys and the change line from the pursuit_change_log diff cron). No
 * trend/delta/% language, no "since yesterday" / last-viewed / unread dots — those need a
 * per-user snapshot history we don't have yet, so we OMIT them rather than fabricate. Any
 * grounded count that is 0 hides its line rather than rendering a fake zero. No right sidebar
 * this release (activity-by-location / urgent alerts all need snapshot data we don't have).
 *
 * Chrome MIRRORS opportunity-map/route.ts's ZHEAD/ZRAIL — top nav + the 4-item left rail
 * (Map · Watchlist(active) · Saved · Pursuits) + the shared account avatar (./account-menu).
 * Keep them in sync. All data via /api/app/watchlist-brief + /api/app/saved-searches
 * (MI-token authed, read client-side from localStorage — same as the map).
 */
import { NextResponse } from 'next/server';
import { LOGIN_MODAL_CSS, LOGIN_MODAL_HTML, LOGIN_MODAL_JS } from '../login-modal';
import { MAPS_HOME_PATH } from '@/lib/mindy/maps-home';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../account-menu';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Watchlist — Mindy</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#006aff;--jan:#006aff;--green:#22a06b;--red:#e5484d}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased}
  /* ── App chrome: top nav + left rail (mirror of opportunity-map ZHEAD/ZRAIL) ── */
  .zhead{position:sticky;top:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid var(--line);background:#fff;z-index:40}
  .zh-left,.zh-right{display:flex;align-items:center;gap:22px}
  .zh-left a{font:700 16px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}
  .zh-right a{font:700 15px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}
  .zh-left a:hover,.zh-right a:hover{color:var(--jan)}
  .zh-left a svg,.zh-right a svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;vertical-align:middle}
  .zh-logo{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;text-decoration:none}
  .zh-logo img{height:25px;width:auto;display:block}
  .zh-logo span{font:700 19px "Inter",system-ui,sans-serif;color:var(--ink);letter-spacing:-.02em}
  /* MOBILE HEADER (<=700px). The centre logo is position:absolute, so it does NOT take part
     in the flex layout — at 390px it sat ON TOP of the nav: measured 49px of overlap with
     "Players", and the logo also collided with "Pricing". A scrollWidth/overflow check
     cannot catch this (an absolutely-positioned element never widens the page), which is
     why the mobile journey passed while the header was visibly broken.
     Fix: below 640px the logo returns to NORMAL FLOW at the left, and the link navs
     collapse — the account button is what a mobile visitor actually needs. */
  @media(max-width:640px){
    .zhead{padding:0 14px;gap:10px}
    .zh-logo{position:static;transform:none;order:-1;flex:0 0 auto}
    .zh-left{display:none}
    .zh-right{gap:12px;margin-left:auto}
    .zh-right a{display:none}
    .zh-right .mindy-acct{display:block}
  }

  @media(max-width:1000px){.zh-left,.zh-right{gap:14px}.zh-left a:nth-child(n+3),.zh-right a:first-child{display:none}}
  .zrail{position:fixed;left:0;top:52px;width:64px;height:calc(100vh - 52px);height:calc(100dvh - 52px);
    background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:2px;padding:14px 0;z-index:30;overflow:hidden}
  .zrail a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--sub);text-decoration:none;padding:8px 2px;border-radius:11px;width:56px;min-height:48px}
  .zrail a:hover{background:var(--wash);color:var(--ink)}.zrail a.on{color:var(--jan);background:#eff5ff}
  .zrail svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .zrail a span{font:600 10px Inter,system-ui,sans-serif;letter-spacing:.01em;line-height:1}
  .zrail-sep{width:28px;height:1px;background:var(--line);margin:6px auto}
  /* content area sits right of the 64px rail */
  .main{margin-left:64px}
  .wrap{max-width:1000px;margin:0 auto;padding:34px 24px 72px}
  /* ── Header ── */
  .mbhead{margin-bottom:28px}
  .mbhead h1{font-size:32px;font-weight:800;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
  .mbhead h1 .sun{display:inline-flex;color:#f59e0b}
  .mbhead h1 .sun svg{width:26px;height:26px}
  .mbhead .sub{color:var(--sub);font-size:15px;margin-top:5px}
  /* ── KPI row ── */
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:38px}
  @media(max-width:720px){.kpis{grid-template-columns:1fr}}
  .kpi{border:1px solid var(--line);border-radius:14px;padding:18px 20px;background:#fff;display:flex;align-items:center;gap:15px}
  .kpi .ic{width:44px;height:44px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center}
  .kpi .ic svg{width:22px;height:22px;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
  .kpi.k-new .ic{background:#eef5ff;color:var(--blue)}.kpi.k-new .ic svg{stroke:var(--blue)}
  .kpi.k-val .ic{background:#e8f7f0;color:var(--green)}.kpi.k-val .ic svg{stroke:var(--green)}
  .kpi.k-close .ic{background:#fdeceb;color:var(--red)}.kpi.k-close .ic svg{stroke:var(--red)}
  .kpi .n{font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1.05}
  .kpi .l{font-size:13px;color:var(--sub);margin-top:3px}
  /* ── Section header ── */
  .sechead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px;flex-wrap:wrap}
  .sechead h2{font-size:20px;font-weight:800;letter-spacing:-.01em}
  .sechead .ssub{color:var(--sub);font-size:14px;margin-top:3px}
  .sectools{display:flex;align-items:center;gap:10px}
  .sortsel{font:600 13px Inter,sans-serif;color:var(--ink);border:1px solid var(--line);border-radius:9px;padding:8px 11px;background:#fff;cursor:pointer}
  .vtoggle{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;background:#fff}
  .vtoggle button{appearance:none;border:0;background:none;padding:8px 10px;cursor:pointer;color:var(--faint);display:flex;align-items:center}
  .vtoggle button.on{color:var(--blue);background:#eff5ff}
  .vtoggle svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  /* ── List rows ── */
  .rows{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff}
  .rows.grid{border:0;background:none;display:grid;grid-template-columns:repeat(2,1fr);gap:14px;overflow:visible}
  @media(max-width:720px){.rows.grid{grid-template-columns:1fr}}
  .row{display:flex;align-items:flex-start;gap:20px;padding:20px 22px;border-bottom:1px solid var(--line);background:#fff;position:relative}
  .row:last-child{border-bottom:0}
  .rows.grid .row{border:1px solid var(--line);border-radius:14px}
  .row:hover{background:#fcfdff}
  .rmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px}
  .rname{font-size:18px;font-weight:800;letter-spacing:-.01em;color:var(--ink);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  /* "N new" badge is GREEN — new opportunities are good news (Eric 2026-08-05). */
  .badge{background:#e7f7ef;color:#0f7a48;font-weight:700;font-size:11.5px;border-radius:20px;padding:3px 10px;letter-spacing:.01em}
  /* NAICS/agency now a small MUTED secondary line under the name (de-emphasized, not the headline). */
  .rmeta{font:500 12.5px Inter,sans-serif;color:var(--faint);display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:-2px}
  .rmeta .dot{color:var(--line)}
  .rchips{display:flex;flex-wrap:wrap;gap:7px}
  .fchip{display:inline-flex;align-items:center;font:600 12px Inter,sans-serif;color:var(--sub);background:var(--wash);border:1px solid var(--line);border-radius:8px;padding:5px 10px;white-space:nowrap}
  .fchip-all{color:var(--faint)}
  .fchip-freq{color:#1e3a8a;background:#eef3ff;border-color:#dbe6ff}
  .fchip-freq.off{color:var(--faint);background:var(--wash);border-color:var(--line)}
  /* ── Today's story (grounded DNA strands + recent changes) — only lines with count>0 render ── */
  /* Clearer separation above Market Signals so the block scans on its own (Eric 2026-08-05). */
  .story{border-top:1px solid var(--line);padding-top:14px;margin-top:12px}
  .story .shd{font:700 10px Inter,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin-bottom:9px}
  .story ul{list-style:none;display:flex;flex-direction:column;gap:5px}
  .story li{display:flex;align-items:center;gap:8px;font:600 13px Inter,sans-serif;color:var(--ink)}
  .story li svg{width:15px;height:15px;flex:none;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .story li b{font-weight:800}
  .story .s-rb svg{stroke:#7c5cff}.story .s-sb svg{stroke:var(--green)}.story .s-es svg{stroke:var(--blue)}
  .story .s-cs svg{stroke:#e5484d}.story .s-ch svg{stroke:#c2410c}
  .rval{font:600 13.5px Inter,sans-serif;color:var(--ink)}
  .rval b{color:var(--green);font-weight:800}
  .rval-cap{color:var(--faint);font-weight:500;font-size:12.5px}
  .rval.pending,.rval.nomatch{color:var(--faint);font-weight:500}
  .rcta{margin-top:2px}
  .view{display:inline-flex;align-items:center;gap:6px;font:700 13.5px Inter,sans-serif;color:#fff;background:var(--blue);border-radius:9px;padding:9px 15px;text-decoration:none}
  .view:hover{filter:brightness(.94)}
  .view svg{width:15px;height:15px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  /* ── ⋮ overflow menu ── */
  .rside{flex:none;position:relative}
  .kebab{appearance:none;border:1px solid transparent;background:none;color:var(--faint);cursor:pointer;border-radius:8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
  .kebab:hover{background:var(--wash);color:var(--ink)}
  .kebab svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2}
  .menu{position:absolute;right:0;top:36px;min-width:170px;background:#fff;border:1px solid var(--line);border-radius:11px;box-shadow:0 12px 30px -8px rgba(16,24,40,.24);padding:6px;z-index:20;display:none}
  .menu.open{display:block}
  .menu .mi{display:block;width:100%;text-align:left;appearance:none;border:0;background:none;font:600 13px Inter,sans-serif;color:var(--ink);padding:9px 11px;border-radius:8px;cursor:pointer}
  .menu .mi:hover{background:var(--wash)}
  .menu .mi.del{color:var(--red)}
  .menu .msep{height:1px;background:var(--line);margin:5px 2px}
  .menu .mhd{font:700 10px Inter,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);padding:6px 11px 3px}
  .menu .mrow{display:flex;gap:4px;padding:2px 7px 6px}
  .menu .mrow button{flex:1;appearance:none;border:1px solid var(--line);background:#fff;font:600 11.5px Inter,sans-serif;color:var(--sub);padding:6px 4px;border-radius:7px;cursor:pointer}
  .menu .mrow button.on{background:var(--green);color:#fff;border-color:var(--green)}
  .menu .mrow button.on[data-freq="off"]{background:#8a94a3;border-color:#8a94a3}
  /* ── Run market report → inline PEEK (not the full dashboard) ── */
  .rptbox{margin-top:14px;border:1px solid var(--green);border-radius:12px;overflow:hidden;background:#fbfefc}
  .rptbox .top{height:3px;background:var(--green)}
  .rptbox .in{padding:14px 16px}
  .rptrun{display:flex;align-items:center;gap:11px;color:var(--sub);font:500 13px Inter,sans-serif}
  .rptspin{width:20px;height:20px;border:2.5px solid var(--line);border-top-color:var(--green);border-radius:50%;animation:rsp 1s linear infinite;flex:none}
  @keyframes rsp{to{transform:rotate(360deg)}}
  .rpthd{font:700 11px Inter,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:var(--sub);margin-bottom:10px;display:flex;align-items:center;gap:8px}
  .rpthd .x{margin-left:auto;border:0;background:none;color:var(--faint);font-size:17px;cursor:pointer;line-height:1;padding:0}
  /* The compact "peek" — a confirmation + one big Open button, NOT the report. */
  .rptpeek{display:flex;flex-direction:column;gap:11px}
  .rptpeek .rk{font:700 14px Inter,sans-serif;color:var(--ink);letter-spacing:-.01em}
  .rptpeek .rk b{color:var(--green)}
  .rptpeek .rc{font:500 12.5px Inter,sans-serif;color:var(--sub)}
  .rptpeek .rgo{display:block;text-align:center;background:var(--green);color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font:800 14px Inter,sans-serif;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(6,100,255,.12)}
  .rptpeek .rgo:hover{filter:brightness(1.05)}
  .rptshare{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .rptshare input{flex:1;min-width:180px;font:11.5px ui-monospace,Menlo,monospace;color:var(--sub);background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 11px}
  .rptshare .cp{border:1px solid var(--line);border-radius:8px;padding:8px 13px;font:700 12px Inter,sans-serif;background:#fff;color:var(--sub);cursor:pointer}
  .rptnote{font:400 11px Inter,sans-serif;color:var(--faint);margin:11px 0 0;line-height:1.5}
  .rptwarn{background:#fdf1e3;border:1px solid #f0c894;border-radius:8px;padding:9px 11px;font:400 11.5px Inter,sans-serif;color:#7a4b12;margin-top:11px}
  .rpterr{font:500 12.5px Inter,sans-serif;color:var(--red);padding:6px 0}
  .rptups{text-align:center;padding:8px 4px}
  .rptups h4{font:800 14px Inter,sans-serif;margin:0 0 5px;color:var(--ink)}
  .rptups p{font:500 12px Inter,sans-serif;color:var(--sub);margin:0 0 12px}
  .rptups a{display:inline-block;background:var(--green);color:#fff;text-decoration:none;border-radius:9px;padding:9px 18px;font:700 12.5px Inter,sans-serif}
  @media(max-width:760px){.row{flex-direction:row}}
  .empty{text-align:center;padding:70px 20px;color:var(--sub)}
  .empty h3{font-size:20px;color:var(--ink);margin-bottom:8px}
  .empty a{color:var(--blue);font-weight:700;text-decoration:none}
  .loading{text-align:center;padding:60px;color:var(--faint);display:flex;flex-direction:column;align-items:center;gap:14px}
  .spin{width:26px;height:26px;border:3px solid var(--line);border-top-color:var(--blue);border-radius:50%;animation:sp 1s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  .errline{text-align:center;padding:60px 20px;color:var(--sub)}
  .errline h3{font-size:18px;color:var(--ink);margin-bottom:6px}
  ${ACCOUNT_MENU_CSS}
</style><style>${LOGIN_MODAL_CSS}</style></head><body>
<header class="zhead">
  <nav class="zh-left">
    <a href="/opportunity-map">Opportunities</a>
    <a href="/opportunity-map?mode=buyers">Players</a>
    <a href="/opportunity-map/pursuits">Pursuits</a>
    <a href="/opportunity-map/reports">Markets</a>
  </nav>
  <a href="${MAPS_HOME_PATH}" title="Mindy" class="zh-logo"><img src="/brand/mindy-logo-icon.png" alt=""/><span>Mindy</span></a>
  <nav class="zh-right">
    <a href="/bid">Bid with confidence</a>
    <a href="/pricing">Pricing</a>
    ${ACCOUNT_MENU_HTML}
  </nav>
</header>
<nav class="zrail">
  <a href="/opportunity-map" title="Map"><svg viewBox="0 0 24 24"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg><span>Map</span></a>
  <a class="on" href="/opportunity-map/saved" title="Watchlist — saved searches &amp; new matches"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Watchlist</span></a>
  <a href="/opportunity-map/favorites" title="Saved — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Saved</span></a>
  <a href="/opportunity-map/pursuits" title="Pursuits — opportunities you are actively working"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Pursuits</span></a>
</nav>
<div class="main">
<div class="wrap">
  <div class="mbhead">
    <h1><span class="sun" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span> <span id="greeting">Morning Brief</span></h1>
    <div class="sub" id="subline">Here’s what’s new in your markets.</div>
  </div>
  <div id="kpis" class="kpis" hidden></div>
  <div id="body">
    <div class="loading"><div class="spin"></div><div>Loading your brief…</div></div>
  </div>
</div>
</div>
<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  var t=tok(), em=email();
  var kpisEl=document.getElementById('kpis'), bodyEl=document.getElementById('body'), greetEl=document.getElementById('greeting');
  function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function esc(s){ return h(s); }

  if(!t||!em){ bodyEl.innerHTML='<div class="signin" style="text-align:center;padding:70px 20px">Please <a href="#" onclick="return window.__mapsSignIn()">sign in</a> to see your Morning Brief.</div>'; return; }
  function hdrs(){ return {'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em}; }

  // Friendly first-name greeting derived SAFELY from the email local-part (never a hardcoded name).
  (function(){ try{ var lp=(em.split('@')[0]||'').split(/[._+-]/)[0]; if(lp&&/^[a-z]+$/i.test(lp)&&lp.length>=2){ var nm=lp.charAt(0).toUpperCase()+lp.slice(1); greetEl.textContent='Good morning, '+nm; } }catch(e){} })();

  // $X.XB / $X.XM / $XXXK money formatting (grounded from the summed M-Estimate medians).
  function fmtMoney(n){
    n=Number(n)||0; if(n<=0)return '$0';
    if(n>=1e9)return '$'+(n/1e9).toFixed(1).replace(/\\.0$/,'')+'B';
    if(n>=1e6)return '$'+(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M';
    if(n>=1e3)return '$'+Math.round(n/1e3)+'K';
    return '$'+Math.round(n);
  }

  // Rebuild the map URL for a saved search from its stored filters — the map re-applies a search by
  // its filter query-params (there is no ?savedSearch=<id> handler on the map), so pass the keys
  // straight through, exactly like the previous Watchlist did. mode=recompete for recompete searches.
  // Deep-link by ID, not by flattened filters.
  //
  // This used to spread r.filters into query params — naics=..., horizons=..., setAsideMulti=... —
  // but the map reads NONE of those (its deep-link params are opp/company/buyer/recompete/strategy),
  // so "Explore N New Opportunities" always landed on the UNFILTERED map: 136,879 results with every
  // horizon on, for a search scoped to NAICS 236/237/238 Open-only (Eric 2026-08-13). Two of the
  // values could not survive the trip anyway — String({open:true,...}) is "[object Object]" and
  // String([]) is "", so horizons became garbage and strategy silently vanished.
  //
  // The map now takes ?ss=<id>, loads the search, and runs it through __applySavedSearch — the same
  // restorer its own saved-search picker uses (mode + every FILT key + the visible controls + the
  // saved viewport). Sending the id keeps ONE source of truth: this page never has to know how a
  // filter is spelled, so the two cannot drift apart again.
  function mapUrl(r){
    var id=r&&r.id;
    if(!id)return '/opportunity-map';
    return '/opportunity-map?ss='+encodeURIComponent(String(id));
  }

  var SEARCHES=[];   // from /api/app/saved-searches (has .filters for the map URL + rename)
  var BRIEF={};      // id -> per-search aggregates from /api/app/watchlist-brief
  var SORT='new', VIEW='list';

  // Plain-English card title. Strip a trailing standalone "Search"/"search" ("Cybersecurity Search"
  // → "Cybersecurity") but NOTHING else — generic names ("My opportunities — Open") pass through
  // UNCHANGED (we never strip "Open"). If the cleaned name is blank OR only codes/punctuation/
  // whitespace, fall back to the NAICS chip as the title (grounded from the search's real codes).
  function cleanName(raw,agg){
    var nm=String(raw==null?'':raw).trim();
    nm=nm.replace(/\\s+(Search|search)$/,'').trim();   // ONLY a trailing standalone "Search"
    // codes-only / empty → NAICS fallback (never show a bare code string as a human title)
    if(!nm || /^[\\d,\\s/&+.-]+$/.test(nm)){
      var nc=naicsChip((agg&&agg.naics)||[]);
      if(nc)return nc;
      return nm || 'Saved search';
    }
    return nm;
  }

  // NAICS chip: up to ~3 codes, then "+N". If MANY 6-digit codes share a 3-digit family, collapse
  // to "NAICS 236***" (Eric's shape). Grounded from the search's real naics array.
  function naicsChip(codes){
    if(!codes||!codes.length)return '';
    if(codes.length<=3)return 'NAICS '+codes.join(', ');
    // many codes → try a shared 3-digit family
    var fam={}; codes.forEach(function(c){ var p=(c+'').slice(0,3); fam[p]=(fam[p]||0)+1; });
    var fams=Object.keys(fam);
    if(fams.length===1)return 'NAICS '+fams[0]+'***';
    return 'NAICS '+codes.slice(0,3).join(', ')+' +'+(codes.length-3);
  }

  // SMALL muted secondary line under the name — NAICS · agencies · alert frequency. De-emphasized
  // (grey text, no chip boxes) so it never competes with the name/story. All grounded.
  function metaFor(r,agg){
    var parts=[];
    var nc=naicsChip((agg&&agg.naics)||[]);
    if(nc)parts.push(h(nc));
    var ags=(agg&&agg.agencies)||[];
    if(ags.length){ parts.push(h(ags.length<=2?ags.join(', '):(ags.slice(0,2).join(', ')+' +'+(ags.length-2)))); }
    else { parts.push('All agencies'); }
    // Alert frequency is a SETTING, not content (Eric 2026-08-05: "keep the row about markets, not
    // configuration"). It lives in the ⋮ menu (Email alerts: Daily/Weekly/Off) — dropped from the meta.
    return parts.join('<span class="dot"> \\u00b7 </span>');
  }

  // ── Today's story — grounded lines, ONLY those with a real count>0; whole block omitted when all
  // are zero. Strand counts from opportunity_dna_keys; the change line from the pursuit_change_log
  // diff cron. No fabricated zeros, no amendments-off-last_modified (that column is 100% NULL).
  function plural(n){ return n===1?'':'s'; }
  function changeLabel(agg){
    var ch=(agg&&agg.changes)||null; if(!ch||!ch.changeCount)return null;
    var top=ch.changeTop, n=ch.changeCount;
    // Single-type, single-row → the specific human phrase; otherwise "N recent changes".
    var byType=ch.byType||{};
    if(top && byType[top]===n){
      var one={deadline:'deadline moved',amendment:'amendment',notice_type:'notice-type change',cancelled:'cancelled',awarded:'awarded',new_docs:'new document'+plural(n)}[top];
      if(one){ if(top==='cancelled'||top==='awarded')return n+' '+one; return (n>1?(n+' '):'1 ')+one; }
    }
    return n+' recent change'+plural(n);
  }
  function storyHtml(agg){
    var st=(agg&&agg.story)||null;
    var lines=[];
    function ic(p){ return '<svg viewBox="0 0 24 24">'+p+'</svg>'; }
    if(st&&st.repeat_buyer>0)lines.push('<li class="s-rb">'+ic('<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>')+'<span><b>'+st.repeat_buyer+'</b> Repeat buyer'+plural(st.repeat_buyer)+'</span></li>');
    if(st&&st.sb_friendly>0)lines.push('<li class="s-sb">'+ic('<path d="M20 6L9 17l-5-5"/>')+'<span><b>'+st.sb_friendly+'</b> Small-business friendly</span></li>');
    if(st&&st.early_stage>0)lines.push('<li class="s-es">'+ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5"/><path d="M12 16h.01"/>')+'<span><b>'+st.early_stage+'</b> Early-stage <span style="color:var(--faint);font-weight:600">(sources sought / early cycle)</span></span></li>');
    if(st&&st.closes_soon>0)lines.push('<li class="s-cs">'+ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')+'<span><b>'+st.closes_soon+'</b> Closing soon</span></li>');
    var cl=changeLabel(agg);
    if(cl)lines.push('<li class="s-ch">'+ic('<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.4 3.9a2 2 0 00-3.4 0z"/>')+'<span>'+h(cl)+'</span></li>');
    if(!lines.length)return '';
    // "Market Signals" (Eric 2026-08-05: "Repeat Buyers / Early Stage / Closing Soon aren't a story,
    // they're signals"). Part of the terminology pass — Market Signals = the facts on each card.
    return '<div class="story"><div class="shd">Market Signals</div><ul>'+lines.join('')+'</ul></div>';
  }

  function valLine(agg){
    if(!agg)return '<div class="rval nomatch">No current matches</div>';
    if(!agg.matchedCount)return '<div class="rval nomatch">No current matches</div>';
    if(!agg.marketValue)return '<div class="rval pending">Market value pending</div>';
    // HONEST CAP (no silent truncation): the brief sums the 300 most-recent matches per search. When a
    // search hits that cap the sum is a FLOOR, not the full market — say so rather than imply a total.
    var capNote=agg.capped?' <span class="rval-cap">across your 300 most recent matches</span>':' in currently matched opportunities';
    return '<div class="rval"><b>'+fmtMoney(agg.marketValue)+'</b>'+capNote+'</div>';
  }

  function rowHtml(r){
    var agg=BRIEF[r.id]||null;
    var nc=(agg&&agg.newCount)||0;
    var href=mapUrl(r);
    // Dynamic CTA: when there's something new, name it ("Explore N New Opportunities →"); else the
    // steady-state "Open Today’s Lens →". Same map deep-link href either way (pre-applies filters).
    var ctaTxt=(nc>0)?('Explore '+(nc>99?'99+':nc)+' New Opportunit'+(nc===1?'y':'ies')):'Open Today\\u2019s Lens';
    return '<div class="row" data-id="'+h(r.id)+'">'
      + '<div class="rmain">'
      +   '<div class="rname">'+h(cleanName(r.name,agg))
      +     (nc>0?'<span class="badge" title="'+nc+' new since you last looked">'+(nc>99?'99+':nc)+' new</span>':'')+'</div>'
      +   '<div class="rmeta">'+metaFor(r,agg)+'</div>'
      +   valLine(agg)
      +   storyHtml(agg)
      +   '<div class="rcta"><a class="view" href="'+h(href)+'">'+ctaTxt+' <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></div>'
      +   '<div class="rptbox" hidden></div>'
      + '</div>'
      + '<div class="rside">'
      +   '<button class="kebab" title="More" aria-label="More"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>'
      +   menuHtml(r,agg)
      + '</div>'
      + '</div>';
  }

  function menuHtml(r,agg){
    var fr=(agg&&agg.alerts_enabled===false)?'off':((agg&&agg.alert_frequency==='weekly')?'weekly':((agg&&agg.alert_frequency==='paused')?'off':'daily'));
    function fb(v,l){ return '<button data-freq="'+v+'"'+(fr===v?' class="on"':'')+'>'+l+'</button>'; }
    return '<div class="menu">'
      + '<button class="mi" data-act="edit">Edit</button>'
      + '<button class="mi" data-act="report">Run market report</button>'
      + '<div class="msep"></div>'
      + '<div class="mhd">Email alerts</div>'
      + '<div class="mrow">'+fb('daily','Daily')+fb('weekly','Weekly')+fb('off','Off')+'</div>'
      + '<div class="msep"></div>'
      + '<button class="mi del" data-act="delete">Delete</button>'
      + '</div>';
  }

  // Client-side re-sort of the grounded per-search aggregates. Three grounded keys only —
  // Most new (newCount) · Most urgent (closingWeek) · Biggest market (marketValue). NO "Highest
  // M-Win" (no grounded search-level aggregate) and NO "Recently viewed" (a deferred memory feature).
  function sorted(){
    var arr=SEARCHES.slice();
    arr.sort(function(a,b){
      var ba=BRIEF[a.id]||{}, bb=BRIEF[b.id]||{};
      if(SORT==='urgent')return (bb.closingWeek||0)-(ba.closingWeek||0);
      if(SORT==='value')return (bb.marketValue||0)-(ba.marketValue||0);
      return (bb.newCount||0)-(ba.newCount||0);   // 'new' (default)
    });
    return arr;
  }

  function renderKpis(totals){
    totals=totals||{newListings:0,marketValue:0,closingWeek:0};
    kpisEl.hidden=false;
    kpisEl.innerHTML=''
      + '<div class="kpi k-new"><div class="ic"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div><div><div class="n">'+(totals.newListings||0)+'</div><div class="l">New opportunities \\u00b7 what\\u2019s new</div></div></div>'
      + '<div class="kpi k-val"><div class="ic"><svg viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div><div><div class="n">'+fmtMoney(totals.marketValue||0)+'</div><div class="l">Current matched value \\u00b7 in matched opportunities</div></div></div>'
      + '<div class="kpi k-close"><div class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div><div><div class="n">'+(totals.closingWeek||0)+'</div><div class="l">Closing this week \\u00b7 urgency</div></div></div>';
  }

  // Actionable hero subline, built from REAL totals (grounded). When new opps exist, name the count
  // + how many markets moved (searches with newCount>0); when nothing is new, an HONEST all-clear.
  function renderSubline(totals){
    var sub=document.getElementById('subline'); if(!sub)return;
    var nl=(totals&&totals.newListings)||0;
    var sc=(totals&&totals.searchCount)||SEARCHES.length||0;
    if(nl>0){
      var moved=0; for(var i=0;i<SEARCHES.length;i++){ var a=BRIEF[SEARCHES[i].id]; if(a&&(a.newCount||0)>0)moved++; }
      if(!moved)moved=1;
      sub.textContent=nl+' new opportunit'+(nl===1?'y':'ies')+' across '+moved+' market'+(moved===1?'':'s')+'. Start where the biggest changes happened.';
    } else {
      sub.textContent='No new opportunities today \\u2014 your '+sc+' market'+(sc===1?'':'s')+' '+(sc===1?'is':'are')+' up to date.';
    }
  }

  function renderRows(){
    if(!SEARCHES.length){
      bodyEl.innerHTML='<div class="empty"><h3>No saved searches yet</h3><p>Save a search from the map to start tracking a market.</p><p style="margin-top:14px"><a href="/opportunity-map">Go to the map \\u2192</a></p></div>';
      return;
    }
    var rowsHtml=sorted().map(rowHtml).join('');
    bodyEl.innerHTML=''
      + '<div class="sechead">'
      +   '<div><h2>Your saved searches</h2><div class="ssub">Track the markets that matter to you.</div></div>'
      +   '<div class="sectools">'
      +     '<select class="sortsel" id="sortsel"><option value="new"'+(SORT==='new'?' selected':'')+'>Most new</option><option value="urgent"'+(SORT==='urgent'?' selected':'')+'>Most urgent</option><option value="value"'+(SORT==='value'?' selected':'')+'>Biggest market</option></select>'
      +     '<div class="vtoggle"><button data-view="list"'+(VIEW==='list'?' class="on"':'')+' title="List"><svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></button>'
      +       '<button data-view="grid"'+(VIEW==='grid'?' class="on"':'')+' title="Grid"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button></div>'
      +   '</div>'
      + '</div>'
      + '<div class="rows'+(VIEW==='grid'?' grid':'')+'" id="rows">'+rowsHtml+'</div>';
    wire();
  }

  function wire(){
    var ss=document.getElementById('sortsel');
    if(ss)ss.onchange=function(){ SORT=ss.value; renderRows(); };
    Array.prototype.forEach.call(document.querySelectorAll('.vtoggle button'),function(b){
      b.onclick=function(){ VIEW=b.getAttribute('data-view'); renderRows(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('#rows .row'),function(row){
      var id=row.getAttribute('data-id');
      var r=null; for(var i=0;i<SEARCHES.length;i++){ if(String(SEARCHES[i].id)===id){ r=SEARCHES[i]; break; } }
      var kebab=row.querySelector('.kebab'), menu=row.querySelector('.menu');
      if(kebab&&menu){
        kebab.onclick=function(e){ e.stopPropagation(); var wasOpen=menu.classList.contains('open'); closeMenus(); if(!wasOpen)menu.classList.add('open'); };
      }
      // Edit (rename) → PATCH /api/app/saved-searches { name }
      var edit=menu&&menu.querySelector('[data-act="edit"]');
      if(edit)edit.onclick=function(){ closeMenus();
        var cur=(r&&r.name)||'';
        var nn=prompt('Rename this saved search:',cur);
        if(nn==null)return; nn=String(nn).trim(); if(!nn||nn===cur)return;
        fetch('/api/app/saved-searches',{method:'PATCH',headers:hdrs(),body:JSON.stringify({email:em,id:id,name:nn})})
          .then(function(res){return res.json();}).then(function(d){ if(d&&d.success){ if(r)r.name=nn; renderRows(); } }).catch(function(){});
      };
      // Run market report → generate the whole-market report for THIS saved search, inline (the PEEK).
      var report=menu&&menu.querySelector('[data-act="report"]'), box=row.querySelector('.rptbox');
      if(report&&box)report.onclick=function(){ closeMenus(); runReport(r,box); };
      // Alert frequency (Daily/Weekly/Off) → PATCH alerts_enabled + alert_frequency
      Array.prototype.forEach.call(menu?menu.querySelectorAll('.mrow button'):[],function(b){
        b.onclick=function(){
          var v=b.getAttribute('data-freq');
          Array.prototype.forEach.call(menu.querySelectorAll('.mrow button'),function(x){ x.classList.toggle('on', x===b); });
          var body={email:em,id:id};
          if(v==='off'){ body.alerts_enabled=false; } else { body.alerts_enabled=true; body.alert_frequency=v; }
          // keep local state so the chip + menu stay consistent
          if(BRIEF[id]){ if(v==='off'){ BRIEF[id].alerts_enabled=false; } else { BRIEF[id].alerts_enabled=true; BRIEF[id].alert_frequency=v; } }
          fetch('/api/app/saved-searches',{method:'PATCH',headers:hdrs(),body:JSON.stringify(body)})
            .then(function(){ closeMenus(); renderRows(); }).catch(function(){});
        };
      });
      // Delete → DELETE /api/app/saved-searches
      var del=menu&&menu.querySelector('[data-act="delete"]');
      if(del)del.onclick=function(){ closeMenus();
        if(!confirm('Delete this saved search?'))return;
        fetch('/api/app/saved-searches?email='+encodeURIComponent(em)+'&id='+encodeURIComponent(id),{method:'DELETE',headers:hdrs()})
          .then(function(){ SEARCHES=SEARCHES.filter(function(x){return String(x.id)!==id;}); delete BRIEF[id]; renderRows(); }).catch(function(){});
      };
    });
  }
  function closeMenus(){ Array.prototype.forEach.call(document.querySelectorAll('.menu.open'),function(m){ m.classList.remove('open'); }); }
  document.addEventListener('click',function(e){ if(!e.target.closest || (!e.target.closest('.rside') && !e.target.closest('.rptbox')))closeMenus(); });

  // ── Run market report → inline PEEK (a compact confirmation + one big "Open full report"
  // link to the hosted /reports/<id> page, plus a copy-share-link — the growth flywheel).
  // NOT the full inline dashboard (Eric 2026-08-02: "it is inline so not useful to see the
  // whole report. We need a new workflow"). Pro-gated server-side (402 → inline upgrade).
  function rptEsc(x){ return h(x); }
  function runReport(r,box){
    r=r||{};
    var f=(r.filters&&typeof r.filters==='object')?r.filters:{};
    var name=(r.name||'').trim();
    var naicsRaw=((f.naics!=null?f.naics:'')+'').trim();
    var psc=((f.psc!=null?f.psc:'')+'').trim();
    var kw=((f.q!=null?f.q:'')+'').trim();
    var agency=((f.agency!=null?f.agency:'')+'').trim();
    var setAside=((f.setAside!=null?f.setAside:'')+'').trim();
    // The report runs on ALL the filters the user saved — a faithful readout, not one code
    // picked for them. Keep EVERY 6-digit NAICS (the union is one market); the name is a
    // LABEL, never a search term ("DOD IT Services" as text pulled all-defense aircraft).
    var naicsCodes=(naicsRaw?naicsRaw.split(','):[]).map(function(c){return c.trim();}).filter(function(c){return /^[0-9]{6}$/.test(c);});
    var naicsCsv=naicsCodes.join(',');
    var st=((f.state!=null?f.state:'')+'').trim().toUpperCase().slice(0,2);
    var subject = (naicsCodes.length===1?naicsCodes[0]:naicsCodes.length?(naicsCodes.length+' NAICS codes'):'')||(psc?('PSC '+psc):'')||kw||name||'market';
    box.hidden=false;
    box.innerHTML='<div class="top"></div><div class="in"><div class="rptrun"><div class="rptspin"></div><div>Building the '+rptEsc(subject)+' report\\u2026 <span style="color:var(--faint)">who\\u2019s buying \\u00b7 who holds it \\u00b7 recompetes \\u00b7 forecasts</span></div></div></div>';
    var payload={ email:em };
    // Market key: NAICS union → PSC (Cybersecurity) → keyword → name (last resort).
    if(naicsCsv){ payload.naics=naicsCsv; if(psc)payload.psc=psc; }
    else if(psc){ payload.psc=psc; }
    else if(kw){ payload.keyword=kw; }
    else if(name){ payload.keyword=name; }
    else {
      box.innerHTML='<div class="top"></div><div class="in"><div class="rpterr">This search has no NAICS, PSC or keyword to build a market from.</div></div>';
      return;
    }
    // Agency + set-aside are OPTIONAL scoping — never a reason to bail.
    if(agency)payload.agency=agency;
    if(setAside)payload.set_aside=setAside;
    if(st)payload.state=st;
    fetch('/api/app/market-report',{method:'POST',headers:hdrs(),body:JSON.stringify(payload)})
      .then(function(r2){ return r2.json().then(function(d){ return {status:r2.status,d:d}; }); })
      .then(function(res){
        if(res.status===402||(res.d&&res.d.teaser)){ rptUpsell(box,res.d&&res.d.upgrade_url); return; }
        if(res.status===422||(res.d&&res.d.grounded===false)){ rptErr(box,(res.d&&res.d.error)||'No federal market found for this search.'); return; }
        if(!res.d||!res.d.success||!res.d.url){ rptErr(box,(res.d&&res.d.error)||'Report generation failed. Try again shortly.'); return; }
        rptOk(box,res.d);
      })
      .catch(function(){ rptErr(box,'Request failed. Check your connection and try again.'); });
  }
  function closeBtn(box){ var x=box.querySelector('.x'); if(x)x.onclick=function(){ box.hidden=true; box.innerHTML=''; }; }
  function rptErr(box,msg){ box.innerHTML='<div class="top"></div><div class="in"><div class="rpthd">Market report<button class="x">\\u00d7</button></div><div class="rpterr">'+rptEsc(msg)+'</div></div>'; closeBtn(box); }
  function rptUpsell(box,url){ box.innerHTML='<div class="top" style="background:#7c5cff"></div><div class="in"><div class="rpthd">Market report<button class="x">\\u00d7</button></div><div class="rptups"><h4><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>Market reports are a Pro feature</h4><p>Turn this saved market into a shareable, client-ready report \\u2014 who\\u2019s buying, who holds it now, recompetes and forecasts, in one link.</p><a href="'+rptEsc(url||'/market-intelligence')+'">Upgrade to Pro</a></div></div>'; closeBtn(box); }
  function rptOk(box,d){
    // The PEEK, not the report: a compact confirmation of what was found + ONE big primary
    // "Open full report" that opens the hosted /reports/<id> page in a new tab, plus a quiet
    // copy-share-link (the flywheel). The card stops trying to BE the report.
    var s=d.summary||{};
    var ag=(s.buying_agencies)||0, rc=(s.recompetes)||0, fc=(s.forecasts)||0;
    var parts=[];
    parts.push(ag+' '+(ag===1?'agency':'agencies'));
    parts.push(rc+' '+(rc===1?'recompete':'recompetes'));
    parts.push(fc+' '+(fc===1?'forecast':'forecasts'));
    var deg = d.degraded ? '<div class="rptwarn">\\u26a0 One data axis came back thin for this search, so the report notes it rather than showing a fabricated number.</div>' : '';
    var hasUrl = !!d.url;
    box.innerHTML='<div class="top"></div><div class="in">'
      + '<div class="rpthd">Market report<button class="x">\\u00d7</button></div>'
      + '<div class="rptpeek">'
      +   '<div class="rk">\\u2713 Report ready \\u00b7 <b>'+rptEsc(d.subject||'this market')+'</b></div>'
      +   '<div class="rc">'+rptEsc(parts.join(' \\u00b7 '))+'</div>'
      +   (hasUrl
            ? '<a class="rgo" href="'+rptEsc(d.url)+'" target="_blank" rel="noopener">Open full report \\u2192</a>'
              + '<div class="rptshare"><input readonly value="'+rptEsc(d.url)+'"><button class="cp">Copy share link</button></div>'
            : '<div class="rptnote">The report generated, but the shareable link couldn\\u2019t be saved just now. Try running it again in a moment.</div>')
      + '</div>'
      + deg
      + '</div>';
    closeBtn(box);
    var cp=box.querySelector('.cp'), inp=box.querySelector('input');
    if(cp&&inp)cp.onclick=function(){ inp.select(); try{ (navigator.clipboard&&navigator.clipboard.writeText(inp.value))||document.execCommand('copy'); cp.textContent='Copied \\u2713'; setTimeout(function(){cp.textContent='Copy share link';},1600); }catch(e){} };
  }

  // Load: the brief (KPIs + per-search aggregates) + the saved searches (filters for the map URL +
  // rename). Then mark_seen so the rail badge clears — same contract the previous Watchlist used
  // (only AFTER the user has seen the counts).
  Promise.all([
    fetch('/api/app/watchlist-brief?email='+encodeURIComponent(em),{headers:hdrs()}).then(function(r){return r.json();}).catch(function(){return null;}),
    fetch('/api/app/saved-searches?email='+encodeURIComponent(em),{headers:hdrs()}).then(function(r){return r.json();}).catch(function(){return null;})
  ]).then(function(res){
    var brief=res[0], saved=res[1];
    if(brief&&brief.success&&Array.isArray(brief.searches)){ brief.searches.forEach(function(a){ if(a&&a.id)BRIEF[a.id]=a; }); }
    SEARCHES=((saved&&saved.searches)||[]).filter(function(s){ return s&&s.mode!=='recompete'; });
    renderKpis(brief&&brief.totals);
    renderSubline(brief&&brief.totals);
    renderRows();
    // Clear the rail badge now that counts have been seen (Zillow's Updates-reset contract).
    fetch('/api/app/saved-searches',{method:'POST',headers:hdrs(),body:JSON.stringify({email:em,action:'mark_seen'})}).catch(function(){});
  }).catch(function(){ kpisEl.hidden=true; bodyEl.innerHTML='<div class="errline"><h3>Couldn\\u2019t load your brief</h3><p>Please refresh the page.</p></div>'; });
})();
</script>
${ACCOUNT_MENU_JS}
${LOGIN_MODAL_HTML}${LOGIN_MODAL_JS}${'<script>'}window.__mapsSignIn=function(){var stale=false;try{stale=!!localStorage.getItem('mi_beta_email')&&!localStorage.getItem('mi_beta_auth_token');}catch(e){}var phrase=stale?'continue where you left off':'see your Morning Brief';if(typeof window.openSignInModal==='function'){window.openSignInModal(phrase,function(){location.reload();});}else{location.href='/app?next='+encodeURIComponent('/opportunity-map/saved');}return false;};${'</script>'}</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
