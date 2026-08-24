/**
 * GET /opportunity-map/vault — the Company Vault, rebuilt as a standalone LIGHT-theme
 * map sub-view (the approved redesign: identity hero + completeness meter + why-it-matters
 * strip + tabbed sections + provenance badges).
 *
 * SCOPE (Eric, corrected): this is the NEW page only — it must EXIST and WORK at its URL
 * for review. It does NOT touch the rail copies, account-menu.ts, or any other existing file.
 * Its OWN left rail (below) renders the rail items with Vault marked active, but that is
 * self-contained markup inside THIS file — the rail-sync + account-menu repoint are the
 * LATER migration step. See tasks / spec.
 *
 * Shell MIRRORS opportunity-map/favorites/route.ts: ZHEAD top nav + a self-contained ZRAIL
 * left rail + account-menu imports + MI-token localStorage auth + hdrs() fetch + sign-in
 * fallback. All in the map's LIGHT token system (copied from favorites).
 *
 * DATA (reuse 1:1): ONE fetch on load — GET /api/app/vault?email= (MI-token authed
 * server-side) -> { identity, past_performance, capabilities, team, documents }. Add/edit
 * writes go to the existing POST /api/app/vault/{past-performance,capabilities,team} and
 * PUT /api/app/vault/identity. Documents upload is add-CTA-only (deep-links to the /app vault
 * uploader — a multipart parse/commit flow, too large to re-host here faithfully this pass).
 *
 * GROUNDED: every value comes from the real payload. A 0-row section shows an honest empty
 * state + add CTA, never a fabricated row. Completeness = the 7 real checks. The past-perf
 * provenance badge reads the REAL `source` column (manual->Self-added / parsed_cap_stmt->From
 * cap statement / bulk_upload->Imported) — there is NO "SAM-matched" (no such column value).
 *
 * NO EMOJI — every icon is an inline sized SVG (fill:none;stroke:currentColor). The
 * artifact's pen / target / trend / check / plus glyphs are all replaced with lucide-style SVGs.
 */
