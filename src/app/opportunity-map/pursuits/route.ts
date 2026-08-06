/**
 * GET /opportunity-map/pursuits — the Pursuits page ("mission control").
 *
 * Lists the signed-in user's ACTIVE PURSUITS (rows in user_pipeline) grouped by
 * health/urgency, with KPI stat cards, a grouped list, and a right sidebar
 * (Today's Agenda · Pursuit Health donut · Recent Activity). Data via
 * GET /api/pipeline?email=<email>&stats=true (MI-token authed, read client-side
 * from localStorage — same auth pattern as the map/favorites). The pursuits array
 * comes back under the `.opportunities` key (see api/pipeline/route.ts GET).
 *
 * Every number is GROUNDED IN REAL DATA — parsed from a real pipeline field or
 * derived by a clearly-labeled rule (never fabricated). Derive-and-label helpers:
 * parseMoney / fmtMoney / stageProb / stageLabel / deriveHealth / isNeedsAttention
 * / relDue live in the client JS below.
 *
 * Chrome: this page lives inside the SAME app shell as /opportunity-map — the top
 * nav (Map · Players · Pursuits · Reports, with Pursuits active) AND the left rail
 * (Map · Watchlist · Saved · Pursuits, with Pursuits active) — mirroring
 * favorites/route.ts. Keep the header/rail markup + chrome CSS in sync with it.
 */
