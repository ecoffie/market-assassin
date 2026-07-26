/**
 * GET /opportunity-map/favorites — the Favorites page (Zillow's "Favorites").
 *
 * Lists the signed-in user's SAVED OPPORTUNITIES (the ones hearted on the map popup),
 * distinct from Saved Searches (which is the "Updates" page). Each row: title · agency ·
 * deadline · an ♥ un-favorite button · a link that reopens the opp on the map.
 * Data via GET /api/opportunities/save?email= (MI-token authed, read client-side from
 * localStorage — same auth pattern as the map). Un-favorite = DELETE the same endpoint.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Favorites — Mindy</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#006aff;--green:#22a06b;--red:#e5484d}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased}
  .top{display:flex;align-items:center;justify-content:space-between;padding:16px 28px;border-bottom:1px solid var(--line)}
  .brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:20px;letter-spacing:-.02em;color:var(--ink);text-decoration:none}
  .brand img{height:24px;width:auto}
  .newbtn{display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:14.5px;color:#fff;background:var(--blue);border:0;border-radius:8px;padding:10px 16px;text-decoration:none}
  .newbtn:hover{filter:brightness(.94)}
  .tabs{display:flex;gap:26px;max-width:920px;margin:0 auto;padding:0 24px;border-bottom:1px solid var(--line)}
  .tabs a{font:700 15px Inter,sans-serif;color:var(--sub);text-decoration:none;padding:16px 2px;border-bottom:2.5px solid transparent;margin-bottom:-1px}
  .tabs a:hover{color:var(--ink)}
  .tabs a.on{color:var(--blue);border-bottom-color:var(--blue)}
  .wrap{max-width:920px;margin:0 auto;padding:30px 24px 64px}
  h1{font-size:32px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px}
  .sub{color:var(--sub);font-size:15px;margin-bottom:26px}
  .row{display:flex;align-items:center;gap:16px;border:1px solid var(--line);border-radius:12px;padding:17px 20px;margin-bottom:12px;transition:box-shadow .15s;text-decoration:none;color:inherit}
  .row:hover{box-shadow:0 6px 18px -8px rgba(16,24,40,.16);border-color:#c7d2e0}
  .rmain{flex:1;min-width:0}
  .rname{font-weight:700;font-size:16px;color:var(--ink);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rmeta{font-size:13.5px;color:var(--sub)}
  .rdue{font:600 13px Inter,sans-serif;color:var(--sub);white-space:nowrap;flex:none}
  .rdue.soon{color:var(--red)}
  .unfav{flex:none;width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:#fff;cursor:pointer;display:grid;place-items:center}
  .unfav svg{width:19px;height:19px;fill:var(--red);stroke:var(--red);stroke-width:2}
  .unfav:hover{background:#fff5f5;border-color:#f5c2c2}
  .empty{text-align:center;padding:60px 20px;color:var(--sub)}
  .empty h3{font-size:19px;color:var(--ink);margin-bottom:8px}
  .empty a{color:var(--blue);font-weight:600;text-decoration:none}
  .signin{padding:40px 20px;text-align:center;color:var(--sub)}
  .signin a{color:var(--blue);font-weight:600;text-decoration:none}
</style></head><body>
<header class="top">
  <a class="brand" href="/app"><img src="/brand/mindy-logo-icon.png" alt="">Mindy</a>
  <a class="newbtn" href="/opportunity-map">← Back to the map</a>
</header>
<nav class="tabs">
  <a href="/opportunity-map/saved">Updates</a>
  <a class="on">Favorites</a>
</nav>
<div class="wrap">
  <h1>Favorites</h1>
  <div class="sub">Opportunities you've hearted on the map. Distinct from your saved searches (Updates).</div>
  <div id="list"><div class="signin">Loading\\u2026</div></div>
</div>
<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  var t=tok(), em=email(), list=document.getElementById('list');
  function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function longDate(d){ if(!d)return ''; try{ return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }catch(e){return '';} }
  function daysLeft(d){ if(!d)return null; return Math.ceil((new Date(d)-new Date())/86400000); }
  if(!t||!em){ list.innerHTML='<div class="signin">Please <a href="/app?next=%2Fopportunity-map%2Ffavorites">sign in</a> to see your favorites.</div>'; return; }
  function hdrs(){ return {'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em}; }
  function render(rows){
    if(!rows.length){ list.innerHTML='<div class="empty"><h3>No favorites yet</h3><p>Click the \\u2661 heart on any opportunity on the map to save it here.</p><p style="margin-top:14px"><a href="/opportunity-map">Go to the map \\u2192</a></p></div>'; return; }
    list.innerHTML=rows.map(function(r){
      var nid=r.notice_id||r.id||''; var due=r.response_deadline; var dl=daysLeft(due);
      var dueTxt=due?(dl!=null&&dl>=0?(dl+' day'+(dl===1?'':'s')+' left'):'Closed'):'';
      return '<a class="row" href="/opportunity-map?opp='+encodeURIComponent(nid)+'" data-nid="'+h(nid)+'">'
        + '<div class="rmain"><div class="rname">'+h(r.title||'Opportunity')+'</div>'
        + '<div class="rmeta">'+h(r.agency||'')+(due?' \\u00b7 due '+h(longDate(due)):'')+'</div></div>'
        + (dueTxt?'<div class="rdue'+(dl!=null&&dl<=7?' soon':'')+'">'+h(dueTxt)+'</div>':'')
        + '<button class="unfav" title="Remove from Favorites" onclick="event.preventDefault();event.stopPropagation();unfav(this)"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg></button>'
        + '</a>';
    }).join('');
  }
  window.unfav=function(btn){
    var row=btn.closest('.row'); var nid=row&&row.getAttribute('data-nid'); if(!nid)return;
    row.style.opacity='.4';
    fetch('/api/opportunities/save',{method:'DELETE',headers:hdrs(),body:JSON.stringify({email:em,noticeId:nid})})
      .then(function(){ row.remove(); if(!list.querySelector('.row'))render([]); })
      .catch(function(){ row.style.opacity='1'; });
  };
  fetch('/api/opportunities/save?email='+encodeURIComponent(em),{headers:hdrs()})
    .then(function(r){return r.json();}).then(function(d){ render((d&&d.opportunities)||[]); })
    .catch(function(){ list.innerHTML='<div class="signin">Couldn\\u2019t load your favorites. Try again shortly.</div>'; });
})();
</script>
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
