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
<title>Favorites — Mindy</title>
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
  .railbadge{position:absolute;top:3px;right:9px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;
    background:#d92d20;color:#fff;font:700 10px Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
    box-shadow:0 0 0 2px #fff;line-height:1}
  /* content area sits right of the 64px rail */
  .main{margin-left:64px}
  .wrap{max-width:920px;margin:0 auto;padding:30px 24px 64px}
  h1{font-size:32px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px}
  .count{color:var(--sub);font-size:15px;margin-bottom:26px}
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
    <a href="/opportunity-map">Open</a>
    <a href="/opportunity-map">Past</a>
    <a href="/opportunity-map">Contacts</a>
    <a href="/bid">Bid with confidence</a>
  </nav>
  <a href="/app" title="Mindy" class="zh-logo"><img src="/brand/mindy-logo-icon.png" alt=""/><span>Mindy</span></a>
  <nav class="zh-right">
    <a href="/pricing">Pricing</a>
    <a href="/app?panel=pursuits">My Pursuits</a>
    ${ACCOUNT_MENU_HTML}
  </nav>
</header>
<nav class="zrail">
  <a href="/opportunity-map" title="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg><span>Search</span></a>
  <a href="/opportunity-map/saved" title="Updates — saved searches &amp; new matches"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Updates</span><b class="railbadge" id="savedBadge" hidden></b></a>
  <a class="on" href="/opportunity-map/favorites" title="Favorites — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Favorites</span></a>
</nav>
<div class="main">
<div class="wrap">
  <h1>Favorites</h1>
  <div class="count" id="count"></div>
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
  function render(rows){
    if(countEl){ countEl.textContent=rows.length?(rows.length+' favorite'+(rows.length===1?'':'s')):''; }
    if(!rows.length){ list.innerHTML='<div class="empty"><h3>No favorites yet</h3><p>Click the \\u2661 heart on any opportunity on the map to save it here.</p><p style="margin-top:14px"><a href="/opportunity-map">Go to the map \\u2192</a></p></div>'; return; }
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
      .then(function(){ card.remove(); var n=list.querySelectorAll('.card').length; if(!n){ render([]); } else if(countEl){ countEl.textContent=n+' favorite'+(n===1?'':'s'); } })
      .catch(function(){ card.style.opacity='1'; });
  };
  fetch('/api/opportunities/save?email='+encodeURIComponent(em),{headers:hdrs()})
    .then(function(r){return r.json();}).then(function(d){ render((d&&d.opportunities)||[]); })
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
