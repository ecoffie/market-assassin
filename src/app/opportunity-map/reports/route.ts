/**
 * GET /opportunity-map/reports — the Market Intelligence (Reports) dashboard.
 *
 * "Understand your markets before everyone else." A saved-market picker on the left; on the
 * right, for the selected market, a grounded dashboard built ENTIRELY from real DB / report-engine
 * data via GET /api/app/market-dashboard: KPI cards (Open Opportunities · Total Market Value ·
 * Forecasts · Repeat Buyers · SB-Friendly Buyers — each rendered ONLY when non-null), Top Buyers,
 * Opportunity DNA bars, Where the money is, Top Forecasts, Largest Open Opportunities, and a
 * grounded AI Market Summary. Share/Export mint the hosted /reports/<id> link via
 * POST /api/app/market-report.
 *
 * NO delta / % change / "heating up" / market-movement-over-time / recent-activity — none of that
 * is grounded (no historical snapshots), so it is OMITTED entirely, never a placeholder.
 *
 * Chrome MIRRORS opportunity-map/saved/route.ts (ZHEAD top nav + ZRAIL left rail + account menu +
 * tok()/email()/hdrs() client auth). The rail's Reports item is active (bar-chart icon). NO EMOJI —
 * every icon is an inline lucide-style SVG (Eric's standing rule).
 */
