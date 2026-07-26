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
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
  .card{position:relative;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:14px;padding:18px 18px 16px;background:#fff;transition:box-shadow .16s,border-color .16s,transform .16s;text-decoration:none;color:inherit}
  .card:hover{box-shadow:0 10px 26px -12px rgba(16,24,40,.22);border-color:#c7d2e0;transform:translateY(-2px)}
  .ctop{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-right:44px}
  .chip{display:inline-flex;align-items:center;font:600 11.5px Inter,sans-serif;letter-spacing:.01em;color:#1e3a8a;background:#eef3ff;border:1px solid #dbe6ff;border-radius:999px;padding:4px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .chip.open{color:var(--green);background:#eafaf2;border-color:#c9efdd}
  .pill{display:inline-flex;align-items:center;gap:4px;font:700 11.5px Inter,sans-serif;color:#fff;background:var(--red);border-radius:999px;padding:4px 10px;white-space:nowrap;margin-left:auto}
  .pill.closed{background:#9aa5b3}
  .cname{font-weight:700;font-size:16px;line-height:1.32;color:var(--ink);margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .cagency{font-size:13.5px;color:var(--sub);line-height:1.35;margin-bottom:auto}
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
  function setAside(r){
    var s=r.set_aside||r.set_aside_code||r.setAside||''; s=String(s||'').trim();
    return s?s:'';
  }
  function render(rows){
    if(!rows.length){ list.innerHTML='<div class="empty"><h3>No favorites yet</h3><p>Click the \\u2661 heart on any opportunity on the map to save it here.</p><p style="margin-top:14px"><a href="/opportunity-map">Go to the map \\u2192</a></p></div>'; return; }
    list.innerHTML='<div class="grid">'+rows.map(function(r){
      var nid=r.notice_id||r.id||''; var due=r.response_deadline; var dl=daysLeft(due);
      var open=dl==null||dl>=0;
      var pillTxt=due?(open?((dl!=null&&dl<=7?'\\ud83d\\udd25 ':'')+dl+' day'+(dl===1?'':'s')+' left'):'Closed'):'';
      var sa=setAside(r);
      var chip=sa?('<span class="chip">'+h(sa)+'</span>'):'<span class="chip open">Open</span>';
      var pill=pillTxt?('<span class="pill'+(open?'':' closed')+'">'+h(pillTxt)+'</span>'):'';
      var naics=r.naics_code||r.naics||'';
      return '<a class="card" href="/opportunity-map?opp='+encodeURIComponent(nid)+'" data-nid="'+h(nid)+'">'
        + '<button class="heart" title="Remove from Favorites" onclick="event.preventDefault();event.stopPropagation();unfav(this)"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg></button>'
        + '<div class="ctop">'+chip+pill+'</div>'
        + '<div class="cname">'+h(r.title||'Opportunity')+'</div>'
        + '<div class="cagency">'+h(r.agency||'')+'</div>'
        + '<div class="cmeta">'+(naics?'<span><b>NAICS</b> '+h(naics)+'</span>':'')+(due?'<span><b>Due</b> '+h(longDate(due))+'</span>':'')+'</div>'
        + '</a>';
    }).join('')+'</div>';
  }
  window.unfav=function(btn){
    var card=btn.closest('.card'); var nid=card&&card.getAttribute('data-nid'); if(!nid)return;
    card.style.opacity='.4';
    fetch('/api/opportunities/save',{method:'DELETE',headers:hdrs(),body:JSON.stringify({email:em,noticeId:nid})})
      .then(function(){ card.remove(); if(!list.querySelector('.card'))render([]); })
      .catch(function(){ card.style.opacity='1'; });
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
