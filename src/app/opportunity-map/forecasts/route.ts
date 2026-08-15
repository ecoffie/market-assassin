/**
 * GET /opportunity-map/forecasts — the browsable FORECASTS view (redesigned).
 *
 * Replaces the old badly-designed, orphaned "Unplaced forecasts" dump (Eric 2026-08-02: "the page
 * design is bad plus it is not integrated into anything, it's just a data page"). This is a MAP
 * SUB-VIEW (same header + left rail as /saved + /favorites + /market, new-map light) showing ALL
 * 33K+ agency forecasts — placed AND location-less — filterable by NAICS / agency / state / FY /
 * keyword. It is reached FROM the other surfaces (map results "see them on the map", the Market
 * view), NOT a rail destination, per Eric's "forecasts appear inline wherever you search; no
 * separate rail item".
 *
 * Data: GET /api/forecasts (auth via x-user-email; shared queryForecasts → agency_forecasts, NO
 * location filter, so the ~43% un-mappable ones are included and honestly flagged). Location-less
 * rows show "○ no location" rather than a fake place — never a guessed pin.
 */
import { NextResponse } from 'next/server';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../account-menu';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Forecasts — Mindy</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#2563eb;--jan:#2563eb;--green:#137a41;--violet:#7c3aed;--red:#e5484d}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased}
  .zhead{position:sticky;top:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid var(--line);background:#fff;z-index:40}
  .zh-left,.zh-right{display:flex;align-items:center;gap:22px}
  .zh-left a{font:700 16px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}
  .zh-right a{font:700 15px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}
  .zh-left a:hover,.zh-right a:hover{color:var(--jan)}
  /* Defensive: any icon in the top nav is line-art, never a filled black blob (a rail-style SVG
     without this rendered as a solid black shape colliding with the logo — Eric 2026-08-02). */
  .zh-left a svg,.zh-right a svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;vertical-align:middle}
  .zh-logo{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;text-decoration:none}
  .zh-logo img{height:25px;width:auto;display:block}
  .zh-logo span{font:700 19px "Inter",system-ui,sans-serif;color:var(--ink);letter-spacing:-.02em}
  @media(max-width:1000px){.zh-left,.zh-right{gap:14px}.zh-left a:nth-child(n+3),.zh-right a:first-child{display:none}}
  .zrail{position:fixed;left:0;top:52px;width:64px;height:calc(100vh - 52px);height:calc(100dvh - 52px);background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:2px;padding:14px 0;z-index:30;overflow:hidden}
  .zrail a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--sub);text-decoration:none;padding:8px 2px;border-radius:11px;width:56px;min-height:48px}
  .zrail a:hover{background:var(--wash);color:var(--ink)}.zrail a.on{color:var(--jan);background:#eff5ff}
  .zrail svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .zrail a span{font:600 10px Inter,system-ui,sans-serif;letter-spacing:.01em;line-height:1}
  .zrail-sep{width:34px;height:1px;background:var(--line);margin:6px auto}
  .main{margin-left:64px}
  .wrap{max-width:1000px;margin:0 auto;padding:28px 24px 64px}
  .kick{font:700 11px Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--violet)}
  h1{font-size:30px;font-weight:800;letter-spacing:-.02em;margin:6px 0 6px}
  .sub{color:var(--sub);font-size:15px;max-width:74ch}
  .sub b{color:var(--ink)}
  /* filter bar */
  .fbar{display:flex;flex-wrap:wrap;gap:9px;margin:18px 0 6px;align-items:center}
  .fbar input{height:40px;border:1px solid var(--line);border-radius:9px;padding:0 12px;font:500 13.5px Inter,sans-serif;color:var(--ink);background:var(--wash);outline:none}
  .fbar input:focus{border-color:var(--jan);background:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
  .fbar input.q{flex:1;min-width:200px}
  .fbar input.sm{width:120px}.fbar input.xs{width:78px}
  .fbar button{height:40px;border:0;border-radius:9px;padding:0 18px;font:700 13.5px Inter,sans-serif;color:#fff;background:var(--jan);cursor:pointer}
  .fbar button:hover{filter:brightness(1.06)}
  .fbar .clr{background:none;color:var(--sub);padding:0 8px}.fbar .clr:hover{color:var(--ink);filter:none}
  .count{font:600 13px Inter,sans-serif;color:var(--sub);margin:12px 0 14px}.count b{color:var(--ink);font-weight:800}
  /* forecast cards */
  .fc{border:1px solid var(--line);border-left:3px solid var(--violet);border-radius:12px;background:#fff;padding:15px 17px;margin-bottom:11px;display:flex;gap:16px;align-items:flex-start;transition:box-shadow .14s,border-color .14s}
  .fc:hover{box-shadow:0 6px 20px -10px rgba(16,24,40,.18)}
  .fc .m{flex:1;min-width:0}
  .fc .tag{display:inline-block;font:700 10px Inter,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:var(--violet);background:#f3edfd;border-radius:6px;padding:3px 8px;margin-bottom:7px}
  .fc .t{font:700 15.5px Inter,sans-serif;color:var(--ink);line-height:1.3}
  .fc .s{font:500 12.5px Inter,sans-serif;color:var(--sub);margin-top:5px;display:flex;flex-wrap:wrap;gap:5px 9px}
  .fc .s .dot{color:var(--faint)}
  .fc .s .noloc{color:var(--faint);font-style:italic}
  .fc .s .set{color:var(--green);font-weight:700}
  .fc .r{flex:none;text-align:right}
  .fc .v{font:800 17px Inter,sans-serif;color:var(--ink);letter-spacing:-.02em}
  .fc .fy{font:600 11px Inter,sans-serif;color:var(--faint);margin-top:3px}
  .more{display:block;margin:18px auto 0;height:44px;border:1px solid var(--line);border-radius:11px;padding:0 26px;font:700 14px Inter,sans-serif;color:var(--jan);background:#fff;cursor:pointer}
  .more:hover{background:var(--wash)}
  .loading,.empty,.signin{text-align:center;padding:56px 20px;color:var(--sub)}
  .empty h3{font-size:19px;color:var(--ink);margin-bottom:8px}
  .signin a{color:var(--jan);font-weight:700;text-decoration:none}
  ${ACCOUNT_MENU_CSS}
</style></head><body>
<header class="zhead">
  <nav class="zh-left">
    <a href="/opportunity-map">Opportunities</a>
    <a href="/opportunity-map?mode=buyers">Players</a>
    <a href="/opportunity-map/pursuits">Pursuits</a>
    <a href="/opportunity-map/reports">Markets</a>
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
  <div class="kick">Forecasts · coming work</div>
  <h1>Upcoming federal forecasts</h1>
  <div class="sub"><b>33,000+</b> planned procurements 6–18 months out — including the ones with no map location. Filter by your NAICS, agency, state or fiscal year to see what's coming before it hits SAM.</div>
  <div class="fbar">
    <input class="q" id="fq" placeholder="Search title or keyword…" autocomplete="off">
    <input class="sm" id="fnaics" placeholder="NAICS (e.g. 541512)" autocomplete="off">
    <input class="sm" id="fagency" placeholder="Agency (e.g. NAVY)" autocomplete="off">
    <input class="xs" id="fstate" placeholder="State" maxlength="2" autocomplete="off">
    <input class="xs" id="ffy" placeholder="FY" autocomplete="off">
    <button id="fgo">Search</button>
    <button class="clr" id="fclr">Clear</button>
  </div>
  <div class="count" id="fcount"></div>
  <div id="flist"><div class="loading">Loading forecasts…</div></div>
</div>
</div>
<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  var list=document.getElementById('flist'), countEl=document.getElementById('fcount');
  var t=tok(), em=email();
  var LIMIT=30, offset=0, total=0, loading=false, acc=[];

  // Seed the filters from URL params (so "see them on the map → forecasts" can carry a scope).
  var P=new URLSearchParams(location.search);
  var F={ q:P.get('q')||P.get('search')||'', naics:P.get('naics')||'', agency:P.get('agency')||'', state:(P.get('state')||'').toUpperCase().slice(0,2), fy:P.get('fy')||P.get('fiscalYear')||'' };
  document.getElementById('fq').value=F.q; document.getElementById('fnaics').value=F.naics;
  document.getElementById('fagency').value=F.agency; document.getElementById('fstate').value=F.state; document.getElementById('ffy').value=F.fy;

  function mnum(n){ n=Number(n)||0; if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B'; if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M'; if(n>=1e3)return '$'+Math.round(n/1e3)+'K'; return n?('$'+n):''; }
  // Honest place label — a bracketed sentinel or a null state = "no location", never a fake place.
  function placeLabel(st){ st=String(st||'').replace(/[\\[\\]]/g,'').trim();
    if(!st||/^usa$/i.test(st))return {txt:'○ no location',cls:'noloc'};
    if(/nationwide|various|multiple|worldwide/i.test(st))return {txt:'Nationwide',cls:'noloc'};
    if(/disclos|withheld|tbd/i.test(st))return {txt:'Location not disclosed',cls:'noloc'};
    return {txt:st,cls:''}; }
  function timing(f){ var q=String(f.quarter||'').replace(/^Q?/,'Q'); var fy=String(f.fiscalYear||'').replace(/^FY/i,''); return (q&&q!=='Qnull'&&fy&&fy!=='null')?(q+' FY'+fy):(fy&&fy!=='null'?('FY'+fy):'upcoming'); }

  function cardHtml(f){
    var pl=placeLabel(f.state);
    var v=mnum(f.valueMax);
    var meta=[];
    meta.push('<span>'+h(f.agency||'Federal agency')+'</span>');
    if(f.office)meta.push('<span class="dot">·</span><span>'+h(f.office)+'</span>');
    if(f.naics)meta.push('<span class="dot">·</span><span>NAICS '+h(f.naics)+'</span>');
    meta.push('<span class="dot">·</span><span class="'+pl.cls+'">'+h(pl.txt)+'</span>');
    if(f.setAside)meta.push('<span class="dot">·</span><span class="set">'+h(f.setAside)+'</span>');
    return '<div class="fc"><div class="m"><span class="tag">Forecast — not yet on SAM</span>'
      + '<div class="t">'+h(f.title||'Forecast opportunity')+'</div>'
      + '<div class="s">'+meta.join('')+'</div></div>'
      + '<div class="r">'+(v?'<div class="v">'+h(v)+'</div>':'')+'<div class="fy">'+h(timing(f))+'</div></div></div>';
  }

  function buildUrl(){
    var qs=['limit='+LIMIT,'offset='+offset];
    if(F.q)qs.push('search='+encodeURIComponent(F.q));
    if(F.naics)qs.push('naics='+encodeURIComponent(F.naics));
    if(F.agency)qs.push('agency='+encodeURIComponent(F.agency));
    if(F.state)qs.push('state='+encodeURIComponent(F.state));
    if(F.fy)qs.push('fiscalYear='+encodeURIComponent(F.fy));
    return '/api/forecasts?'+qs.join('&');
  }
  function render(){
    if(!acc.length){ list.innerHTML='<div class="empty"><h3>No forecasts match</h3><p>Try a broader NAICS prefix or clear a filter.</p></div>'; countEl.innerHTML=''; return; }
    countEl.innerHTML='<b>'+total.toLocaleString()+'</b> forecast'+(total===1?'':'s')+' match'+(total===1?'es':'')+' — showing '+acc.length;
    list.innerHTML=acc.map(cardHtml).join('') + (acc.length<total?'<button class="more" id="fmore">Load more ('+(total-acc.length).toLocaleString()+' more)</button>':'');
    var mb=document.getElementById('fmore'); if(mb)mb.onclick=function(){ offset+=LIMIT; load(true); };
  }
  function load(append){
    if(loading)return; loading=true;
    if(!append){ offset=0; acc=[]; list.innerHTML='<div class="loading">Loading forecasts…</div>'; }
    fetch(buildUrl(),{headers:{'x-mi-auth-token':t||'','x-user-email':em||''}})
      .then(function(r){ if(r.status===401)throw {code:401}; return r.json(); })
      .then(function(d){ loading=false;
        if(!d||!d.success){ list.innerHTML='<div class="empty"><h3>Couldn\\u2019t load forecasts</h3><p>Please try again.</p></div>'; return; }
        total=(d.pagination&&d.pagination.total)||0;
        acc=acc.concat(d.forecasts||[]);
        render();
      })
      .catch(function(e){ loading=false;
        if(e&&e.code===401){ list.innerHTML='<div class="signin">Please <a href="/app?next='+encodeURIComponent(location.pathname+location.search)+'">sign in</a> to browse forecasts.</div>'; return; }
        list.innerHTML='<div class="empty"><h3>Couldn\\u2019t load forecasts</h3><p>Check your connection and try again.</p></div>'; });
  }
  function applyFilters(){
    F.q=document.getElementById('fq').value.trim();
    F.naics=document.getElementById('fnaics').value.trim();
    F.agency=document.getElementById('fagency').value.trim();
    F.state=document.getElementById('fstate').value.trim().toUpperCase().slice(0,2);
    F.fy=document.getElementById('ffy').value.trim();
    load(false);
  }
  document.getElementById('fgo').onclick=applyFilters;
  document.getElementById('fclr').onclick=function(){ ['fq','fnaics','fagency','fstate','ffy'].forEach(function(id){document.getElementById(id).value='';}); F={q:'',naics:'',agency:'',state:'',fy:''}; load(false); };
  ['fq','fnaics','fagency','fstate','ffy'].forEach(function(id){ document.getElementById(id).addEventListener('keydown',function(e){ if(e.key==='Enter')applyFilters(); }); });

  if(!t||!em){ list.innerHTML='<div class="signin">Please <a href="/app?next='+encodeURIComponent(location.pathname+location.search)+'">sign in</a> to browse forecasts.</div>'; countEl.innerHTML=''; return; }
  load(false);
})();
</script>
${ACCOUNT_MENU_JS}
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
