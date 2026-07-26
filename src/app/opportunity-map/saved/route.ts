/**
 * GET /opportunity-map/saved — the Saved Searches manager (Zillow's "Updates" page).
 *
 * Lists the signed-in user's saved searches with: name, mode, a summary of the saved
 * filters, an Alerts ON/OFF toggle (PATCH alerts_enabled), and Delete. "New search"
 * links back to the map. All data via /api/app/saved-searches (MI-token authed,
 * read client-side from localStorage — same as the map).
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Saved Searches — Mindy</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#006aff;--green:#22a06b;--red:#e5484d}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased}
  .top{display:flex;align-items:center;justify-content:space-between;padding:16px 28px;border-bottom:1px solid var(--line)}
  .brand{display:flex;align-items:center;gap:9px;font-family:"Space Grotesk",sans-serif;font-weight:700;font-size:22px;color:var(--ink);text-decoration:none}
  .brand img{width:26px;height:26px}
  .newbtn{display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:14.5px;color:#fff;background:var(--blue);border:0;border-radius:8px;padding:10px 16px;text-decoration:none}
  .newbtn:hover{filter:brightness(.94)}
  .wrap{max-width:920px;margin:0 auto;padding:32px 24px 64px}
  h1{font-family:"Space Grotesk",sans-serif;font-size:34px;font-weight:700;margin-bottom:6px}
  .sub{color:var(--sub);font-size:15px;margin-bottom:26px}
  .row{display:flex;align-items:center;gap:16px;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:12px;transition:box-shadow .15s}
  .row:hover{box-shadow:0 2px 12px rgba(16,24,40,.06)}
  .rmain{flex:1;min-width:0}
  .rname{font-size:16.5px;font-weight:700;color:var(--ink);margin-bottom:3px}
  .rmeta{font-size:13px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rmeta .chip{display:inline-block;background:var(--hair);color:var(--sub);border-radius:6px;padding:2px 8px;margin-right:6px;font-weight:600;font-size:11.5px}
  .badge{background:var(--red);color:#fff;font-weight:700;font-size:12px;border-radius:20px;padding:2px 9px;margin-left:8px;vertical-align:middle}
  .toggle{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--sub);cursor:pointer;user-select:none;white-space:nowrap}
  .sw{width:38px;height:22px;border-radius:22px;background:#cfd6de;position:relative;transition:background .18s;flex:none}
  .sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .18s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
  .toggle.on .sw{background:var(--green)}.toggle.on .sw::after{transform:translateX(16px)}
  .toggle.on{color:var(--green)}
  .del{background:none;border:0;color:var(--sub);cursor:pointer;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:5px;padding:6px}
  .del:hover{color:var(--red)}.del svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8}
  .empty{text-align:center;padding:70px 20px;color:var(--sub)}
  .empty h3{font-size:20px;color:var(--ink);margin-bottom:8px}
  .empty a{color:var(--blue);font-weight:700;text-decoration:none}
  .loading{text-align:center;padding:60px;color:var(--faint)}
  .signin{text-align:center;padding:70px 20px}.signin a{color:var(--blue);font-weight:700}
</style>
<style>
  .tabs{display:flex;gap:26px;max-width:920px;margin:0 auto;padding:0 24px;border-bottom:1px solid var(--line)}
  .tabs a{font:700 15px Inter,sans-serif;color:var(--sub);text-decoration:none;padding:16px 2px;border-bottom:2.5px solid transparent;margin-bottom:-1px}
  .tabs a:hover{color:var(--ink)}.tabs a.on{color:var(--blue);border-bottom-color:var(--blue)}
</style></head><body>
<div class="top">
  <a class="brand" href="/app"><img src="/brand/mindy-logo-icon.png" alt="">Mindy</a>
  <a class="newbtn" href="/opportunity-map"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>New search</a>
</div>
<nav class="tabs">
  <a class="on" href="/opportunity-map/saved">Updates</a>
  <a href="/opportunity-map/favorites">Favorites</a>
</nav>
<div class="wrap">
  <h1>Updates</h1>
  <div class="sub">Your saved searches. We alert you by email when new opportunities match a search with alerts on.</div>
  <div id="list"><div class="loading">Loading…</div></div>
</div>
<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  var t=tok(), em=email(), list=document.getElementById('list');
  function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  var SET={SDVOSB:'SDVOSB',SB:'Small Business','8A':'8(a)',WOSB:'WOSB',HZ:'HUBZone',OTHER:'Other'};
  function summary(f){
    if(!f||typeof f!=='object')return 'All opportunities';
    var parts=[];
    if(f.q)parts.push('“'+f.q+'”');
    if(f.setAside)parts.push((f.setAside+'').split(',').map(function(k){return SET[k]||k;}).join(', '));
    if(f.naics)parts.push('NAICS '+f.naics);
    if(f.psc)parts.push('PSC '+f.psc);
    if(f.agency)parts.push(f.agency);
    if(f.state)parts.push(f.state);
    if(f.postedDays)parts.push('posted ≤'+f.postedDays+'d');
    if(f.closingDays)parts.push('closing ≤'+f.closingDays+'d');
    if(f.valueRange)parts.push('$'+f.valueRange.replace('-','–'));
    return parts.length?parts.join(' · '):'All opportunities';
  }
  if(!t||!em){ list.innerHTML='<div class="signin">Please <a href="/app?next=%2Fopportunity-map%2Fsaved">sign in</a> to see your saved searches.</div>'; return; }
  function hdrs(){ return {'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em}; }
  // Opening Saved = "seen" → clear the map's red Updates badge (fold current matches into last_seen).
  fetch('/api/app/saved-searches',{method:'POST',headers:hdrs(),body:JSON.stringify({email:em,action:'mark_seen'})}).catch(function(){});

  function render(rows){
    if(!rows.length){ list.innerHTML='<div class="empty"><h3>No saved searches yet</h3><p>Filter the map, then hit <strong>Save search</strong> — we\\'ll alert you when new opportunities match.</p><p style="margin-top:14px"><a href="/opportunity-map">Go to the map →</a></p></div>'; return; }
    list.innerHTML=rows.map(function(r){
      var on=r.alerts_enabled!==false;
      return '<div class="row" data-id="'+h(r.id)+'">'
        + '<div class="rmain"><div class="rname">'+h(r.name)+'</div>'
        + '<div class="rmeta"><span class="chip">'+(r.mode==='recompete'?'Recompetes':'Open opps')+'</span>'+h(summary(r.filters))+'</div></div>'
        + '<div class="toggle'+(on?' on':'')+'" role="button" title="Email alerts"><span class="sw"></span>Alerts '+(on?'on':'off')+'</div>'
        + '<button class="del" title="Delete"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6v14a2 2 0 002 2h8a2 2 0 002-2V6"/></svg>Delete</button>'
        + '</div>';
    }).join('');
    // Wire toggles + deletes.
    Array.prototype.forEach.call(list.querySelectorAll('.row'),function(row){
      var id=row.getAttribute('data-id');
      var tg=row.querySelector('.toggle');
      tg.onclick=function(){
        var on=!tg.classList.contains('on'); tg.classList.toggle('on',on); tg.lastChild.textContent='Alerts '+(on?'on':'off');
        fetch('/api/app/saved-searches',{method:'PATCH',headers:hdrs(),body:JSON.stringify({email:em,id:id,alerts_enabled:on})}).catch(function(){});
      };
      row.querySelector('.del').onclick=function(){
        if(!confirm('Delete this saved search?'))return;
        fetch('/api/app/saved-searches?email='+encodeURIComponent(em)+'&id='+encodeURIComponent(id),{method:'DELETE',headers:hdrs()})
          .then(function(){ row.remove(); if(!list.querySelector('.row'))render([]); }).catch(function(){});
      };
    });
  }
  fetch('/api/app/saved-searches?email='+encodeURIComponent(em),{headers:hdrs()})
    .then(function(r){return r.json();}).then(function(d){ render((d&&d.searches)||[]); })
    .catch(function(){ list.innerHTML='<div class="empty"><h3>Couldn\\'t load</h3><p>Please refresh.</p></div>'; });
})();
</script></body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