import { NextResponse } from 'next/server';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../account-menu';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pursuits — Mindy</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#006aff;--jan:#006aff;--green:#22a06b;--red:#e5484d;--amber:#f59e0b;--purple:#6b3ac9}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased}
  /* ── App chrome: top nav + left rail (mirror of opportunity-map ZHEAD/ZRAIL) ── */
  .zhead{position:sticky;top:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid var(--line);background:#fff;z-index:40}
  .zh-left,.zh-right{display:flex;align-items:center;gap:22px}
  .zh-left a{font:700 16px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}
  .zh-right a{font:700 15px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}
  .zh-left a:hover,.zh-right a:hover{color:var(--jan)}
  .zh-left a.zh-on{color:var(--jan);border-bottom:2px solid var(--jan);padding-bottom:2px}
  /* Defensive: any icon in the top nav is line-art, never a filled black blob. */
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
  .wrap{max-width:1240px;margin:0 auto;padding:26px 26px 72px}
  /* ── Header row ── */
  .phead{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:22px}
  .phead h1{font-size:30px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px}
  .phead .sub{color:var(--sub);font-size:14.5px;max-width:560px;line-height:1.4}
  .btn-primary{display:inline-flex;align-items:center;gap:8px;font:700 14px Inter,sans-serif;color:#fff;
    background:linear-gradient(135deg,#1e3a8a,#7c3aed);border:0;border-radius:11px;padding:11px 18px;cursor:pointer;text-decoration:none;white-space:nowrap;box-shadow:0 6px 16px -6px rgba(124,58,237,.5)}
  .btn-primary:hover{filter:brightness(1.06)}
  /* ── KPI cards ── */
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:22px}
  @media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:520px){.kpis{grid-template-columns:1fr}}
  .kpi{display:flex;align-items:flex-start;gap:14px;border:1px solid var(--line);border-radius:14px;padding:16px 16px;background:#fff}
  .kpi-ic{flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center}
  .kpi-ic svg{width:21px;height:21px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .kpi-ic.blue{background:#eaf2ff}.kpi-ic.blue svg{stroke:var(--blue)}
  .kpi-ic.green{background:#eafaf2}.kpi-ic.green svg{stroke:var(--green)}
  .kpi-ic.red{background:#fdecec}.kpi-ic.red svg{stroke:var(--red)}
  .kpi-ic.amber{background:#fff5e6}.kpi-ic.amber svg{stroke:var(--amber)}
  .kpi-body{min-width:0}
  .kpi-num{font:800 24px Inter,sans-serif;letter-spacing:-.02em;line-height:1.05}
  .kpi-lbl{font:600 13px Inter,sans-serif;color:var(--ink);margin-top:3px}
  .kpi-sub{font:500 12px Inter,sans-serif;color:var(--faint);margin-top:3px}
  .kpi.clickable{cursor:pointer;transition:border-color .12s,box-shadow .12s,transform .06s}
  .kpi.clickable:hover{border-color:#c7d2e0;box-shadow:0 4px 14px -8px rgba(17,28,38,.25)}
  .kpi.clickable:active{transform:translateY(1px)}
  .kpi.on{border-color:var(--blue);box-shadow:0 0 0 1px var(--blue) inset}
  .kpi.clickable:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
  /* filter bar above the grouped list when a KPI is active */
  .filterbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 14px;margin-bottom:12px;
    background:#eff5ff;border:1px solid #d5e5ff;border-radius:10px;font:600 13px Inter,sans-serif;color:#1e3a8a}
  .filterbar button{border:0;background:#fff;border:1px solid #cfe0ff;color:var(--blue);font:700 12px Inter,sans-serif;border-radius:8px;padding:5px 11px;cursor:pointer}
  .filterbar button:hover{background:#f5f9ff}
  /* calm all-clear line when nothing needs attention */
  .allclear{display:flex;align-items:center;gap:9px;padding:14px 18px;margin-bottom:16px;border:1px solid #c9efdd;background:#eafaf2;
    border-radius:12px;font:600 13.5px Inter,sans-serif;color:#0a6b45}
  .allclear svg{width:18px;height:18px;flex:none;stroke:var(--green);fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  /* Waiting-on-you sidebar row */
  .waitrow{display:flex;align-items:center;gap:11px;text-decoration:none;padding:4px 0}
  .waitrow .waitn{flex:none;width:34px;height:34px;border-radius:9px;background:#eaf2ff;color:var(--blue);font:800 15px Inter,sans-serif;display:grid;place-items:center}
  .waitrow .waitlbl{font:600 12.5px Inter,sans-serif;color:var(--ink);line-height:1.35}
  .waitrow .waitarrow{width:16px;height:16px;flex:none;stroke:var(--blue);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;margin-left:auto}
  .waitrow:hover .waitlbl{color:var(--blue)}
  /* ── Toolbar ── */
  .toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:20px}
  .tb-search{position:relative;flex:1;min-width:200px;max-width:360px}
  .tb-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;stroke:var(--faint);fill:none;stroke-width:2}
  .tb-search input{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px 10px 34px;font:500 14px Inter,sans-serif;color:var(--ink);outline:none}
  .tb-search input:focus{border-color:var(--blue)}
  .tb-btn{display:inline-flex;align-items:center;gap:7px;font:600 13.5px Inter,sans-serif;color:var(--ink);
    background:#fff;border:1px solid var(--line);border-radius:10px;padding:9px 13px;cursor:pointer;white-space:nowrap}
  .tb-btn:hover{border-color:#c7d2e0;background:var(--wash)}
  .tb-btn svg{width:11px;height:7px;stroke:currentColor;stroke-width:1.8;fill:none;stroke-linecap:round}
  .tb-spacer{flex:1}
  .tb-toggle{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .tb-toggle button{border:0;background:#fff;padding:9px 11px;cursor:pointer;color:var(--faint);display:grid;place-items:center}
  .tb-toggle button.on{background:#eff5ff;color:var(--blue)}
  .tb-toggle button svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .tb-toggle button+button{border-left:1px solid var(--line)}
  /* ── Two-column layout ── */
  .pmain{display:grid;grid-template-columns:1fr 320px;gap:24px;align-items:start}
  @media(max-width:1100px){.pmain{grid-template-columns:1fr}}
  /* ── Grouped list ── */
  .pgroup{border:1px solid var(--line);border-radius:14px;background:#fff;margin-bottom:16px;overflow:hidden;border-left:4px solid var(--line)}
  /* let an open row-menu escape the group's overflow clip (toggled while a menu is open) */
  .pgroup.menu-open{overflow:visible}
  .plist.menu-open{overflow:visible}
  .pgroup.g-red{border-left-color:var(--red)}
  .pgroup.g-amber{border-left-color:var(--amber)}
  .pgroup.g-blue{border-left-color:var(--blue)}
  .pgroup.g-grey{border-left-color:#94a3b8}
  .pg-head{display:flex;align-items:center;gap:10px;padding:14px 18px;cursor:pointer;user-select:none}
  .pg-head:hover{background:var(--wash)}
  .pg-chev{width:16px;height:16px;stroke:var(--faint);fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .15s}
  .pgroup.collapsed .pg-chev{transform:rotate(-90deg)}
  .pg-title{font:700 15px Inter,sans-serif;letter-spacing:-.01em}
  .pg-count{font:700 12px Inter,sans-serif;color:var(--sub);background:var(--wash);border:1px solid var(--line);border-radius:999px;padding:2px 9px}
  .pg-body{border-top:1px solid var(--hair)}
  .pgroup.collapsed .pg-body{display:none}
  /* Action-led row: [icon] [main: title / NEXT ACTION label / action / meta] [stage] [health+reason] [value?] [Continue] [kebab] */
  .prow{display:grid;grid-template-columns:26px 1fr auto auto auto auto 28px;gap:14px;align-items:center;padding:15px 18px;border-bottom:1px solid var(--hair);font-size:13px}
  .prow:last-child{border-bottom:0}
  .prow:hover{background:var(--wash)}
  @media(max-width:1100px){.prow{grid-template-columns:26px 1fr auto auto 28px}.prow .col-health,.prow .col-value{display:none}}
  @media(max-width:760px){.prow{grid-template-columns:26px 1fr auto 28px}.prow .col-health,.prow .col-value,.prow .col-stage{display:none}}
  .row-ic{width:26px;height:26px;display:grid;place-items:center;align-self:start;margin-top:2px}
  .row-ic svg{width:20px;height:20px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .row-ic.alert-red svg{stroke:var(--red)}
  .row-ic.alert-amber svg{stroke:var(--amber)}
  .row-ic.ok svg{stroke:var(--green)}
  .row-main{min-width:0}
  /* secondary top line: the pursuit title */
  .row-title{font:500 13.5px Inter,sans-serif;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  /* the NEXT ACTION label — small uppercase */
  .row-nalabel{font:700 9.5px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-top:6px}
  /* THE dominant focal line — the next action, large + bold */
  .row-action{font:700 16.5px Inter,sans-serif;color:var(--ink);letter-spacing:-.01em;line-height:1.25;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .row-action.empty{color:var(--faint);font-weight:600}
  /* small meta line under the action: due-relative · Updated N ago */
  .row-meta{display:flex;align-items:center;flex-wrap:wrap;gap:0;margin-top:5px;font:600 11.5px Inter,sans-serif}
  .row-meta .m{color:var(--sub)}
  .row-meta .m.over{color:var(--red)}.row-meta .m.soon{color:var(--amber)}
  .row-meta .updated{color:var(--faint);font-weight:500}
  .row-meta .dot{width:3px;height:3px;border-radius:50%;background:var(--faint);margin:0 8px;flex:none}
  .stagechip{font:600 11px Inter,sans-serif;color:#1e3a8a;background:#eef3ff;border:1px solid #dbe6ff;border-radius:999px;padding:2px 9px;white-space:nowrap}
  .col-stage,.col-health,.col-value{display:flex;justify-content:flex-end}
  /* small far-right value chip (de-emphasized) */
  .valchip{font:600 12px Inter,sans-serif;color:var(--sub);background:var(--wash);border:1px solid var(--line);border-radius:8px;padding:3px 9px;white-space:nowrap}
  .hchip{font:700 11px Inter,sans-serif;border-radius:999px;padding:3px 10px;white-space:nowrap;display:inline-block}
  .hchip.atrisk{color:#fff;background:var(--red)}
  .hchip.attention{color:#7a4a00;background:#fff2dc;border:1px solid #ffe0ab}
  .hchip.healthy{color:#0a6b45;background:#eafaf2;border:1px solid #c9efdd}
  .hchip.stalled{color:#475569;background:#eef2f6;border:1px solid #dbe2ea}
  .row-cta{display:inline-flex;align-items:center;justify-content:center;font:700 12px Inter,sans-serif;color:var(--blue);
    background:#fff;border:1px solid #cfe0ff;border-radius:9px;padding:7px 12px;cursor:pointer;text-decoration:none;white-space:nowrap}
  .row-cta:hover{background:#f5f9ff;border-color:var(--blue)}
  .row-kebab{width:28px;height:28px;border:0;background:none;color:var(--faint);cursor:pointer;border-radius:7px;display:grid;place-items:center}
  .row-kebab:hover{background:var(--hair);color:var(--sub)}
  .row-kebab[aria-expanded="true"]{background:var(--hair);color:var(--ink)}
  .row-kebab svg{width:16px;height:16px;fill:currentColor}
  /* row-kebab dropdown menu */
  .row-kmenu{position:relative;display:inline-flex}
  .km-pop{position:absolute;top:32px;right:0;z-index:20;min-width:194px;background:#fff;border:1px solid var(--line);
    border-radius:11px;box-shadow:0 12px 30px -8px rgba(17,28,38,.28);padding:5px;display:flex;flex-direction:column}
  .km-item{display:block;width:100%;text-align:left;border:0;background:none;cursor:pointer;
    font:600 13px Inter,sans-serif;color:var(--ink);padding:8px 10px;border-radius:7px;white-space:nowrap}
  .km-item:hover{background:var(--wash)}
  .km-item:disabled{color:var(--faint);cursor:default;background:none}
  .km-item.km-danger{color:var(--red)}
  .km-item.km-danger:hover{background:#fdecec}
  .km-sep{height:1px;background:var(--hair);margin:4px 2px}
  /* ── Sidebar cards ── */
  .side{display:flex;flex-direction:column;gap:16px}
  .scard{border:1px solid var(--line);border-radius:14px;background:#fff;padding:16px 16px}
  .sc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
  .sc-title{font:700 14px Inter,sans-serif;letter-spacing:-.01em}
  .sc-link{font:600 12.5px Inter,sans-serif;color:var(--blue);text-decoration:none}
  .sc-link:hover{text-decoration:underline}
  .sc-empty{font:500 13px Inter,sans-serif;color:var(--faint);line-height:1.45;padding:6px 0}
  /* agenda timeline */
  .agenda{list-style:none;display:flex;flex-direction:column;gap:2px}
  .ag-item{display:grid;grid-template-columns:64px 1fr;gap:10px;padding:9px 0;border-top:1px solid var(--hair)}
  .ag-item:first-child{border-top:0}
  .ag-time{font:700 11.5px Inter,sans-serif;color:var(--sub);text-align:right;padding-top:1px}
  .ag-time.over{color:var(--red)}.ag-time.soon{color:var(--amber)}
  .ag-body{min-width:0}
  .ag-act{font:700 13px Inter,sans-serif;color:var(--ink);white-space:normal}
  .ag-opp{font:600 12px Inter,sans-serif;color:var(--purple);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* donut */
  .donutwrap{display:flex;align-items:center;gap:16px}
  .donut{position:relative;width:104px;height:104px;flex:none;border-radius:50%}
  .donut::after{content:"";position:absolute;inset:16px;background:#fff;border-radius:50%}
  .donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:2}
  .donut-center .n{font:800 22px Inter,sans-serif;line-height:1;letter-spacing:-.02em}
  .donut-center .l{font:600 10px Inter,sans-serif;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
  .legend{display:flex;flex-direction:column;gap:7px;flex:1;min-width:0}
  .lg-item{display:flex;align-items:center;gap:8px;font:600 12.5px Inter,sans-serif;color:var(--ink)}
  .lg-dot{width:10px;height:10px;border-radius:3px;flex:none}
  .lg-n{margin-left:auto;font:700 12.5px Inter,sans-serif;color:var(--sub)}
  /* empty / signin */
  .empty{text-align:center;padding:56px 20px;color:var(--sub)}
  .empty h3{font-size:19px;color:var(--ink);margin-bottom:8px}
  .empty a{color:var(--blue);font-weight:600;text-decoration:none}
  .signin{padding:44px 20px;text-align:center;color:var(--sub)}
  .signin a{color:var(--blue);font-weight:600;text-decoration:none}
  .loadline{padding:40px 20px;text-align:center;color:var(--faint);font:500 14px Inter,sans-serif}
  ${ACCOUNT_MENU_CSS}
</style></head><body>
<header class="zhead">
  <nav class="zh-left">
    <a href="/opportunity-map">Map</a>
    <a href="/opportunity-map">Players</a>
    <a class="zh-on" href="/opportunity-map/pursuits">Pursuits</a>
    <a href="/opportunity-map/reports">Reports</a>
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
  <a href="/opportunity-map/favorites" title="Saved — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Saved</span></a>
  <a class="on" href="/opportunity-map/pursuits" title="Pursuits — opportunities you're actively working"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Pursuits</span></a>
</nav>
<div class="main">
<div class="wrap">
  <div class="phead">
    <div>
      <h1>Pursuits</h1>
      <div class="sub">What needs your attention today &mdash; and what&rsquo;s waiting on you.</div>
    </div>
    <a class="btn-primary" href="/opportunity-map" title="Capture a pursuit from the map">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      Add pursuit
    </a>
  </div>
  <div id="body"><div class="loadline">Loading your pursuits&hellip;</div></div>
</div>
</div>
<script>
(function(){
  // ── Auth helpers (verbatim from favorites/route.ts) ──
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  var t=tok(), em=email(), body=document.getElementById('body');
  function hdrs(){ return {'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em}; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  if(!t||!em){ body.innerHTML='<div class="signin">Please <a href="/app?next=%2Fopportunity-map%2Fpursuits">sign in</a> to see your pursuits.</div>'; return; }

  // ── Derived-value helpers (grounded rules, never fabrication) ──
  var DAY=86400000;
  function startOfToday(){ var d=new Date(); d.setHours(0,0,0,0); return d; }
  // parseMoney: value_estimate can be a string ("$6.2M", "$500K", "1200000") or a number.
  function parseMoney(v){
    if(v==null) return 0;
    if(typeof v==='number') return isFinite(v)?v:0;
    var s=String(v); var m=s.match(/\\$?\\s*([\\d,.]+)\\s*(k|m|b)?/i);
    if(!m) return 0;
    var n=parseFloat(m[1].replace(/,/g,'')); if(!isFinite(n)) return 0;
    var suf=(m[2]||'').toLowerCase();
    if(suf==='b') n*=1e9; else if(suf==='m') n*=1e6; else if(suf==='k') n*=1e3;
    return n;
  }
  function fmtMoney(n){ n=Number(n); if(!isFinite(n)||n<=0) return '\\u2014';
    if(n>=1e9) return '$'+(n/1e9).toFixed(1).replace(/\\.0$/,'')+'B';
    if(n>=1e6) return '$'+(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M';
    if(n>=1e3) return '$'+Math.round(n/1e3)+'K';
    return '$'+Math.round(n);
  }
  // stageProb: default win-probability by stage when win_probability isn't stored.
  function stageProb(stage){ return ({tracking:15,pursuing:40,bidding:70,submitted:100,won:100,lost:0,archived:0})[stage]||20; }
  // progress % by stage (drives the Active-group progress bar).
  function stageProgress(stage){ return ({tracking:15,pursuing:40,bidding:70,submitted:100,won:100,lost:0,archived:0})[stage]!=null?({tracking:15,pursuing:40,bidding:70,submitted:100,won:100,lost:0,archived:0})[stage]:20; }
  // stageLabel: map internal stage → the workflow label shown in the chip.
  function stageLabel(stage){ return ({tracking:'Research',pursuing:'Capture',bidding:'Proposal',submitted:'Submitted',won:'Won',lost:'Lost',archived:'Archived'})[stage]||'Tracking'; }
  function parseDate(s){ if(!s) return null; var d=new Date(s); return isNaN(d.getTime())?null:d; }
  function daysUntil(s){ var d=parseDate(s); if(!d) return null; return Math.ceil((d-startOfToday())/DAY); }
  function isActive(p){ return ['won','lost','archived'].indexOf(p.stage||'tracking')===-1; }
  // isNeedsAttention: overdue next action OR deadline <=3 days OR critical/high priority.
  function isNeedsAttention(p){
    if(!isActive(p)) return false;
    var nad=daysUntil(p.next_action_date); if(nad!=null && nad<0) return true;
    var rd=daysUntil(p.response_deadline); if(rd!=null && rd<=3 && rd>=-30) return true;
    if(p.priority==='critical'||p.priority==='high') return true;
    return false;
  }
  // deriveHealth: returns {level, reason}. level = 'at_risk'|'attention'|'stalled'|'healthy'.
  // reason is a short grounded phrase traced to a real field (deadline/next_action_date/priority);
  // '' when there is nothing to add (healthy). NEVER invented.
  function deriveHealth(p){
    if(!isActive(p)) return {level:'healthy', reason:''};
    var nad=daysUntil(p.next_action_date), rd=daysUntil(p.response_deadline);
    // At Risk: overdue action, or a deadline within 3 days, or critical priority.
    if(nad!=null && nad<0) return {level:'at_risk', reason:'action overdue'};
    if(rd!=null && rd<=3 && rd>=-30) return {level:'at_risk', reason: rd<0 ? 'closed '+(-rd)+'d ago' : (rd===0 ? 'closes today' : 'closes in '+rd+'d')};
    if(p.priority==='critical') return {level:'at_risk', reason:'critical'};
    // Stalled: tracking with no next action and no next-action date (no movement).
    if((p.stage||'tracking')==='tracking' && !p.next_action && !p.next_action_date) return {level:'stalled', reason:'no next step'};
    // Attention: high priority, or a deadline within 7 days.
    if(rd!=null && rd<=7 && rd>=0) return {level:'attention', reason:'due in '+rd+'d'};
    if(p.priority==='high') return {level:'attention', reason:'high priority'};
    return {level:'healthy', reason:''};
  }
  // relDue: relative label for a date ("Overdue 2d", "Today", "in 5d", "Aug 17").
  function relDue(s){
    var d=daysUntil(s); if(d==null) return {txt:'',cls:'norm'};
    if(d<0) return {txt:'Overdue '+(-d)+'d', cls:'over'};
    if(d===0) return {txt:'Today', cls:'soon'};
    if(d===1) return {txt:'Tomorrow', cls:'soon'};
    if(d<=7) return {txt:'in '+d+'d', cls:'soon'};
    return {txt:fmtShortDate(s), cls:'norm'};
  }
  function fmtShortDate(s){ var d=parseDate(s); if(!d) return ''; try{ return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }catch(e){return '';} }
  function fmtLongDate(s){ var d=parseDate(s); if(!d) return ''; try{ return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }catch(e){return '';} }
  // relTime: "just now" / "5 minutes ago" / "2 hours ago" / "3 days ago" / a short date beyond ~30d.
  // From a real updated_at timestamp only; returns '' if the date is unparseable.
  function relTime(s){
    var d=parseDate(s); if(!d) return '';
    var diff=Date.now()-d.getTime(); if(diff<0) diff=0;
    var mins=Math.floor(diff/60000);
    if(mins<1) return 'just now';
    if(mins<60) return mins+' minute'+(mins===1?'':'s')+' ago';
    var hrs=Math.floor(mins/60);
    if(hrs<24) return hrs+' hour'+(hrs===1?'':'s')+' ago';
    var days=Math.floor(hrs/24);
    if(days<=30) return days+' day'+(days===1?'':'s')+' ago';
    return 'on '+fmtShortDate(s);
  }
  function weightedValue(p){ var v=parseMoney(p.value_estimate);
    var prob=(typeof p.win_probability==='number'&&isFinite(p.win_probability))?p.win_probability:stageProb(p.stage||'tracking');
    return v*(prob/100);
  }
  function subLine(p){ var id=p.notice_id||p.naics_code||''; var ag=p.agency||''; var parts=[];
    if(id)parts.push(String(id)); if(ag)parts.push(ag); return parts.join(' \\u00b7 '); }
  // Continue -> the opp's drawer on the map when we have a notice. A pursuit with no notice_id has
  // no map listing to open, so fall back to the map itself (stay on-map, never bounce out to /app).
  function continueHref(p){ return p.notice_id ? ('/opportunity-map?opp='+encodeURIComponent(p.notice_id)) : '/opportunity-map'; }

  var ALL=[], QUERY='', FILTER='';  // FILTER: ''|'attn'|'due'|'wait'|'all' — a clicked KPI narrows the list to that group.

  fetch('/api/pipeline?email='+encodeURIComponent(em)+'&stats=true',{headers:hdrs()})
    .then(function(r){ return r.json(); })
    .then(function(d){
      // The pursuits array is returned under the .opportunities key (api/pipeline GET).
      ALL=(d&&d.opportunities)||[];
      render();
    })
    .catch(function(){
      body.innerHTML='<div class="signin">Couldn\\u2019t load your pursuits. Please try again shortly.</div>';
    });

  function filtered(){
    var q=QUERY.trim().toLowerCase();
    if(!q) return ALL;
    return ALL.filter(function(p){
      return String(p.title||'').toLowerCase().indexOf(q)>-1
        || String(p.agency||'').toLowerCase().indexOf(q)>-1;
    });
  }

  function stageChip(p){ return '<span class="stagechip">'+esc(stageLabel(p.stage||'tracking'))+'</span>'; }
  function stageCell(p){ return '<div class="col-stage">'+stageChip(p)+'</div>'; }
  // Small far-right value chip — de-emphasized, and only when a real value exists.
  function valueCell(p){ var v=parseMoney(p.value_estimate); if(v<=0) return '<div class="col-value"></div>';
    return '<div class="col-value"><span class="valchip">'+esc(fmtMoney(v))+'</span></div>'; }
  // Health chip WITH a grounded reason (from deriveHealth). Healthy shows no reason.
  function healthCell(hr){
    var map={at_risk:['atrisk','At Risk'],attention:['attention','Needs attention'],healthy:['healthy','On track'],stalled:['stalled','Stalled']};
    var m=map[hr.level]||map.healthy;
    var label=(hr.reason&&hr.level!=='healthy')?(m[1]+' \\u00b7 '+hr.reason):m[1];
    return '<div class="col-health"><span class="hchip '+m[0]+'">'+esc(label)+'</span></div>';
  }
  // Row kebab -> a REAL dropdown of grounded actions, each wired to a live /api/pipeline call
  // (PATCH stage / DELETE) or an in-app link. id + notice_id + stage ride on data-attrs so the
  // menu handlers act on the exact row. No fabricated actions — every item maps to a real endpoint.
  function kebab(p){
    var id=esc(p.id||''); var nid=esc(p.notice_id||''); var stage=String(p.stage||'tracking');
    // A row with no id can't be PATCHed/DELETEd -> only the read-only "Open on map" is offered.
    // NOTE: terminal pursuits (won/lost/archived) are bucketed OUT of the grouped list entirely,
    // so a kebab only ever renders on an ACTIVE row — every outcome-setter is always applicable here.
    var canEdit=!!id;
    var items='';
    if(nid) items+='<button class="km-item" data-kact="openmap" data-nid="'+nid+'">Open on map</button>';
    if(canEdit){
      items+='<button class="km-item" data-kact="setstep">Set next step\\u2026</button>';
      items+='<div class="km-sep"></div>';
      items+='<button class="km-item" data-kact="won">Mark won</button>';
      items+='<button class="km-item" data-kact="lost">Mark lost</button>';
      items+='<button class="km-item" data-kact="nobid">No-bid (archive)</button>';
      items+='<div class="km-sep"></div>';
      items+='<button class="km-item km-danger" data-kact="remove">Remove from pursuits</button>';
    }
    // A row with neither id nor notice_id has no action at all -> no kebab (don't render a dead control).
    if(!items) return '';
    return '<div class="row-kmenu">'
      + '<button class="row-kebab" title="More actions" aria-haspopup="menu" aria-expanded="false" data-kid="'+id+'" data-nid="'+nid+'" data-stage="'+esc(stage)+'" data-title="'+esc(p.title||'')+'" onclick="event.preventDefault();event.stopPropagation();window.togglePursuitMenu(this);"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>'
      + '<div class="km-pop" role="menu" data-kid="'+id+'" hidden>'+items+'</div></div>'; }
  function cta(p){ return '<a class="row-cta" href="'+continueHref(p)+'">Continue</a>'; }

  // humanizeAction: next_action is a human sentence, but an internal action-KEY enum
  // (e.g. 'request_pursuit_brief') has leaked into that field on real rows. Since the action
  // is now the DOMINANT focal line, never render a raw snake_case enum. A known key maps to a
  // friendly label; an unknown all-lowercase snake_case token falls back to '' (→ "No next step
  // set"). A real sentence (spaces/capitals/punctuation) passes through verbatim.
  var ACTION_KEY_LABELS={
    request_pursuit_brief:'Request a pursuit brief',
    draft_response:'Draft your response',
    research_agency_incumbent:'Research the agency & incumbent',
    submit_loi:'Submit letter of intent'
  };
  function humanizeAction(raw){
    var s=String(raw==null?'':raw).trim();
    if(!s) return '';
    // all-lowercase snake_case with no spaces = an internal action key, not a sentence.
    if(/^[a-z]+(_[a-z]+)+$/.test(s)) return ACTION_KEY_LABELS[s]||'';
    return s; // genuine human sentence
  }

  // The action-led main column: title (secondary) → NEXT ACTION label → the action (dominant) → meta.
  // next_action is rendered VERBATIM as the focal line (after the snake_case-enum guard). When
  // empty, a muted honest prompt (never fabricated).
  function rowMain(p){
    var title='<div class="row-title">'+esc(p.title||'Untitled pursuit')+'</div>';
    var actionText=humanizeAction(p.next_action);
    var hasAction=!!actionText;
    // Due-relative for the meta line: prefer the next-action date, else the response deadline.
    var whenSrc=p.next_action_date||p.response_deadline||null;
    var r=whenSrc?relDue(whenSrc):{txt:'',cls:'norm'};
    var action, label='';
    if(hasAction){
      label='<div class="row-nalabel">Next action</div>';
      action='<div class="row-action">'+esc(actionText)+'</div>';
    } else {
      // No next step set — honest muted focal line, never an invented action.
      action='<div class="row-action empty">No next step set</div>';
    }
    // Meta line: due-relative (if any) · Updated N ago (only if updated_at is present).
    var parts=[];
    if(r.txt) parts.push('<span class="m '+r.cls+'">'+esc(r.txt)+'</span>');
    var ut=p.updated_at?relTime(p.updated_at):'';
    if(ut) parts.push('<span class="updated">Updated '+esc(ut)+'</span>');
    var meta = parts.length ? ('<div class="row-meta">'+parts.join('<span class="dot"></span>')+'</div>') : '';
    return '<div class="row-main">'+title+label+action+meta+'</div>';
  }
  function actionRowHtml(p, ic, healthHr){
    return '<div class="prow">'+ic+rowMain(p)+stageCell(p)+healthCell(healthHr)+valueCell(p)+cta(p)+kebab(p)+'</div>';
  }

  // Needs-Attention row: alert icon (red/amber by level) + action-led main + stage + health(reason) + value.
  function attentionRow(p){
    var hr=deriveHealth(p);
    var icCls=hr.level==='at_risk'?'alert-red':'alert-amber';
    var ic='<div class="row-ic '+icCls+'"><svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg></div>';
    return actionRowHtml(p, ic, hr);
  }
  // Active row: green check icon; health derived (usually On track / Needs attention).
  function activeRow(p){
    var hr=deriveHealth(p);
    var ic='<div class="row-ic ok"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div>';
    return actionRowHtml(p, ic, hr);
  }
  // Simple row for Waiting/Submitted groups (collapsed by default; light clock icon).
  function simpleRow(p){
    var hr=deriveHealth(p);
    var ic='<div class="row-ic ok"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 2"/></svg></div>';
    return actionRowHtml(p, ic, hr);
  }

  function groupBlock(cls,title,rowsHtml,count,collapsed){
    return '<div class="pgroup '+cls+(collapsed?' collapsed':'')+'">'
      +'<div class="pg-head" onclick="this.parentNode.classList.toggle(\\'collapsed\\')">'
      +'<svg class="pg-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>'
      +'<span class="pg-title">'+esc(title)+'</span><span class="pg-count">'+count+'</span></div>'
      +'<div class="pg-body">'+(rowsHtml||'')+'</div></div>';
  }

  function render(){
    if(!ALL.length){
      body.innerHTML='<div class="empty"><h3>No pursuits yet</h3><p>Save an opportunity from the map to start tracking it.</p>'
        +'<p style="margin-top:14px"><a href="/opportunity-map">Go to the map \\u2192</a></p></div>';
      return;
    }
    var rows=filtered();

    // ── Buckets ──
    var needs=[], active=[], waiting=[], submitted=[];
    rows.forEach(function(p){
      var stage=p.stage||'tracking';
      if(isNeedsAttention(p)){ needs.push(p); return; }
      if(stage==='submitted'){ submitted.push(p); return; }
      if(stage==='tracking'){ waiting.push(p); return; }
      if(stage==='pursuing'||stage==='bidding'){ active.push(p); return; }
      // won/lost/archived and anything else → skip the grouped list (not "active work").
    });

    // ── KPI numbers (all from the FULL set, not the search view) ──
    // All work-oriented + grounded — Pipeline value lives in Reports, not here.
    var activePursuits=ALL.filter(isActive);
    var attentionCount=ALL.filter(isNeedsAttention).length;
    var onTrack=activePursuits.length-attentionCount; if(onTrack<0)onTrack=0;
    var dueSoon=activePursuits.filter(function(p){
      var a=daysUntil(p.next_action_date), b=daysUntil(p.response_deadline);
      return (a!=null&&a>=0&&a<=7)||(b!=null&&b>=0&&b<=7);
    }).length;
    // "Waiting on you" = active pursuits with NO next step set — the ball is in YOUR court to
    // define the next action. This is the ONLY grounded reading of "waiting": user_pipeline has
    // no waiting_on/blocked_on field, so a typed "Waiting on Customer/Amendment" would be
    // fabricated. "Waiting on you" is true from the data (next_action empty) and actionable.
    var waitingOnYouCount=ALL.filter(function(p){ return isActive(p) && !humanizeAction(p.next_action); }).length;

    // KPI ORDER = optimize for ACTION, not inventory (Eric): Needs Attention leads; Active is last.
    var kpis='<div class="kpis">'
      +kpi('red','<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',attentionCount,'Needs attention', attentionCount>0?'See below':'All clear', 'attn')
      +kpi('amber','<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',dueSoon,'Due this week', dueSoon>0?'Filter to these':'Nothing due', 'due')
      +kpi('blue','<path d="M12 8v8M8 12h8"/><circle cx="12" cy="12" r="9"/>',waitingOnYouCount,'Waiting on you','No next step set', 'wait')
      +kpi('green','<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/>',activePursuits.length,'Active pursuits',onTrack+' on track', 'all')
      +'</div>';

    var toolbar='<div class="toolbar">'
      +'<div class="tb-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>'
      +'<input id="pq" type="text" placeholder="Search pursuits\\u2026" value="'+esc(QUERY)+'"></div>'
      +'<button class="tb-btn" type="button">Owner: All <svg viewBox="0 0 11 7"><path d="M1 1l4.5 4.5L10 1"/></svg></button>'
      +'<button class="tb-btn" type="button">Status: All <svg viewBox="0 0 11 7"><path d="M1 1l4.5 4.5L10 1"/></svg></button>'
      +'<button class="tb-btn" type="button">Health: All <svg viewBox="0 0 11 7"><path d="M1 1l4.5 4.5L10 1"/></svg></button>'
      +'<button class="tb-btn" type="button"><svg viewBox="0 0 24 24" width="14" height="14" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round"><path d="M3 5h18M6 12h12M10 19h4"/></svg> Filters</button>'
      +'<div class="tb-spacer"></div>'
      +'<div class="tb-toggle"><button class="on" title="Grid"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button>'
      +'<button title="List"><svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></button></div></div>';

    // A clicked KPI narrows to one focused group. 'wait'/'due' span buckets, so each renders as its
    // OWN single group; 'attn' shows just Needs Attention; 'all' + no-filter show the full grouped list.
    var groups='';
    if(FILTER==='wait'){
      var waitOnYou=rows.filter(function(p){ return isActive(p) && !humanizeAction(p.next_action); });
      groups=groupBlock('g-blue','Waiting on you',waitOnYou.map(activeRow).join(''),waitOnYou.length,false);
    } else if(FILTER==='due'){
      var dueRows=rows.filter(function(p){ var a=daysUntil(p.next_action_date), b=daysUntil(p.response_deadline); return isActive(p) && ((a!=null&&a>=0&&a<=7)||(b!=null&&b>=0&&b<=7)); });
      groups=groupBlock('g-amber','Due this week',dueRows.map(attentionRow).join(''),dueRows.length,false);
    } else if(FILTER==='attn'){
      groups=groupBlock('g-red','Needs Attention',needs.map(attentionRow).join(''),needs.length,false);
    } else {
      // Default (or 'all'): the full grouped list. Needs Attention is ALWAYS expanded when it has
      // rows — the page must answer "what needs me today?" the instant it loads (Eric: don't make me
      // click). When empty, omit it entirely (no dead empty group) + show a calm all-clear line.
      groups=''
        +(needs.length ? groupBlock('g-red','Needs Attention',needs.map(attentionRow).join(''),needs.length,false)
                       : '<div class="allclear"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>Nothing needs your attention right now.</div>')
        +groupBlock('g-amber','Active',active.map(activeRow).join(''),active.length,active.length===0)
        +groupBlock('g-blue','Waiting',waiting.map(simpleRow).join(''),waiting.length,true)
        +groupBlock('g-grey','Submitted',submitted.map(simpleRow).join(''),submitted.length,true);
    }
    if(FILTER){
      groups='<div class="filterbar"><span>Filtered by <b>'+esc(({attn:'Needs attention',due:'Due this week',wait:'Waiting on you',all:'All active'})[FILTER]||FILTER)+'</b></span>'
        +'<button type="button" id="clearFilter">Clear</button></div>'+groups;
    }

    var listCol='<div class="plist">'+groups+'</div>';
    var sideCol='<div class="side">'+agendaCard()+waitingCard()+healthCard()+activityCard()+'</div>';

    body.innerHTML=kpis+toolbar+'<div class="pmain">'+listCol+sideCol+'</div>';

    var pq=document.getElementById('pq');
    if(pq){ pq.oninput=function(){ QUERY=pq.value; render(); setTimeout(function(){ var f=document.getElementById('pq'); if(f){ f.focus(); f.setSelectionRange(f.value.length,f.value.length); } },0); }; }

    // Clickable KPI filters: click a card to narrow to its bucket; click the active one (or Clear) to reset.
    function setFilter(k){ FILTER=(FILTER===k)?'':k; render(); }
    Array.prototype.forEach.call(document.querySelectorAll('.kpi.clickable'),function(el){
      el.addEventListener('click',function(){ setFilter(el.getAttribute('data-fkey')); });
      el.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setFilter(el.getAttribute('data-fkey')); } });
    });
    var cf=document.getElementById('clearFilter'); if(cf){ cf.onclick=function(){ FILTER=''; render(); }; }
    var wlink=document.getElementById('waitOnYouLink'); if(wlink){ wlink.onclick=function(e){ e.preventDefault(); FILTER='wait'; render(); }; }

    // Row-kebab menu: one delegated click handler for every menu item (survives re-renders).
    Array.prototype.forEach.call(document.querySelectorAll('.km-pop .km-item'),function(el){
      el.addEventListener('click',function(e){
        e.preventDefault(); e.stopPropagation();
        var pop=el.parentNode; var id=pop&&pop.getAttribute('data-kid');
        window.runPursuitAction(el.getAttribute('data-kact'), id, el);
      });
    });
  }

  // KPI card — clickable filter. fkey narrows the list to that bucket; clicking the active one clears.
  function kpi(color,iconPath,num,lbl,sub,fkey){
    var on=(fkey&&FILTER===fkey)?' on':'';
    var attr=fkey?(' role="button" tabindex="0" data-fkey="'+fkey+'"'):'';
    return '<div class="kpi'+(fkey?' clickable':'')+on+'"'+attr+'><div class="kpi-ic '+color+'"><svg viewBox="0 0 24 24">'+iconPath+'</svg></div>'
      +'<div class="kpi-body"><div class="kpi-num">'+esc(String(num))+'</div><div class="kpi-lbl">'+esc(lbl)+'</div><div class="kpi-sub">'+esc(sub)+'</div></div></div>';
  }

  // ── Today's Agenda: built from REAL next_action_date items, soonest first. ──
  function agendaCard(){
    var items=ALL.filter(function(p){ return isActive(p) && p.next_action_date && p.next_action; })
      .map(function(p){ return {p:p, d:parseDate(p.next_action_date), act:humanizeAction(p.next_action)}; })
      // require both a real date AND a human-readable action (drops rows whose next_action is a bare enum key)
      .filter(function(x){ return x.d && x.act; })
      .sort(function(a,b){ return a.d-b.d; })
      .slice(0,6);
    var inner;
    if(!items.length){
      inner='<div class="sc-empty">No scheduled actions \\u2014 add a next step to a pursuit.</div>';
    } else {
      inner='<ul class="agenda">'+items.map(function(x){
        var r=relDue(x.p.next_action_date);
        var timeLbl=r.txt||fmtShortDate(x.p.next_action_date);
        return '<li class="ag-item"><div class="ag-time '+r.cls+'">'+esc(timeLbl)+'</div>'
          +'<div class="ag-body"><div class="ag-act">'+esc(x.act)+'</div>'
          +'<div class="ag-opp">'+esc(x.p.title||'Untitled pursuit')+'</div></div></li>';
      }).join('')+'</ul>';
    }
    // No "View calendar" link — there's no map calendar surface, and THIS card IS the agenda
    // (next actions, soonest first). A link to /app?panel=pipeline pointed at the pipeline board,
    // not a calendar, so it was both an /app exit and mislabeled. Dropped.
    return '<div class="scard"><div class="sc-head"><span class="sc-title">Today\\u2019s Agenda</span></div>'+inner+'</div>';
  }

  // ── Waiting on you: the grounded bottleneck card. Counts active pursuits with NO next step
  //    set (the ball is in your court). NO fabricated "waiting on customer/amendment" — that
  //    signal does not exist in user_pipeline. Clicking filters the list to that set. ──
  function waitingCard(){
    var wy=ALL.filter(function(p){ return isActive(p) && !humanizeAction(p.next_action); });
    var inner;
    if(!wy.length){
      inner='<div class="sc-empty">Every active pursuit has a next step. Nothing waiting on you.</div>';
    } else {
      inner='<a href="#" id="waitOnYouLink" class="waitrow">'
        +'<span class="waitn">'+wy.length+'</span>'
        +'<span class="waitlbl">'+(wy.length===1?'pursuit needs':'pursuits need')+' a next step \\u2014 set one to keep it moving</span>'
        +'<svg viewBox="0 0 24 24" class="waitarrow"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>';
    }
    return '<div class="scard"><div class="sc-head"><span class="sc-title">Waiting on you</span></div>'+inner+'</div>';
  }

  // ── Pursuit Health donut: derived split of ACTIVE pursuits. ──
  function healthCard(){
    var active=ALL.filter(isActive);
    var c={healthy:0,attention:0,at_risk:0,stalled:0};
    active.forEach(function(p){ var h=deriveHealth(p).level; c[h]=(c[h]||0)+1; });
    var total=active.length;
    var COL={healthy:'#22a06b',attention:'#f59e0b',at_risk:'#e5484d',stalled:'#94a3b8'};
    var ORDER=['healthy','attention','at_risk','stalled'];
    var LBL={healthy:'Healthy',attention:'Needs Attention',at_risk:'At Risk',stalled:'Stalled'};
    var donutBg;
    if(total===0){ donutBg='background:#eef2f6'; }
    else {
      var stops=[], acc=0;
      ORDER.forEach(function(k){ if(c[k]>0){ var from=acc/total*360, to=(acc+c[k])/total*360; stops.push(COL[k]+' '+from.toFixed(2)+'deg '+to.toFixed(2)+'deg'); acc+=c[k]; } });
      donutBg='background:conic-gradient('+stops.join(',')+')';
    }
    var legend=ORDER.map(function(k){
      return '<div class="lg-item"><span class="lg-dot" style="background:'+COL[k]+'"></span>'+LBL[k]+'<span class="lg-n">'+c[k]+'</span></div>';
    }).join('');
    return '<div class="scard"><div class="sc-head"><span class="sc-title">Pursuit Health</span></div>'
      +'<div class="donutwrap"><div class="donut" style="'+donutBg+'"><div class="donut-center"><div class="n">'+total+'</div><div class="l">Active</div></div></div>'
      +'<div class="legend">'+legend+'</div></div></div>';
  }

  // ── Recent Activity: honest placeholder (no activity-log table yet). ──
  function activityCard(){
    return '<div class="scard"><div class="sc-head"><span class="sc-title">Recent Activity</span></div>'
      +'<div class="sc-empty">Activity feed coming soon \\u2014 we\\u2019ll show edits, uploads and stage changes here.</div></div>';
  }

  // Watchlist badge on the rail (same fetch the map/favorites pages use).
  fetch('/api/app/saved-searches?badge=1&email='+encodeURIComponent(em),{headers:hdrs()})
    .then(function(r){return r.json();}).then(function(d){
      var n=(d&&d.success&&d.count)?d.count:0; var b=document.getElementById('savedBadge');
      if(b){ if(n>0){ b.textContent=n>99?'99+':String(n); b.hidden=false; } else { b.hidden=true; } }
    }).catch(function(){});

  // ── Row-kebab dropdown: open/close + grounded actions (Open on map / Set next step /
  //    Mark won-lost / No-bid / Remove). Every mutating action hits the REAL /api/pipeline
  //    PATCH or DELETE; terminal + destructive actions confirm first. ──
  function closeAllMenus(){
    Array.prototype.forEach.call(document.querySelectorAll('.km-pop:not([hidden])'),function(p){ p.hidden=true; });
    Array.prototype.forEach.call(document.querySelectorAll('.row-kebab[aria-expanded="true"]'),function(b){ b.setAttribute('aria-expanded','false'); });
    // release the overflow-escape on any group/list that had it
    Array.prototype.forEach.call(document.querySelectorAll('.pgroup.menu-open,.plist.menu-open'),function(g){ g.classList.remove('menu-open'); });
  }
  window.togglePursuitMenu=function(btn){
    var pop=btn.parentNode.querySelector('.km-pop'); if(!pop)return;
    var wasOpen=!pop.hidden; closeAllMenus();
    if(!wasOpen){
      pop.hidden=false; btn.setAttribute('aria-expanded','true');
      // let the menu escape the group card's overflow:hidden clip
      var grp=btn.closest?btn.closest('.pgroup'):null; if(grp) grp.classList.add('menu-open');
      var lst=btn.closest?btn.closest('.plist'):null; if(lst) lst.classList.add('menu-open');
    }
  };
  // Close on any outside click / Escape.
  document.addEventListener('click',function(e){ if(!e.target.closest || !e.target.closest('.row-kmenu')) closeAllMenus(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeAllMenus(); });

  // Find the pursuit row object by id (for title in confirms + optimistic local update).
  function pursuitById(id){ for(var i=0;i<ALL.length;i++){ if(String(ALL[i].id)===String(id)) return ALL[i]; } return null; }

  window.runPursuitAction=function(act, id, el){
    closeAllMenus();
    if(act==='openmap'){ var nid=el&&el.getAttribute('data-nid'); if(nid) window.location.href='/opportunity-map?opp='+encodeURIComponent(nid); return; }
    var p=pursuitById(id); if(!p){ return; }
    var title=p.title||'this pursuit';

    if(act==='setstep'){
      var cur=(typeof p.next_action==='string'&&!/^[a-z]+(_[a-z]+)+$/.test(p.next_action.trim()))?p.next_action:'';
      var next=window.prompt('Next step for \\u201c'+title+'\\u201d:', cur);
      if(next===null) return;              // cancelled
      next=String(next).trim();
      patchPursuit(id, { next_action: next }, 'next step updated'); return;
    }
    if(act==='won'||act==='lost'||act==='nobid'){
      var stageMap={won:'won',lost:'lost',nobid:'archived'};
      var verb={won:'won',lost:'lost',nobid:'no-bid'}[act];
      // Terminal outcomes confirm — they move the pursuit out of the active list.
      if(!window.confirm('Mark \\u201c'+title+'\\u201d as '+verb+'? This closes the pursuit.')) return;
      patchPursuit(id, { stage: stageMap[act] }, verb); return;
    }
    if(act==='remove'){
      if(!window.confirm('Remove \\u201c'+title+'\\u201d from your pursuits? This can\\u2019t be undone.')) return;
      deletePursuit(id, title); return;
    }
  };

  function patchPursuit(id, updates, okword){
    var payload={ id:id, user_email:em }; for(var k in updates){ if(updates.hasOwnProperty(k)) payload[k]=updates[k]; }
    fetch('/api/pipeline',{method:'PATCH',headers:hdrs(),body:JSON.stringify(payload)})
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        if(!res.ok || (res.d&&res.d.error)){ alert('Couldn\\u2019t update this pursuit ('+((res.d&&res.d.error)||res.ok===false&&'server error')+'). Try again.'); return; }
        // Reflect locally then re-render (grounded: use the server's returned row when present).
        var p=pursuitById(id); if(p){ for(var k in updates){ if(updates.hasOwnProperty(k)) p[k]=updates[k]; } if(res.d&&res.d.updated_at) p.updated_at=res.d.updated_at; }
        render();
      })
      .catch(function(){ alert('Couldn\\u2019t reach the server. Try again shortly.'); });
  }
  function deletePursuit(id, title){
    fetch('/api/pipeline',{method:'DELETE',headers:hdrs(),body:JSON.stringify({ id:id, user_email:em })})
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        if(!res.ok || (res.d&&res.d.error)){ alert('Couldn\\u2019t remove this pursuit. Try again.'); return; }
        ALL=ALL.filter(function(x){ return String(x.id)!==String(id); });   // drop it locally
        render();
      })
      .catch(function(){ alert('Couldn\\u2019t reach the server. Try again shortly.'); });
  }
})();
</script>
${ACCOUNT_MENU_JS}
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
