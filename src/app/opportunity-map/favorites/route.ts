/**
 * GET /opportunity-map/favorites — the SAVED page, redesigned as a Decision-Card INBOX.
 *
 * Saved is not a bookmark grid — it's an INBOX of "opportunities I'm still watching" (Eric's
 * 4-state system: Watchlist=Markets · Map=Discovery · Saved=Watching · Pursuits=Working). Each
 * saved opportunity renders as the product's Decision Card (the SAME card language as the map —
 * lcHeader / dnaRow / cardHero / cleanTitle / shortAgency, reused here so the pin, the popup and
 * the Saved card can never disagree), grouped into workflow sections (Needs Attention · Closing
 * Soon · Watching · Closed). The primary action is "Start Pursuit", which MOVES the card to
 * Pursuits (create-then-remove, gated on POST success) — inbox processing, not a bookmark.
 *
 * CARD-REUSE APPROACH = COPY (not extract). The map's cardHTML family is woven into template.html's
 * scope (the AGENCY map, #dna-* SVG symbol defs, ~120 lines of card CSS keyed on --disp/--sans/--grnd
 * tokens, the TODAY global, earlySignalChip/draftURL) AND builds a DIFFERENT footer (SAM.gov / Start
 * drafting) than this inbox needs. Extracting it cleanly would drag the whole card visual system +
 * CSS + SVG into a shared module and re-thread template.html's generator — a large, risky change to
 * the LIVE map. So the decision-card HELPERS (lcHeader / dnaRow / cardHero / cleanTitle / shortAgency
 * / dnaTop / dnaOrder / estMoneyExact / confSub / srcColor / daysOut / fmtDays / dueChip) are COPIED
 * verbatim-in-behavior into this IIFE, with a self-contained card CSS block + the two SVG symbols, and
 * each saved row is mapped to the pin-shaped `o` the helpers expect. (Spec sanctions the copy fallback.)
 *
 * Data via GET /api/opportunities/save?email= (MI-token authed, read client-side from localStorage —
 * same auth pattern as the map). It hydrates each saved row from sam_opportunities and returns
 * opportunity_dna (the genome), sub_tier, intel_value_range, the LIVE + SNAPSHOT response_deadline.
 *
 * Chrome: this page lives inside the SAME app shell as /opportunity-map — the top nav AND the left
 * rail (with Saved active + account menu). The nav header + rail markup/CSS MIRROR opportunity-map/
 * route.ts (ZHEAD_HTML / ZRAIL_HTML) — keep them in sync.
 *
 * NO EMOJI anywhere — every icon is an inline sized SVG (the old fire-char urgency glyph is gone; the
 * lifecycle header carries urgency in words, "N DAYS LEFT", exactly like the map card).
 */
