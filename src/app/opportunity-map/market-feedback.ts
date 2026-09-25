import { MINDY_INTEL } from '@/lib/maps/mindy-intel';

/**
 * MAPS FEEDBACK — instant acknowledgement, truthful horizon progress, first-load transition (Maps P1/P2,
 * 2026-09-24).
 *
 * Principle: never make the user wonder whether Mindy heard them, and never let an old answer masquerade
 * as the new one.
 *
 * This module owns ONLY presentation. It never fetches, never decides what a market is and never delays
 * data: VIEWPORT_JS (route.ts) reports the facts of each fetch round — `begin` (a round was dispatched),
 * `horizon` (one horizon's REAL request resolved or failed), `paint` (render ran / the round settled),
 * `idle` (no opportunity round, e.g. the Players map) — and this module turns them into what is on screen.
 * A superseded round is simply replaced by `begin` for the new one, so cancelled work disappears from the
 * progress state and can never paint (the generation check in VIEWPORT_JS already drops its data).
 *
 * WHEN EACH THING APPEARS (all thresholds are MF_TIMING below; `e` = ms since the action):
 *   nothing ............ a pan/zoom that settles in < 300 ms, a cached horizon toggle, any round that is done
 *                        before the next frame.
 *   subtle ack ......... e = 0 for a market change: the 2px bar starts at the top of the map, and the header
 *                        count + old pins begin fading (CSS delay 100–120 ms, so a fast answer never flashes).
 *                        A pan gets the bar only at e ≥ 300 ms.
 *   local progress ..... 300 ms ≤ e < 1 s: a small spinner beside "Updating your market…" in the header.
 *   Updating panel ..... e ≥ 1 s and the round is not settled: the branded card over the map with one row
 *                        per enabled horizon, each marked done only when ITS request completed.
 *   Mindy Intel ........ e ≥ 3 s in the Updating panel; e ≥ 2.5 s in Building your market. Rotates every 8 s
 *                        only while the wait continues. Never delays dismissal.
 *   Building your market  the FIRST market of a page load (cold/warm entry, deep link, restored search). Sits
 *                        in the HTML so it can cover the server-rendered placeholder list, but fades in only
 *                        after 250 ms — a fast entry never sees it. It leaves the moment a horizon has painted
 *                        pins (not when every horizon is done), or when the round settles, or after 25 s.
 */

/** Every timing threshold in one place (ms). */
export const MF_TIMING = {
  LOCAL: 300,       // local spinner; a pan's bar
  BRANDED: 1000,    // "Updating your market…" panel with horizon progress
  RICH: 3000,       // Mindy Intel inside the Updating panel
  BOOT_REVEAL: 250, // Building your market fades in after this (CSS animation-delay)
  BOOT_INTEL: 2500, // Mindy Intel inside Building your market
  ROTATE: 8000,     // next Intel card, only while still waiting
  FAILSAFE: 25000,  // Building your market can never outlive this, whatever else happens
} as const;

/** Canonical user-facing horizon names for progress rows (one place). */
export const MF_HORIZON_LABEL = { open: 'Open Now', recompete: 'Coming Back', forecast: 'Coming Soon' } as const;
export const MF_HORIZON_STAGE = {
  open: 'Finding Open Now',
  recompete: 'Checking contracts coming back',
  forecast: 'Looking ahead at agency demand',
} as const;

const HORIZON_COLOR = { open: 'var(--grnd,#22a06b)', recompete: 'var(--recomp,#b45309)', forecast: 'var(--forecast,#7c3aed)' };

