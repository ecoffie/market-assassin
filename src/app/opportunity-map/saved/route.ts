/**
 * GET /opportunity-map/saved — the Saved Searches manager (Zillow's "Updates" page).
 *
 * Lists the signed-in user's saved searches with: name, mode, a summary of the saved
 * filters, an Alerts ON/OFF toggle (PATCH alerts_enabled), and Delete. "New search"
 * links back to the map. All data via /api/app/saved-searches (MI-token authed,
 * read client-side from localStorage — same as the map).
 *
 * Chrome: this page lives inside the SAME app shell as /opportunity-map — the top nav
 * (Open · Past · Contacts · Bid with confidence · Pricing · My Pursuits + the account
 * avatar) AND the left rail (Search · Updates · Favorites, with Updates active) — so
 * it's visually consistent with the map, exactly like the Favorites page (#471). The
 * nav header + rail markup/CSS MIRROR opportunity-map/favorites/route.ts (which mirror
 * opportunity-map/route.ts's ZHEAD/ZRAIL); the account avatar is shared verbatim via
 * ./account-menu. Keep them in sync.
 */
import { NextResponse } from 'next/server';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../account-menu';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Updates — Mindy</title>
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
  /* content area sits right of the 64px rail */
  .main{margin-left:64px}
  .wrap{max-width:920px;margin:0 auto;padding:30px 24px 64px}
  .wraphead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:26px}
  h1{font-size:32px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px}
  .sub{color:var(--sub);font-size:15px}
  .newbtn{display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:14.5px;color:#fff;background:var(--blue);border:0;border-radius:8px;padding:10px 16px;text-decoration:none;white-space:nowrap;flex:none}
  .newbtn:hover{filter:brightness(.94)}
  /* ── Zillow-style saved-search cards ── */
  .row{display:flex;align-items:flex-start;gap:20px;border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:14px;transition:box-shadow .16s,border-color .16s,transform .16s;background:#fff}
  .row:hover{box-shadow:0 8px 24px -10px rgba(16,24,40,.18);border-color:#c7d2e0;transform:translateY(-1px)}
  .row.hasnew{border-color:#cfe0ff}
  .rmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:11px}
  .rname{font-size:18px;font-weight:800;letter-spacing:-.01em;color:var(--ink);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .rname a{color:var(--ink);text-decoration:none}
  .rname a:hover{color:var(--blue);text-decoration:underline}
  .badge{background:var(--red);color:#fff;font-weight:700;font-size:11.5px;border-radius:20px;padding:3px 10px;vertical-align:middle;letter-spacing:.01em}
  .rchips{display:flex;flex-wrap:wrap;gap:7px}
  .fchip{display:inline-flex;align-items:center;font:600 12px Inter,sans-serif;color:var(--sub);background:var(--wash);border:1px solid var(--line);border-radius:8px;padding:5px 10px;white-space:nowrap}
  .fchip-mode{color:#1e3a8a;background:#eef3ff;border-color:#dbe6ff}
  .fchip-all{color:var(--faint)}
  .ractions{margin-top:1px;display:flex;align-items:center;gap:18px}
  .view{font:700 13px Inter,sans-serif;color:var(--blue);text-decoration:none}
  .view:hover{text-decoration:underline}
  /* Run report → (beside View on map) + the inline report panel it opens */
  .runrpt{appearance:none;border:0;background:none;padding:0;cursor:pointer;font:700 13px Inter,sans-serif;color:var(--green);display:inline-flex;align-items:center;gap:5px}
  .runrpt:hover{text-decoration:underline}
  .runrpt svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .runrpt:disabled{color:var(--faint);cursor:default;text-decoration:none}
  .rptbox{margin-top:14px;border:1px solid var(--green);border-radius:12px;overflow:hidden;background:#fbfefc}
  .rptbox .top{height:3px;background:var(--green)}
  .rptbox .in{padding:14px 16px}
  .rptrun{display:flex;align-items:center;gap:11px;color:var(--sub);font:500 13px Inter,sans-serif}
  .rptspin{width:20px;height:20px;border:2.5px solid var(--line);border-top-color:var(--green);border-radius:50%;animation:rsp 1s linear infinite;flex:none}
  @keyframes rsp{to{transform:rotate(360deg)}}
  .rpthd{font:700 11px Inter,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:var(--sub);margin-bottom:10px;display:flex;align-items:center;gap:8px}
  .rpthd .x{margin-left:auto;border:0;background:none;color:var(--faint);font-size:17px;cursor:pointer;line-height:1;padding:0}
  .rptkpi{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:12px}
  @media(max-width:620px){.rptkpi{grid-template-columns:repeat(2,1fr)}}
  .rptkpi .c{border:1px solid var(--line);border-radius:9px;padding:9px 11px;background:#fff}
  .rptkpi .k{font:600 9.5px Inter,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:var(--faint)}
  .rptkpi .v{font:800 17px Inter,sans-serif;margin-top:4px;letter-spacing:-.02em;color:var(--ink)}
  .rptkpi .v.g{color:var(--green)} .rptkpi .v.m{color:var(--faint);font-size:12px;font-weight:700}
  .rptkpi .n{font:400 9px Inter,sans-serif;color:var(--faint);margin-top:2px}
  .rptshare{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .rptshare input{flex:1;min-width:200px;font:11.5px ui-monospace,Menlo,monospace;color:var(--sub);background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 11px}
  .rptshare .cp{border:0;border-radius:8px;padding:8px 13px;font:700 12px Inter,sans-serif;background:var(--green);color:#fff;cursor:pointer}
  .rptshare .op{border:1px solid var(--green);color:var(--green);border-radius:8px;padding:8px 13px;font:700 12px Inter,sans-serif;text-decoration:none;background:none}
  .rptcontacts{border:1px solid var(--line);border-radius:9px;background:#fff;padding:10px 12px;margin-bottom:12px}
  .rptcontacts .h{font:700 10px Inter,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);margin-bottom:7px}
  .rptcontacts .pc{display:flex;align-items:center;gap:10px;padding:4px 0;flex-wrap:wrap}
  .rptcontacts .pn{font:600 12px Inter,sans-serif;color:var(--ink);flex:1;min-width:120px}
  .rptcontacts .pn span{display:block;font:400 10px Inter,sans-serif;color:var(--faint)}
  .rptcontacts .pe{font:600 11.5px ui-monospace,Menlo,monospace;color:var(--green);text-decoration:none;white-space:nowrap}
  .rptcontacts .pe:hover{text-decoration:underline}
  .rptnote{font:400 11px Inter,sans-serif;color:var(--faint);margin:11px 0 0;line-height:1.5}
  .rptwarn{background:#fdf1e3;border:1px solid #f0c894;border-radius:8px;padding:9px 11px;font:400 11.5px Inter,sans-serif;color:#7a4b12;margin-top:11px}
  .rpterr{font:500 12.5px Inter,sans-serif;color:var(--red);padding:6px 0}
  .rptups{text-align:center;padding:8px 4px}
  .rptups h4{font:800 14px Inter,sans-serif;margin:0 0 5px;color:var(--ink)}
  .rptups p{font:500 12px Inter,sans-serif;color:var(--sub);margin:0 0 12px}
  .rptups a{display:inline-block;background:var(--green);color:#fff;text-decoration:none;border-radius:9px;padding:9px 18px;font:700 12.5px Inter,sans-serif}
  /* Right side: email-frequency segmented control + delete */
  .rside{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:10px;min-width:170px}
  .freqlbl{font:700 10.5px Inter,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}
  .freq{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--wash)}
  .fq{appearance:none;border:0;background:none;font:600 12.5px Inter,sans-serif;color:var(--sub);padding:8px 13px;cursor:pointer;border-right:1px solid var(--line)}
  .fq:last-child{border-right:0}
  .fq:hover{background:#eef2f7;color:var(--ink)}
  .fq.on{background:var(--green);color:#fff}
  .fq[data-freq="off"].on{background:#8a94a3}
  .del{background:none;border:0;color:var(--faint);cursor:pointer;font-size:12.5px;font-weight:600;display:inline-flex;align-items:center;gap:5px;padding:4px 2px}
  .del:hover{color:var(--red)}.del svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8}
  @media(max-width:760px){.row{flex-direction:column;gap:14px}.rside{align-items:flex-start;width:100%}}
  .empty{text-align:center;padding:70px 20px;color:var(--sub)}
  .empty h3{font-size:20px;color:var(--ink);margin-bottom:8px}
  .empty a{color:var(--blue);font-weight:700;text-decoration:none}
  .loading{text-align:center;padding:60px;color:var(--faint)}
  .signin{text-align:center;padding:70px 20px}.signin a{color:var(--blue);font-weight:700}
  ${ACCOUNT_MENU_CSS}
</style></head><body>
<header class="zhead">
  <nav class="zh-left">
    <a href="/opportunity-map">Opportunities</a>
    <a href="/opportunity-map">Players</a>
    <a href="/app?panel=pipeline">Pursuits</a>
    <a href="/opportunity-map/unplaced" title="Unplaced — forecasts with no location to map"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.6"/></svg><span>Unplaced</span></a>
</nav>
  <a href="/app" title="Mindy" class="zh-logo"><img src="/brand/mindy-logo-icon.png" alt=""/><span>Mindy</span></a>
  <nav class="zh-right">
    <a href="/bid">Bid with confidence</a>
    <a href="/pricing">Pricing</a>
    ${ACCOUNT_MENU_HTML}
  </nav>
</header>
<nav class="zrail">
  <a href="/opportunity-map" title="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg><span>Search</span></a>
  <a class="on" href="/opportunity-map/saved" title="Updates — saved searches &amp; new matches"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Updates</span></a>
  <a href="/opportunity-map/favorites" title="Favorites — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Favorites</span></a>
</nav>
<div class="main">
<div class="wrap">
  <div class="wraphead">
    <div>
      <h1>Updates</h1>
      <div class="sub">Your saved searches. We alert you by email when new opportunities match a search with alerts on.</div>
    </div>
    <a class="newbtn" href="/opportunity-map"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>New search</a>
  </div>
  <div id="list"><div class="loading">Loading…</div></div>
</div>
</div>
<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  var t=tok(), em=email(), list=document.getElementById('list');
  function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  var SET={SDVOSB:'SDVOSB',SB:'Small Business','8A':'8(a)',WOSB:'WOSB',HZ:'HUBZone',OTHER:'Other'};
  // The saved filters as a list of readable CHIPS (Zillow shows each facet as its own pill, not one
  // run-on line). Every chip traces to a real stored filter key; empty → "All opportunities".
  function summaryChips(f){
    if(!f||typeof f!=='object')return [];
    var chips=[];
    if(f.q)chips.push('“'+f.q+'”');
    if(f.setAside)chips.push((f.setAside+'').split(',').map(function(k){return SET[k]||k;}).join(', '));
    if(f.naics)chips.push('NAICS '+f.naics);
    if(f.psc)chips.push('PSC '+f.psc);
    if(f.agency)chips.push(f.agency);
    if(f.state)chips.push(f.state);
    if(f.postedDays)chips.push('Posted ≤'+f.postedDays+'d');
    if(f.closingDays)chips.push('Closing ≤'+f.closingDays+'d');
    if(f.valueRange)chips.push('$'+f.valueRange.replace('-','–'));
    return chips;
  }
  if(!t||!em){ list.innerHTML='<div class="signin">Please <a href="/app?next=%2Fopportunity-map%2Fsaved">sign in</a> to see your saved searches.</div>'; return; }
  function hdrs(){ return {'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em}; }
  // Per-search NEW-match counts, keyed by saved-search id. Populated BEFORE render so each
  // row can show its own "N new" badge (the Zillow shape: a count per saved search).
  var NEWCOUNTS={};
  // DO NOT mark_seen here. It used to fire on page load, which folded every current match into
  // last_seen_notice_ids BEFORE anything rendered — so the red dot cleared and the page showed
  // nothing, every time (Eric, 2026-07-27; his two searches were stamped seen at 10:05:56 with
  // 137 and 226 ids the moment he opened this page). Zillow shows you WHAT'S NEW first, then
  // clears. We now mark seen only after the counts have been fetched AND rendered.

  // Rebuild the map URL for a saved search from its stored filters. The filter keys are
  // already the map's query-param names, so they pass straight through; mode selects the
  // dataset (recompete vs open). NOTE: no backticks in this file - it is a template literal.
  function mapUrl(r){
    var qs=[];
    var f=(r&&r.filters&&typeof r.filters==='object')?r.filters:{};
    Object.keys(f).forEach(function(k){
      var v=f[k]; if(v==null||v==='')return;
      qs.push(encodeURIComponent(k)+'='+encodeURIComponent(String(v)));
    });
    if(r&&r.mode==='recompete')qs.push('mode=recompete');
    return '/opportunity-map'+(qs.length?'?'+qs.join('&'):'');
  }

  function render(rows){
    if(!rows.length){ list.innerHTML='<div class="empty"><h3>No saved searches yet</h3><p>Filter the map, then hit <strong>Save search</strong> — we\\'ll alert you when new opportunities match.</p><p style="margin-top:14px"><a href="/opportunity-map">Go to the map →</a></p></div>'; return; }
    list.innerHTML=rows.map(function(r){
      var on=r.alerts_enabled!==false;
      var nc=NEWCOUNTS[r.id]||0;
      // The count IS the answer to "what changed?" — make the name a link that RE-RUNS the
      // search on the map so the user can act on it, exactly like Zillow's saved-search rows.
      // Built from the stored filters object, whose keys are already the map's own query
      // params (verified: {naics:'541512,…'} / {noticeType:'Presolicitation'}). Deliberately
      // NOT ?saved=<id> — the map has no handler for that, so it would land unfiltered.
      var href=mapUrl(r);
      // Zillow-style saved-search CARD: title link + "N new" badge · dataset + filter CHIPS ·
      // an email-frequency segmented control (Daily/Weekly/Off, wired to the real alert_frequency
      // field) · Delete. freq = off when alerts off, else the stored cadence (default daily).
      var freq=(!on)?'off':((r.alert_frequency==='weekly')?'weekly':'daily');
      var chips=summaryChips(r.filters);
      var chipHtml=(r.mode==='recompete'?'<span class="fchip fchip-mode">Recompetes</span>':'<span class="fchip fchip-mode">Open opps</span>')
        + (chips.length?chips.map(function(c){return '<span class="fchip">'+h(c)+'</span>';}).join(''):'<span class="fchip fchip-all">All opportunities</span>');
      function fbtn(val,lbl){ return '<button class="fq'+(freq===val?' on':'')+'" data-freq="'+val+'">'+lbl+'</button>'; }
      return '<div class="row'+(nc>0?' hasnew':'')+'" data-id="'+h(r.id)+'">'
        + '<div class="rmain">'
        +   '<div class="rname"><a href="'+h(href)+'">'+h(r.name)+'</a>'
        +     (nc>0?'<span class="badge" title="'+nc+' new since you last looked">'+(nc>99?'99+':nc)+' new</span>':'')+'</div>'
        +   '<div class="rchips">'+chipHtml+'</div>'
        +   '<div class="ractions"><a class="view" href="'+h(href)+'">View on map \\u2192</a>'
        // Run report → generate the whole-market report for THIS saved search. Uses the
        // its STORED FILTERS define the market — NAICS first (the reliable market key),
        // then the typed keyword (filters.q), then the name only as a last resort. The
        // name is a LABEL ("DOD IT Services") — using it as a search dragged "DOD" into
        // all-defense aircraft spend (Eric 2026-08-02). Pro-gated; opens inline.
        +     '<button class="runrpt" type="button" data-name="'+h(r.name||'')+'" data-naics="'+h((r.filters&&r.filters.naics)||'')+'" data-psc="'+h((r.filters&&r.filters.psc)||'')+'" data-keyword="'+h((r.filters&&r.filters.q)||'')+'" data-agency="'+h((r.filters&&r.filters.agency)||'')+'" data-setaside="'+h((r.filters&&r.filters.setAside)||'')+'" data-state="'+h((r.filters&&r.filters.state)||'')+'"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>Run report \\u2192</button>'
        +   '</div>'
        +   '<div class="rptbox" hidden></div>'
        + '</div>'
        + '<div class="rside">'
        +   '<div class="freqlbl">Email alerts</div>'
        +   '<div class="freq" role="group" aria-label="Email frequency">'+fbtn('daily','Daily')+fbtn('weekly','Weekly')+fbtn('off','Off')+'</div>'
        +   '<button class="del" title="Delete this saved search"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6v14a2 2 0 002 2h8a2 2 0 002-2V6"/></svg>Delete</button>'
        + '</div>'
        + '</div>';
    }).join('');
    // Wire the email-frequency segmented control + deletes.
    Array.prototype.forEach.call(list.querySelectorAll('.row'),function(row){
      var id=row.getAttribute('data-id');
      // Daily/Weekly/Off → PATCH the real fields: 'off' = alerts_enabled:false; else enabled + the
      // chosen alert_frequency ('daily'|'weekly'). Optimistic (highlight the picked button), fail-soft.
      Array.prototype.forEach.call(row.querySelectorAll('.fq'),function(b){
        b.onclick=function(){
          var v=b.getAttribute('data-freq');
          Array.prototype.forEach.call(row.querySelectorAll('.fq'),function(x){ x.classList.toggle('on', x===b); });
          var body={email:em,id:id};
          if(v==='off'){ body.alerts_enabled=false; } else { body.alerts_enabled=true; body.alert_frequency=v; }
          fetch('/api/app/saved-searches',{method:'PATCH',headers:hdrs(),body:JSON.stringify(body)}).catch(function(){});
        };
      });
      row.querySelector('.del').onclick=function(){
        if(!confirm('Delete this saved search?'))return;
        fetch('/api/app/saved-searches?email='+encodeURIComponent(em)+'&id='+encodeURIComponent(id),{method:'DELETE',headers:hdrs()})
          .then(function(){ row.remove(); if(!list.querySelector('.row'))render([]); }).catch(function(){});
      };
      // Run report → generate the whole-market report for THIS saved search, inline.
      var rb=row.querySelector('.runrpt'), box=row.querySelector('.rptbox');
      if(rb&&box)rb.onclick=function(){ runReport(rb,box); };
    });
  }

  // Generate + render a market report inline under a saved-search row. Uses the
  // search NAME as the keyword (a saved search IS a defined market), with its first
  // NAICS + state to ground. Pro-gated server-side (402 → inline upgrade). Reading a
  // generated report is free/public; generating is Pro.
  function rptEsc(x){ return h(x); }
  function runReport(btn,box){
    var name=(btn.getAttribute('data-name')||'').trim();
    var naicsRaw=(btn.getAttribute('data-naics')||'').trim();
    var psc=(btn.getAttribute('data-psc')||'').trim();
    var kw=(btn.getAttribute('data-keyword')||'').trim();
    var agency=(btn.getAttribute('data-agency')||'').trim();
    var setAside=(btn.getAttribute('data-setaside')||'').trim();
    // The report runs on ALL the filters the user saved — a faithful readout, not one
    // code picked for them (Eric 2026-08-02: "use all the filters they typed in, not
    // selecting for them"). Keep EVERY 6-digit NAICS (the union is one market); the name
    // is a LABEL, never a search term ("DOD IT Services" as text pulled all-defense aircraft).
    var naicsCodes=(naicsRaw?naicsRaw.split(','):[]).map(function(c){return c.trim();}).filter(function(c){return /^[0-9]{6}$/.test(c);});
    var naicsCsv=naicsCodes.join(',');
    var st=(btn.getAttribute('data-state')||'').trim().toUpperCase().slice(0,2);
    var subject = (naicsCodes.length===1?naicsCodes[0]:naicsCodes.length?(naicsCodes.length+' NAICS codes'):'')||(psc?('PSC '+psc):'')||kw||name||'market';
    box.hidden=false;
    box.innerHTML='<div class="top"></div><div class="in"><div class="rptrun"><div class="rptspin"></div><div>Building the '+rptEsc(subject)+' report\\u2026 <span style="color:var(--faint)">who\\u2019s buying \\u00b7 who holds it \\u00b7 recompetes \\u00b7 forecasts</span></div></div></div>';
    btn.disabled=true;
    var payload={ email:em };
    // PRIORITY: the saved NAICS SET (union) → the typed keyword (filters.q) → the name as
    // a last resort. Plus the agency + set-aside the search scoped to, so the whole report
    // is the market the user actually defined (verified: 4 NAICS + DEFENSE → IT PSC +
    // Leidos/GDIT/Accenture, DoD-only agencies; the name alone → aircraft + 0 contractors).
    // Market key: NAICS union → PSC (Cybersecurity) → keyword → name (last resort).
    if(naicsCsv){ payload.naics=naicsCsv; if(psc)payload.psc=psc; }
    else if(psc){ payload.psc=psc; }
    else if(kw){ payload.keyword=kw; }
    else if(name){ payload.keyword=name; }
    else {
      // No market key AT ALL (no NAICS, no PSC, no keyword, no name). Only THEN can't we build.
      box.innerHTML='<div class="top"></div><div class="in"><div class="rpterr">This search has no NAICS, PSC or keyword to build a market from.</div></div>';
      btn.disabled=false; return;
    }
    // Agency + set-aside are OPTIONAL scoping (a search may have neither) — never a reason
    // to bail. (Bugfix 2026-08-02: a dangling else on the set-aside check made a search
    // with no set-aside — "DOD IT Services", naics+agency only — falsely report "no NAICS".)
    if(agency)payload.agency=agency;
    if(setAside)payload.set_aside=setAside;
    if(st)payload.state=st;
    fetch('/api/app/market-report',{method:'POST',headers:hdrs(),body:JSON.stringify(payload)})
      .then(function(r){ return r.json().then(function(d){ return {status:r.status,d:d}; }); })
      .then(function(res){ btn.disabled=false;
        if(res.status===402||(res.d&&res.d.teaser)){ rptUpsell(box,res.d&&res.d.upgrade_url); return; }
        if(res.status===422||(res.d&&res.d.grounded===false)){ rptErr(box,(res.d&&res.d.error)||'No federal market found for this search.'); return; }
        if(!res.d||!res.d.success||!res.d.url){ rptErr(box,(res.d&&res.d.error)||'Report generation failed. Try again shortly.'); return; }
        rptOk(box,res.d);
      })
      .catch(function(){ btn.disabled=false; rptErr(box,'Request failed. Check your connection and try again.'); });
  }
  function closeBtn(box){ var x=box.querySelector('.x'); if(x)x.onclick=function(){ box.hidden=true; box.innerHTML=''; }; }
  function rptErr(box,msg){ box.innerHTML='<div class="top"></div><div class="in"><div class="rpthd">Market report<button class="x">\\u00d7</button></div><div class="rpterr">'+rptEsc(msg)+'</div></div>'; closeBtn(box); }
  function rptUpsell(box,url){ box.innerHTML='<div class="top" style="background:#7c5cff"></div><div class="in"><div class="rpthd">Market report<button class="x">\\u00d7</button></div><div class="rptups"><h4>\\ud83d\\udd12 Market reports are a Pro feature</h4><p>Turn this saved market into a shareable, client-ready report \\u2014 who\\u2019s buying, who holds it now, recompetes and forecasts, in one link.</p><a href="'+rptEsc(url||'/market-intelligence')+'">Upgrade to Pro</a></div></div>'; closeBtn(box); }
  function mnum(n){ n=Number(n)||0; if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B'; if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M'; if(n>=1e3)return '$'+Math.round(n/1e3)+'K'; return '$'+n; }
  function rptOk(box,d){
    var s=d.summary||{}; var sec=(d&&d.sections)||{};
    var topCo=((sec.competition&&sec.competition.contractors)||[])[0]||null;
    var topAg=((sec.top_agencies)||[])[0]||null;
    var contacts=sec.contacts||null;
    var k1 = topCo ? '<div class="c"><div class="k">Top incumbent</div><div class="v g">'+mnum(topCo.total_obligated)+'</div><div class="n">'+rptEsc((topCo.recipient_name||'').split(' ').slice(0,2).join(' '))+'</div></div>'
                   : '<div class="c"><div class="k">Buying agencies</div><div class="v">'+((s.buying_agencies)||0)+'</div><div class="n">in this market</div></div>';
    // 4th KPI: prefer "who to call" (the standout the report now answers) when we have
    // contacts, else the top buyer, else a see-report hint.
    var k4 = (contacts&&contacts.people&&contacts.people.length)
      ? '<div class="c"><div class="k">Who to call</div><div class="v">'+(s.contacts||contacts.people.length)+'</div><div class="n">'+rptEsc((contacts.agency||'').split(',')[0])+'</div></div>'
      : (topAg?('<div class="c"><div class="k">Top buyer</div><div class="v m">'+rptEsc((topAg.name||topAg.agency||'').split(',')[0])+'</div><div class="n">'+mnum(topAg.amount||topAg.total)+'</div></div>')
             :('<div class="c"><div class="k">Total market</div><div class="v m">see report</div><div class="n"></div></div>'));
    // A compact "who to call" preview: top 2 real POCs with mailto — the report's
    // highest-intent output, right in the peek.
    var contactsPeek='';
    if(contacts&&contacts.people&&contacts.people.length){
      contactsPeek='<div class="rptcontacts"><div class="h">Who to call \\u00b7 '+rptEsc((contacts.office||contacts.agency||'').split(',')[0])+'</div>'
        + contacts.people.slice(0,2).map(function(p){
            return '<div class="pc"><span class="pn">'+rptEsc(p.name)+'<span>'+rptEsc(p.role||'')+'</span></span>'
              + (p.email?'<a class="pe" href="mailto:'+rptEsc(p.email)+'">'+rptEsc(p.email)+'</a>':'')+'</div>';
          }).join('')
        + '</div>';
    }
    var deg = d.degraded ? '<div class="rptwarn">\\u26a0 One data axis came back thin for this search, so the report notes it rather than showing a fabricated number. For a precise market total, save a search by a 6-digit NAICS.</div>' : '';
    box.innerHTML='<div class="top"></div><div class="in">'
      + '<div class="rpthd">Market report \\u00b7 '+rptEsc(d.subject||'market')+'<button class="x">\\u00d7</button></div>'
      + '<div class="rptkpi">'
      +   k1
      +   '<div class="c"><div class="k">Recompetes</div><div class="v">'+((s.recompetes)||0)+'</div><div class="n">expiring primes</div></div>'
      +   '<div class="c"><div class="k">Forecasts</div><div class="v">'+((s.forecasts)||0)+'</div><div class="n">coming work</div></div>'
      +   k4
      + '</div>'
      + contactsPeek
      + '<div class="rptshare"><input readonly value="'+rptEsc(d.url)+'"><button class="cp">Copy link</button><a class="op" href="'+rptEsc(d.url)+'" target="_blank" rel="noopener">Open \\u2197</a></div>'
      + deg
      + '<p class="rptnote">The full page has top agencies, competitors, recompetes, forecasts and who to call. Reading is free \\u2014 every \\u201crespond\\u201d action on it prompts a sign-in (the share loop).</p>'
      + '</div>';
    closeBtn(box);
    var cp=box.querySelector('.cp'), inp=box.querySelector('input');
    if(cp&&inp)cp.onclick=function(){ inp.select(); try{ (navigator.clipboard&&navigator.clipboard.writeText(inp.value))||document.execCommand('copy'); cp.textContent='Copied \\u2713'; setTimeout(function(){cp.textContent='Copy link';},1600); }catch(e){} };
  }
  // Load order matters: counts FIRST (so rows can render "N new"), then the searches, then —
  // and only then — mark them seen. Marking seen before rendering is what made this page
  // always look empty while the rail still showed a red dot.
  Promise.all([
    fetch('/api/app/saved-searches?badge=1&email='+encodeURIComponent(em),{headers:hdrs()})
      .then(function(r){return r.json();}).catch(function(){return null;}),
    fetch('/api/app/saved-searches?email='+encodeURIComponent(em),{headers:hdrs()})
      .then(function(r){return r.json();})
  ]).then(function(res){
    var b=res[0], d=res[1];
    if(b&&b.success&&b.perSearch&&b.perSearch.length){
      b.perSearch.forEach(function(p){ if(p&&p.id)NEWCOUNTS[p.id]=p.count||0; });
    }
    render((d&&d.searches)||[]);
    // Now that the user has actually SEEN the counts, fold current matches into last_seen so
    // the rail badge clears — same contract as Zillow's Updates resetting once viewed.
    fetch('/api/app/saved-searches',{method:'POST',headers:hdrs(),body:JSON.stringify({email:em,action:'mark_seen'})}).catch(function(){});
  }).catch(function(){ list.innerHTML='<div class="empty"><h3>Couldn\\'t load</h3><p>Please refresh.</p></div>'; });
})();
</script>
${ACCOUNT_MENU_JS}
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