import { NextResponse } from 'next/server';
import { LOGIN_MODAL_CSS, LOGIN_MODAL_HTML, LOGIN_MODAL_JS } from '../login-modal';
import { MAPS_HOME_PATH } from '@/lib/mindy/maps-home';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../account-menu';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Saved — Mindy</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#006aff;--jan:#006aff;
    --grnd:#0f9d58;--grnd-line:#cfe9d9;--recomp:#b26a00;--forecast:#7c5cff;--warm:#b54708;--con:#d92d20;--red:#e5484d;
    --disp:'Inter',system-ui,sans-serif;--sans:'Inter',system-ui,sans-serif}
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
  .zh-acct{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:1px solid var(--line);color:var(--sub)}
  .zh-logo{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;text-decoration:none}
  .zh-logo img{height:25px;width:auto;display:block}
  .zh-logo span{font:700 19px "Inter",system-ui,sans-serif;color:var(--ink);letter-spacing:-.02em}
  @media(max-width:1000px){.zh-left,.zh-right{gap:14px}.zh-left a:nth-child(n+3),.zh-right a:first-child{display:none}}
  .zrail{position:fixed;left:0;top:52px;width:64px;height:calc(100vh - 52px);height:calc(100dvh - 52px);
    background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:2px;padding:14px 0;z-index:30;overflow:hidden}
  .zrail a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--sub);text-decoration:none;padding:8px 2px;border-radius:11px;width:56px;min-height:48px}
  .zrail a:hover{background:var(--wash);color:var(--ink)}.zrail a.on{color:var(--jan);background:#eff5ff}
  .zrail svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .zrail a span{font:600 10px Inter,system-ui,sans-serif;letter-spacing:.01em;line-height:1}
  .zrail-sep{width:28px;height:1px;background:var(--line);margin:6px auto}
  .railbadge{position:absolute;top:3px;right:9px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;
    background:#d92d20;color:#fff;font:700 10px Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
    box-shadow:0 0 0 2px #fff;line-height:1}
  /* content area sits right of the 64px rail */
  .main{margin-left:64px}
  .wrap{max-width:980px;margin:0 auto;padding:30px 24px 64px}
  h1{font-size:32px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px}
  /* ── Grounded inbox header: "N need your attention today" + count sub-line ── */
  .lede{font-size:19px;font-weight:700;letter-spacing:-.01em;color:var(--ink);margin-bottom:5px;line-height:1.3}
  .lede.calm{color:var(--sub);font-weight:600}
  .subline{color:var(--sub);font-size:14px;margin-bottom:20px}
  /* ── Workflow filter chips (replace the old Date-added / Showing dropdowns) ── */
  .filbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:24px}
  .fchip{display:inline-flex;align-items:center;gap:7px;font:700 13.5px Inter,sans-serif;color:var(--sub);
    background:#fff;border:1px solid var(--line);border-radius:999px;padding:8px 14px;cursor:pointer;white-space:nowrap;transition:.14s}
  .fchip:hover{border-color:#c7d2e0;color:var(--ink)}
  .fchip.on{color:#fff;background:var(--ink);border-color:var(--ink)}
  .fchip .fct{font-weight:600;font-size:12px;opacity:.75}
  .fchip.on .fct{opacity:.85}
  /* ── Group section ── */
  .grp{margin-bottom:30px}
  .grphdr{display:flex;align-items:center;gap:9px;margin-bottom:13px}
  .grphdr .gdot{width:8px;height:8px;border-radius:50%;flex:none}
  .grphdr .gtitle{font:800 14px Inter,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:var(--ink)}
  .grphdr .gcount{font:600 13px Inter,sans-serif;color:var(--faint)}
  .grp.attn .gdot{background:var(--con)}
  .grp.soon .gdot{background:var(--warm)}
  .grp.watch .gdot{background:var(--blue)}
  .grp.closed .gdot{background:var(--faint)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px}
  /* ── The DECISION CARD (copied behavior from the map's cardHTML family) ── */
  .dcard{position:relative;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff;transition:box-shadow .16s,border-color .16s,transform .16s}
  .dcard:hover{box-shadow:0 10px 26px -12px rgba(16,24,40,.22);border-color:#c7d2e0;transform:translateY(-2px)}
  .dcard.closedcard{opacity:.7}
  .cstrip{height:3px;width:100%}
  /* lifecycle header */
  .lchdr{display:flex;align-items:center;gap:8px;padding:9px 15px;border-bottom:1px solid var(--hair);
    font:700 11px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase}
  .lchdr .lcdot{width:6px;height:6px;border-radius:50%;flex:none}
  .lchdr.open{color:var(--grnd)} .lchdr.open .lcdot{background:var(--grnd)}
  .lchdr.recomp{color:var(--recomp)} .lchdr.recomp .lcdot{background:var(--recomp)}
  .lchdr.fore{color:var(--forecast)} .lchdr.fore .lcdot{background:var(--forecast)}
  .lchdr.closed{color:var(--faint)} .lchdr.closed .lcdot{background:var(--faint)}
  .lchdr .lcwhen{margin-left:auto;font-weight:600;font-size:10.5px;letter-spacing:.01em;text-transform:none;color:var(--faint)}
  .lchdr .lcwhen.soon{color:var(--warm);font-weight:700;letter-spacing:.05em;display:inline-flex;align-items:center;gap:5px}
  .lchdr .lcwhen.urg{color:var(--con);font-weight:700;letter-spacing:.05em;display:inline-flex;align-items:center;gap:5px}
  .lchdr .lcwhen.soon::before,.lchdr .lcwhen.urg::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
  .cbody{padding:13px 15px 14px;display:flex;flex-direction:column;flex:1}
  /* identity + story line */
  .idrow{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:10px}
  .agid{display:inline-flex;align-items:center;gap:6px;font-family:var(--sans);font-weight:800;font-size:13px;letter-spacing:.01em;color:var(--ink);text-transform:uppercase}
  .agid .dnaic{width:13px;height:13px;color:var(--faint);flex:none}
  .story{display:inline-flex;align-items:center;gap:6px;font-family:var(--sans);font-weight:700;font-size:12.5px;color:var(--sub)}
  .story .middot{color:var(--faint);font-weight:600}
  svg.dnaic{stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;fill:none}
  /* estimate hero */
  .chero{border:1px solid var(--grnd-line);border-radius:11px;padding:6.5px 13px;margin-bottom:11px;background:linear-gradient(150deg,#f4fbf7,#f9fdfb)}
  .chero.recomp{border-color:#f0d9b5;background:linear-gradient(150deg,#fffaf2,#fff7ee)}
  .chero.recomp .cval{color:var(--recomp)}
  .chero.fore{border-color:#e4dcff;background:linear-gradient(150deg,#f6f2ff,#faf8ff)}
  .chero.fore .cval{color:var(--forecast)}
  .chero.pending{border-color:var(--hair);background:linear-gradient(150deg,#f5f7fa,#fafbfc)}
  .chero .cval{font-family:var(--disp);font-weight:800;font-size:25px;letter-spacing:-.7px;color:var(--ink);line-height:1.15}
  .chero .cval .apx{font-size:12px;color:var(--faint);opacity:.55;font-weight:600;vertical-align:2px;margin-right:1px}
  .chero .cval.pend{font-size:17px;font-weight:700;color:var(--faint);letter-spacing:-.2px}
  .chero .cconf{font-family:var(--sans);font-size:10.5px;font-weight:500;color:var(--faint);margin-top:1px}
  /* reason chips (Needs-Attention "why") */
  .rchips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .rchip{display:inline-flex;align-items:center;gap:5px;font:700 11px Inter,sans-serif;letter-spacing:.01em;
    color:var(--con);background:#fdecec;border:1px solid #f7cccc;border-radius:999px;padding:3px 9px}
  .rchip svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  /* title / meta / facts */
  .ctitle{font-family:var(--disp);font-weight:700;font-size:15.5px;line-height:1.32;color:var(--ink);margin-bottom:6px;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .ctitle.cmono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px}
  .cmeta{font-size:12.5px;color:var(--sub);line-height:1.4;margin-bottom:8px}
  .cfacts{font-size:12px;color:var(--faint);line-height:1.4;margin-bottom:8px}
  .cnote{font-size:12px;color:var(--faint);line-height:1.4;margin-bottom:8px;font-style:italic}
  /* "Saved because" tiny line */
  .savedbc{display:inline-flex;align-items:center;gap:6px;font:600 11.5px Inter,sans-serif;color:var(--faint);margin-bottom:12px;letter-spacing:.01em}
  .savedbc svg{width:12px;height:12px;fill:none;stroke:var(--red);stroke-width:2;flex:none}
  .savedbc b{color:var(--sub);font-weight:700}
  /* footer / CTA */
  .cfoot{margin-top:auto;display:flex;align-items:center;gap:10px;padding-top:4px}
  .startp{display:inline-flex;align-items:center;justify-content:center;gap:7px;flex:1;font:700 14px Inter,sans-serif;
    color:#fff;background:var(--blue);border:1px solid var(--blue);border-radius:10px;padding:10px 14px;cursor:pointer;text-decoration:none;transition:.14s}
  .startp:hover{background:#0057d6;border-color:#0057d6}
  .startp:disabled{opacity:.6;cursor:default}
  .startp svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .cerr{font:600 11.5px Inter,sans-serif;color:var(--con);margin-top:8px;display:none}
  .cerr.show{display:block}
  .heart{width:38px;height:38px;flex:none;border-radius:10px;border:1px solid var(--line);background:#fff;cursor:pointer;display:grid;place-items:center;transition:background .15s,border-color .15s}
  .heart svg{width:17px;height:17px;fill:var(--red);stroke:var(--red);stroke-width:2}
  .heart:hover{background:#fff5f5;border-color:#f5c2c2}
  .viewlink{display:block;padding:0;text-decoration:none;color:inherit}
  .dcard.rmv{opacity:0;transform:translateY(-8px) scale(.98);transition:opacity .28s,transform .28s}
  .empty{text-align:center;padding:60px 20px;color:var(--sub)}
  .empty h3{font-size:20px;color:var(--ink);margin-bottom:8px}
  .empty a{color:var(--blue);font-weight:600;text-decoration:none}
  .empty svg{width:44px;height:44px;stroke:var(--faint);fill:none;stroke-width:1.6;margin-bottom:14px}
  .signin{padding:40px 20px;text-align:center;color:var(--sub)}
  .signin a{color:var(--blue);font-weight:600;text-decoration:none}
  ${ACCOUNT_MENU_CSS}
</style><style>${LOGIN_MODAL_CSS}</style></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <g id="dna-landmark"><path d="M4 8 12 4l8 4"/><line x1="4" y1="8" x2="20" y2="8"/><line x1="6" y1="11" x2="6" y2="17"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><line x1="18" y1="11" x2="18" y2="17"/><line x1="4" y1="20" x2="20" y2="20"/></g>
  <g id="dna-check"><path d="M20 6 9 17l-5-5"/></g>
</defs></svg>
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
  <a href="/opportunity-map/saved" title="Watchlist — saved searches &amp; new matches"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Watchlist</span><b class="railbadge" id="savedBadge" hidden></b></a>
  <a class="on" href="/opportunity-map/favorites" title="Saved — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Saved</span></a>
  <a href="/opportunity-map/pursuits" title="Pursuits — opportunities you are actively working"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Pursuits</span></a>
</nav>
<div class="main">
<div class="wrap">
  <h1>Saved</h1>
  <div class="lede" id="lede"></div>
  <div class="subline" id="subline"></div>
  <div class="filbar" id="filbar" hidden></div>
  <div id="list"><div class="signin">Loading&hellip;</div></div>
</div>
</div>
<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  var t=tok(), em=email(), list=document.getElementById('list');
  function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  if(!t||!em){ document.getElementById('lede').style.display='none';
    list.innerHTML='<div class="signin">Please <a href="#" onclick="return window.__mapsSignIn()">sign in</a> to see your saved opportunities.</div>'; return; }
  function hdrs(){ return {'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em}; }

  // ── Behavioral analytics (mirrors opportunity-map/route.ts _track). Fire-and-forget: signed-out
  //    emits NOTHING, every failure swallowed, never blocks the DELETE/POST. Reuses the EXISTING
  //    /api/app/engagement POST — eventType is ALLOWLISTED, so the specific action rides in
  //    metadata.action (eventType stays 'tool_use'). A saved row always has a notice_id (the nid),
  //    so journey_id is deterministic ('journey:'+nid) and joins the map funnel. The SAVE action
  //    itself happens on the MAP (this page LISTS saved), so we only emit the Saved-page actions.
  //    DEFERRED (next layer, not built here): finer Map events (hover-sample / cluster-expand /
  //    zoom) + Vault field-level events. ──
  function journeyId(nid){
    if(nid) return 'journey:'+nid;
    try{ var key='mindy_journey_'+String(nid||''); var ex=localStorage.getItem(key); if(ex) return ex;
      var j='j_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10); localStorage.setItem(key,j); return j;
    }catch(e){ return 'j_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10); }
  }
  function track(action, extras){
    try{
      if(!t||!em) return;                                  // signed-out: nothing to attribute
      var m=extras||{}; m.action=action; m.surface='saved';
      fetch('/api/app/engagement',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t},
        body:JSON.stringify({email:em,eventType:'tool_use',eventSource:'saved',metadata:m}),keepalive:true}).catch(function(){});
    }catch(e){}
  }

  // ── TODAY, anchored to LOCAL NOON so day-diff math is a clean integer (mirrors template.html). ──
  var TODAY=(function(){var d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate(),12,0,0,0);})();

  // ── COPIED decision-card HELPERS (behavior verbatim from opportunity-map/template.html) ──
  function esc(s){return h(s);}
  function estMoney(n){n=Number(n);if(!isFinite(n)||n<=0)return '';
    if(n>=1e9)return '$'+(n/1e9).toFixed(n%1e9?1:0).replace(/\\.0$/,'')+'B';
    if(n>=1e6)return '$'+(n/1e6).toFixed(n%1e6?1:0).replace(/\\.0$/,'')+'M';
    if(n>=1e3)return '$'+Math.round(n/1e3)+'K';
    return '$'+Math.round(n);}
  function estMoneyExact(n){n=Number(n);if(!isFinite(n)||n<=0)return '';
    if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B';
    if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M';
    return '$'+Math.round(n).toLocaleString();}
  // confidence sub-line under the estimate — OPEN only, grounded (comparable count). No fabrication.
  function confSub(o){
    if(o.src==='RECOMPETE'||o.src==='FORECAST') return '';
    if(!(Number(o.est||0)>0)) return '';
    var n=Number(o.estN||0);
    if(n>0) return '<div class="cconf">Estimated from '+n.toLocaleString('en-US')+' similar awards</div>';
    return '';
  }
  function cardHero(o){
    if(o.src==='FORECAST'){
      var er=(o.estRange&&String(o.estRange).trim())?String(o.estRange):'';
      return er ? '<div class="chero fore"><div class="cval">'+esc(er)+'</div></div>'
        : '<div class="chero pending"><div class="cval pend">Estimate pending</div></div>';
    }
    var m=estMoneyExact(o.est), conf=confSub(o);
    return m ? '<div class="chero"><div class="cval"><span class="apx">\\u2248 </span>'+m+'</div>'+conf+'</div>'
      : '<div class="chero pending"><div class="cval pend">Estimate Pending</div></div>';
  }
  function dueDate(o){return o.close;}
  function daysOut(o){var d=String(dueDate(o)||'').slice(0,10); if(!d)return NaN; return Math.round((new Date(d+'T12:00:00')-TODAY)/864e5);}
  function fmtDays(d){
    if(!isFinite(d))return null;
    if(d<0)return{t:'Closed',c:'dead'};
    if(d===0)return{t:'Due today',c:'hot'};
    if(d===1)return{t:'1 day left',c:'hot'};
    if(d<=3)return{t:d+' days left',c:'hot'};
    if(d<=7)return{t:d+' days left',c:'warm'};
    return{t:d+' days left',c:'cool'};
  }
  function longDate(d){var s=String(d||'').slice(0,10); if(!s)return ''; try{ return new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }catch(e){return '';} }
  function shortDate(d){var s=String(d||'').slice(0,10); if(!s)return ''; var dt=new Date(s+'T12:00:00'); if(isNaN(dt))return '';
    var y=dt.getFullYear(), compact=(y===TODAY.getFullYear())&&(dt>=TODAY);
    return dt.toLocaleDateString('en-US', compact?{month:'short',day:'numeric'}:{month:'short',day:'numeric',year:'numeric'});}
  // DNA strand read order (mirrors dnaOrder/dnaTop in template.html).
  function dnaOrder(dna){
    var RANK={repeat_buyer:0,sb_friendly:1,posts_early:2,sources_sought:3,early_cycle:4,recompete:5,forecast:6,set_aside:7,full_open:8,closes_soon:9,last_chance:10};
    var tone={good:0,watch:1,neutral:2};
    return dna.slice().sort(function(a,b){
      var ra=(a.key in RANK)?RANK[a.key]:50, rb=(b.key in RANK)?RANK[b.key]:50;
      return (a.tier-b.tier)||(ra-rb)||((tone[a.tone]||0)-(tone[b.tone]||0));
    });
  }
  function dnaTop(dna,n){ if(!dna||!dna.length)return []; return dnaOrder(dna).slice(0,n).map(function(s){return s.label;}); }
  var TITLE_ABBR={JOC:'Job Order Contract',MATOC:'Multiple Award Task Order Contract',SATOC:'Single Award Task Order Contract',
    IDIQ:'IDIQ',IDV:'IDV',BPA:'Blanket Purchase Agreement',BOA:'Basic Ordering Agreement',
    PWS:'Performance Work Statement',SOW:'Statement of Work',SOO:'Statement of Objectives',
    RFP:'RFP',RFI:'RFI',RFQ:'RFQ',IFB:'IFB','O&M':'Operations & Maintenance','R&M':'Repair & Maintenance',
    POP:'Period of Performance',ANG:'Air National Guard',USACE:'Army Corps of Engineers',
    HVAC:'HVAC',IT:'IT',NAICS:'NAICS',PSC:'PSC'};
  var TITLE_STOP={FOR:1,AND:1,OR:1,THE:1,OF:1,TO:1,A:1,AN:1,IN:1,ON:1,AT:1,BY:1,WITH:1};
  function titleCaseWord(str){ return String(str||'').toLowerCase().replace(/\\b([a-z])/g,function(m,c){return c.toUpperCase();}); }
  function cleanTitle(t){
    var s=String(t==null?'':t).trim(); if(!s)return '';
    s=s.replace(/^([A-Z0-9][A-Z0-9-]{6,}[0-9][A-Z0-9-]*)\\s+(?=\\S)/,'');
    var shout=s===s.toUpperCase(); if(shout)s=titleCaseWord(s);
    s=s.replace(/\\b(\\d{1,2})[\\s-]*(?:year|yr)s?\\b/ig,'($1-Year)');
    s=s.replace(/[A-Za-z][A-Za-z&/]*[A-Za-z]|[A-Za-z]/g,function(w){
      var hit=TITLE_ABBR[w.toUpperCase()]; if(hit!=null)return hit;
      if(shout&&TITLE_STOP[w.toUpperCase()])return w.toLowerCase();
      return w; });
    return s.replace(/\\s+/g,' ').replace(/\\(\\s+/g,'(').replace(/\\s+\\)/g,')').trim();
  }
  function shortAgency(name){
    var s=String(name==null?'':name).trim(); if(!s)return '';
    s=s.replace(/,\\s*department\\s+of(\\s+the)?\\s*$/i,'');
    s=s.replace(/^(the\\s+)?(u\\.?s\\.?|united\\s+states)\\s+/i,'');
    s=s.replace(/^dep(artmen)?t\\.?\\s+of\\s+(the\\s+)?/i,'');
    s=s.replace(/\\s+/g,' ').trim();
    if(s===s.toUpperCase())s=s.toLowerCase().replace(/\\b([a-z])/g,function(m,c){return c.toUpperCase();});
    return s;
  }
  // lifecycle header — OPEN NOW / Recompete / Forecast / Closed + urgency ("N DAYS LEFT", words, no emoji).
  function lcHeader(o){
    var _dOpen=daysOut(o), _urgent='';
    if(o.src!=='RECOMPETE'&&o.src!=='FORECAST'&&isFinite(_dOpen)&&_dOpen>=0&&_dOpen<=14){
      _urgent=_dOpen===0?'DUE TODAY':_dOpen===1?'1 DAY LEFT':_dOpen+' DAYS LEFT';
    }
    var closedOpen=(o.src!=='RECOMPETE'&&o.src!=='FORECAST'&&isFinite(_dOpen)&&_dOpen<0);
    var kind = o.src==='FORECAST' ? {c:'fore',t:'Forecast',when:(o.estRange?'':'')}
      : (closedOpen ? {c:'closed',t:'Closed',when:o.close?('Closed '+shortDate(o.close)):''}
        : {c:'open',t:'Open now',when:_urgent});
    var whenCls=(kind.c==='open'&&_urgent)?(_dOpen<=3?'lcwhen urg':'lcwhen soon'):'lcwhen';
    return '<div class="lchdr '+kind.c+'"><span class="lcdot"></span>'+kind.t
      + (kind.when?'<span class="'+whenCls+'">'+esc(kind.when)+'</span>':'')+'</div>';
  }
  function dnaRow(o){
    var ag=(o.subAgency&&String(o.subAgency).trim())?String(o.subAgency):(o.agency?String(o.agency):'');
    ag=shortAgency(ag); if(!ag)return '';
    var top=dnaTop(o.dna,1), story=top.length?top[0]:'';
    var storyHTML=story?'<span class="story"><span class="middot">\\u00b7</span>'+esc(story)+'</span>':'';
    return '<div class="idrow"><span class="agid"><svg class="dnaic" viewBox="0 0 24 24"><use href="#dna-landmark"/></svg>'+esc(ag)+'</span>'+storyHTML+'</div>';
  }
  function srcColor(o){ return o.src==='RECOMPETE'?'#b26a00':(o.src==='FORECAST'?'#7c5cff':'#0f9d58'); }

  // ── Value/set/src derivation from a saved row (mirrors the map API decorate step) ──
  function estComparableCount(vr){
    var label=(vr&&typeof vr==='object'&&typeof vr.label==='string')?vr.label:'';
    var m=/^\\s*(\\d{1,6})\\s+comparable\\b/i.exec(label); return m?parseInt(m[1],10):0;
  }
  // Detect FORECAST from the persisted DNA keys (the genome carries a 'forecast' strand) or notice_type.
  function isForecast(r){
    var keys=Array.isArray(r.opportunity_dna_keys)?r.opportunity_dna_keys:[];
    if(keys.indexOf('forecast')>=0)return true;
    var nt=String(r.notice_type||'').toLowerCase();
    return /forecast|presolicitation.*forecast/.test(nt);
  }
  // Coerce a saved row's NAICS (string | ["337121"] | {code:..} | null) to a clean single code STRING.
  function naicsCode(v){
    if(v==null)return '';
    if(Array.isArray(v))return naicsCode(v[0]);
    if(typeof v==='object')return naicsCode(v.code!=null?v.code:v.value);
    var s=String(v).trim(); return s==='[object Object]'?'':s;
  }
  function setAsideLabel(r){
    var s=r.set_aside_description||r.set_aside_code||r.set_aside||r.setAside||''; s=String(s||'').trim();
    s=s.replace(/\\s*\\(FAR[^)]*\\)\\s*$/i,'').trim();
    return s;
  }
  // A saved row can fail to hydrate; the snapshot title can literally be 'Unknown Opportunity'.
  function realTitle(r){ var s=String(r.title||'').trim(); if(!s)return ''; if(/^unknown opportunity$/i.test(s))return ''; return s; }

  // Map a saved row to the pin-shaped o object the copied card helpers expect.
  function toO(r){
    var vr=(r.intel_value_range&&typeof r.intel_value_range==='object')?r.intel_value_range:null;
    var fore=isForecast(r);
    var o={
      nid: String(r.notice_id||r.id||''),
      src: fore?'FORECAST':'SAM',
      title: r.title||'',
      agency: r.agency||'',
      subAgency: r.sub_tier||'',
      naics: naicsCode(r.naics_code!=null?r.naics_code:r.naics),
      set: setAsideLabel(r),
      close: String(r.response_deadline||'').slice(0,10),
      notice_type: r.notice_type||'',
      sol: r.solicitation_number||r.notice_id||'',
      loc: r.pop_state||'',
      dna: Array.isArray(r.opportunity_dna)?r.opportunity_dna:[],
      est: (vr&&typeof vr.median==='number')?vr.median:0,
      estLow: (vr&&typeof vr.low==='number')?vr.low:0,
      estHigh: (vr&&typeof vr.high==='number')?vr.high:0,
      estN: estComparableCount(vr),
      estRange: ''
    };
    return o;
  }

  // ── GROUPING (the inbox core). Each row lands in EXACTLY ONE group by priority:
  //    Needs Attention > Closing Soon > Watching. Closed/expired -> a Closed group. ──
  // deltas: deadline-MOVED (live vs snapshot). closing<=3d -> Needs Attention.
  function daysLeftOf(r){ var d=String(r.response_deadline||'').slice(0,10); if(!d)return null;
    return Math.round((new Date(d+'T12:00:00')-TODAY)/864e5); }
  // Snapshot vs live deadline: a MOVE is a read-time delta (only when both present + differ by >0 days).
  function deadlineMoved(r){
    var live=String(r.response_deadline||'').slice(0,10);
    var snap=String(r.saved_response_deadline||'').slice(0,10);
    if(!live||!snap||live===snap)return false;
    return true; // both present, differ -> the deadline moved since save
  }
  // A row's group key. FORECAST is NEVER "closed" (no response deadline semantics) — it's Watching.
  function groupOf(r){
    var o=toO(r), fore=(o.src==='FORECAST');
    var d=fore?null:daysLeftOf(r);
    var moved=!fore&&deadlineMoved(r);
    // Needs Attention: closing <=3d (and >=0), OR the deadline moved since it was saved.
    if((d!=null&&d>=0&&d<=3)||moved) return 'attn';
    // Closed/expired: a real OPEN row whose deadline already passed.
    if(d!=null&&d<0) return 'closed';
    // Closing Soon: 4-7 days out.
    if(d!=null&&d>=4&&d<=7) return 'soon';
    // Everything else active (incl. forecasts, undated, far-out) — Watching.
    return 'watch';
  }
  function reasonsFor(r){
    // GROUNDED "why it needs attention" chips — NO fabricated dots. Only closing-soon (<=3d) +
    // deadline-moved (both real). notice_type->cancelled/awarded is DEFERRED (no snapshot column).
    var out=[], d=daysLeftOf(r);
    if(d!=null&&d>=0&&d<=3) out.push(d===0?'Closes today':(d===1?'Closes in 1 day':'Closes in '+d+' days'));
    if(deadlineMoved(r)) out.push('Deadline moved');
    return out;
  }
  var ALERTSVG='<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';

  var GROUP_META={
    attn:{cls:'attn',title:'Needs Attention'},
    soon:{cls:'soon',title:'Closing Soon'},
    watch:{cls:'watch',title:'Watching'},
    closed:{cls:'closed',title:'Closed'}
  };
  var GROUP_ORDER=['attn','soon','watch','closed'];

  // Raw saved rows + the current workflow filter drive the rendered inbox.
  var ALL=[], FILTER='all';

  function counts(){
    var c={attn:0,soon:0,watch:0,closed:0,forecast:0};
    ALL.forEach(function(r){ c[groupOf(r)]++; if(toO(r).src==='FORECAST')c.forecast++; });
    return c;
  }
  function inFilter(r){
    if(FILTER==='all')return true;
    if(FILTER==='forecast')return toO(r).src==='FORECAST';
    return groupOf(r)===FILTER;
  }

  function header(){
    var c=counts(), lede=document.getElementById('lede'), sub=document.getElementById('subline');
    if(!ALL.length){ lede.textContent=''; sub.textContent=''; return; }
    var watchingTotal=c.watch+c.soon; // "watching" in the honest all-caught-up sense = not-urgent actives
    if(c.attn>0){
      lede.className='lede';
      lede.textContent=c.attn+' saved opportunit'+(c.attn===1?'y needs':'ies need')+' your attention today.';
    } else {
      lede.className='lede calm';
      var n=ALL.length-c.closed;
      lede.textContent="You're all caught up \\u2014 "+n+' opportunit'+(n===1?'y':'ies')+" you're watching.";
    }
    // count sub-line — only nonzero segments, grounded.
    var parts=[];
    if(c.attn)parts.push(c.attn+' need attention');
    if(watchingTotal)parts.push(watchingTotal+' watching');
    var closingSoon=c.attn+c.soon; // opportunities closing this week
    if(closingSoon)parts.push(closingSoon+' closing soon');
    sub.textContent=parts.join(' \\u00b7 ');
  }

  function filters(){
    var bar=document.getElementById('filbar'); if(!bar)return;
    if(!ALL.length){ bar.hidden=true; return; } bar.hidden=false;
    var c=counts();
    // Workflow filters (replace Date added). Only offer buckets that have rows; All is always present.
    var opts=[['all','All',ALL.length]];
    if(c.attn)opts.push(['attn','Needs Attention',c.attn]);
    if(c.soon)opts.push(['soon','Closing Soon',c.soon]);
    if(c.watch)opts.push(['watch','Watching',c.watch]);
    if(c.forecast)opts.push(['forecast','Forecasts',c.forecast]);
    bar.innerHTML=opts.map(function(o){
      return '<button class="fchip'+(o[0]===FILTER?' on':'')+'" data-f="'+o[0]+'">'+h(o[1])+' <span class="fct">'+o[2]+'</span></button>';
    }).join('');
    bar.querySelectorAll('.fchip').forEach(function(b){ b.onclick=function(){ FILTER=b.getAttribute('data-f'); filters(); render(); }; });
  }

  function cardHTML(r){
    var o=toO(r), col=srcColor(o), grp=groupOf(r);
    var reasons = grp==='attn' ? reasonsFor(r) : [];
    var rchips = reasons.length ? ('<div class="rchips">'+reasons.map(function(x){return '<span class="rchip">'+ALERTSVG+esc(x)+'</span>';}).join('')+'</div>') : '';
    var title=realTitle(r), solRef=String(o.sol||'').trim();
    var vrLo=Number(o.estLow||0), vrHi=Number(o.estHigh||0), hasVal=Number(o.est||0)>0||o.src==='FORECAST';
    var unavailable=!title && !hasVal && !(o.dna&&o.dna.length);
    var hero=cardHero(o);
    var titleLine=title
      ? ('<div class="ctitle">'+esc(cleanTitle(o.title))+'</div>')
      : (solRef?('<div class="ctitle cmono">'+esc(solRef)+'</div>'):'');
    // "Saved because <top strand>" — grounded from the genome, OMITTED when no strands.
    var top=dnaTop(o.dna,1);
    var savedbc = top.length
      ? ('<div class="savedbc"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg>Saved because <b>'+esc(top[0])+'</b></div>')
      : '';
    // facts (NAICS · set-aside · notice type) + meta (agency+due).
    var facts=[]; if(o.naics)facts.push('NAICS '+h(o.naics)); if(o.set)facts.push(h(o.set)); if(o.notice_type&&o.src!=='FORECAST')facts.push(h(o.notice_type));
    var factsLine=facts.length?('<div class="cfacts">'+facts.join(' \\u00b7 ')+'</div>'):'';
    var meta=[]; var ag=shortAgency(o.subAgency||o.agency); if(ag)meta.push(h(ag)); if(o.loc)meta.push(h(o.loc));
    if(o.close&&o.src!=='FORECAST')meta.push('Due '+h(longDate(o.close)));
    var metaLine=meta.length?('<div class="cmeta">'+meta.join(' \\u00b7 ')+'</div>'):'';
    var noteLine=unavailable?('<div class="cnote">Details unavailable \\u2014 this notice may have been archived or removed.</div>'):'';
    var closedCls=(grp==='closed')?' closedcard':'';
    return '<div class="dcard'+closedCls+'" data-nid="'+h(o.nid)+'">'
      + '<a class="viewlink" href="/opportunity-map?opp='+encodeURIComponent(o.nid)+'">'
      +   lcHeader(o)
      +   '<div class="cstrip" style="background:'+col+'"></div>'
      +   '<div class="cbody">'
      +     dnaRow(o)
      +     hero
      +     rchips
      +     titleLine
      +     metaLine
      +     factsLine
      +     noteLine
      +     savedbc
      + '</div></a>'
      + '<div class="cbody" style="padding-top:0;flex:0">'
      +   '<div class="cfoot">'
      +     '<button class="startp" onclick="startPursuit(this)"><span>Start Pursuit</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>'
      +     '<button class="heart" title="Remove from Saved" onclick="unfav(this)"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg></button>'
      +   '</div>'
      +   '<div class="cerr">Couldn\\u2019t start the pursuit. Try again.</div>'
      + '</div>'
      + '</div>';
  }

  function render(){
    if(!ALL.length){
      var bar0=document.getElementById('filbar'); if(bar0)bar0.hidden=true;
      list.innerHTML='<div class="empty"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg>'
        + '<h3>Inbox zero</h3><p>Nothing saved right now. Heart an opportunity on the map to watch it here.</p>'
        + '<p style="margin-top:14px"><a href="/opportunity-map">Explore the map \\u2192</a></p></div>';
      return;
    }
    var rows=ALL.filter(inFilter);
    if(!rows.length){ list.innerHTML='<div class="empty"><h3>Nothing in this view</h3><p>Try \\u201cAll\\u201d to see every saved opportunity.</p></div>'; return; }
    // Group, in priority order. A 0-row group is omitted. Within a group, sort by soonest deadline.
    var buckets={attn:[],soon:[],watch:[],closed:[]};
    rows.forEach(function(r){ buckets[groupOf(r)].push(r); });
    function soonestFirst(a,b){ var da=daysLeftOf(a), db=daysLeftOf(b);
      if(da==null&&db==null)return 0; if(da==null)return 1; if(db==null)return -1; return da-db; }
    var html='';
    GROUP_ORDER.forEach(function(k){
      var b=buckets[k]; if(!b.length)return;
      b.sort(soonestFirst);
      var m=GROUP_META[k];
      html+='<section class="grp '+m.cls+'"><div class="grphdr"><span class="gdot"></span>'
        + '<span class="gtitle">'+h(m.title)+'</span><span class="gcount">'+b.length+'</span></div>'
        + '<div class="grid">'+b.map(cardHTML).join('')+'</div></section>';
    });
    list.innerHTML=html;
  }

  function refresh(){ header(); filters(); render(); }

  // ── Un-save (secondary): DELETE the favorite, drop from state, re-render. ──
  window.unfav=function(btn){
    var card=btn.closest('.dcard'); var nid=card&&card.getAttribute('data-nid'); if(!nid)return;
    card.classList.add('rmv');
    fetch('/api/opportunities/save',{method:'DELETE',headers:hdrs(),body:JSON.stringify({email:em,noticeId:nid})})
      .then(function(){ track('saved_removed', { notice_id:nid, journey_id:journeyId(nid) }); ALL=ALL.filter(function(r){ return String(r.notice_id||r.id||'')!==String(nid); }); refresh(); })
      .catch(function(){ card.classList.remove('rmv'); });
  };

  // ── START PURSUIT = MOVE. CREATE-then-remove, gated on POST success (never remove-first). ──
  window.startPursuit=function(btn){
    var card=btn.closest('.dcard'); var nid=card&&card.getAttribute('data-nid'); if(!nid)return;
    var r=null; for(var i=0;i<ALL.length;i++){ if(String(ALL[i].notice_id||ALL[i].id||'')===String(nid)){ r=ALL[i]; break; } }
    if(!r)return;
    var o=toO(r), errEl=card.querySelector('.cerr');
    if(errEl)errEl.classList.remove('show');
    btn.disabled=true; btn.querySelector('span').textContent='Starting\\u2026';
    var vr=(r.intel_value_range&&typeof r.intel_value_range==='object')?r.intel_value_range:null;
    var val=(vr&&typeof vr.median==='number'&&vr.median>0)?String(vr.median):(r.estimated_value!=null?String(r.estimated_value):'');
    var body={
      user_email: em,
      notice_id: nid,
      title: realTitle(r)||o.sol||('Saved opportunity '+nid),
      agency: r.agency||'',
      naics_code: o.naics||'',
      set_aside: o.set||'',
      response_deadline: r.response_deadline||'',
      value_estimate: val,
      notice_type: r.notice_type||'',
      source: 'saved_inbox'
    };
    // 1) CREATE the pursuit. 2) ONLY on 2xx, DELETE the favorite. Never remove-first.
    fetch('/api/pipeline',{method:'POST',headers:hdrs(),body:JSON.stringify(body)})
      .then(function(res){ if(!res.ok)throw new Error('pipeline '+res.status); return res.json(); })
      .then(function(){
        // GROUNDED: the Saved->Pursuit funnel hop, emitted only after the pipeline POST succeeded.
        track('start_pursuit_clicked', { notice_id:nid, journey_id:journeyId(nid) });
        return fetch('/api/opportunities/save',{method:'DELETE',headers:hdrs(),body:JSON.stringify({email:em,noticeId:nid})})
          .catch(function(){ /* pursuit created; a failed un-save is non-fatal — it just re-appears next load */ });
      })
      .then(function(){
        card.classList.add('rmv');
        setTimeout(function(){
          ALL=ALL.filter(function(x){ return String(x.notice_id||x.id||'')!==String(nid); });
          refresh(); // re-render groups + header counts live; empty -> Inbox zero.
        },260);
      })
      .catch(function(){
        btn.disabled=false; btn.querySelector('span').textContent='Start Pursuit';
        if(errEl)errEl.classList.add('show');
      });
  };

  fetch('/api/opportunities/save?email='+encodeURIComponent(em),{headers:hdrs()})
    .then(function(r){return r.json();}).then(function(d){ ALL=(d&&d.opportunities)||[]; refresh(); })
    .catch(function(){ document.getElementById('lede').style.display='none';
      list.innerHTML='<div class="signin">Couldn\\u2019t load your saved opportunities. Try again shortly.</div>'; });

  // Watchlist (Updates) badge on THIS page's rail.
  fetch('/api/app/saved-searches?badge=1&email='+encodeURIComponent(em),{headers:hdrs()})
    .then(function(r){return r.json();}).then(function(d){
      var n=(d&&d.success&&d.count)?d.count:0; var b=document.getElementById('savedBadge');
      if(b){ if(n>0){ b.textContent=n>99?'99+':String(n); b.hidden=false; } else { b.hidden=true; } }
    }).catch(function(){});
})();
</script>
${ACCOUNT_MENU_JS}
${LOGIN_MODAL_HTML}${LOGIN_MODAL_JS}${'<script>'}window.__mapsSignIn=function(){var stale=false;try{stale=!!localStorage.getItem('mi_beta_email')&&!localStorage.getItem('mi_beta_auth_token');}catch(e){}var phrase=stale?'continue where you left off':'see your saved opportunities';if(typeof window.openSignInModal==='function'){window.openSignInModal(phrase,function(){location.reload();});}else{location.href='/app?next='+encodeURIComponent('/opportunity-map/favorites');}return false;};${'</script>'}</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