// ── CSS ──────────────────────────────────────────────────────────────────────────────────────────────
export const MARKET_FEEDBACK_CSS =
  // 1. The acknowledgement bar: 2px across the top of the map, starts the instant a round begins.
  '.mfb-bar{position:absolute;left:0;right:0;top:0;height:2px;z-index:650;overflow:hidden;pointer-events:none;opacity:0;transition:opacity .12s}'
  + '.mfb-bar.on{opacity:1}'
  // Sweep with transform (composited), never left/width — a layout property would re-layout every frame.
  + '.mfb-bar::before{content:"";position:absolute;top:0;bottom:0;left:0;width:40%;background:linear-gradient(90deg,transparent,#5b3fd6,#2563eb,transparent);transform:translateX(-100%);animation:mfbSweep 1.1s cubic-bezier(.45,.05,.35,1) infinite;will-change:transform}'
  + '@keyframes mfbSweep{to{transform:translateX(250%)}}'
  // 2. Stale content — INLINE opacity on each affected element (see setStale in the JS), never classes.
  //    Measured on a 3,165-pin map: a body class reaching into the marker pane forced a 130–260 ms page-wide
  //    style recalc; a class on the pane/feed/count itself still cost 18–100 ms (this page's rules make class
  //    changes invalidate broadly); visibility (inherited) restyled every pin (~190 ms). An inline opacity
  //    write costs 0–3 ms, and with will-change the fade is composited instead of repainting every pin per
  //    frame. That cost matters: it delayed the very fetch it was acknowledging by ~0.5 s.
  + '.mapwrap .leaflet-marker-pane,.mapwrap .leaflet-overlay-pane,#feed{will-change:opacity}'
  // The header count is the ANSWER — while it describes the previous market, "Updating your market…" takes
  // its place (the count is faded out, never shown beside it).
  + '.sortrow{position:relative}'
  // No left/right: an absolutely positioned element placed BEFORE the count takes its static position — exactly
  // where the count starts — with no geometry read (a read here forced a full-page layout per action).
  + '.mfb-upd{position:absolute;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:8px;white-space:nowrap;font-size:14px;font-weight:600;color:var(--sub,#6b7787);opacity:0;pointer-events:none;transition:opacity .1s}'
  + '.mfb-upd i{display:none;width:12px;height:12px;border:2px solid #d9dcf5;border-top-color:#5b3fd6;border-radius:50%;animation:mfbSpin .7s linear infinite}'
  // Visible is the DEFAULT state; animations only animate FROM hidden. The page honours
  // prefers-reduced-motion with a global animation:none — which must leave everything visible, not stuck at 0.
  + '@keyframes mfbIn{from{opacity:0}}@keyframes mfbSpin{to{transform:rotate(360deg)}}'
  // 3. The Updating panel — floats over the top of the map, never blocks it.
  // Bottom-center of the map: the top edge already carries the "N of M" pill (left), the "Picked up where you
  // left off" pill (center) and Draw (right); the bottom has only the legend (left) and zoom (right). Fixed
  // width so the card does not jump when the Intel card joins it.
  + '.mfb-panel{position:absolute;left:50%;bottom:28px;transform:translate(-50%,6px);z-index:640;width:min(400px,calc(100% - 32px));box-sizing:border-box;background:rgba(255,255,255,.97);border:1px solid rgba(91,63,214,.18);border-radius:14px;box-shadow:0 10px 30px rgba(17,24,39,.14);padding:12px 16px 12px;opacity:0;transition:opacity .18s,transform .18s;pointer-events:none}'
  + '.mfb-panel.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}'
  + '.mfb-ph{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#1f1d3a;letter-spacing:.01em}'
  + '.mfb-ph .mfb-k{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#5b3fd6}'
  + '.mfb-rows{list-style:none;margin:8px 0 0;padding:0}'
  + '.mfb-row{display:flex;align-items:center;gap:9px;padding:4px 0;font-size:13px;color:#374151}'
  + '.mfb-row b{font-weight:700;color:#111827}'
  + '.mfb-ic{position:relative;flex:0 0 auto;width:16px;height:16px;border-radius:50%;box-sizing:border-box}'
  + '.mfb-row[data-s="pending"] .mfb-ic,.mfb-st[data-s="pending"] .mfb-ic{border:2px solid rgba(91,63,214,.2);border-top-color:var(--hz,#5b3fd6);animation:mfbSpin .75s linear infinite}'
  + '.mfb-row[data-s="waiting"] .mfb-ic,.mfb-st[data-s="waiting"] .mfb-ic{border:2px solid rgba(107,119,135,.35)}'
  + '.mfb-row[data-s="done"] .mfb-ic,.mfb-st[data-s="done"] .mfb-ic{background:var(--hz,#22a06b)}'
  + '.mfb-row[data-s="done"] .mfb-ic::after,.mfb-st[data-s="done"] .mfb-ic::after{content:"";position:absolute;left:5px;top:2px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}'
  + '.mfb-row[data-s="error"] .mfb-ic,.mfb-st[data-s="error"] .mfb-ic{background:#dc2626}'
  + '.mfb-row[data-s="error"] .mfb-ic::after,.mfb-st[data-s="error"] .mfb-ic::after{content:"!";position:absolute;inset:0;color:#fff;font:800 11px/16px system-ui;text-align:center}'
  + '.mfb-row[data-s="note"] .mfb-ic,.mfb-st[data-s="note"] .mfb-ic{border:2px solid #9ca3af;background:#f3f4f6}'
  + '.mfb-row .mfb-v,.mfb-st .mfb-v{margin-left:auto;font-variant-numeric:tabular-nums;color:#6b7787;font-weight:600}'
  // Mindy Intel card (shared by the panel and the boot transition).
  + '.mfb-intel{margin-top:10px;border-left:3px solid #5b3fd6;background:#f6f4ff;border-radius:8px;padding:9px 12px;animation:mfbIn .3s backwards}'
  + '.mfb-intel[hidden],.mfb-err[hidden]{display:none}'
  + '.mfb-intel-k{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#5b3fd6;margin-bottom:3px}'
  + '.mfb-intel p{margin:0;font-size:13px;line-height:1.45;color:#27264a}'
  // Update failed with the previous market still on screen: say so, never pretend.
  + '.mfb-err{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);z-index:641;background:#fff;border:1px solid #fecaca;border-radius:12px;box-shadow:0 8px 24px rgba(17,24,39,.12);padding:10px 14px;font-size:13px;color:#7f1d1d;display:flex;gap:10px;align-items:center}'
  + '.mfb-err button{border:1px solid #fecaca;background:#fff5f5;color:#991b1b;border-radius:8px;padding:4px 10px;font-weight:700;cursor:pointer}'
  // 4. BUILDING YOUR MARKET — first entry only. Covers the map + list (the server-rendered placeholder list
  //    must not read as the user's market); the map stays faintly visible behind it.
  // Absolutely positioned GRID CHILD: its containing block is the grid area named here — the map + list
  // (row 3, columns 2–3 on desktop; the single content cell on mobile). Nav, icon rail and search bar stay
  // usable: the user can change the query while the market builds.
  + '.app{position:relative}'
  + '.mfb-boot{grid-area:3/2/4/4;position:absolute;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 600px at 30% 20%,rgba(91,63,214,.55),transparent 60%),linear-gradient(135deg,rgba(10,14,40,.9),rgba(33,20,84,.86));backdrop-filter:blur(3px) saturate(.7);-webkit-backdrop-filter:blur(3px) saturate(.7);color:#fff;opacity:0;transition:opacity .32s,transform .32s}'
  // Revealed by the parse-time timer in MARKET_BOOT_HTML (class "in") — a CSS timer would be cancelled by
  // the reduced-motion rule and leave the overlay invisible.
  + '.mfb-boot.in{opacity:1}'
  + '.mfb-boot.out{opacity:0!important;transform:scale(1.015);pointer-events:none}'
  // While the first market builds, the server-rendered placeholder list (and its "600 results") is NOT the
  // user's market — hide it so it can never flash before the overlay reveals or read as the answer.
  //    Opacity, not visibility: visibility is inherited, so lifting it would restyle every pin at the
  //    exact moment the first market paints.
  + '.app.mfb-booting #feed,.app.mfb-booting #rescount,.app.mfb-booting #mapCount,.app.mfb-booting .leaflet-marker-pane{opacity:0!important}'
  + '.mfb-boot[hidden]{display:none}'
  + '.mfb-boot::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,transparent,#8b7bff,#60a5fa,transparent);background-size:40% 100%;background-repeat:no-repeat;animation:mfbBootSweep 1.6s ease-in-out infinite}'
  + '@keyframes mfbBootSweep{0%{background-position:-40% 0}100%{background-position:140% 0}}'
  + '.mfb-boot-in{width:min(560px,calc(100% - 48px))}'
  + '.mfb-kicker{font-size:11px;font-weight:800;letter-spacing:.34em;text-transform:uppercase;color:#b9b0ff}'
  + '.mfb-title{margin-top:10px;font-size:clamp(30px,4.2vw,50px);line-height:1;font-weight:900;letter-spacing:-.01em;text-transform:uppercase}'
  + '.mfb-q{margin-top:10px;font-size:15px;color:#d8d4ff;min-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.mfb-stages{list-style:none;margin:26px 0 0;padding:0}'
  + '.mfb-st{display:flex;align-items:center;gap:14px;padding:9px 0;font-size:clamp(17px,1.9vw,22px);font-weight:700;color:rgba(255,255,255,.55);border-top:1px solid rgba(255,255,255,.08);transition:color .25s}'
  + '.mfb-st .mfb-ic{width:22px;height:22px}'
  + '.mfb-st[data-s="done"] .mfb-ic::after{left:7px;top:3px;width:6px;height:11px}'
  + '.mfb-st[data-s="pending"],.mfb-st[data-s="done"]{color:#fff}'
  + '.mfb-st[data-s="error"]{color:#fecaca}'
  + '.mfb-st .mfb-v{color:#c9c3ff;font-size:.8em}'
  + '.mfb-boot .mfb-intel{margin-top:22px;background:rgba(255,255,255,.07);border-left-color:#8b7bff}'
  + '.mfb-boot .mfb-intel-k{color:#b9b0ff}'
  + '.mfb-boot .mfb-intel p{color:#eeeaff;font-size:15px}'
  + '@media(max-width:640px){.mfb-boot{grid-area:3/1/4/2}.mfb-title{font-size:30px}}'
  + '@media (prefers-reduced-motion:reduce){.mfb-bar::before,.mfb-boot::after{animation:none}.mfb-bar{background:#5b3fd6}.mfb-ic{animation:none!important}}';