import { NextResponse } from 'next/server';
import { LOGIN_MODAL_CSS, LOGIN_MODAL_HTML, LOGIN_MODAL_JS } from '../login-modal';
import { MAPS_HOME_PATH } from '@/lib/mindy/maps-home';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../account-menu';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vault — Mindy</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#006aff;--jan:#006aff;
    --grnd:#0f9d58;--grnd-line:#cfe9d9;--green:#22a06b;--recomp:#b26a00;--forecast:#7c5cff;--warm:#b54708;--con:#d92d20;--red:#e5484d;
    --disp:'Inter',system-ui,sans-serif;--sans:'Inter',system-ui,sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased}
  /* App chrome: top nav + left rail (mirror of opportunity-map ZHEAD/ZRAIL) */
  .zhead{position:sticky;top:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid var(--line);background:#fff;z-index:40}
  .zh-left,.zh-right{display:flex;align-items:center;gap:22px}
  .zh-left a{font:700 16px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}
  .zh-right a{font:700 15px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}
  .zh-left a:hover,.zh-right a:hover{color:var(--jan)}
  .zh-acct{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:1px solid var(--line);color:var(--sub)}
  .zh-logo{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;text-decoration:none}
  .zh-logo img{height:25px;width:auto;display:block}
  .zh-logo span{font:700 19px "Inter",system-ui,sans-serif;color:var(--ink);letter-spacing:-.02em}
  /* MOBILE HEADER (<=700px). The centre logo is position:absolute, so it does NOT take part
     in the flex layout — at 390px it sat ON TOP of the nav: measured 49px of overlap with
     "Players", and the logo also collided with "Pricing". A scrollWidth/overflow check
     cannot catch this (an absolutely-positioned element never widens the page), which is
     why the mobile journey passed while the header was visibly broken.
     Fix: below 640px the logo returns to NORMAL FLOW at the left, and the link navs
     collapse — the account button is what a mobile visitor actually needs. */
  @media(max-width:640px){
    .zhead{padding:0 14px;gap:10px}
    .zh-logo{position:static;transform:none;order:-1;flex:0 0 auto}
    .zh-left{display:none}
    .zh-right{gap:12px;margin-left:auto}
    .zh-right a{display:none}
    .zh-right .mindy-acct{display:block}
  }

  @media(max-width:1000px){.zh-left,.zh-right{gap:14px}.zh-left a:nth-child(n+3),.zh-right a:first-child{display:none}}
  .zrail{position:fixed;left:0;top:52px;width:64px;height:calc(100vh - 52px);height:calc(100dvh - 52px);
    background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:2px;padding:14px 0;z-index:30;overflow:hidden}
  .zrail a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--sub);text-decoration:none;padding:8px 2px;border-radius:11px;width:56px;min-height:48px}
  .zrail a:hover{background:var(--wash);color:var(--ink)}.zrail a.on{color:var(--jan);background:#eff5ff}
  .zrail svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .zrail a span{font:600 10px Inter,system-ui,sans-serif;letter-spacing:.01em;line-height:1}
  /* content area sits right of the 64px rail */
  .main{margin-left:64px}
  .wrap{max-width:1040px;margin:0 auto;padding:30px 24px 72px}
  /* Header */
  .kicker{font:700 12px Inter,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-bottom:7px;display:flex;align-items:center;gap:8px}
  .kicker svg{width:15px;height:15px;fill:none;stroke:var(--green);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  h1{font-size:32px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px}
  .lede{color:var(--sub);font-size:15px;margin-bottom:24px;line-height:1.45;max-width:640px}
  /* HERO */
  .hero{display:grid;grid-template-columns:1.35fr 1fr;gap:18px;margin-bottom:26px}
  @media(max-width:820px){.hero{grid-template-columns:1fr}}
  .idcard,.meter{border:1px solid var(--line);border-radius:16px;padding:20px 22px;background:#fff}
  .idtop{display:flex;align-items:center;gap:14px}
  .logo{width:52px;height:52px;flex:none;border-radius:14px;background:linear-gradient(135deg,#1e3a8a,#7c3aed);display:flex;align-items:center;justify-content:center;color:#fff;font:800 19px Inter,sans-serif;letter-spacing:.02em}
  .idname{font-size:20px;font-weight:800;letter-spacing:-.015em;line-height:1.2;min-width:0}
  .idloc{font-size:12.5px;color:var(--faint);margin-top:3px;line-height:1.3}
  .oneliner{font-size:13.5px;font-style:italic;color:var(--sub);border-left:3px solid var(--hair);padding-left:12px;margin:15px 0 4px;line-height:1.55}
  .idgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:16px}
  .idcell{border:1px solid var(--line);border-radius:11px;padding:8px 11px;background:var(--wash)}
  .idcell .k{font:700 9px ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
  .idcell .v{font:700 13px ui-monospace,Menlo,monospace;color:var(--ink);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .idcell.editable .k{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .idedit{border:0;background:none;padding:0;margin:0;cursor:pointer;color:var(--faint);line-height:0;opacity:.55;transition:opacity .12s,color .12s}
  .idcell.editable:hover .idedit,.idedit:focus-visible{opacity:1;color:var(--blue)}
  .idedit svg{width:13px;height:13px}
  .naics-editor{margin-top:4px;display:flex;flex-direction:column;gap:6px}
  .naics-editor input{width:100%;box-sizing:border-box;font:700 13px ui-monospace,Menlo,monospace;color:var(--ink);border:1px solid var(--blue);border-radius:7px;padding:5px 7px;outline:none}
  .naics-editor .nhint{font:500 10px Inter,system-ui,sans-serif;color:var(--sub)}
  .naics-editor .nrow{display:flex;gap:6px}
  .nbtn{font:700 11px Inter,system-ui,sans-serif;border-radius:7px;padding:5px 10px;cursor:pointer;border:1px solid var(--line)}
  .nbtn.save{background:var(--blue);color:#fff;border-color:var(--blue)}
  .nbtn.save:disabled{opacity:.6;cursor:default}
  .nbtn.cancel{background:#fff;color:var(--sub)}
  .naics-err{font:500 10px Inter,system-ui,sans-serif;color:#dc2626;display:none}
  .naics-err.show{display:block}
  .certrow{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}
  .certpill{display:inline-flex;align-items:center;gap:6px;font:700 11.5px Inter,sans-serif;color:var(--green);background:#eaf7f0;border:1px solid var(--grnd-line);border-radius:999px;padding:4px 11px}
  .certpill svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  /* meter */
  .meter{display:flex;flex-direction:column}
  .mpct{font-size:38px;font-weight:800;letter-spacing:-.03em;line-height:1}
  .mpct span{font-size:16px;color:var(--faint);font-weight:700}
  .mlabel{font:700 10px ui-monospace,Menlo,monospace;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);margin-top:5px}
  .mbar{height:8px;border-radius:999px;background:var(--hair);overflow:hidden;margin:15px 0 16px}
  .mbar>i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--forecast));transition:width .4s}
  .mtodo-h{font-size:13px;color:var(--sub);line-height:1.45;margin-bottom:11px}
  .mtodo-h b{color:var(--ink);font-weight:700}
  .todo{display:flex;flex-direction:column;gap:8px}
  .todo a{display:flex;align-items:center;gap:9px;text-decoration:none;font:600 13px Inter,sans-serif;color:var(--ink);border:1px solid var(--line);border-radius:11px;padding:9px 12px;background:#fff;cursor:pointer;transition:.14s}
  .todo a:hover{border-color:#b8ccf0;background:var(--wash)}
  .todo a .dot{width:7px;height:7px;border-radius:50%;background:var(--warm);flex:none}
  .todo a .add{margin-left:auto;color:var(--blue);font-weight:800;display:inline-flex;align-items:center;gap:4px}
  .todo a .add svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
  .mdone{display:flex;align-items:flex-start;gap:9px;font-size:13px;color:var(--green);font-weight:600;line-height:1.45}
  .mdone svg{width:17px;height:17px;flex:none;fill:none;stroke:var(--green);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;margin-top:1px}
  .lede .lede-priv{color:var(--faint)}
  /* to-do why-clause + label stacking */
  .todo a .todolbl{display:flex;flex-direction:column;gap:1px;min-width:0}
  .todo a .todowhy{font:500 11px Inter,sans-serif;color:var(--faint);line-height:1.3}
  /* PER-GROUP knowledge bars (grounded from vaultGroups) */
  .groups{margin-bottom:28px}
  .groups-h{font:800 13px Inter,sans-serif;letter-spacing:-.01em;color:var(--ink);margin-bottom:12px}
  .groups .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  @media(max-width:900px){.groups .grid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:520px){.groups .grid{grid-template-columns:1fr}}
  .gcard{display:block;border:1px solid var(--line);border-radius:14px;padding:14px 15px;background:var(--wash);text-decoration:none;color:inherit;cursor:pointer;transition:.14s}
  .gcard:hover{border-color:#b8ccf0;background:#fff}
  .gtop{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
  .gtitle{font:800 14px Inter,sans-serif;letter-spacing:-.01em;color:var(--ink)}
  .gpct{font:800 16px Inter,sans-serif;letter-spacing:-.02em;color:var(--blue)}
  .gq{font:600 11.5px Inter,sans-serif;color:var(--sub);margin-top:3px;line-height:1.3}
  .gbar{height:6px;border-radius:999px;background:var(--hair);overflow:hidden;margin:11px 0 12px}
  .gbar>i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--forecast))}
  .usedin{display:flex;flex-wrap:wrap;align-items:center;gap:5px}
  .usedlbl{font:700 9px ui-monospace,Menlo,monospace;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}
  .upill{display:inline-flex;align-items:center;gap:3px;font:600 10.5px Inter,sans-serif;color:var(--green);background:#eaf7f0;border:1px solid var(--grnd-line);border-radius:999px;padding:2px 7px}
  .upill svg{width:9px;height:9px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
  /* group-tab intro strip */
  .gintro{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;padding:12px 15px;background:var(--wash);margin-bottom:18px}
  .gintro-q{font:800 15px Inter,sans-serif;letter-spacing:-.01em;color:var(--ink)}
  /* TABS */
  .tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:22px;overflow-x:auto}
  .tab{display:inline-grid;grid-template-columns:auto auto;grid-template-rows:auto auto;column-gap:7px;align-items:center;color:var(--sub);background:none;border:0;border-bottom:2px solid transparent;padding:9px 15px;cursor:pointer;white-space:nowrap;margin-bottom:-1px;text-align:left}
  .tab .tablbl{grid-row:1;grid-column:1;font:800 14px Inter,sans-serif;letter-spacing:-.01em}
  .tab .ct{grid-row:1;grid-column:2;font:700 10px ui-monospace,Menlo,monospace;color:var(--faint);background:var(--hair);border-radius:8px;padding:1px 6px;line-height:1.2;justify-self:start}
  .tab .tabq{grid-row:2;grid-column:1/-1;font:600 11px Inter,sans-serif;color:var(--faint);letter-spacing:-.005em}
  .tab:hover{color:var(--ink)}
  .tab.on{color:var(--blue);border-bottom-color:var(--blue)}
  .tab.on .tabq{color:var(--blue);opacity:.8}
  .tab.on .ct{color:var(--blue);background:#eaf1ff}
  /* section bodies */
  .sec{display:none}
  .sec.on{display:block}
  .secbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  .sectitle{font-size:18px;font-weight:800;letter-spacing:-.01em}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;font:700 13px Inter,sans-serif;border-radius:10px;padding:9px 14px;cursor:pointer;text-decoration:none;border:1px solid var(--blue);color:#fff;background:var(--blue);transition:.14s}
  .btn:hover{background:#0057d6;border-color:#0057d6}
  .btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
  .btn.ghost{color:var(--blue);background:#fff;border-color:var(--line)}
  .btn.ghost:hover{background:var(--wash);border-color:#b8ccf0}
  /* identity grid */
  .fieldgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  @media(max-width:640px){.fieldgrid{grid-template-columns:1fr}}
  .field{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:#fff}
  .field .fk{font:700 10px ui-monospace,Menlo,monospace;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}
  .field .fv{font-size:14px;color:var(--ink);margin-top:5px;line-height:1.4;word-break:break-word}
  .field .fv.empty{color:var(--faint);font-style:italic}
  .field.wide{grid-column:1/-1}
  /* rows (pp/caps/team/docs) */
  .row{border:1px solid var(--line);border-radius:13px;padding:15px 17px;background:#fff;margin-bottom:12px}
  .row:hover{border-color:#d7dee8}
  .rowtop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .rowtitle{font-size:15.5px;font-weight:700;letter-spacing:-.01em;line-height:1.3}
  .rowmeta{font-size:12.5px;color:var(--sub);margin-top:4px;line-height:1.4}
  .rowval{font:800 15px Inter,sans-serif;color:var(--green);white-space:nowrap}
  .rowdesc{font-size:13px;color:var(--sub);line-height:1.5;margin-top:9px}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .chip{font:600 11.5px Inter,sans-serif;color:var(--sub);background:var(--wash);border:1px solid var(--line);border-radius:999px;padding:3px 9px}
  .badge{display:inline-flex;align-items:center;gap:5px;font:700 10.5px Inter,sans-serif;letter-spacing:.02em;border-radius:999px;padding:3px 9px;white-space:nowrap}
  .badge svg{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .badge.prov{color:var(--sub);background:var(--wash);border:1px solid var(--line)}
  .badge.draft{color:var(--warm);background:#fff7ec;border:1px solid #f0d9b5}
  .badgerow{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}
  .rowactions{display:flex;gap:8px;margin-top:12px}
  .linkbtn{font:600 12.5px Inter,sans-serif;color:var(--blue);background:none;border:0;cursor:pointer;padding:0;text-decoration:none}
  .linkbtn:hover{text-decoration:underline}
  .viewall{font:700 13px Inter,sans-serif;color:var(--blue);background:none;border:0;cursor:pointer;padding:8px 0;display:inline-flex;align-items:center;gap:5px}
  .viewall svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  /* empty state */
  .empty{text-align:center;padding:44px 20px;border:1px dashed var(--line);border-radius:16px;background:var(--wash)}
  .empty svg{width:38px;height:38px;stroke:var(--faint);fill:none;stroke-width:1.6;margin-bottom:12px}
  .empty h3{font-size:16px;font-weight:800;color:var(--ink);margin-bottom:6px}
  .empty p{font-size:13.5px;color:var(--sub);max-width:400px;margin:0 auto 16px;line-height:1.5}
  /* add form (inline modal-ish card) */
  .addform{border:1px solid var(--blue);border-radius:14px;padding:18px 20px;background:#f7faff;margin-bottom:16px;display:none}
  .addform.on{display:block}
  .addform h4{font-size:15px;font-weight:800;margin-bottom:14px;letter-spacing:-.01em}
  .fg{margin-bottom:12px}
  .fg label{display:block;font:700 11px Inter,sans-serif;color:var(--sub);text-transform:uppercase;letter-spacing:.03em;margin-bottom:5px}
  .fg input,.fg textarea{width:100%;font:400 14px Inter,sans-serif;color:var(--ink);border:1px solid var(--line);border-radius:9px;padding:9px 11px;background:#fff;outline:none}
  .fg input:focus,.fg textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,106,255,.1)}
  .fg textarea{min-height:70px;resize:vertical}
  .fg2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:640px){.fg2{grid-template-columns:1fr}}
  .formfoot{display:flex;align-items:center;gap:10px;margin-top:6px}
  .formerr{font:600 12.5px Inter,sans-serif;color:var(--con);display:none}
  .formerr.show{display:block}
  /* auth / loading */
  .signin,.loading{padding:60px 20px;text-align:center;color:var(--sub);font-size:15px}
  .signin a{color:var(--blue);font-weight:700;text-decoration:none}
  ${ACCOUNT_MENU_CSS}
</style><style>${LOGIN_MODAL_CSS}</style></head><body>
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
  <a href="/opportunity-map/saved" title="Watchlist — saved searches &amp; new matches"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Watchlist</span></a>
  <a href="/opportunity-map/favorites" title="Saved — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Saved</span></a>
  <a href="/opportunity-map/pursuits" title="Pursuits — opportunities you are actively working"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Pursuits</span></a>
</nav>
<div class="main"><div class="wrap" id="root">
  <div class="loading">Loading your vault&hellip;</div>
</div></div>
<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  var t=tok(), em=email(), root=document.getElementById('root');
  function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  if(!t||!em){ root.innerHTML='<div class="signin">Please <a href="#" onclick="return window.__mapsSignIn()">sign in</a> to open your Company Vault.</div>'; return; }
  function hdrs(){ return {'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em}; }

  // ── SVG icon set (all inline; NO emoji). ──
  var IC={
    shield:'<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.4-3 8.5-7 10-4-1.5-7-5.6-7-10V6z"/><path d="M9.2 12.2l1.9 1.9 3.7-3.9"/></svg>',
    check:'<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    arrow:'<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    // why-strip icons (artifact pen / target / up-arrow -> pen / target / trend-up)
    pen:'<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
    target:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>',
    trend:'<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
    doc:'<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>',
    briefcase:'<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    layers:'<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/></svg>',
    people:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M16 4.2A3.2 3.2 0 0119 8M21 20c0-2.6-1.7-4.2-4-4.7"/></svg>',
    upload:'<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>'
  };

  // ── Completeness (ported from src/lib/vault/completeness.ts — same 7 checks/order). ──
  function nz(v){ return typeof v==='string' && v.trim().length>0; }
  function alen(v){ return Array.isArray(v)?v.length:0; }
  function completeness(d){
    var id=d.identity||{};
    var checks=[
      {done: nz(id.legal_name)&&nz(id.uei), label:'Add your legal name + UEI', section:'identity'},
      {done: alen(id.certifications)>0, label:'List your certifications', section:'identity'},
      {done: nz(id.one_liner), label:'Write your one-liner', section:'identity'},
      {done: alen(d.past_performance)>0, label:'Add past performance', section:'past_performance'},
      {done: alen(d.capabilities)>0, label:'Add capabilities', section:'capabilities'},
      {done: alen(d.team)>0, label:'Add key personnel', section:'team'},
      {done: alen(d.documents)>0, label:'Upload a capability statement', section:'documents'}
    ];
    var doneCount=checks.filter(function(c){return c.done;}).length;
    var pct=Math.round(doneCount/checks.length*100);
    var missing=checks.filter(function(c){return !c.done;}).slice(0,3);
    return {checks:checks,doneCount:doneCount,pct:pct,missing:missing,complete:doneCount===checks.length};
  }
  // ── Per-knowledge-group completeness (ported from computeVaultGroups in
  //    src/lib/vault/completeness.ts — same 4 groups, same checks/order, grounded). ──
  function vaultGroups(d){
    var id=d.identity||{};
    function g(checks){ var total=checks.length; var done=checks.filter(Boolean).length;
      return {done:done,total:total,pct:total?Math.round(done/total*100):0}; }
    var identity=g([ nz(id.legal_name)&&nz(id.uei), nz(id.cage_code), alen(id.primary_naics)>0 ]);
    var capabilities=g([ alen(d.capabilities)>0, alen(d.documents)>0 ]);
    var experience=g([ alen(d.past_performance)>0, alen(d.team)>0, alen(id.contract_vehicles)>0 ]);
    var positioning=g([ nz(id.one_liner), nz(id.elevator_pitch), alen(id.certifications)>0 ]);
    return [
      {key:'identity',title:'Identity',question:'Who are you?',section:'identity',done:identity.done,total:identity.total,pct:identity.pct},
      {key:'capabilities',title:'Capabilities',question:'What do you do?',section:'capabilities',done:capabilities.done,total:capabilities.total,pct:capabilities.pct},
      {key:'experience',title:'Experience',question:'What have you done?',section:'experience',done:experience.done,total:experience.total,pct:experience.pct},
      {key:'positioning',title:'Positioning',question:'How should Mindy describe you?',section:'positioning',done:positioning.done,total:positioning.total,pct:positioning.pct}
    ];
  }
  // "Used in" — STATIC TRUE capability mapping per group (NOT a usage count; always true).
  // These are the Mindy features each knowledge group feeds. Hardcoded on purpose.
  // NOTE: the "make it alive" live-usage rail ("used 17x", "last used 2h ago") + the
  // AI-audit "+18% quality" number are DEFERRED — no usage-event table exists to ground them.
  var USED_IN={ identity:['Proposals','Market Matching','M-Win'],
    capabilities:['Proposals','Ask Mindy','Market Matching'],
    experience:['Proposals','M-Win'],
    positioning:['Proposals','Ask Mindy'] };
  // Short, TRUE, directional why-clause per completeness check label (NO fabricated %).
  var WHY_CLAUSE={
    'Add your legal name + UEI':'Mindy writes as your real registered entity',
    'List your certifications':'sharpens set-aside matching',
    'Write your one-liner':'Mindy uses it in every proposal intro',
    'Add past performance':'cited as real proof instead of placeholders',
    'Add capabilities':'woven into your proposal narrative',
    'Add key personnel':'fills Key Personnel + Management Plan sections',
    'Upload a capability statement':'Mindy parses it to enrich your vault'
  };
  // Past-perf provenance from the REAL source column. No fabricated auto-match label.
  function provLabel(src){
    var s=String(src||'').trim();
    if(s==='parsed_cap_stmt')return 'From cap statement';
    if(s==='bulk_upload')return 'Imported';
    return 'Self-added';
  }
  // Draft heuristic — bracketed title/agency or boilerplate scope reads as a stub.
  function isDraft(r){
    var brk=/^\\s*\\[.*\\]\\s*$/;
    if(brk.test(String(r.contract_title||''))||brk.test(String(r.agency||'')))return true;
    var sc=String(r.scope_description||'').trim().toLowerCase();
    if(sc && /^(describe|add|todo|placeholder|tbd|lorem)/.test(sc))return true;
    return false;
  }
  function money(n){ n=Number(n); if(!isFinite(n)||n<=0)return '';
    if(n>=1e9)return '$'+(n/1e9).toFixed(n%1e9?1:0).replace(/\\.0$/,'')+'B';
    if(n>=1e6)return '$'+(n/1e6).toFixed(n%1e6?1:0).replace(/\\.0$/,'')+'M';
    if(n>=1e3)return '$'+Math.round(n/1e3)+'K';
    return '$'+Math.round(n).toLocaleString(); }
  function yr(d){ var s=String(d||'').slice(0,4); return /^\\d{4}$/.test(s)?s:''; }
  function period(a,b){ var x=yr(a),y=yr(b); if(x&&y)return x+'\\u2013'+y; return x||y||''; }
  function arr(v){ return Array.isArray(v)?v.filter(Boolean):[]; }

  var DATA=null, TAB='identity', PP_EXPANDED=false;
  var PP_INITIAL=4;

  // Map a completeness check's section -> the 4-group tab that hosts its add form.
  // (documents live under Capabilities; team + past-perf under Experience; one-liner/
  // certs under Positioning; the rest under Identity.)
  function groupTabFor(section){
    if(section==='documents'||section==='capabilities')return 'capabilities';
    if(section==='past_performance'||section==='team')return 'experience';
    return 'identity'; // legal_name+uei -> identity; certifications/one_liner still routed via label below
  }
  // The three positioning-specific checks route to the Positioning tab.
  function groupTabForCheck(m){
    if(m.label==='List your certifications'||m.label==='Write your one-liner')return 'positioning';
    return groupTabFor(m.section);
  }

  // ── HERO ──
  function heroHTML(){
    var id=DATA.identity||{}, c=completeness(DATA);
    var initials=(String(id.legal_name||'').trim().split(/\\s+/).map(function(w){return w[0];}).join('').slice(0,2)||'CO').toUpperCase();
    var loc=[id.hq_city,id.hq_state].filter(Boolean).join(', ');
    var certs=arr(id.certifications);
    var locLine=[loc].filter(Boolean);
    if(certs.length)locLine.push(certs.slice(0,3).join(' / '));
    // Primary NAICS is INLINE-editable right here (Eric 2026-08-06: "there should be an easier way
    // rather than reset your whole profile"). Click the cell → it becomes an input → Save → PUTs
    // ONLY primary_naics (the API is a partial merge, so nothing else on the profile is touched).
    var naicsVal=arr(id.primary_naics).join(', ')||'\\u2014';
    var idcell=[
      {k:'UEI',v:id.uei||'\\u2014'},
      {k:'CAGE',v:id.cage_code||'\\u2014'},
      {k:'Primary NAICS',v:h(naicsVal),edit:true}
    ].map(function(x){
      if(x.edit) return '<div class="idcell editable" id="naicsCell"><div class="k">'+h(x.k)
        + '<button class="idedit" id="naicsEditBtn" title="Edit Primary NAICS" aria-label="Edit Primary NAICS">'+IC.pen+'</button></div>'
        + '<div class="v" id="naicsView">'+x.v+'</div></div>';
      return '<div class="idcell"><div class="k">'+h(x.k)+'</div><div class="v">'+h(x.v)+'</div></div>';
    }).join('');
    var certHTML=certs.length?('<div class="certrow">'+certs.map(function(cx){return '<span class="certpill">'+IC.check+h(cx)+'</span>';}).join('')+'</div>'):'';
    var oneliner=nz(id.one_liner)?('<p class="oneliner">'+h(id.one_liner)+'</p>'):'';

    // meter
    var todo;
    if(c.missing.length){
      todo='<p class="mtodo-h">A fuller vault grounds better proposals + sharper matches. <b>'+c.missing.length+' thing'+(c.missing.length===1?'':'s')+' left:</b></p>'
        + '<div class="todo">'+c.missing.map(function(m){
            var why=WHY_CLAUSE[m.label]||'';
            var whyHtml=why?('<span class="todowhy">'+h(why)+'</span>'):'';
            return '<a data-goto="'+h(groupTabForCheck(m))+'"><span class="dot"></span><span class="todolbl">'+h(m.label)+whyHtml+'</span><span class="add">Teach Mindy '+IC.arrow+'</span></a>';
          }).join('')+'</div>';
    } else {
      todo='<div class="mdone">'+IC.check+'<span>Your vault is complete \\u2014 Mindy has everything it needs to ground your proposals, matches, and answers.</span></div>';
    }
    var meter='<div class="meter"><div class="mpct">'+c.pct+'<span>%</span></div><div class="mlabel">Vault complete</div>'
      + '<div class="mbar"><i style="width:'+c.pct+'%"></i></div>'+todo+'</div>';

    var idcard='<div class="idcard"><div class="idtop"><div class="logo">'+h(initials)+'</div>'
      + '<div style="min-width:0"><div class="idname">'+h(id.legal_name||'Your company')+'</div>'
      + '<div class="idloc">'+(locLine.length?h(locLine.join(' \\u00b7 ')):'Add your HQ + certifications')+'</div></div></div>'
      + oneliner + '<div class="idgrid">'+idcell+'</div>'+certHTML+'</div>';

    return '<div class="hero">'+idcard+meter+'</div>';
  }

  // ── Per-group knowledge bars (grounded from vaultGroups) — "where do I improve?" ──
  //    Each row is clickable -> jumps to that group's tab. pct straight from the payload.
  function groupsHTML(){
    var gs=vaultGroups(DATA);
    return '<div class="groups"><div class="groups-h">What Mindy knows about your company</div>'
      + '<div class="grid">'+gs.map(function(g){
          var used=(USED_IN[g.key]||[]).map(function(f){ return '<span class="upill">'+IC.check+h(f)+'</span>'; }).join('');
          return '<a class="gcard" data-goto="'+h(g.section)+'">'
            + '<div class="gtop"><span class="gtitle">'+h(g.title)+'</span><span class="gpct">'+g.pct+'%</span></div>'
            + '<div class="gq">'+h(g.question)+'</div>'
            + '<div class="gbar"><i style="width:'+g.pct+'%"></i></div>'
            + '<div class="usedin"><span class="usedlbl">Used in</span>'+used+'</div>'
            + '</a>';
        }).join('')+'</div></div>';
  }

  // ── TABS — the 4 knowledge groups, each led by its question. ──
  //    Section bodies are RE-GROUPED (not deleted): Capabilities tab stacks capabilities +
  //    documents; Experience tab stacks past-performance + key personnel; Positioning +
  //    Identity both render the identity fields (Positioning leads with the narrative fields).
  function tabsHTML(){
    var defs=[
      {id:'identity',label:'Identity',q:'Who are you?',ct:null},
      {id:'capabilities',label:'Capabilities',q:'What do you do?',ct:alen(DATA.capabilities)+alen(DATA.documents)},
      {id:'experience',label:'Experience',q:'What have you done?',ct:alen(DATA.past_performance)+alen(DATA.team)},
      {id:'positioning',label:'Positioning',q:'How should Mindy describe you?',ct:null}
    ];
    return '<div class="tabs">'+defs.map(function(d){
      var ct=(d.ct!=null)?('<span class="ct">'+d.ct+'</span>'):'';
      return '<button class="tab'+(d.id===TAB?' on':'')+'" data-tab="'+d.id+'"><span class="tablbl">'+h(d.label)+'</span><span class="tabq">'+h(d.q)+'</span>'+ct+'</button>';
    }).join('')+'</div>';
  }

  function emptyState(icon,title,msg,ctaLabel,section){
    return '<div class="empty">'+icon+'<h3>'+h(title)+'</h3><p>'+h(msg)+'</p>'
      + (section?('<button class="btn" data-add="'+h(section)+'">'+IC.plus+h(ctaLabel)+'</button>'):'')+'</div>';
  }

  // ── Identity section body ──
  function secIdentity(){
    var id=DATA.identity||{};
    function f(k,v,wide){ var e=(v==null||String(v).trim()==='');
      return '<div class="field'+(wide?' wide':'')+'"><div class="fk">'+h(k)+'</div><div class="fv'+(e?' empty':'')+'">'+(e?'Not set':h(v))+'</div></div>'; }
    var certs=arr(id.certifications), vehicles=arr(id.contract_vehicles), svc=arr(id.service_states), naics=arr(id.primary_naics);
    var poc=[id.poc_name,id.poc_email,id.poc_phone].filter(Boolean).join(' \\u00b7 ');
    var body='<div class="fieldgrid">'
      + f('Legal name',id.legal_name)
      + f('DBA',id.dba)
      + f('UEI',id.uei)
      + f('CAGE code',id.cage_code)
      + f('EIN',id.ein)
      + f('DUNS',id.duns)
      + f('Primary NAICS',naics.join(', '))
      + f('Certifications',certs.join(', '))
      + f('One-liner',id.one_liner,true)
      + f('Elevator pitch',id.elevator_pitch,true)
      + f('HQ',[id.hq_city,id.hq_state].filter(Boolean).join(', '))
      + f('Service states',svc.join(', '))
      + f('Contract vehicles',vehicles.join(', '),true)
      + f('Point of contact',poc,true)
      + '</div>';
    var hasAny=nz(id.legal_name)||nz(id.uei)||nz(id.one_liner)||certs.length;
    return '<div class="secbar"><div class="sectitle">Company identity</div>'
      + '<button class="btn ghost" data-editid="1">'+IC.pen+'Teach Mindy '+IC.arrow+'</button></div>'
      + editIdentityForm()
      + (hasAny?body:emptyState(IC.briefcase,'No identity yet','Add your legal name, UEI, CAGE and a one-liner so Mindy writes as your company.','Teach Mindy',null)
          .replace('data-add=""','data-editid="1"').replace('<button class="btn" >','<button class="btn" data-editid="1">'));
  }

  function editIdentityForm(){
    var id=DATA.identity||{};
    function inp(name,label,val,wide){ return '<div class="fg'+(wide?'':'')+'"><label>'+h(label)+'</label><input data-f="'+name+'" value="'+h(val||'')+'"></div>'; }
    return '<div class="addform" id="form-identity"><h4>Edit company identity</h4>'
      + '<div class="fg2">'+inp('legal_name','Legal name',id.legal_name)+inp('dba','DBA',id.dba)+'</div>'
      + '<div class="fg2">'+inp('uei','UEI',id.uei)+inp('cage_code','CAGE code',id.cage_code)+'</div>'
      + '<div class="fg2">'+inp('hq_city','HQ city',id.hq_city)+inp('hq_state','HQ state',id.hq_state)+'</div>'
      + '<div class="fg"><label>Certifications (comma-separated)</label><input data-f="certifications" value="'+h(arr(id.certifications).join(', '))+'"></div>'
      + '<div class="fg"><label>Primary NAICS (comma-separated)</label><input data-f="primary_naics" value="'+h(arr(id.primary_naics).join(', '))+'"></div>'
      + '<div class="fg"><label>One-liner</label><textarea data-f="one_liner">'+h(id.one_liner||'')+'</textarea></div>'
      + '<div class="fg"><label>Elevator pitch</label><textarea data-f="elevator_pitch">'+h(id.elevator_pitch||'')+'</textarea></div>'
      + '<div class="formerr" id="err-identity"></div>'
      + '<div class="formfoot"><button class="btn" data-save="identity">'+IC.check+'Save</button>'
      + '<button class="btn ghost" data-cancel="identity">Cancel</button></div></div>';
  }

  // ── Positioning body — the narrative fields (how Mindy should describe you). ──
  //    Reuses the SAME identity edit form (form-identity) so saving works unchanged.
  function secPositioning(){
    var id=DATA.identity||{};
    function f(k,v,wide){ var e=(v==null||String(v).trim()==='');
      return '<div class="field'+(wide?' wide':'')+'"><div class="fk">'+h(k)+'</div><div class="fv'+(e?' empty':'')+'">'+(e?'Not set':h(v))+'</div></div>'; }
    var certs=arr(id.certifications);
    var body='<div class="fieldgrid">'
      + f('One-liner',id.one_liner,true)
      + f('Elevator pitch',id.elevator_pitch,true)
      + f('Certifications',certs.join(', '),true)
      + '</div>';
    var hasAny=nz(id.one_liner)||nz(id.elevator_pitch)||certs.length;
    return '<div class="secbar"><div class="sectitle">How Mindy describes you</div>'
      + '<button class="btn ghost" data-editid="1">'+IC.pen+'Teach Mindy '+IC.arrow+'</button></div>'
      + editIdentityForm()
      + (hasAny?body:emptyState(IC.pen,'No positioning yet','Write your one-liner, elevator pitch and certifications so Mindy describes your company in its own voice.','Teach Mindy',null)
          .replace('data-add=""','data-editid="1"').replace('<button class="btn" >','<button class="btn" data-editid="1">'));
  }

  // ── Past performance body ──
  function secPP(){
    var rows=arr(DATA.past_performance);
    var head='<div class="secbar"><div class="sectitle">Past performance</div>'
      + '<button class="btn" data-add="past_performance">'+IC.plus+'Teach Mindy a contract</button></div>'
      + addFormPP();
    if(!rows.length)return head+emptyState(IC.briefcase,'No past performance yet','Add the real contracts you\\u2019ve delivered so Mindy cites them in proposals instead of placeholders.','Teach Mindy a contract','past_performance');
    var shown=PP_EXPANDED?rows:rows.slice(0,PP_INITIAL);
    var body=shown.map(function(r){
      var title=h(r.contract_title||'Untitled contract');
      var meta=[h(r.agency||''),period(r.period_start,r.period_end),arr(r.naics_codes).join(', ')].filter(Boolean).join(' \\u00b7 ');
      var val=money(r.contract_value);
      var badges='<span class="badge prov">'+IC.shield+h(provLabel(r.source))+'</span>';
      if(isDraft(r))badges+='<span class="badge draft">'+IC.pen+'Draft \\u2014 add details</span>';
      var desc=r.scope_description?('<div class="rowdesc">'+h(r.scope_description)+'</div>'):'';
      var kw=arr(r.relevance_keywords);
      var chips=kw.length?('<div class="chips">'+kw.slice(0,8).map(function(k){return '<span class="chip">'+h(k)+'</span>';}).join('')+'</div>'):'';
      return '<div class="row"><div class="rowtop"><div style="min-width:0"><div class="rowtitle">'+title+'</div>'
        + (meta?'<div class="rowmeta">'+meta+'</div>':'')+'</div>'
        + (val?'<div class="rowval">'+h(val)+'</div>':'')+'</div>'
        + desc+chips+'<div class="badgerow">'+badges+'</div></div>';
    }).join('');
    var more='';
    if(rows.length>PP_INITIAL){
      more=PP_EXPANDED
        ? '<button class="viewall" data-toggle-pp="0">Show fewer '+IC.arrow+'</button>'
        : '<button class="viewall" data-toggle-pp="1">View all '+rows.length+' '+IC.arrow+'</button>';
    }
    return head+body+more;
  }
  function addFormPP(){
    return '<div class="addform" id="form-past_performance"><h4>Add a past-performance contract</h4>'
      + '<div class="fg"><label>Contract title *</label><input data-f="contract_title" placeholder="e.g. Enterprise Network Modernization"></div>'
      + '<div class="fg2"><div class="fg"><label>Agency *</label><input data-f="agency" placeholder="e.g. Department of the Navy"></div>'
      + '<div class="fg"><label>Contract value ($)</label><input data-f="contract_value" placeholder="e.g. 2500000"></div></div>'
      + '<div class="fg2"><div class="fg"><label>Period start</label><input data-f="period_start" placeholder="YYYY-MM-DD"></div>'
      + '<div class="fg"><label>Period end</label><input data-f="period_end" placeholder="YYYY-MM-DD"></div></div>'
      + '<div class="fg"><label>Scope (what you did)</label><textarea data-f="scope_description" placeholder="2–4 sentences on the work + outcomes"></textarea></div>'
      + '<div class="fg"><label>NAICS codes (comma-separated)</label><input data-f="naics_codes" placeholder="541512, 541519"></div>'
      + '<div class="formerr" id="err-past_performance"></div>'
      + '<div class="formfoot"><button class="btn" data-save="past_performance">'+IC.plus+'Add contract</button>'
      + '<button class="btn ghost" data-cancel="past_performance">Cancel</button></div></div>';
  }

  // ── Capabilities body ──
  function secCaps(){
    var rows=arr(DATA.capabilities);
    var head='<div class="secbar"><div class="sectitle">Capabilities</div>'
      + '<button class="btn" data-add="capabilities">'+IC.plus+'Teach Mindy a capability</button></div>'
      + addFormCaps();
    if(!rows.length)return head+emptyState(IC.layers,'No capabilities yet','Add plain-English capability blurbs tagged with NAICS so Mindy weaves them into your proposals.','Teach Mindy a capability','capabilities');
    var body=rows.map(function(r){
      var tags=arr(r.related_naics).concat(arr(r.keywords)).slice(0,10);
      var chips=tags.length?('<div class="chips">'+tags.map(function(k){return '<span class="chip">'+h(k)+'</span>';}).join('')+'</div>'):'';
      return '<div class="row"><div class="rowtitle">'+h(r.capability_name||'Capability')+'</div>'
        + (r.description?'<div class="rowdesc">'+h(r.description)+'</div>':'')+chips+'</div>';
    }).join('');
    return head+body;
  }
  function addFormCaps(){
    return '<div class="addform" id="form-capabilities"><h4>Add a capability</h4>'
      + '<div class="fg"><label>Capability name *</label><input data-f="capability_name" placeholder="e.g. Penetration Testing"></div>'
      + '<div class="fg"><label>Description *</label><textarea data-f="description" placeholder="1–3 sentences in your own voice"></textarea></div>'
      + '<div class="fg"><label>Related NAICS (comma-separated)</label><input data-f="related_naics" placeholder="541512"></div>'
      + '<div class="fg"><label>Keywords (comma-separated)</label><input data-f="keywords" placeholder="cyber, pentest, NIST"></div>'
      + '<div class="formerr" id="err-capabilities"></div>'
      + '<div class="formfoot"><button class="btn" data-save="capabilities">'+IC.plus+'Add capability</button>'
      + '<button class="btn ghost" data-cancel="capabilities">Cancel</button></div></div>';
  }

  // ── Team body ──
  function secTeam(){
    var rows=arr(DATA.team);
    var head='<div class="secbar"><div class="sectitle">Key personnel</div>'
      + '<button class="btn" data-add="team">'+IC.plus+'Teach Mindy a person</button></div>'
      + addFormTeam();
    if(!rows.length)return head+emptyState(IC.people,'No key personnel yet','Add your team\\u2019s leads + bios so Mindy can fill Key Personnel and Management Plan sections.','Teach Mindy a person','team');
    var body=rows.map(function(r){
      var meta=[h(r.title||''), r.security_clearance?('Clearance: '+h(r.security_clearance)):''].filter(Boolean).join(' \\u00b7 ');
      var certs=arr(r.certifications);
      var chips=certs.length?('<div class="chips">'+certs.map(function(k){return '<span class="chip">'+h(k)+'</span>';}).join('')+'</div>'):'';
      var bio=(r.bio_short||r.bio_full);
      var resume=r.resume_storage_path?('<div class="badgerow"><span class="badge prov">'+IC.doc+'Resume on file</span></div>'):'';
      return '<div class="row"><div class="rowtitle">'+h(r.full_name||'Team member')+'</div>'
        + (meta?'<div class="rowmeta">'+meta+'</div>':'')
        + (bio?'<div class="rowdesc">'+h(bio)+'</div>':'')+chips+resume+'</div>';
    }).join('');
    return head+body;
  }
  function addFormTeam(){
    return '<div class="addform" id="form-team"><h4>Add a team member</h4>'
      + '<div class="fg2"><div class="fg"><label>Full name *</label><input data-f="full_name" placeholder="e.g. Jordan Lee"></div>'
      + '<div class="fg"><label>Title *</label><input data-f="title" placeholder="e.g. Program Manager"></div></div>'
      + '<div class="fg2"><div class="fg"><label>Security clearance</label><input data-f="security_clearance" placeholder="e.g. Secret"></div>'
      + '<div class="fg"><label>Certifications (comma-separated)</label><input data-f="certifications" placeholder="PMP, CISSP"></div></div>'
      + '<div class="fg"><label>Short bio</label><textarea data-f="bio_short" placeholder="1–2 sentence intro"></textarea></div>'
      + '<div class="formerr" id="err-team"></div>'
      + '<div class="formfoot"><button class="btn" data-save="team">'+IC.plus+'Add person</button>'
      + '<button class="btn ghost" data-cancel="team">Cancel</button></div></div>';
  }

  // ── Documents body (read + add-CTA only; upload lives in the /app vault uploader) ──
  function secDocs(){
    var rows=arr(DATA.documents);
    var head='<div class="secbar"><div class="sectitle">Documents</div>'
      + '<a class="btn" href="/app?panel=vault&section=documents">'+IC.upload+'Upload a document</a></div>';
    if(!rows.length)return head+emptyState(IC.doc,'No documents yet','Upload your capability statement or company overview \\u2014 Mindy parses it into your vault.','Upload a document',null)
      .replace('<button class="btn" data-add="documents">'+IC.plus+'Upload a document</button>','<a class="btn" href="/app?panel=vault&section=documents">'+IC.upload+'Upload a document</a>');
    var body=rows.map(function(r){
      var meta=[String(r.doc_type||'').replace(/_/g,' '), r.page_count?(r.page_count+' pages'):''].filter(Boolean).join(' \\u00b7 ');
      var status=String(r.parse_status||'pending');
      var badgeCls=status==='parsed'||status==='edited'?'prov':'draft';
      return '<div class="row"><div class="rowtop"><div style="min-width:0"><div class="rowtitle">'+h(r.original_filename||'Document')+'</div>'
        + (meta?'<div class="rowmeta">'+meta+'</div>':'')+'</div></div>'
        + '<div class="badgerow"><span class="badge '+badgeCls+'">'+IC.doc+h(status)+'</span></div></div>';
    }).join('');
    return head+body;
  }

  // Group-tab intro: the question Mindy is asking + the static "Used in" strip.
  function groupIntro(key){
    var gs=vaultGroups(DATA); var g=null;
    for(var i=0;i<gs.length;i++){ if(gs[i].key===key){g=gs[i];break;} }
    if(!g)return '';
    var used=(USED_IN[key]||[]).map(function(f){ return '<span class="upill">'+IC.check+h(f)+'</span>'; }).join('');
    return '<div class="gintro"><div class="gintro-q">'+h(g.question)+'</div>'
      + '<div class="usedin"><span class="usedlbl">Used in</span>'+used+'</div></div>';
  }

  function sectionBody(){
    // The 4 knowledge-group tabs. Bodies are RE-GROUPED, not deleted.
    if(TAB==='identity')return groupIntro('identity')+secIdentity();
    if(TAB==='capabilities')return groupIntro('capabilities')+secCaps()+secDocs();
    if(TAB==='experience')return groupIntro('experience')+secPP()+secTeam();
    if(TAB==='positioning')return groupIntro('positioning')+secPositioning();
    return '';
  }

  function render(){
    var id=DATA.identity||{};
    root.innerHTML=''
      + '<div class="kicker">'+IC.shield+'Mindy&rsquo;s Memory</div>'
      + '<h1>Company Vault</h1>'
      + '<p class="lede">Teach Mindy everything about your company. The better your Vault, the smarter every proposal, recommendation, and answer becomes. <span class="lede-priv">Only you can see it.</span></p>'
      + heroHTML()
      + groupsHTML()
      + tabsHTML()
      + '<div class="sec on" id="secbody">'+sectionBody()+'</div>';
    wire();
  }

  function goTab(tab){ TAB=tab; if(tab!=='experience')PP_EXPANDED=false; render();
    var el=document.getElementById('secbody'); if(el)el.scrollIntoView({behavior:'smooth',block:'nearest'}); }

  function collectForm(section){
    var form=document.getElementById('form-'+section); if(!form)return {};
    var out={};
    form.querySelectorAll('[data-f]').forEach(function(inp){ out[inp.getAttribute('data-f')]=inp.value; });
    return out;
  }
  function splitList(s){ return String(s||'').split(',').map(function(x){return x.trim();}).filter(Boolean); }
  function showErr(section,msg){ var e=document.getElementById('err-'+section); if(e){e.textContent=msg;e.classList.add('show');} }

  function saveSection(section,btn){
    var raw=collectForm(section);
    var errEl=document.getElementById('err-'+section); if(errEl)errEl.classList.remove('show');
    var url, method, body;
    if(section==='identity'){
      var profile={ legal_name:raw.legal_name, dba:raw.dba, uei:raw.uei, cage_code:raw.cage_code,
        hq_city:raw.hq_city, hq_state:raw.hq_state, one_liner:raw.one_liner, elevator_pitch:raw.elevator_pitch,
        certifications:splitList(raw.certifications), primary_naics:splitList(raw.primary_naics) };
      url='/api/app/vault/identity'; method='PUT'; body={email:em, profile:profile};
    } else if(section==='past_performance'){
      if(!raw.contract_title||!raw.agency){ showErr(section,'Contract title and agency are required.'); return; }
      var entryPP={ contract_title:raw.contract_title, agency:raw.agency, scope_description:raw.scope_description,
        period_start:raw.period_start||null, period_end:raw.period_end||null,
        contract_value:raw.contract_value?Number(String(raw.contract_value).replace(/[^0-9.]/g,'')):null,
        naics_codes:splitList(raw.naics_codes), source:'manual' };
      url='/api/app/vault/past-performance'; method='POST'; body={email:em, entry:entryPP};
    } else if(section==='capabilities'){
      if(!raw.capability_name||!raw.description){ showErr(section,'Capability name and description are required.'); return; }
      var entryC={ capability_name:raw.capability_name, description:raw.description,
        related_naics:splitList(raw.related_naics), keywords:splitList(raw.keywords) };
      url='/api/app/vault/capabilities'; method='POST'; body={email:em, entry:entryC};
    } else if(section==='team'){
      if(!raw.full_name||!raw.title){ showErr(section,'Full name and title are required.'); return; }
      var entryT={ full_name:raw.full_name, title:raw.title, security_clearance:raw.security_clearance,
        certifications:splitList(raw.certifications), bio_short:raw.bio_short, is_key_personnel:true };
      url='/api/app/vault/team'; method='POST'; body={email:em, entry:entryT};
    } else { return; }

    if(btn){ btn.disabled=true; }
    fetch(url,{method:method,headers:hdrs(),body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,j:j}; }); })
      .then(function(res){
        if(!res.ok||(res.j&&res.j.success===false)) throw new Error((res.j&&res.j.error)||'Save failed');
        // Reload the vault to reflect the new row + recompute completeness (grounded).
        return reload();
      })
      .catch(function(e){ if(btn)btn.disabled=false; showErr(section, e&&e.message?e.message:'Could not save. Try again.'); });
  }

  // Inline Primary NAICS edit (hero cell) — one-click fix, NOT the full identity form.
  // Saves ONLY primary_naics; the PUT is a partial merge so every other Vault field is untouched.
  function openNaicsEditor(){
    var cell=document.getElementById('naicsCell'); if(!cell)return;
    var view=document.getElementById('naicsView'); if(!view||cell.querySelector('.naics-editor'))return;
    var id=(DATA.identity||{});
    var cur=arr(id.primary_naics).join(', ');
    var ed=document.createElement('div'); ed.className='naics-editor';
    ed.innerHTML='<input id="naicsInput" value="'+h(cur)+'" placeholder="e.g. 541512, 541519" autocomplete="off" spellcheck="false">'
      + '<div class="nhint">Comma-separated. First code is your primary. 2\\u20136 digits each.</div>'
      + '<div class="naics-err" id="naicsErr"></div>'
      + '<div class="nrow"><button class="nbtn save" id="naicsSave">Save</button><button class="nbtn cancel" id="naicsCancel">Cancel</button></div>';
    view.style.display='none'; cell.appendChild(ed);
    var input=document.getElementById('naicsInput'); if(input){ input.focus(); input.select(); }
    function close(){ ed.remove(); view.style.display=''; }
    document.getElementById('naicsCancel').onclick=close;
    if(input)input.addEventListener('keydown',function(e){ if(e.key==='Escape')close(); if(e.key==='Enter'){e.preventDefault();doSave();} });
    var errEl=document.getElementById('naicsErr');
    function doSave(){
      var codes=splitList((input&&input.value)||'');
      var bad=codes.filter(function(c){ return !/^\\d{2,6}$/.test(c); });
      if(codes.length && bad.length){ errEl.textContent='Not a valid NAICS: '+bad.join(', ')+'. Use 2\\u20136 digit codes.'; errEl.classList.add('show'); return; }
      errEl.classList.remove('show');
      var btn=document.getElementById('naicsSave'); if(btn)btn.disabled=true;
      fetch('/api/app/vault/identity',{method:'PUT',headers:hdrs(),body:JSON.stringify({email:em,profile:{primary_naics:codes}})})
        .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,j:j}; }); })
        .then(function(res){ if(!res.ok||(res.j&&res.j.success===false))throw new Error((res.j&&res.j.error)||'Save failed'); return reload(); })
        .catch(function(e){ if(btn)btn.disabled=false; errEl.textContent=(e&&e.message)?e.message:'Could not save. Try again.'; errEl.classList.add('show'); });
    }
    document.getElementById('naicsSave').onclick=doSave;
  }

  function wire(){
    // todo deep-links (hero meter)
    root.querySelectorAll('[data-goto]').forEach(function(a){ a.onclick=function(e){ e.preventDefault(); goTab(a.getAttribute('data-goto')); }; });
    // inline Primary NAICS editor (hero cell) — click the pencil OR the value to edit just NAICS
    var nb=document.getElementById('naicsEditBtn'); if(nb)nb.onclick=function(e){ e.stopPropagation(); openNaicsEditor(); };
    var nv=document.getElementById('naicsView'); if(nv){ nv.style.cursor='pointer'; nv.title='Click to edit'; nv.onclick=openNaicsEditor; }
    // tabs
    root.querySelectorAll('[data-tab]').forEach(function(b){ b.onclick=function(){ goTab(b.getAttribute('data-tab')); }; });
    // add buttons -> reveal inline form
    root.querySelectorAll('[data-add]').forEach(function(b){ b.onclick=function(){ var f=document.getElementById('form-'+b.getAttribute('data-add')); if(f){f.classList.add('on');f.scrollIntoView({behavior:'smooth',block:'nearest'});} }; });
    root.querySelectorAll('[data-editid]').forEach(function(b){ b.onclick=function(){ var f=document.getElementById('form-identity'); if(f){f.classList.add('on');f.scrollIntoView({behavior:'smooth',block:'nearest'});} }; });
    // cancel
    root.querySelectorAll('[data-cancel]').forEach(function(b){ b.onclick=function(){ var f=document.getElementById('form-'+b.getAttribute('data-cancel')); if(f)f.classList.remove('on'); }; });
    // save
    root.querySelectorAll('[data-save]').forEach(function(b){ b.onclick=function(){ saveSection(b.getAttribute('data-save'), b); }; });
    // pp view-all toggle
    root.querySelectorAll('[data-toggle-pp]').forEach(function(b){ b.onclick=function(){ PP_EXPANDED=b.getAttribute('data-toggle-pp')==='1'; render(); }; });
  }

  function reload(){
    return fetch('/api/app/vault?email='+encodeURIComponent(em),{headers:hdrs()})
      .then(function(r){ return r.json(); })
      .then(function(d){ if(d&&d.success===false)throw new Error(d.error||'Load failed'); DATA={ identity:d.identity||{}, past_performance:d.past_performance||[], capabilities:d.capabilities||[], team:d.team||[], documents:d.documents||[] }; render(); });
  }

  reload().catch(function(){ root.innerHTML='<div class="signin">Couldn\\u2019t load your vault. Try again shortly.</div>'; });
})();
</script>
${ACCOUNT_MENU_JS}
${LOGIN_MODAL_HTML}${LOGIN_MODAL_JS}${'<script>'}window.__mapsSignIn=function(){var stale=false;try{stale=!!localStorage.getItem('mi_beta_email')&&!localStorage.getItem('mi_beta_auth_token');}catch(e){}var phrase=stale?'continue where you left off':'open your Company Vault';if(typeof window.openSignInModal==='function'){window.openSignInModal(phrase,function(){location.reload();});}else{location.href='/app?next='+encodeURIComponent('/opportunity-map/vault');}return false;};${'</script>'}</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