import { NextResponse } from 'next/server';
import { MAPS_HOME_PATH } from '@/lib/mindy/maps-home';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../account-menu';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reports — Mindy</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#006aff;--jan:#006aff;--green:#22a06b;--red:#e5484d;--purpA:#1e3a8a;--purpB:#7c3aed}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased}
  /* ── App chrome: top nav + left rail (mirror of opportunity-map/saved ZHEAD/ZRAIL) ── */
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
  .zrail .cnt{position:absolute;top:4px;right:8px;min-width:16px;height:16px;padding:0 4px;border-radius:9px;background:var(--red);color:#fff;font:700 10px Inter,sans-serif;display:none;align-items:center;justify-content:center}
  .zrail .cnt.show{display:flex}
  /* content area sits right of the 64px rail */
  .main{margin-left:64px}
  .wrap{max-width:1180px;margin:0 auto;padding:30px 26px 72px}
  /* ── Header ── */
  .rhead{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:26px}
  .rhead h1{font-size:30px;font-weight:800;letter-spacing:-.02em}
  .rhead .sub{color:var(--sub);font-size:15px;margin-top:5px}
  .hbtns{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .hbtn{display:inline-flex;align-items:center;gap:7px;font:700 13px Inter,sans-serif;border-radius:10px;padding:9px 14px;cursor:pointer;text-decoration:none;border:1px solid var(--line);background:#fff;color:var(--ink)}
  .hbtn:hover{background:var(--wash)}
  .hbtn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .hbtn.primary{background:linear-gradient(135deg,var(--purpA),var(--purpB));color:#fff;border-color:transparent}
  .hbtn.primary:hover{filter:brightness(1.06)}
  .hbtn.primary svg{stroke:#fff}
  .hbtn[disabled]{opacity:.5;cursor:default;pointer-events:none}
  /* ── Two-column layout: saved-market list + main dashboard ── */
  .cols{display:grid;grid-template-columns:264px 1fr;gap:26px;align-items:start}
  @media(max-width:900px){.cols{grid-template-columns:1fr}}
  .side .shd{font:700 11px Inter,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin:0 4px 10px}
  .mkt{display:flex;flex-direction:column;gap:6px}
  .mkt button{appearance:none;text-align:left;border:1px solid transparent;background:none;border-radius:11px;padding:11px 13px;cursor:pointer;display:flex;flex-direction:column;gap:3px;width:100%}
  .mkt button:hover{background:var(--wash)}
  .mkt button.on{background:#eff5ff;border-color:#cfe2ff}
  .mkt button .mn{font:700 14px Inter,sans-serif;color:var(--ink);letter-spacing:-.01em}
  .mkt button.on .mn{color:var(--blue)}
  .mkt button .mv{font:500 12px Inter,sans-serif;color:var(--sub)}
  /* Bloomberg watchlist value line: tabular figures, a touch heavier than the NAICS fallback. */
  .mkt button .mv.mv-val{display:inline-flex;align-items:center;gap:5px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
  .mkt button.on .mv.mv-val{color:var(--blue)}
  /* Trend-arrow hook (render-when-real; nothing emitted until snapshot history exists). */
  .mkt button .mv-val .trend{display:inline-flex}
  .mkt button .mv-val .trend svg{width:12px;height:12px;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .mkt button .mv-val .trend.up svg{stroke:var(--green)}
  .mkt button .mv-val .trend.down svg{stroke:var(--red)}
  .mkt button .mv-val .trend.flat svg{stroke:var(--faint)}
  .mkt .addm{color:var(--blue);font-weight:700;border:1px dashed var(--line)}
  .mkt .addm:hover{background:#f4f9ff}
  .side .empty{font:500 13px Inter,sans-serif;color:var(--sub);padding:14px 6px;line-height:1.5}
  .side .empty a{color:var(--blue);font-weight:700;text-decoration:none}
  /* ── Main panel ── */
  .mkhd{margin-bottom:18px}
  .mkhd h2{font-size:22px;font-weight:800;letter-spacing:-.01em}
  .mkhd .chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}
  .chip{display:inline-flex;align-items:center;font:600 12px Inter,sans-serif;color:var(--sub);background:var(--wash);border:1px solid var(--line);border-radius:8px;padding:5px 10px;white-space:nowrap}
  .chip-win{color:var(--faint)}
  /* KPI cards */
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px}
  .kc{border:1px solid var(--line);border-radius:14px;padding:16px 18px;background:#fff;display:flex;align-items:center;gap:14px}
  .kc .ic{width:42px;height:42px;border-radius:11px;flex:none;display:flex;align-items:center;justify-content:center;background:#eef5ff}
  .kc .ic svg{width:21px;height:21px;stroke:var(--blue);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .kc.k-val .ic{background:#e8f7f0}.kc.k-val .ic svg{stroke:var(--green)}
  .kc.k-fc .ic{background:#f3eefe}.kc.k-fc .ic svg{stroke:var(--purpB)}
  .kc.k-rb .ic{background:#fff3e6}.kc.k-rb .ic svg{stroke:#d97706}
  .kc.k-sb .ic{background:#e8f7f0}.kc.k-sb .ic svg{stroke:var(--green)}
  .kc .n{font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1.05}
  .kc .l{font-size:12.5px;color:var(--sub);margin-top:3px}
  /* Muted KPI card — a real measured zero renders a small "None identified" label, not a
     bold "0" (which reads as broken next to the positive KPIs). Lower emphasis, greyed icon. */
  .kc.k-muted{background:var(--wash);border-color:var(--hair)}
  .kc.k-muted .ic{background:#eef0f3}
  .kc.k-muted .ic svg{stroke:var(--faint)}
  .kc .n .none{font-size:14px;font-weight:600;color:var(--faint);letter-spacing:0;display:inline-block}
  /* Section cards + grid */
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:760px){.grid{grid-template-columns:1fr}}
  .card{border:1px solid var(--line);border-radius:14px;padding:18px 20px;background:#fff;margin-bottom:18px}
  .card h3{font-size:15px;font-weight:800;letter-spacing:-.01em;display:flex;align-items:center;gap:8px;margin-bottom:4px}
  .card h3 svg{width:16px;height:16px;stroke:var(--purpB);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .card .csub{font:500 12.5px Inter,sans-serif;color:var(--sub);margin-bottom:14px}
  .card .full{grid-column:1/-1}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font:700 10.5px Inter,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
  td{padding:8px;border-bottom:1px solid var(--hair);vertical-align:top}
  tr:last-child td{border-bottom:0}
  td.lead{font-weight:600;color:var(--ink)}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .money{color:var(--green);font-weight:700}
  .rowlink{color:var(--ink);text-decoration:none}
  .rowlink:hover{color:var(--blue)}
  /* Ranked horizontal bars — shared by Opportunity DNA (.dnab) + Where the money is */
  .stbar{display:flex;flex-direction:column;gap:11px}
  .stb{display:grid;grid-template-columns:130px 1fr auto;gap:12px;align-items:center;font:600 13px Inter,sans-serif}
  .stb .track{height:8px;border-radius:5px;background:var(--hair);overflow:hidden}
  .stb .fill{height:100%;background:linear-gradient(90deg,var(--purpA),var(--purpB));border-radius:5px}
  .stb .amt{color:var(--sub);font-variant-numeric:tabular-nums;white-space:nowrap}
  /* DNA strand bars: wider label column (strand names run longer than state names) */
  .stb.dnab{grid-template-columns:150px 1fr auto}
  /* AI summary */
  .aisum{border:1px solid #cfe2ff;background:linear-gradient(180deg,#f6faff,#fff);border-radius:14px;padding:18px 20px;margin-bottom:18px}
  .aisum h3{display:flex;align-items:center;gap:8px}
  .aisum h3 svg{width:18px;height:18px;flex:none;fill:none;stroke:var(--blue);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .aisum p{font:500 14px/1.6 Inter,sans-serif;color:var(--ink)}
  .aisum .asklink{display:inline-flex;align-items:center;gap:6px;margin-top:12px;font:700 13px Inter,sans-serif;color:var(--blue);text-decoration:none}
  .aisum .asklink svg{width:15px;height:15px;stroke:var(--blue);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  /* Recommended actions — grounded footer list. Each line = a small SVG check + text (NO emoji). */
  .recs{display:flex;flex-direction:column;gap:11px}
  .recs .rec{display:flex;align-items:flex-start;gap:10px;font:500 13.5px/1.45 Inter,sans-serif;color:var(--ink)}
  .recs .rec svg{width:17px;height:17px;flex:none;margin-top:1px;stroke:var(--green);fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .recs .rec b{font-weight:700}
  .explore{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,var(--purpA),var(--purpB));color:#fff;text-decoration:none;border-radius:11px;padding:12px 20px;font:800 14px Inter,sans-serif;letter-spacing:-.01em;margin-top:4px}
  .explore:hover{filter:brightness(1.06)}
  .explore svg{width:16px;height:16px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .empty2{font:500 13px Inter,sans-serif;color:var(--faint);font-style:italic;padding:6px 0}
  .degnote{background:#fdf1e3;border:1px solid #f0c894;border-radius:10px;padding:10px 13px;font:500 12.5px Inter,sans-serif;color:#7a4b12;margin-bottom:16px}
  /* States */
  .loading{text-align:center;padding:70px;color:var(--faint);display:flex;flex-direction:column;align-items:center;gap:14px}
  .spin{width:26px;height:26px;border:3px solid var(--line);border-top-color:var(--blue);border-radius:50%;animation:sp 1s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  .errline,.signin,.blank{text-align:center;padding:64px 20px;color:var(--sub)}
  .errline h3,.blank h3{font-size:18px;color:var(--ink);margin-bottom:6px}
  .signin a,.blank a{color:var(--blue);font-weight:700;text-decoration:none}
  ${ACCOUNT_MENU_CSS}
</style></head><body>
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
  <a href="/opportunity-map/saved" title="Watchlist — saved searches &amp; new matches"><span class="cnt" id="wlCnt"></span><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Watchlist</span></a>
  <a href="/opportunity-map/favorites" title="Saved — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Saved</span></a>
  <a href="/opportunity-map/pursuits" title="Pursuits — opportunities you are actively working"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Pursuits</span></a>
</nav>
<div class="main">
<div class="wrap">
  <div class="rhead">
    <div>
      <h1>Market Intelligence</h1>
      <div class="sub">Understand your markets before everyone else.</div>
    </div>
    <div class="hbtns">
      <button class="hbtn" id="btnShare" disabled><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>Share report</button>
      <button class="hbtn" id="btnExport" disabled><svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4M4 21h16"/></svg>Export PDF</button>
      <a class="hbtn primary" id="btnWatch" href="/opportunity-map/saved"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>Save to watchlist</a>
    </div>
  </div>
  <div class="cols">
    <aside class="side">
      <div class="shd">Saved markets</div>
      <div id="mktList" class="mkt"><div class="empty2">Loading…</div></div>
    </aside>
    <div id="panel">
      <div class="loading"><div class="spin"></div><div>Loading your markets…</div></div>
    </div>
  </div>
</div>
</div>
<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  var t=tok(), em=email();
  var panel=document.getElementById('panel'), mktList=document.getElementById('mktList');
  var btnShare=document.getElementById('btnShare'), btnExport=document.getElementById('btnExport'), btnWatch=document.getElementById('btnWatch');
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  if(!t||!em){ panel.innerHTML='<div class="signin">Please <a href="/app?next=%2Fopportunity-map%2Freports">sign in</a> to see your Market Intelligence.</div>'; mktList.innerHTML=''; return; }
  function hdrs(){ return {'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em}; }

  function fmtMoney(n){
    n=Number(n); if(!isFinite(n)||n<=0)return '$0';
    if(n>=1e9)return '$'+(n/1e9).toFixed(1).replace(/\\.0$/,'')+'B';
    if(n>=1e6)return '$'+(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M';
    if(n>=1e3)return '$'+Math.round(n/1e3)+'K';
    return '$'+Math.round(n);
  }
  function fmtNum(n){ n=Number(n)||0; return n.toLocaleString(); }
  function pct(p){ return Math.round((Number(p)||0)*100)+'%'; }

  // Build the map URL for a saved search from its stored filters (mirrors the Watchlist mapUrl).
  function mapUrl(r){
    var qs=[]; var f=(r&&r.filters&&typeof r.filters==='object')?r.filters:{};
    Object.keys(f).forEach(function(k){ var v=f[k]; if(v==null||v==='')return; qs.push(encodeURIComponent(k)+'='+encodeURIComponent(String(v))); });
    if(r&&r.mode==='recompete')qs.push('mode=recompete');
    return '/opportunity-map'+(qs.length?'?'+qs.join('&'):'');
  }

  // Translate a saved search's stored filter object → the market-dashboard query string. Only the
  // grounded market axes the endpoint understands (q/naics/psc/agency/state/set_aside).
  function dashQuery(r){
    var f=(r&&r.filters&&typeof r.filters==='object')?r.filters:{};
    var out={};
    if(f.q||f.search) out.q=String(f.q||f.search);
    if(f.naics) out.naics=String(f.naics);
    if(f.psc) out.psc=String(f.psc);
    if(f.agency) out.agency=String(f.agency);
    if(f.state) out.state=String(f.state);
    if(f.setAside) out.set_aside=String(f.setAside);
    return out;
  }
  function hasAxis(q){ return !!(q.q||q.naics||q.psc||q.agency); }

  var SEARCHES=[], SEL=null, CUR=null; // CUR = last loaded dashboard payload (for Share/Export)
  // Bloomberg-watchlist rail: cache each market's TOTAL VALUE (kpis.totalMarketValue) keyed by
  // market id, populated LAZILY when that market's dashboard is fetched (on select). Unopened
  // markets keep the NAICS-codes meta line — never a fabricated value.
  var MKT_VALUES={};

  function marketLabel(r){
    var q=dashQuery(r);
    if(r.name) return r.name;
    return q.q||q.naics||q.psc||q.agency||'Market';
  }

  function renderMktList(){
    if(!SEARCHES.length){
      mktList.innerHTML='<div class="empty">No saved markets yet.<br><a href="/opportunity-map">Save a search from the map \\u2192</a></div>';
      return;
    }
    var html=SEARCHES.map(function(r,i){
      var on=(SEL===r.id)?' on':'';
      var q=dashQuery(r);
      // Bloomberg meta: once this market's dashboard has been fetched, show its TOTAL VALUE (from
      // MKT_VALUES cache); otherwise fall back to the NAICS-codes line. Value only shows for markets
      // the user has opened — never a placeholder for an unopened one.
      var val=MKT_VALUES[r.id];
      var metaHtml;
      if(val!=null){
        // TREND ARROW = render-when-real. It needs a prior daily_saved_search_snapshots row to
        // compare against; the snapshot cron started ~today so there is ~0 history, and a value
        // trend cannot be computed from a single point. So NO arrow renders today — correct, never
        // a fabricated ▲/▼. HOOK: when a snapshot-diff endpoint exists, compute dir here
        // ('up'|'down'|'flat') from (currentValue vs prior snapshot value) and prepend
        // trendArrowSvg(dir); until then this stays value-only by design.
        metaHtml='<span class="mv mv-val">'+esc(fmtMoney(val))+'</span>';
      } else {
        var meta=[q.naics?('NAICS '+q.naics.split(',')[0]+(q.naics.split(',').length>1?' +'+(q.naics.split(',').length-1):'')):(q.agency||q.psc||q.q||'')].filter(Boolean).join(' \\u00b7 ');
        metaHtml=meta?'<span class="mv">'+esc(meta)+'</span>':'';
      }
      return '<button data-id="'+esc(r.id)+'" class="'+on.trim()+'"><span class="mn">'+esc(marketLabel(r))+'</span>'+metaHtml+'</button>';
    }).join('');
    html+='<a class="mkt-addm addm" href="/opportunity-map" style="border-radius:11px;padding:11px 13px;text-decoration:none;text-align:center;font:700 13px Inter,sans-serif">+ Add a market</a>';
    mktList.innerHTML=html;
    Array.prototype.forEach.call(mktList.querySelectorAll('button[data-id]'),function(b){
      b.onclick=function(){ selectMarket(b.getAttribute('data-id')); };
    });
  }

  function selectMarket(id){
    var r=null; for(var i=0;i<SEARCHES.length;i++){ if(String(SEARCHES[i].id)===String(id)){ r=SEARCHES[i]; break; } }
    if(!r)return;
    SEL=r.id; renderMktList();
    loadDashboard(r);
  }

  function setHeaderBtns(enabled,r){
    btnShare.disabled=!enabled; btnExport.disabled=!enabled;
    if(r) btnWatch.href=mapUrl(r);
  }

  function loadDashboard(r){
    CUR=null; setHeaderBtns(false,r);
    var q=dashQuery(r);
    if(!hasAxis(q)){
      panel.innerHTML='<div class="blank"><h3>Nothing to report yet</h3><p>This saved search has no NAICS, PSC, keyword or agency to build a market from.</p></div>';
      return;
    }
    panel.innerHTML='<div class="loading"><div class="spin"></div><div>Building your market intelligence\\u2026 <span style="color:var(--faint)">who\\u2019s buying \\u00b7 who holds it \\u00b7 recompetes \\u00b7 forecasts</span></div></div>';
    var qs=Object.keys(q).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(q[k]);}).join('&');
    fetch('/api/app/market-dashboard?email='+encodeURIComponent(em)+'&'+qs,{headers:hdrs()})
      .then(function(res){ return res.json().then(function(d){ return {status:res.status,d:d}; }); })
      .then(function(res){
        if(!res.d||!res.d.success){ panel.innerHTML='<div class="errline"><h3>Couldn\\u2019t build this market</h3><p>'+esc((res.d&&res.d.error)||'Please try again shortly.')+'</p></div>'; return; }
        CUR={payload:res.d,search:r};
        // Cache this market's TOTAL VALUE for the Bloomberg rail meta (grounded; only when non-null).
        var tv=res.d.kpis&&res.d.kpis.totalMarketValue;
        if(tv!=null){ MKT_VALUES[r.id]=tv; renderMktList(); }
        renderDashboard(res.d,r);
        setHeaderBtns(true,r);
      })
      .catch(function(){ panel.innerHTML='<div class="errline"><h3>Request failed</h3><p>Check your connection and try again.</p></div>'; });
  }

  var DNA_COLORS=['#7c3aed','#006aff','#22a06b','#d97706','#e5484d','#0ea5e9','#8b5cf6','#14b8a6','#f59e0b','#ec4899','#64748b'];

  function kpiCard(cls,ic,n,l){
    return '<div class="kc '+cls+'"><div class="ic">'+ic+'</div><div><div class="n">'+n+'</div><div class="l">'+esc(l)+'</div></div></div>';
  }

  // Grounded "Recommended actions" — 3-5 next-step lines derived ONLY from the report's real data
  // (topBuyers / kpis.forecasts / byState / kpis.recompetes / opportunityDna). NO LLM, no generic
  // filler: a line only renders when its source field is present. Returns '' when nothing is
  // groundable, so the caller omits the whole card. Each line is a small inline SVG check (no emoji).
  function buildRecsHtml(d){
    var k=(d&&d.kpis)||{};
    var recs=[];
    var buyers=(d&&d.topBuyers)||[];
    if(buyers.length&&buyers[0]&&buyers[0].name){
      var b0=buyers[0];
      var amt=(b0.amount!=null?(' \\u2014 leads at '+fmtMoney(b0.amount)):' \\u2014 the top buyer in this market');
      recs.push('Watch <b>'+esc(b0.name)+'</b>'+amt);
    }
    var fc=Number(k.forecasts)||0;
    if(fc>0){
      recs.push('Monitor <b>'+fmtNum(fc)+'</b> upcoming forecast'+(fc===1?'':'s')+' 6\\u201318 months out');
    }
    var states=(d&&d.byState)||[];
    if(states.length&&states[0]&&states[0].state){
      var s0=states[0];
      recs.push('Focus on <b>'+esc(s0.state)+'</b> \\u2014 '+pct(s0.pct)+' of open-opportunity value');
    }
    var rc=Number(k.recompetes)||0;
    if(rc>0){
      recs.push('Review <b>'+fmtNum(rc)+'</b> upcoming recompete'+(rc===1?'':'s'));
    }
    // Optional 5th line: a high repeat-buyer DNA strand (grounded only — never invented).
    if(recs.length<5&&Array.isArray(d&&d.opportunityDna)){
      var rb=null;
      for(var i=0;i<d.opportunityDna.length;i++){
        var x=d.opportunityDna[i];
        var lbl=String((x&&x.label)||'').toLowerCase();
        if((lbl.indexOf('repeat')>=0||lbl.indexOf('incumbent')>=0)&&x.pct!=null&&Number(x.pct)>=0.4){ rb=x; break; }
      }
      if(rb) recs.push('This market is <b>'+pct(rb.pct)+' '+esc(rb.label)+'</b> \\u2014 target incumbents\\u2019 recompetes');
    }
    if(!recs.length) return '';
    recs=recs.slice(0,5);
    var chk='<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
    var items=recs.map(function(t){ return '<div class="rec">'+chk+'<span>'+t+'</span></div>'; }).join('');
    return '<div class="card full"><h3><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/></svg>Recommended actions</h3>'
      +'<div class="csub">Grounded next steps from this market\\u2019s real buyers, forecasts, geography and recompetes.</div>'
      +'<div class="recs">'+items+'</div></div>';
  }

  function renderDashboard(d,r){
    var q=dashQuery(r);
    var chips=[];
    if(q.naics)chips.push('<span class="chip">NAICS '+esc(q.naics.split(',').slice(0,3).join(', '))+(q.naics.split(',').length>3?' +'+(q.naics.split(',').length-3):'')+'</span>');
    if(q.psc)chips.push('<span class="chip">PSC '+esc(q.psc)+'</span>');
    if(q.q)chips.push('<span class="chip">"'+esc(q.q)+'"</span>');
    if(q.agency)chips.push('<span class="chip">'+esc(q.agency)+'</span>');
    else chips.push('<span class="chip chip-win">All agencies</span>');
    if(q.state)chips.push('<span class="chip">'+esc(q.state)+'</span>');
    if(q.set_aside)chips.push('<span class="chip">'+esc(q.set_aside)+'</span>');
    chips.push('<span class="chip chip-win">Current</span>');

    var k=d.kpis||{};
    // KPI icons (inline lucide SVGs — NO emoji).
    var icOpen='<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
    var icVal='<svg viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>';
    var icFc='<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 4-5"/></svg>';
    var icRb='<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>';
    var icSb='<svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 5-3.5 7.5-8.5 9C7.5 19.5 4 17 4 12V6l8-3 8 3z"/></svg>';

    var kpis=[];
    // Open Opportunities + Total Market Value always render (grounded counts/values; value may be
    // null → shown as "Unknown", never $0).
    kpis.push(kpiCard('k-open',icOpen,fmtNum(k.openOpportunities)+(k.openCapped?'+':''),'Open opportunities'));
    kpis.push(kpiCard('k-val',icVal,(k.totalMarketValue!=null?fmtMoney(k.totalMarketValue):'Unknown'),'Total market value'));
    kpis.push(kpiCard('k-fc',icFc,fmtNum(k.forecasts),'Forecasts identified'));
    if(k.repeatBuyers!=null) kpis.push(kpiCard('k-rb',icRb,fmtNum(k.repeatBuyers),'Repeat buyers'));
    // SB-friendly buyers: a real measured zero (or null) is honest, not broken. Render a small
    // muted "None identified" label + mute the card so a bare bold "0" doesn't read as an error
    // next to the positive KPIs. >0 → unchanged bold number.
    if(k.sbFriendlyBuyers!=null){
      if(Number(k.sbFriendlyBuyers)>0){
        kpis.push(kpiCard('k-sb',icSb,fmtNum(k.sbFriendlyBuyers),'SB-friendly buyers'));
      } else {
        kpis.push(kpiCard('k-sb k-muted',icSb,'<span class="none">None identified</span>','SB-friendly buyers'));
      }
    }

    // Top Buyers table
    var buyers=(d.topBuyers||[]);
    var buyersHtml=buyers.length
      ? '<table><thead><tr><th>Buyer</th><th class="num">Market value</th></tr></thead><tbody>'
        + buyers.map(function(b){ return '<tr><td class="lead">'+esc(b.name)+'</td><td class="num money">'+fmtMoney(b.amount)+'</td></tr>'; }).join('')
        + '</tbody></table>'
      : '<div class="empty2">No buyer data available for this market.</div>';

    // Opportunity DNA — RANKED HORIZONTAL BARS (Eric 2026-08-05: "kill the pie chart —
    // pie charts are hard to read; horizontal bars let you immediately compare"). Bar width =
    // strand pct of open opps (each strand is share-of-total, so widths are directly comparable);
    // per-strand DNA color kept. OMITTED entirely when null — never invented.
    var dnaHtml='';
    if(Array.isArray(d.opportunityDna)&&d.opportunityDna.length){
      var strands=d.opportunityDna.slice(0,8);
      var maxPct=strands.reduce(function(m,x){return Math.max(m,x.pct||0);},0)||1;
      var dnaBars=strands.map(function(x,i){
        var w=Math.max(3,Math.round(((x.pct||0)/maxPct)*100));
        var c=DNA_COLORS[i%DNA_COLORS.length];
        return '<div class="stb dnab"><span>'+esc(x.label)+'</span>'
          +'<span class="track"><span class="fill" style="width:'+w+'%;background:'+c+'"></span></span>'
          +'<span class="amt">'+fmtNum(x.count)+' \\u00b7 '+pct(x.pct)+'</span></div>';
      }).join('');
      dnaHtml='<div class="card"><h3><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 3"/></svg>Opportunity DNA</h3>'
        +'<div class="csub">Strand mix across the '+fmtNum(d.kpis.openOpportunities)+' open opportunities in this market.</div>'
        +'<div class="stbar">'+dnaBars+'</div></div>';
    }

    // Where the money is — ranked state list (OMIT the choropleth; ranked bars only)
    var stHtml='';
    if(Array.isArray(d.byState)&&d.byState.length){
      var maxV=d.byState[0].value||1;
      var bars=d.byState.map(function(s){
        var w=Math.max(3,Math.round((s.value/maxV)*100));
        return '<div class="stb"><span>'+esc(s.state)+'</span><span class="track"><span class="fill" style="width:'+w+'%"></span></span><span class="amt">'+fmtMoney(s.value)+' \\u00b7 '+pct(s.pct)+'</span></div>';
      }).join('');
      stHtml='<div class="card"><h3><svg viewBox="0 0 24 24"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>Where the money is</h3>'
        +'<div class="csub">Estimated open-opportunity value by place of performance.</div>'
        +'<div class="stbar">'+bars+'</div></div>';
    } else {
      stHtml='<div class="card"><h3><svg viewBox="0 0 24 24"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>Where the money is</h3><div class="empty2">No place-of-performance value available for the open opportunities in this market.</div></div>';
    }

    // Top Forecasts
    var fc=(d.topForecasts||[]);
    var fcHtml=fc.length
      ? '<table><thead><tr><th>Title</th><th>Agency</th><th>FY</th></tr></thead><tbody>'
        + fc.map(function(x){ return '<tr><td class="lead">'+esc(x.title||'\\u2014')+'</td><td>'+esc(x.agency||'\\u2014')+'</td><td>'+esc(x.fiscalYear||'\\u2014')+'</td></tr>'; }).join('')
        + '</tbody></table>'
      : '<div class="empty2">No forecasts identified for this market.</div>';

    // Largest Open Opportunities
    var lo=(d.largestOpen||[]);
    var loHtml=lo.length
      ? '<table><thead><tr><th>Opportunity</th><th>Agency</th><th class="num">Est. value</th></tr></thead><tbody>'
        + lo.map(function(x){
            var href=x.noticeId?('/opportunity-map?opp='+encodeURIComponent(x.noticeId)):mapUrl(r);
            return '<tr><td class="lead"><a class="rowlink" href="'+esc(href)+'">'+esc(x.title)+'</a></td><td>'+esc(x.agency||'\\u2014')+'</td><td class="num money">'+fmtMoney(x.value)+'</td></tr>';
          }).join('')
        + '</tbody></table>'
      : '<div class="empty2">No open opportunity has a grounded value estimate in this market yet.</div>';

    var deg=d.degraded?'<div class="degnote">One data source came back thin for this market, so the affected section is shown as-is rather than a fabricated figure.</div>':'';

    panel.innerHTML=''
      + '<div class="mkhd"><h2>'+esc(marketLabel(r))+'</h2><div class="chips">'+chips.join('')+'</div></div>'
      + deg
      + '<div class="kpis">'+kpis.join('')+'</div>'
      // Newspaper flow (Eric 2026-08-05, FINAL): Headline -> Executive Brief -> DNA -> Top buyers ->
      // Top forecasts -> Largest open -> Where the money is (GEOGRAPHY LAST) -> Recommended actions.
      // Geography moved to the END of the grid (it's context, not the lead). Renamed "AI market
      // summary" -> "Executive Brief" (Eric: the old name "sounds like ChatGPT"). DNA stays first
      // in the grid — the differentiator, right under the brief.
      + (d.summaryText?('<div class="aisum"><h3><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="none"/><path d="M7 8h10M7 12h10M7 16h6"/></svg>Executive Brief</h3><p>'+esc(d.summaryText)+'</p><a class="asklink" href="'+esc(mapUrl(r))+'">Explore this market on the map <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></div>'):'')
      + '<div class="grid">'
      +   (dnaHtml||'')
      +   '<div class="card"><h3><svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6"/></svg>Top buyers</h3><div class="csub">Federal buying sub-agencies by obligated dollars.</div>'+buyersHtml+'</div>'
      +   '<div class="card"><h3><svg viewBox="0 0 24 24"><path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/></svg>Top forecasts</h3><div class="csub">Planned procurements 6\\u201318 months out.</div>'+fcHtml+'</div>'
      +   '<div class="card full"><h3><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/></svg>Largest open opportunities</h3><div class="csub">Open solicitations by estimated value \\u2014 click to open on the map.</div>'+loHtml+'</div>'
      +   stHtml
      + '</div>'
      + buildRecsHtml(d)
      + '<div style="margin-top:20px"><a class="explore" href="'+esc(mapUrl(r))+'"><svg viewBox="0 0 24 24"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>Explore this market on the map</a></div>';
  }

  // ── Share / Export → mint the hosted /reports/<id> via POST /api/app/market-report ──
  var lastReportUrl=null;
  function mintReport(r,cb){
    var q=dashQuery(r);
    var payload={email:em};
    if(q.naics){ payload.naics=q.naics; if(q.psc)payload.psc=q.psc; }
    else if(q.psc){ payload.psc=q.psc; }
    else if(q.q){ payload.keyword=q.q; }
    if(q.agency)payload.agency=q.agency;
    if(q.set_aside)payload.set_aside=q.set_aside;
    if(q.state)payload.state=q.state;
    fetch('/api/app/market-report',{method:'POST',headers:hdrs(),body:JSON.stringify(payload)})
      .then(function(res){ return res.json().then(function(d){ return {status:res.status,d:d}; }); })
      .then(function(res){
        if(res.status===402||(res.d&&res.d.teaser)){ cb(null,'Market reports are a Mindy Pro feature.',res.d&&res.d.upgrade_url); return; }
        if(!res.d||!res.d.success||!res.d.url){ cb(null,(res.d&&res.d.error)||'Report generation failed. Try again shortly.'); return; }
        cb(res.d.url);
      })
      .catch(function(){ cb(null,'Request failed. Check your connection and try again.'); });
  }

  btnShare.onclick=function(){
    if(!CUR)return;
    var r=CUR.search, orig=btnShare.innerHTML;
    btnShare.disabled=true; btnShare.textContent='Preparing link\\u2026';
    var done=function(url,err,upgrade){
      btnShare.disabled=false; btnShare.innerHTML=orig;
      if(url){ lastReportUrl=url;
        try{ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(url); btnShare.textContent='Link copied \\u2713'; setTimeout(function(){btnShare.innerHTML=orig;},1800); return; } }catch(e){}
        window.prompt('Shareable report link:',url);
      } else if(upgrade){ window.location.href=upgrade; }
      else { alert(err||'Could not create a shareable link.'); }
    };
    mintReport(r,done);
  };
  btnExport.onclick=function(){
    if(!CUR)return;
    var r=CUR.search, orig=btnExport.innerHTML;
    if(lastReportUrl){ window.open(lastReportUrl,'_blank','noopener'); return; }
    btnExport.disabled=true; btnExport.textContent='Preparing\\u2026';
    mintReport(r,function(url,err,upgrade){
      btnExport.disabled=false; btnExport.innerHTML=orig;
      if(url){ lastReportUrl=url; window.open(url,'_blank','noopener'); } // hosted report page has a Save-as-PDF button
      else if(upgrade){ window.location.href=upgrade; }
      else { alert(err||'Could not open the report.'); }
    });
  };

  // Load: saved searches → render list → auto-select the first market → load its dashboard.
  // Also fetch the watchlist badge count for the rail (parity with the map/saved chrome).
  fetch('/api/app/saved-searches?badge=1&email='+encodeURIComponent(em),{headers:hdrs()})
    .then(function(r){return r.json();}).then(function(d){
      if(d&&d.success&&d.count>0){ var c=document.getElementById('wlCnt'); if(c){ c.textContent=(d.count>99?'99+':d.count); c.classList.add('show'); } }
    }).catch(function(){});

  fetch('/api/app/saved-searches?email='+encodeURIComponent(em),{headers:hdrs()})
    .then(function(r){return r.json();})
    .then(function(d){
      SEARCHES=((d&&d.searches)||[]).filter(function(s){ return s&&s.mode!=='recompete'; });
      renderMktList();
      if(SEARCHES.length){ selectMarket(SEARCHES[0].id); }
      else { panel.innerHTML='<div class="blank"><h3>No saved markets yet</h3><p>Save a search from the map to turn it into a market intelligence report.</p><p style="margin-top:14px"><a href="/opportunity-map">Go to the map \\u2192</a></p></div>'; }
    })
    .catch(function(){ mktList.innerHTML='<div class="empty">Couldn\\u2019t load your markets.</div>'; panel.innerHTML='<div class="errline"><h3>Couldn\\u2019t load your markets</h3><p>Please refresh the page.</p></div>'; });
})();
</script>
${ACCOUNT_MENU_JS}
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