// ── HTML ─────────────────────────────────────────────────────────────────────────────────────────────
function stageRow(key: string, label: string, color?: string): string {
  return '<li class="mfb-st" data-st="' + key + '" data-s="waiting"' + (color ? ' style="--hz:' + color + '"' : '')
    + '><span class="mfb-ic"></span><span>' + label + '</span><span class="mfb-v"></span></li>';
}

/** Building your market — injected right after `<div class="app">` (never for ?embed=). */
export const MARKET_BOOT_HTML =
  '<div class="mfb-boot" id="mfbBoot" role="status" aria-live="polite" aria-label="Building your market">'
  + '<div class="mfb-boot-in">'
  + '<div class="mfb-kicker">Mindy</div>'
  + '<div class="mfb-title">Building your market</div>'
  + '<div class="mfb-q" id="mfbBootQ"></div>'
  + '<ol class="mfb-stages" id="mfbStages">'
  + stageRow('intent', 'Understanding your market').replace('data-s="waiting"', 'data-s="pending"')
  + stageRow('open', MF_HORIZON_STAGE.open, HORIZON_COLOR.open)
  + stageRow('recompete', MF_HORIZON_STAGE.recompete, HORIZON_COLOR.recompete)
  + stageRow('forecast', MF_HORIZON_STAGE.forecast, HORIZON_COLOR.forecast)
  + '</ol>'
  + '<div class="mfb-intel" id="mfbBootIntel" hidden><div class="mfb-intel-k">Mindy Intel</div><p></p></div>'
  + '</div></div>'
  // Parse-time: mark the page as booting (hides the placeholder list) and reveal the overlay after
  // BOOT_REVEAL unless the market is already on screen. Runs before any other script on the page.
  + '<script>(function(){try{var a=document.querySelector(".app");if(a)a.classList.add("mfb-booting");setTimeout(function(){var b=document.getElementById("mfbBoot");'
  + 'if(b&&!b.hidden&&!b.classList.contains("out"))b.classList.add("in");},' + MF_TIMING.BOOT_REVEAL + ');}catch(e){}})();</script>';

