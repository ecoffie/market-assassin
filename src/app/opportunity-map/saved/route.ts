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
</script>
${ACCOUNT_MENU_JS}
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
