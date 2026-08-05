/**
 * GET /opportunity-map/favorites — the Favorites page (Zillow's "Favorites").
 *
 * Lists the signed-in user's SAVED OPPORTUNITIES (the ones hearted on the map popup),
 * distinct from Saved Searches (which is the "Updates" page). Each row: title · agency ·
 * deadline · an ♥ un-favorite button · a link that reopens the opp on the map.
 * Data via GET /api/opportunities/save?email= (MI-token authed, read client-side from
 * localStorage — same auth pattern as the map). Un-favorite = DELETE the same endpoint.
 *
 * Chrome: this page lives inside the SAME app shell as /opportunity-map — the top nav
 * (Open · Past · Contacts · Bid with confidence · Pricing · My Pursuits) AND the left rail
 * (Search · Updates · Favorites, with Favorites active) — so it's visually consistent with
 * the map (like Zillow keeping its chrome on the Favorites page). The nav header + rail
 * markup/CSS MIRROR opportunity-map/route.ts (ZHEAD_HTML / ZRAIL_HTML) — keep them in sync.
 */
import { NextResponse } from 'next/server';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../account-menu';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Saved — Mindy</title>
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
  /* Defensive: any icon in the top nav is line-art, never a filled black blob (a rail-style SVG
     without this rendered as a solid black shape colliding with the logo — Eric 2026-08-02). */
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
  .wrap{max-width:920px;margin:0 auto;padding:30px 24px 64px}
  h1{font-size:32px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px}
  .count{color:var(--sub);font-size:15px;margin-bottom:16px}
  /* ── Control bar (Zillow's "104 favorites · 10 for sale…" row + Showing/Sort dropdowns) ── */
  .ctlbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
    border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin-bottom:22px;background:#fff}
  .ctl-l{min-width:0}
  .ctl-count{font:800 18px Inter,sans-serif;letter-spacing:-.01em;color:var(--ink)}
  .ctl-break{font-size:13px;color:var(--sub);margin-top:2px}
  .ctl-r{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .fsel{position:relative}
  .fsel-btn{display:inline-flex;align-items:center;gap:8px;font:700 14px Inter,sans-serif;color:var(--blue);
    background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:9px 14px;cursor:pointer;white-space:nowrap}
  .fsel-btn:hover{background:#f5f9ff;border-color:var(--blue)}
  .fsel-btn svg{width:11px;height:7px;stroke:currentColor;stroke-width:1.8;fill:none;stroke-linecap:round}
  .fmenu{position:absolute;top:calc(100% + 6px);right:0;min-width:210px;background:#fff;border:1px solid var(--line);
    border-radius:12px;box-shadow:0 12px 28px -8px rgba(16,24,40,.22);padding:6px;z-index:20;display:none}
  .fmenu.show{display:block}
  .fitem{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:none;
    font:500 14px Inter,sans-serif;color:var(--ink);padding:9px 12px;border-radius:8px;cursor:pointer}
  .fitem:hover{background:#f0f6ff}
  .fitem.on{color:var(--blue);font-weight:700}
  .fitem .fchk{width:16px;flex:0 0 16px;visibility:hidden}.fitem.on .fchk{visibility:visible}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
  .card{position:relative;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:14px;padding:18px 18px 16px;background:#fff;transition:box-shadow .16s,border-color .16s,transform .16s;text-decoration:none;color:inherit}
  .card:hover{box-shadow:0 10px 26px -12px rgba(16,24,40,.22);border-color:#c7d2e0;transform:translateY(-2px)}
  .ctop{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-right:44px}
  .chip{display:inline-flex;align-items:center;font:600 11.5px Inter,sans-serif;letter-spacing:.01em;color:#1e3a8a;background:#eef3ff;border:1px solid #dbe6ff;border-radius:999px;padding:4px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .chip.open{color:var(--green);background:#eafaf2;border-color:#c9efdd}
  .chip.unk{color:var(--faint);background:var(--wash);border-color:var(--line)}
  .pill{display:inline-flex;align-items:center;gap:4px;font:700 11.5px Inter,sans-serif;color:#fff;background:var(--red);border-radius:999px;padding:4px 10px;white-space:nowrap;margin-left:auto}
  .pill.closed{background:#9aa5b3}
  .cprice{font-weight:800;font-size:23px;letter-spacing:-.02em;color:var(--ink);line-height:1.1;margin-bottom:6px}
  .cprice-tag{font-weight:600;font-size:11.5px;color:var(--faint);letter-spacing:0;text-transform:uppercase}
  .cname{font-weight:600;font-size:14.5px;line-height:1.34;color:var(--sub);margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .cname.asHead{font-weight:700;font-size:16px;color:var(--ink)}
  .cname.cmono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px}
  .cfacts{font-size:12.5px;color:var(--sub);line-height:1.4;margin-bottom:6px}
  .cagency{font-size:13px;color:var(--sub);line-height:1.4;margin-bottom:auto}
  .cnote{font-size:12px;color:var(--faint);line-height:1.4;margin-top:4px;font-style:italic}
  .cmeta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:12px;font-size:12.5px;color:var(--faint)}
  .cmeta b{color:var(--sub);font-weight:600}
  .heart{position:absolute;top:14px;right:14px;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:#fff;cursor:pointer;display:grid;place-items:center;z-index:2;transition:background .15s,border-color .15s}
  .heart svg{width:18px;height:18px;fill:var(--red);stroke:var(--red);stroke-width:2}
  .heart:hover{background:#fff5f5;border-color:#f5c2c2}
  .empty{text-align:center;padding:60px 20px;color:var(--sub)}
  .empty h3{font-size:19px;color:var(--ink);margin-bottom:8px}
  .empty a{color:var(--blue);font-weight:600;text-decoration:none}
  .signin{padding:40px 20px;text-align:center;color:var(--sub)}
  .signin a{color:var(--blue);font-weight:600;text-decoration:none}
  ${ACCOUNT_MENU_CSS}
</style></head><body>
<header class="zhead">
  <nav class="zh-left">
    <a href="/opportunity-map">Opportunities</a>
    <a href="/opportunity-map">Players</a>
    <a href="/app?panel=pipeline">Pursuits</a>
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
  <a href="/opportunity-map/saved" title="Watchlist — saved searches &amp; new matches"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Watchlist</span><b class="railbadge" id="savedBadge" hidden></b></a>
  <a class="on" href="/opportunity-map/favorites" title="Saved — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Saved</span></a>
  <a href="/opportunity-map/pursuits" title="Pursuits — opportunities you are actively working"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Pursuits</span></a>
  <a href="/opportunity-map/reports" title="Reports — market intelligence"><svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/></svg><span>Reports</span></a>
</nav>
<div class="main">
<div class="wrap">
  <h1>Saved</h1>
  <!-- Zillow-parity control bar: count + status breakdown (left) · Showing/Sort dropdowns (right).
       Hidden until there's ≥1 favorite (empty/sign-in states show nothing here). -->
  <div class="ctlbar" id="ctlbar" hidden>
    <div class="ctl-l">
      <div class="ctl-count" id="ctlCount"></div>
      <div class="ctl-break" id="ctlBreak"></div>
    </div>
    <div class="ctl-r">
      <div class="fsel" id="filWrap">
        <button class="fsel-btn" id="filBtn" type="button"><span id="filLabel">Showing all</span>
          <svg viewBox="0 0 11 7"><path d="M1 1l4.5 4.5L10 1"/></svg></button>
        <div class="fmenu" id="filMenu"></div>
      </div>
      <div class="fsel" id="srtWrap">
        <button class="fsel-btn" id="srtBtn" type="button"><span id="srtLabel">Date added</span>
          <svg viewBox="0 0 11 7"><path d="M1 1l4.5 4.5L10 1"/></svg></button>
        <div class="fmenu" id="srtMenu"></div>
      </div>
    </div>
  </div>
  <div id="list"><div class="signin">Loading\\u2026</div></div>
</div>
</div>
<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  var t=tok(), em=email(), list=document.getElementById('list'), countEl=document.getElementById('count');
  function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function longDate(d){ if(!d)return ''; try{ return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }catch(e){return '';} }
  function daysLeft(d){ if(!d)return null; return Math.ceil((new Date(d)-new Date())/86400000); }
  if(!t||!em){ list.innerHTML='<div class="signin">Please <a href="/app?next=%2Fopportunity-map%2Ffavorites">sign in</a> to see your favorites.</div>'; return; }
  function hdrs(){ return {'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em}; }
  function setAside(r){
    // Prefer the human-readable description; fall back to the code, then legacy snapshot.
    var s=r.set_aside_description||r.set_aside_code||r.set_aside||r.setAside||''; s=String(s||'').trim();
    // Trim the FAR citation noise so the chip stays short ("Total Small Business Set-Aside").
    s=s.replace(/\\s*\\(FAR[^)]*\\)\\s*$/i,'').trim();
    return s;
  }
  function fmtM(n){ n=Number(n); if(!isFinite(n)||n<=0)return ''; return n>=1e9?('$'+(n/1e9).toFixed(1).replace(/\\.0$/,'')+'B'):n>=1e6?('$'+(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M'):n>=1e3?('$'+Math.round(n/1e3)+'K'):('$'+Math.round(n)); }
  function valueRange(r){
    var vr=r.intel_value_range; if(!vr||typeof vr!=='object')return '';
    var lo=fmtM(vr.low), hi=fmtM(vr.high);
    if(lo&&hi)return lo+'\\u2013'+hi;
    return fmtM(vr.median)||lo||hi||'';
  }
  // A saved row can fail to hydrate against sam_opportunities (archived / purged / not found),
  // and the persisted snapshot title can literally be 'Unknown Opportunity' (saved with no data).
  // NEVER render a blank "Unknown Opportunity" card — treat these titles as absent so the card
  // degrades to the solicitation # / notice_id + a subtle "details unavailable" note.
  function realTitle(r){
    var s=String(r.title||'').trim();
    if(!s) return '';
    if(/^unknown opportunity$/i.test(s)) return '';
    return s;
  }
  // Raw favorites + the current filter/sort state drive a derived VIEW that render() paints.
  var ALL=[], FILTER='all', SORT='added';
  function dl_(r){ return daysLeft(r.response_deadline); }
  function statusOf(r){ var d=dl_(r); if(d==null)return 'open'; if(d<0)return 'closed'; if(d<=7)return 'soon'; return 'open'; }
  function valOf(r){ var vr=r.intel_value_range; if(vr&&typeof vr==='object'){ var v=Number(vr.median||vr.high||vr.low); if(isFinite(v))return v; } return 0; }
  function applyView(){
    var rows=ALL.filter(function(r){
      if(FILTER==='all')return true;
      if(FILTER==='open')return statusOf(r)==='open'||statusOf(r)==='soon';
      if(FILTER==='soon')return statusOf(r)==='soon';
      if(FILTER==='closed')return statusOf(r)==='closed';
      return true;
    });
    rows.sort(function(a,b){
      if(SORT==='deadline'){ var da=dl_(a), db=dl_(b); // soonest real deadline first; undated last
        if(da==null&&db==null)return 0; if(da==null)return 1; if(db==null)return -1; return da-db; }
      if(SORT==='value')return valOf(b)-valOf(a); // biggest M-Estimate first
      return 0; // 'added' — ALL already arrives newest-saved-first from the API
    });
    render(rows);
  }
  // Build the count + status breakdown + the two dropdown menus from the full set (never the filtered
  // view, so the breakdown always reflects the true totals — like Zillow's "104 favorites · 10 for sale").
  function buildControls(){
    var bar=document.getElementById('ctlbar'); if(!bar)return;
    if(!ALL.length){ bar.hidden=true; return; } bar.hidden=false;
    var nOpen=0,nSoon=0,nClosed=0; ALL.forEach(function(r){ var s=statusOf(r); if(s==='soon'){nSoon++;nOpen++;} else if(s==='closed'){nClosed++;} else {nOpen++;} });
    document.getElementById('ctlCount').textContent=ALL.length+' favorite'+(ALL.length===1?'':'s');
    var parts=[]; if(nOpen)parts.push(nOpen+' open'); if(nSoon)parts.push(nSoon+' closing soon'); if(nClosed)parts.push(nClosed+' closed');
    document.getElementById('ctlBreak').textContent=parts.join(' \\u00b7 ');
    // Filter menu — only offer buckets that actually have rows (no dead options).
    var fopts=[['all','Showing all',ALL.length]];
    if(nOpen)fopts.push(['open','Open only',nOpen]);
    if(nSoon)fopts.push(['soon','Closing soon (\\u22647 days)',nSoon]);
    if(nClosed)fopts.push(['closed','Closed',nClosed]);
    menuHTML('filMenu',fopts,FILTER);
    var sopts=[['added','Date added',0],['deadline','Deadline (soonest)',0],['value','Value (high to low)',0]];
    menuHTML('srtMenu',sopts,SORT);
  }
  function menuHTML(id,opts,cur){
    var m=document.getElementById(id); if(!m)return;
    m.innerHTML=opts.map(function(o){ return '<button class="fitem'+(o[0]===cur?' on':'')+'" data-v="'+o[0]+'">'
      + '<svg class="fchk" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="#006aff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>'
      + '<span>'+h(o[1])+(o[2]?' <span style="color:#9aa5b3;font-weight:500">('+o[2]+')</span>':'')+'</span></button>'; }).join('');
  }
  function wireMenu(btnId,menuId,labelId,onPick,labelFor){
    var btn=document.getElementById(btnId), menu=document.getElementById(menuId), lbl=document.getElementById(labelId);
    if(!btn||!menu)return;
    btn.onclick=function(e){ e.stopPropagation(); var open=!menu.classList.contains('show');
      document.querySelectorAll('.fmenu').forEach(function(x){x.classList.remove('show');}); menu.classList.toggle('show',open); };
    menu.onclick=function(e){ var it=e.target.closest('.fitem'); if(!it)return; var v=it.getAttribute('data-v');
      onPick(v); if(lbl)lbl.textContent=labelFor(v); menu.classList.remove('show'); };
  }
  document.addEventListener('click',function(){ document.querySelectorAll('.fmenu').forEach(function(x){x.classList.remove('show');}); });
  wireMenu('filBtn','filMenu','filLabel',function(v){ FILTER=v; buildControls(); applyView(); },
    function(v){ return v==='all'?'Showing all':v==='open'?'Open only':v==='soon'?'Closing soon':'Closed'; });
  wireMenu('srtBtn','srtMenu','srtLabel',function(v){ SORT=v; buildControls(); applyView(); },
    function(v){ return v==='deadline'?'Deadline (soonest)':v==='value'?'Value (high to low)':'Date added'; });
  function render(rows){
    if(countEl){ countEl.textContent=''; } // the count now lives in the control bar
    if(!ALL.length){ var bar0=document.getElementById('ctlbar'); if(bar0)bar0.hidden=true;
      list.innerHTML='<div class="empty"><h3>No favorites yet</h3><p>Click the <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg> heart on any opportunity on the map to save it here.</p><p style="margin-top:14px"><a href="/opportunity-map">Go to the map \\u2192</a></p></div>'; return; }
    if(!rows.length){ list.innerHTML='<div class="empty"><h3>Nothing matches this filter</h3><p>Try \\u201cShowing all\\u201d to see every favorite.</p></div>'; return; }
    list.innerHTML='<div class="grid">'+rows.map(function(r){
      var nid=r.notice_id||r.id||''; var due=r.response_deadline; var dl=daysLeft(due);
      var open=dl==null||dl>=0;
      var pillTxt=due?(open?((dl!=null&&dl<=7?'\\ud83d\\udd25 ':'')+dl+' day'+(dl===1?'':'s')+' left'):'Closed'):'';
      var pill=pillTxt?('<span class="pill'+(open?'':' closed')+'">'+h(pillTxt)+'</span>'):'';
      var naics=r.naics_code||r.naics||'';
      var sa=setAside(r);
      var nt=String(r.notice_type||'').trim();
      var title=realTitle(r);
      var vr=valueRange(r);
      // A row with no live title AND no facts to show is a "details unavailable" degrade — the
      // saved notice is gone from the cache (archived/purged). We still show the reference # so
      // the card is a real, clickable receipt, never a blank "Unknown Opportunity" (Eric).
      var solRef=String(r.solicitation_number||nid||'').trim();
      var unavailable=!title && !vr;
      var chip=unavailable?'<span class="chip unk">Saved</span>':'<span class="chip open">Open</span>';
      // Headline = the M-Estimate(TM) value range (Zillow's big price), else the title. Branded +
      // superscript TM so this never reads as an official/government figure ([[mwin_score_naming]]
      // — same "render as a NAME, it's ours" principle as M-Win). Compact form on this small card;
      // the full chart + disclosure lives in the map drawer.
      var headline=vr?('<div class="cprice">'+h(vr)+' <span class="cprice-tag">M-Estimate<sup>\\u2122</sup></span></div>'):'';
      // If we used the value as headline, the title is the sub-line; else the title IS the headline.
      // With NO real title, fall back to the reference # as the headline so the card is never blank.
      var titleLine=title
        ? ('<div class="cname'+(vr?'':' asHead')+'">'+h(title)+'</div>')
        : (solRef?('<div class="cname asHead cmono">'+h(solRef)+'</div>'):'');
      // Sub-facts line (Zillow's "4 bds · 3 ba · 1,100 sqft") — dot-joined, empties omitted.
      var facts=[]; if(naics)facts.push('NAICS '+h(naics)); if(sa)facts.push(h(sa)); if(nt)facts.push(h(nt));
      var factsLine=facts.length?('<div class="cfacts">'+facts.join(' \\u00b7 ')+'</div>'):'';
      // Meta line (Zillow's address/MLS) — agency + due date.
      var meta=[]; if(r.agency)meta.push(h(r.agency)); if(due)meta.push('Due '+h(longDate(due)));
      var metaLine=meta.length?('<div class="cagency">'+meta.join(' \\u00b7 ')+'</div>'):'';
      // Honest degrade note when the notice no longer hydrates (archived / removed from SAM cache).
      var noteLine=unavailable?('<div class="cnote">Details unavailable \\u2014 this notice may have been archived or removed.</div>'):'';
      return '<a class="card" href="/opportunity-map?opp='+encodeURIComponent(nid)+'" data-nid="'+h(nid)+'">'
        + '<button class="heart" title="Remove from Favorites" onclick="event.preventDefault();event.stopPropagation();unfav(this)"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg></button>'
        + '<div class="ctop">'+chip+pill+'</div>'
        + headline
        + titleLine
        + factsLine
        + metaLine
        + noteLine
        + '</a>';
    }).join('')+'</div>';
  }
  window.unfav=function(btn){
    var card=btn.closest('.card'); var nid=card&&card.getAttribute('data-nid'); if(!nid)return;
    card.style.opacity='.4';
    fetch('/api/opportunities/save',{method:'DELETE',headers:hdrs(),body:JSON.stringify({email:em,noticeId:nid})})
      .then(function(){ // drop it from the source set, then rebuild the controls + view (keeps the
        // breakdown counts + filter menu honest, not just the DOM node removed).
        ALL=ALL.filter(function(r){ return String(r.notice_id||r.id||'')!==String(nid); });
        buildControls(); applyView(); })
      .catch(function(){ card.style.opacity='1'; });
  };
  fetch('/api/opportunities/save?email='+encodeURIComponent(em),{headers:hdrs()})
    .then(function(r){return r.json();}).then(function(d){ ALL=(d&&d.opportunities)||[]; buildControls(); applyView(); })
    .catch(function(){ list.innerHTML='<div class="signin">Couldn\\u2019t load your favorites. Try again shortly.</div>'; });
  // Updates count on THIS page's rail. The #savedBadge element existed here but nothing ever
  // populated it — only the map (route.ts) had this fetch — so the Updates icon on Favorites
  // never showed a count even when there were new matches (Eric, 2026-07-27).
  fetch('/api/app/saved-searches?badge=1&email='+encodeURIComponent(em),{headers:hdrs()})
    .then(function(r){return r.json();}).then(function(d){
      var n=(d&&d.success&&d.count)?d.count:0; var b=document.getElementById('savedBadge');
      if(b){ if(n>0){ b.textContent=n>99?'99+':String(n); b.hidden=false; } else { b.hidden=true; } }
    }).catch(function(){});
})();
</script>
${ACCOUNT_MENU_JS}
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