/** Bar + Updating panel + failure note — injected inside `.mapwrap`, right after `#map`. */
export const MARKET_FEEDBACK_MAP_HTML =
  '<div class="mfb-bar" id="mfbBar" aria-hidden="true"></div>'
  + '<div class="mfb-panel" id="mfbPanel" role="status" aria-live="polite">'
  + '<div class="mfb-ph"><span class="mfb-k">Mindy</span><span>Updating your market…</span></div>'
  + '<ul class="mfb-rows" id="mfbRows"></ul>'
  + '<div class="mfb-intel" id="mfbIntel" hidden><div class="mfb-intel-k">Mindy Intel</div><p></p></div>'
  + '</div>'
  + '<div class="mfb-err" id="mfbErr" hidden role="alert"><span>Couldn’t update your market. Showing your previous results.</span><button type="button" id="mfbRetry">Retry</button></div>';

// ── JS ───────────────────────────────────────────────────────────────────────────────────────────────
// Pure decision functions first (unit-tested by extracting them — see market-feedback.unit.test.ts),
// then the small controller that applies them to the DOM. Contains no template-literal placeholders.
const MF_PURE_JS = String.raw`
  // What the screen should show for round r at time now. Pure — no DOM, no clock.
  // r: {kind:'market'|'pan', boot, stale, t0, settled, painted, useful, failed, h:{m:{s,total}}}
  function mfView(r,now,T){
    var off={bar:false,stale:false,local:false,panel:false,intel:false,boot:false,bootIntel:false,err:false};
    if(!r)return off;
    var e=now-r.t0, open=!r.settled;
    var boot=!!r.boot && !r.useful && open && e<T.FAILSAFE;
    var market=r.kind!=='pan';
    return {
      // the acknowledgement: immediate for a market change, only after LOCAL for a pan
      bar: open && (market ? true : e>=T.LOCAL),
      // old content fades until NEW content has painted; if the round settles without painting
      // (every horizon failed) the old market stays marked as old
      stale: !!r.stale && !r.painted,
      local: open && market && !boot && e>=T.LOCAL,
      panel: open && market && !boot && e>=T.BRANDED,
      intel: open && market && !boot && e>=T.RICH,
      boot: boot,
      bootIntel: boot && e>=T.BOOT_INTEL,
      err: !!r.settled && !r.painted && !!r.stale && r.failed>0
    };
  }
  // One horizon's progress row: state s ∈ waiting|pending|done|error|note + the text beside it.
  // total is the horizon's REAL count; states other than ok never become a number.
  function mfRowText(h){
    if(!h||h.s==='waiting')return {s:'waiting',v:''};
    if(h.s==='pending')return {s:'pending',v:''};
    if(h.s==='error')return {s:'error',v:'couldn’t load'};
    if(h.s==='needs_scope')return {s:'note',v:'add what you sell'};
    if(h.s==='unavailable')return {s:'note',v:'not covered'};
    if(h.s==='unknown')return {s:'done',v:'count unavailable'};
    var n=(typeof h.total==='number')?h.total.toLocaleString():'';
    return {s:'done',v:h.s==='partial'?(n+' (partial)'):n};
  }
  // The k-th Mindy Intel card for this view: eligible cards (general, or about an enabled horizon),
  // unseen ones first, in their authored order. Deterministic.
  function mfPickIntel(cards,enabled,seen,k){
    var el=cards.filter(function(c){ return !c.horizons.length || c.horizons.some(function(h){ return enabled.indexOf(h)>-1; }); });
    if(!el.length)return null;
    var fresh=el.filter(function(c){ return seen.indexOf(c.id)===-1; }), old=el.filter(function(c){ return seen.indexOf(c.id)>-1; });
    var order=fresh.concat(old);
    return order[k%order.length];
  }
`;

export const MARKET_FEEDBACK_JS = '<script>(function(){'
  + 'var T=' + JSON.stringify(MF_TIMING) + ';'
  + 'var LABEL=' + JSON.stringify(MF_HORIZON_LABEL) + ';'
  + 'var COLOR=' + JSON.stringify(HORIZON_COLOR) + ';'
  + 'var INTEL=' + JSON.stringify(MINDY_INTEL) + ';'
  + MF_PURE_JS
  + String.raw`
  var R=null, timer=0, everUseful=false;
  var bootEl=document.getElementById('mfbBoot');
  var bootLive=!!bootEl;                 // Building your market is only for the first market of a page load
  var log=window.__mfLog=window.__mfLog||[];
  function now(){ try{ return performance.now(); }catch(e){ return Date.now(); } }
  function mark(ev,x){ try{ log.push({t:Math.round(now()),ev:ev,gen:R&&R.gen,x:x}); if(log.length>300)log.shift(); }catch(e){} }
  var seen=[]; try{ seen=JSON.parse(sessionStorage.getItem('mf_intel_seen')||'[]')||[]; }catch(e){ seen=[]; }
  function remember(id){ if(seen.indexOf(id)>-1)return; seen.push(id); try{ sessionStorage.setItem('mf_intel_seen',JSON.stringify(seen)); }catch(e){} }
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  // "Updating your market…" — sits exactly over the header count while the count describes the old market.
  function upd(){
    var u=$('mfbUpd'); if(u)return u;
    var rc=$('rescount'); if(!rc||!rc.parentNode)return null;
    u=document.createElement('div'); u.id='mfbUpd'; u.className='mfb-upd'; u.setAttribute('aria-live','polite');
    u.innerHTML='<i></i><span>Updating your market\u2026</span>';
    rc.parentNode.insertBefore(u,rc);
    return u;
  }
  // Mark (or unmark) everything that shows the CURRENT market as old: pins, shapes, the list and both counts.
  // Inline writes only (see the CSS note). Fading waits 100–120 ms so an answer that is already here never
  // flashes; coming back is immediate.
  function fade(el,op,delayMs){ if(!el)return; el.style.transition='opacity '+(op?'.22s':'.16s')+' ease '+(op?delayMs:0)+'ms'; el.style.opacity=op||''; }
  function setStale(on){
    try{ var ps=document.querySelectorAll('.mapwrap .leaflet-marker-pane,.mapwrap .leaflet-overlay-pane'); for(var i=0;i<ps.length;i++)fade(ps[i],on?'.28':'',120); }catch(e){}
    fade($('feed'),on?'.38':'',120);
    var mc=$('mapCount'); if(mc)mc.style.opacity=on?'0':'';
    fade($('rescount'),on?'0':'',100);
    var u=upd(); if(u){ u.style.transitionDelay=on?'100ms':'0ms'; u.style.opacity=on?'1':'0'; }
  }
  var last={};
  function setFlag(key,on,fn){ if(last[key]===on)return; last[key]=on; fn(on); mark(key+(on?':on':':off')); }

  function intelFor(el,startAt,e,enabled){
    if(!el)return;
    var k=Math.max(0,Math.floor((e-startAt)/T.ROTATE));
    var c=mfPickIntel(INTEL,enabled,seen,k);
    if(!c){ el.hidden=true; return; }
    if(el.getAttribute('data-id')!==c.id){
      el.setAttribute('data-id',c.id);
      var p=el.querySelector('p'); if(p)p.textContent=c.text;
      el.style.animation='none'; void el.offsetWidth; el.style.animation='';
      remember(c.id); mark('intel',c.id);
    }
    el.hidden=false;
  }

  function paintRows(){
    var ul=$('mfbRows'); if(!ul||!R)return;
    ul.innerHTML=R.enabled.map(function(m){
      var t=mfRowText(R.h[m]);
      return '<li class="mfb-row" data-s="'+t.s+'" style="--hz:'+COLOR[m]+'"><span class="mfb-ic"></span><span>'+esc(LABEL[m])+'</span><span class="mfb-v">'+esc(t.v)+'</span></li>';
    }).join('');
  }
  function paintStages(){
    var ol=$('mfbStages'); if(!ol)return;
    var intent=ol.querySelector('[data-st="intent"]');
    if(intent&&R)intent.setAttribute('data-s','done');
    ['open','recompete','forecast'].forEach(function(m){
      var li=ol.querySelector('[data-st="'+m+'"]'); if(!li)return;
      if(R&&R.enabled.indexOf(m)===-1){ li.hidden=true; return; }
      li.hidden=false;
      var t=mfRowText(R?R.h[m]:null);
      li.setAttribute('data-s',t.s);
      var v=li.querySelector('.mfb-v'); if(v)v.textContent=t.v;
    });
    var q=$('mfbBootQ'); if(q&&R)q.textContent=R.q?('“'+R.q+'”'):'';
  }

  // All DOM writes happen in ONE flush per frame. The earliest any write can be seen is the next frame anyway,
  // and writing inside the page's own tasks (which then read geometry) forced a full synchronous layout each time.
  var frame=0;
  function apply(){
    clearTimeout(timer); timer=0;
    if(frame)return;
    if(typeof requestAnimationFrame==='function'&&!document.hidden){ frame=requestAnimationFrame(function(){ frame=0; flush(); }); }
    else flush();
  }
  function flush(){
    var t=now(), v=mfView(R,t,T), e=R?t-R.t0:0;
    setFlag('bar',v.bar,function(on){ var b=$('mfbBar'); if(b)b.classList.toggle('on',on); });
    setFlag('stale',v.stale,setStale);
    setFlag('local',v.local,function(on){ var u=upd(); if(u){ var i=u.querySelector('i'); if(i)i.style.display=on?'inline-block':'none'; } });
    setFlag('panel',v.panel,function(on){ var p=$('mfbPanel'); if(p)p.classList.toggle('on',on); });
    setFlag('err',v.err,function(on){
      var x=$('mfbErr'); if(x)x.hidden=!on;
      // Nothing is updating any more: the header must say the market on screen is the PREVIOUS one.
      var u=upd(); var sp=u&&u.querySelector('span');
      if(sp)sp.textContent=on?'Not updated \u2014 showing your previous market':'Updating your market\u2026';
    });
    if(v.panel)paintRows();
    var pi=$('mfbIntel'); if(v.intel)intelFor(pi,T.RICH,e,R.enabled); else if(pi)pi.hidden=true;
    if(bootLive){
      paintStages();
      var bi=$('mfbBootIntel'); if(v.bootIntel)intelFor(bi,T.BOOT_INTEL,e,R.enabled); else if(bi)bi.hidden=true;
      // Building your market ends when useful data is on the map — or the round settled, or the failsafe.
      if(R&&!v.boot)endBoot(R.useful?'useful':(R.settled?'settled':'failsafe'));
    }
    if(!R||R.settled)return;
    // Next re-evaluation: the next threshold we have not crossed yet (or the next Intel rotation).
    var marks=[T.LOCAL,T.BRANDED,T.RICH,T.BOOT_INTEL,T.FAILSAFE].filter(function(x){ return x>e; });
    if(v.intel||v.bootIntel)marks.push(e+T.ROTATE-((e-(v.intel?T.RICH:T.BOOT_INTEL))%T.ROTATE));
    if(marks.length)timer=setTimeout(apply,Math.max(16,Math.min.apply(null,marks)-e+5));
  }
  window.__mfFlushNow=function(){ if(frame){ cancelAnimationFrame(frame); frame=0; } flush(); };   // tests
  function endBoot(why){
    if(!bootLive)return; bootLive=false;
    mark('boot:off',why);
    if(!bootEl)return;
    var app=document.querySelector('.app'); if(app)app.classList.remove('mfb-booting');
    bootEl.classList.add('out');
    setTimeout(function(){ bootEl.hidden=true; },340);
  }

  var ackTimer=0;
  window.__mf={
    // The user just acted and a fetch round will follow (after a parse, a debounce flush…). Acknowledge NOW:
    // the bar starts and the previous market is marked as old. begin() keeps this action time as t0, so every
    // threshold is measured from the action, not from the dispatch. Expires if no round follows.
    ack:function(){
      if(bootLive){ return; }
      var onScreen=(typeof OPPS!=='undefined')&&!!(OPPS&&OPPS.length);
      R={gen:null,ack:true,kind:'market',enabled:(R&&R.enabled)||[],stale:onScreen,q:'',t0:now(),boot:false,settled:false,painted:false,useful:false,failed:0,h:{}};
      mark('ack'); apply();
      clearTimeout(ackTimer); ackTimer=setTimeout(function(){ if(R&&R.ack&&R.gen==null){ R=null; mark('ack:expired'); apply(); } },3000);
    },
    // A round was dispatched. kind: 'market' (the intent changed) | 'pan' (only the bbox moved).
    // stale: the content on screen describes a DIFFERENT market than this round will answer.
    begin:function(o){
      var acked=(R&&R.ack&&R.gen==null)?R:null; clearTimeout(ackTimer);
      R={gen:o.gen,kind:acked?'market':o.kind,enabled:o.enabled.slice(),stale:(!!o.stale||!!(acked&&acked.stale))&&!bootLive,q:o.q||'',t0:acked?acked.t0:now(),
        boot:bootLive,settled:false,painted:false,useful:false,failed:0,h:{}};
      o.enabled.forEach(function(m){ R.h[m]={s:'pending'}; });
      mark('begin',{kind:R.kind,acked:!!acked,stale:R.stale,enabled:o.enabled.join(',')});
      apply();
    },
    // One horizon's REAL request completed (info.s = ok|partial|unavailable|unknown|needs_scope) or failed (error).
    horizon:function(gen,m,info){
      if(!R||R.gen!==gen||!R.h[m])return;
      R.h[m]={s:info.s,total:info.total};
      if(info.s==='error')R.failed++;
      mark('horizon',{m:m,s:info.s,total:info.total,src:info.src});
      apply();
    },
    // render() ran for this round (painted) and/or every horizon has reported (settled).
    paint:function(gen,o){
      if(!R||R.gen!==gen)return;
      if(o.painted&&!R.painted){ R.painted=true; mark('painted',{pins:o.pins}); }
      if(o.painted&&o.pins>0&&!R.useful){ R.useful=true; everUseful=true; mark('useful',{pins:o.pins}); }
      if(o.settled&&!R.settled){ R.settled=true; mark('settled'); }
      apply();
    },
    // No opportunity round (Players map, nothing enabled): clear every feedback state.
    idle:function(){ R=null; mark('idle'); apply(); endBoot('idle'); }
  };
  document.addEventListener('click',function(e){ if(e.target&&e.target.id==='mfbRetry'){ var x=$('mfbErr'); if(x)x.hidden=true; last.err=false; if(window.__mapRefetch)window.__mapRefetch(); } });
  // Failsafe: whatever happens (a script error, a page that never fetches), the transition cannot trap the user.
  setTimeout(function(){ endBoot('failsafe'); },T.FAILSAFE);
})();</script>`;

/** The pure functions as source, for unit tests (extracted with new Function). */
export const MF_PURE_JS_FOR_TESTS = MF_PURE_JS;
