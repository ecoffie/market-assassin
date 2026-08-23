/**
 * GET /opportunity-map/proposal — the Proposal Workspace (Eric: "the real product;
 * the culmination of the OS"). The NEXT STATE after Pursuits — "How do I win this?".
 *
 * This is a re-shell, NOT a rebuild: it WRAPS the EXISTING proposal engine (all under
 * /api/app/proposal/*, MI-token authed) into a 3-column "mission control" keyed to a
 * pursuit via ?pursuit=<pipeline_id> (also accepts ?notice=<notice_id>). Nothing new is
 * built on the engine side — every panel fetches a route that already exists:
 *   - Documents            → /api/app/proposal/pursuit-docs
 *   - Compliance Matrix %  → /api/app/proposal/compliance-state (owner/status persisted)
 *   - LEFT rail + center   → /api/app/proposal/drafts (persisted drafted sections)
 *   - Build this section   → /api/app/proposal/draft (one section, Vault-grounded)
 *   - Generate Next        → /api/app/proposal/draft-all
 *   - Mindy Suggestions    → /api/app/proposal/scan (+ referee for Review)
 *   - Export draft (.docx) → /api/app/proposal/export (it produces .docx, NOT PDF — the
 *                            export route Packer.toBuffer's a wordprocessingml doc; the
 *                            button is labelled honestly)
 *   - M-Win donut          → /api/app/win-probability (SAME call the listing hero uses)
 *   - "Using from Vault"   → /api/app/vault (capabilities/past-perf/certs counts)
 *   - Opportunity facts    → /api/pipeline (the pursuit row: title/agency/naics/deadline/
 *                            set_aside/value/notice_id)
 *
 * GROUNDED-vs-DEFERRED (Eric decided — do NOT fabricate):
 *  - Per-section % + overall % = a GROUNDED derived rule in src/lib/proposal/
 *    workspace-progress.ts (done/in-progress/pending from real drafts + compliance
 *    counts; overall = mean; empty → 0, never a guess). Unit-tested.
 *  - Team panel = REAL compliance-matrix owners ONLY (distinct owner emails + a count
 *    per owner; display name = email local-part). NO fabricated roster. Empty → honest
 *    "assign requirements in the Compliance Matrix" state.
 *  - Pricing margin + Teaming Prime/Subs have NO data source → honest "coming" empty
 *    states, NEVER an invented margin/sub.
 *  - Autosave: only ever shown when a save truly persists; v1 does NOT autosave edits,
 *    so the header shows "Draft" with NO fake timestamp.
 *
 * Shell mirrors src/app/opportunity-map/favorites/route.ts (ZHEAD nav + self-contained
 * rail + account-menu + MI-token localStorage auth + hdrs() + sign-in fallback). LIGHT
 * theme, map tokens copied. NO EMOJI — every glyph is an inline sized SVG. Every fetch is
 * async + fail-soft: the shell renders instantly and panels fill in; a failed fetch shows
 * an honest note, never blocks. A 402/teaser response shows the upgrade CTA, never crashes.
 *
 * ENCODING: the raw-HTML portion uses real UTF-8 chars / entities (&rarr; &middot;
 * &mdash;); \\uXXXX escapes appear ONLY inside JS single-quoted strings assigned via
 * innerHTML/textContent — never in raw HTML.
 */
import { NextResponse } from 'next/server';
import { MAPS_HOME_PATH } from '@/lib/mindy/maps-home';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../account-menu';

export const dynamic = 'force-dynamic';

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Proposal Workspace — Mindy</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#006aff;--jan:#006aff;
    --grnd:#0f9d58;--grnd-line:#cfe9d9;--recomp:#b26a00;--forecast:#7c5cff;--warm:#b54708;--amber:#b26a00;--con:#d92d20;--red:#e5484d;
    --disp:'Inter',system-ui,sans-serif;--sans:'Inter',system-ui,sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fbfcfe;-webkit-font-smoothing:antialiased}
  a{color:inherit}
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
  .main{margin-left:64px}
  /* ── Workspace header (below the app nav) ── */
  .wshead{position:sticky;top:52px;z-index:25;display:flex;align-items:center;gap:14px;padding:12px 24px;border-bottom:1px solid var(--line);background:#fff}
  .backlink{display:inline-flex;align-items:center;gap:7px;font:700 13.5px Inter,sans-serif;color:var(--sub);text-decoration:none;white-space:nowrap}
  .backlink:hover{color:var(--jan)}
  .backlink svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  .wstitle{font:800 18px Inter,sans-serif;letter-spacing:-.02em;display:flex;align-items:center;gap:9px}
  .beta{font:800 9.5px Inter,sans-serif;letter-spacing:.08em;color:#5b34c9;background:#efe9ff;border:1px solid #ddd0fb;border-radius:6px;padding:2px 7px;text-transform:uppercase}
  .savestate{font:600 12px Inter,sans-serif;color:var(--faint);white-space:nowrap}
  .savestate svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2;vertical-align:-1px;margin-right:4px}
  .wshead-sp{flex:1}
  .btn-sec{display:inline-flex;align-items:center;gap:7px;font:700 13px Inter,sans-serif;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:9px;padding:8px 13px;cursor:pointer;text-decoration:none}
  .btn-sec:hover{border-color:#c7d2e0;background:var(--wash)}
  .btn-sec svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  /* ── Opportunity hero ── */
  .hero{display:flex;gap:20px;align-items:stretch;padding:18px 24px;border-bottom:1px solid var(--line);background:#fff}
  .hero-l{flex:1;min-width:0}
  .hero-title-row{display:flex;align-items:flex-start;gap:10px}
  .hero-title{font:800 21px Inter,sans-serif;letter-spacing:-.02em;line-height:1.2;color:var(--ink)}
  .hero-edit{font:700 12px Inter,sans-serif;color:var(--jan);background:none;border:0;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:2px 0;white-space:nowrap;margin-top:3px}
  .hero-edit svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.2}
  .hero-sub{font:600 13.5px Inter,sans-serif;color:var(--sub);margin-top:5px}
  .hero-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .chip{display:inline-flex;align-items:center;gap:6px;font:700 12px Inter,sans-serif;color:var(--sub);background:var(--wash);border:1px solid var(--line);border-radius:999px;padding:5px 11px;white-space:nowrap}
  .chip svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .chip.due{color:var(--warm);background:#fff7ee;border-color:#f0d9b5}
  .chip.due.urgent{color:var(--con);background:#fdecec;border-color:#f7cccc}
  .chip.dna{color:var(--grnd);background:#f2fbf6;border-color:var(--grnd-line)}
  .chip.set{color:#5b34c9;background:#f4f0ff;border-color:#e2d7fb}
  .chip.val{color:var(--ink)}
  /* M-Win donut card */
  .mwin{flex:none;width:210px;border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:linear-gradient(160deg,#f7fbff,#fbfcfe)}
  .mwin-lab{font:800 10.5px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--sub)}
  .donut{position:relative;width:96px;height:96px}
  .donut svg{transform:rotate(-90deg)}
  .donut .num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 24px Inter,sans-serif;letter-spacing:-.02em}
  .mwin-conf{font:700 12px Inter,sans-serif}
  .mwin-why{font:700 11.5px Inter,sans-serif;color:var(--jan);background:none;border:0;cursor:pointer}
  .mwin-miss{font:600 12px Inter,sans-serif;color:var(--faint);text-align:center;line-height:1.4;padding:6px 2px}
  /* ── Progress strip ── */
  .pstrip{padding:14px 24px;border-bottom:1px solid var(--line);background:#fff}
  .pstrip-top{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}
  .pstrip-top .lab{font:800 13px Inter,sans-serif;color:var(--ink)}
  .pstrip-top .pc{font:800 13px Inter,sans-serif;color:var(--grnd)}
  .pbar{height:8px;border-radius:5px;background:var(--hair);overflow:hidden}
  .pbar > i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#0f9d58,#14b866);transition:width .4s}
  .pminis{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px}
  .pmini{flex:1;min-width:130px}
  .pmini .pm-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}
  .pmini .pm-lab{font:700 11.5px Inter,sans-serif;color:var(--sub)}
  .pmini .pm-pc{font:700 11.5px Inter,sans-serif;color:var(--faint)}
  .pmini .pm-bar{height:5px;border-radius:4px;background:var(--hair);overflow:hidden}
  .pmini .pm-bar > i{display:block;height:100%;border-radius:4px}
  .pm-ok > i{background:var(--grnd)} .pm-prog > i{background:var(--blue)}
  .pm-low > i{background:var(--amber)} .pm-pend > i{background:var(--faint)}
  /* ── 3-column layout ── */
  .cols{display:grid;grid-template-columns:248px 1fr 312px;gap:0;align-items:start}
  .colL{border-right:1px solid var(--line);background:#fff;min-height:60vh}
  .colC{padding:20px 24px 100px;min-width:0}
  .colR{border-left:1px solid var(--line);background:#fff;padding:16px;display:flex;flex-direction:column;gap:14px;min-height:60vh}
  @media(max-width:1120px){.cols{grid-template-columns:220px 1fr}.colR{grid-column:1 / -1;border-left:0;border-top:1px solid var(--line);flex-direction:row;flex-wrap:wrap}.colR > *{flex:1;min-width:240px}}
  @media(max-width:760px){.cols{grid-template-columns:1fr}.colL{border-right:0;border-bottom:1px solid var(--line)}}
  /* LEFT rail sections */
  .railhd{font:800 11px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);padding:16px 16px 8px}
  .sect{display:flex;align-items:center;gap:10px;padding:9px 16px;font:600 13.5px Inter,sans-serif;color:var(--ink);cursor:pointer;border:0;background:none;width:100%;text-align:left;border-left:3px solid transparent}
  .sect:hover{background:var(--wash)}
  .sect.on{background:#eff5ff;border-left-color:var(--jan);color:var(--jan);font-weight:700}
  .sect .dot{width:16px;height:16px;flex:none;display:flex;align-items:center;justify-content:center}
  .sect .dot svg{width:16px;height:16px}
  .dot.done{color:var(--grnd)} .dot.prog{color:var(--blue)} .dot.pend{color:var(--faint)}
  .sect .sub{display:block;margin-left:8px;border-left:1px solid var(--line);padding-left:0}
  .sect-sub .sect{padding-left:34px;font-size:12.5px}
  .addsect{display:flex;align-items:center;gap:8px;padding:12px 16px;font:700 12.5px Inter,sans-serif;color:var(--jan);cursor:pointer;background:none;border:0;width:100%;text-align:left}
  .addsect svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.4}
  /* CENTER editor */
  .ed-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px}
  .ed-title{font:800 19px Inter,sans-serif;letter-spacing:-.02em}
  .pill{font:800 10px Inter,sans-serif;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:6px}
  .pill.draft{color:#5b34c9;background:#f4f0ff;border:1px solid #e2d7fb}
  .pill.approved{color:var(--grnd);background:#f2fbf6;border:1px solid var(--grnd-line)}
  .pill.pending{color:var(--faint);background:var(--hair);border:1px solid var(--line)}
  .ed-progress{display:flex;align-items:center;gap:10px;margin:8px 0 14px}
  .ed-progress .lab{font:700 12px Inter,sans-serif;color:var(--sub);white-space:nowrap}
  .ed-progress .pbar{flex:1;max-width:260px}
  .btn-build{display:inline-flex;align-items:center;gap:7px;font:700 13px Inter,sans-serif;color:#fff;background:var(--jan);border:1px solid var(--jan);border-radius:9px;padding:8px 15px;cursor:pointer;white-space:nowrap}
  .btn-build:hover{background:#0057d6}
  .btn-build:disabled{opacity:.55;cursor:default}
  .btn-build svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  .toolbar{display:flex;gap:2px;padding:6px;border:1px solid var(--line);border-bottom:0;border-radius:9px 9px 0 0;background:var(--wash)}
  .toolbar button{width:30px;height:28px;border:0;background:none;border-radius:6px;color:var(--sub);cursor:pointer;display:flex;align-items:center;justify-content:center;font:700 13px Georgia,serif}
  .toolbar button:hover{background:#fff;color:var(--ink)}
  .toolbar button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2}
  .editor{width:100%;min-height:340px;border:1px solid var(--line);border-radius:0 0 9px 9px;padding:16px;font:400 14.5px/1.7 Inter,sans-serif;color:var(--ink);resize:vertical;outline:none}
  .editor:focus{border-color:#c7d2e0}
  .editor.empty-state{color:var(--faint);font-style:italic}
  .vaultbar{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin-top:14px;padding:12px 14px;border:1px solid var(--line);border-radius:11px;background:var(--wash)}
  .vaultbar .vlab{font:700 12px Inter,sans-serif;color:var(--sub)}
  .vchip{display:inline-flex;align-items:center;gap:6px;font:700 12px Inter,sans-serif;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:999px;padding:5px 11px}
  .vchip b{color:var(--grnd)}
  .vchip svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .vlink{font:700 12px Inter,sans-serif;color:var(--jan);background:none;border:0;cursor:pointer;margin-left:auto}
  /* deferred section bodies (Pricing / Teaming) */
  .deferbox{border:1px dashed #d4d9e2;border-radius:12px;padding:22px;text-align:center;background:var(--wash);margin-top:6px}
  .deferbox svg{width:30px;height:30px;fill:none;stroke:var(--faint);stroke-width:1.6;margin-bottom:8px}
  .deferbox h4{font:800 15px Inter,sans-serif;color:var(--ink);margin-bottom:5px}
  .deferbox p{font:500 13px Inter,sans-serif;color:var(--sub);line-height:1.5;max-width:340px;margin:0 auto}
  .deferbox .coming{display:inline-block;margin-top:10px;font:800 10px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);background:var(--hair);border-radius:6px;padding:3px 9px}
  /* RIGHT rail cards */
  .rcard{border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden}
  .rcard-hd{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:1px solid var(--hair)}
  .rcard-hd .t{font:800 12.5px Inter,sans-serif;letter-spacing:.01em;display:flex;align-items:center;gap:7px}
  .rcard-hd .t svg{width:15px;height:15px;fill:none;stroke:var(--sub);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .rcard-hd .t .badge{font:700 10px Inter,sans-serif;color:#fff;background:var(--jan);border-radius:9px;padding:1px 7px;min-width:18px;text-align:center}
  .rcard-hd .act{font:700 11.5px Inter,sans-serif;color:var(--jan);background:none;border:0;cursor:pointer;text-decoration:none}
  .rcard-bd{padding:12px 14px}
  .rrow{display:flex;justify-content:space-between;gap:10px;padding:5px 0;font:500 12.5px Inter,sans-serif}
  .rrow .k{color:var(--faint)} .rrow .v{color:var(--ink);font-weight:700;text-align:right;min-width:0;word-break:break-word}
  .docitem{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--hair)}
  .docitem:first-child{border-top:0}
  .docitem svg{width:17px;height:17px;flex:none;fill:none;stroke:var(--sub);stroke-width:1.8}
  .docitem .dnm{font:600 12.5px Inter,sans-serif;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .docitem .dmeta{font:600 11px Inter,sans-serif;color:var(--faint)}
  .sugg{display:flex;gap:9px;padding:9px 0;border-top:1px solid var(--hair);cursor:default}
  .sugg:first-child{border-top:0}
  .sugg .ic{flex:none;width:17px;height:17px;margin-top:1px}
  .sugg .ic svg{width:17px;height:17px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .sugg.err .ic svg{stroke:var(--con)} .sugg.warn .ic svg{stroke:var(--warm)} .sugg.ok .ic svg{stroke:var(--grnd)}
  .sugg .tx{font:500 12.5px Inter,sans-serif;color:var(--ink);line-height:1.4}
  .teamrow{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--hair)}
  .teamrow:first-child{border-top:0}
  .teamav{width:28px;height:28px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 11px Inter,sans-serif;color:#fff;background:linear-gradient(135deg,#1e3a8a,#7c3aed)}
  .teamrow .tnm{font:600 12.5px Inter,sans-serif;color:var(--ink)}
  .teamrow .tct{font:600 11px Inter,sans-serif;color:var(--faint);margin-left:auto}
  .rempty{font:500 12.5px Inter,sans-serif;color:var(--sub);line-height:1.5;padding:4px 0}
  .rempty a,.rempty button{color:var(--jan);font-weight:700;background:none;border:0;cursor:pointer;padding:0;text-decoration:none}
  .rnote{font:600 11.5px Inter,sans-serif;color:var(--con);padding:4px 0}
  /* ── Bottom action bar ── */
  .actionbar{position:fixed;left:64px;right:0;bottom:0;z-index:35;display:flex;align-items:center;gap:10px;padding:11px 22px;border-top:1px solid var(--line);background:rgba(255,255,255,.96);backdrop-filter:blur(6px);flex-wrap:wrap}
  .abtn{display:inline-flex;align-items:center;gap:7px;font:700 12.5px Inter,sans-serif;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:9px;padding:9px 13px;cursor:pointer;white-space:nowrap}
  .abtn:hover{border-color:#c7d2e0;background:var(--wash)}
  .abtn:disabled{opacity:.55;cursor:default}
  .abtn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .abtn .sm{font:600 11px Inter,sans-serif;color:var(--faint)}
  .abtn.primary{color:#fff;background:linear-gradient(135deg,#1e3a8a,#7c3aed);border-color:transparent}
  .abtn.primary:hover{filter:brightness(1.06)}
  .abar-sp{flex:1}
  /* ── Upgrade CTA (402/teaser) ── */
  .upsell{margin:12px 0;padding:14px 16px;border:1px solid #e2d7fb;border-radius:12px;background:#f7f2ff}
  .upsell h4{font:800 14px Inter,sans-serif;color:#4c1d95;margin-bottom:4px}
  .upsell p{font:500 12.5px Inter,sans-serif;color:#5b34c9;line-height:1.5;margin-bottom:10px}
  .upsell a{display:inline-flex;align-items:center;gap:6px;font:700 12.5px Inter,sans-serif;color:#fff;background:linear-gradient(135deg,#1e3a8a,#7c3aed);border-radius:9px;padding:8px 14px;text-decoration:none}
  .signin{padding:60px 20px;text-align:center;color:var(--sub);font:500 15px Inter,sans-serif}
  .signin a{color:var(--jan);font-weight:700;text-decoration:none}
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
  <a href="/opportunity-map/saved" title="Watchlist"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Watchlist</span></a>
  <a href="/opportunity-map/favorites" title="Saved"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Saved</span></a>
  <a class="on" href="/opportunity-map/pursuits" title="Pursuits"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Pursuits</span></a>
</nav>
<div class="main" id="wsroot">
  <div class="signin" id="gate">Loading&hellip;</div>
</div>
<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function qp(k){ try{ return new URLSearchParams(location.search).get(k)||''; }catch(e){ return ''; } }

  var t=tok(), em=email(), root=document.getElementById('wsroot');
  if(!t||!em){ root.innerHTML='<div class="signin">Please <a href="/app?next=%2Fopportunity-map%2Fproposal">sign in</a> to open the Proposal Workspace.</div>'; return; }
  function hdrs(){ return {'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em}; }

  var PURSUIT_ID = qp('pursuit');           // pipeline_id (primary key)
  var NOTICE_ID  = qp('notice');            // fallback: match a pursuit by notice_id

  // ── Behavioral analytics (mirrors opportunity-map/route.ts _track). Fire-and-forget: signed-out
  //    emits NOTHING, every failure swallowed, never blocks a build/nav. Reuses the EXISTING
  //    /api/app/engagement POST — eventType is ALLOWLISTED, so the specific action rides in
  //    metadata.action ('tool_use', or 'export' for the .docx export). journey_id joins this
  //    workspace's lifecycle back to the map funnel. DEFERRED (next layer, not built here): finer
  //    Map events (hover-sample / cluster-expand / zoom) + Vault field-level events. ──
  function journeyId(o){
    o=o||{}; var nid=o.notice_id||NOTICE_ID||'';
    if(nid) return 'journey:'+nid;
    var key='mindy_journey_'+String(o.id||PURSUIT_ID||'');
    try{ var ex=localStorage.getItem(key); if(ex) return ex;
      var j='j_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
      localStorage.setItem(key, j); return j;
    }catch(e){ return 'j_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10); }
  }
  // Journey key for the current pursuit: notice_id when present (omit when genuinely absent), always journey_id.
  function jkey(extra){
    var p=(typeof S!=='undefined'&&S&&S.pursuit)?S.pursuit:{};
    var m=extra||{}; var nid=p.notice_id||NOTICE_ID||'';
    if(nid) m.notice_id=nid;
    m.journey_id=journeyId(p);
    return m;
  }
  function track(action, extras){
    try{
      if(!t||!em) return;                                  // signed-out: nothing to attribute
      var m=jkey(extras); m.action=action; m.surface='proposal';
      var et=(action==='export_proposal')?'export':'tool_use';   // allowed eventType only
      fetch('/api/app/engagement',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t},
        body:JSON.stringify({email:em,eventType:et,eventSource:'proposal',metadata:m}),keepalive:true}).catch(function(){});
    }catch(e){}
  }

  // ── SVG glyphs (no emoji anywhere) ─────────────────────────────────────────
  var IC = {
    check:'<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    circle:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>',
    half:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor" stroke="none"/></svg>',
    doc:'<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
    warn:'<svg viewBox="0 0 24 24"><path d="M10.3 3.9 2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
    err:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    ok:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
    arrow:'<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    users:'<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/></svg>',
    file:'<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
    info:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
    tag:'<svg viewBox="0 0 24 24"><path d="M20.6 13.4 12 22l-9-9V3h10z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>'
  };

  // ── GROUNDED progress derivation (mirrors src/lib/proposal/workspace-progress.ts) ──
  var DRAFT_WORD_FLOOR = 40, IN_PROGRESS_PCT = 60;
  function sectionProgressFromDraft(d){
    if(!d) return {pct:0,state:'pending'};
    var words = (typeof d.wordCount==='number'&&d.wordCount>0) ? d.wordCount : String(d.draft||'').split(/\\s+/).filter(Boolean).length;
    if(words<=0) return {pct:0,state:'pending'};
    var approved = d.approved===true || String(d.status||'').toLowerCase()==='approved';
    if(approved && words>=DRAFT_WORD_FLOOR) return {pct:100,state:'done'};
    return {pct:IN_PROGRESS_PCT,state:'in_progress'};
  }
  function complianceProgress(rows){
    var list=Array.isArray(rows)?rows:[]; var total=list.length;
    if(total===0) return {pct:0,state:'pending',done:0,total:0};
    var done=list.filter(function(r){return String(r.status||'').toLowerCase()==='done';}).length;
    var pct=Math.round(done/total*100);
    var state=pct>=100?'done':(done>0?'in_progress':'pending');
    return {pct:pct,state:state,done:done,total:total};
  }
  function overallProgress(pcts){
    var vals=(pcts||[]).filter(function(n){return typeof n==='number'&&isFinite(n);});
    if(!vals.length) return 0;
    return Math.round(vals.reduce(function(a,b){return a+b;},0)/vals.length);
  }
  function teamFromComplianceOwners(rows){
    var list=Array.isArray(rows)?rows:[]; var counts={};
    list.forEach(function(r){ var o=String(r.owner||'').trim().toLowerCase(); if(!o)return; counts[o]=(counts[o]||0)+1; });
    return Object.keys(counts).map(function(e){ var at=e.indexOf('@'); return {email:e,name:at>0?e.slice(0,at):e,count:counts[e]}; })
      .sort(function(a,b){ return b.count-a.count || a.email.localeCompare(b.email); });
  }

  // ── The LEFT-rail stage model. Grounded stages map to a draft sectionType;
  //    non-drafting stages (Overview / Compliance Matrix / Outline / Attachments /
  //    Final Review / Submit) have their own state rules. Pricing + Teaming are the
  //    DEFERRED (honest "coming") sections — no fabricated data. ──
  // NOTICE_MODE mirrors noticeTypeToDetected() in src/lib/utils/notice-type.ts —
  // the SAME mapping the /app panel uses. The Workspace's client JS cannot import
  // the TS lib (this file emits raw browser JS), so the mapping is reproduced here
  // and pinned by a unit test that asserts the two agree for every notice type in
  // the corpus. If the lib changes, that test fails — this must not silently drift.
  var NOTICE_MODE = 'unknown';
  function detectNoticeMode(nt){
    var t = String(nt||'').toLowerCase();
    if(!t.trim()) return 'unknown';
    // respondability 'none' — informational, no drafting flow
    if(t.indexOf('award')>-1 || t.indexOf('justification')>-1 || t.indexOf('surplus')>-1 || t.indexOf('sale of')>-1) return 'unknown';
    // respondability 'response' — market research: LOI/capability response
    if(t.indexOf('sources sought')>-1) return 'sources_sought';
    if(t.indexOf('rfi')>-1 || t.indexOf('request for information')>-1) return 'rfi';
    if(t.indexOf('rfq')>-1 || t.indexOf('request for quote')>-1 || t.indexOf('quotation')>-1) return 'rfq';
    return 'rfp';
  }

  // ── NOTICE-TYPE-AWARE STAGES (2026-08-18) ──────────────────────────────────
  // Was ONE hardcoded array: every notice type got the identical 15-section RFP
  // skeleton. A Sources Sought — which wants a 2-5 page capability response —
  // rendered Transition Plan, Risk Management and "Submit Proposal", and the
  // right rail printed "Contract Type: Sources Sought" beside it. notice_type was
  // read for DISPLAY only and branched nothing.
  //
  // This mirrors the SHIPPING /app panel exactly (ProposalsPanel:791-793) — two
  // modes, no third case:
  //   sources_sought | rfi  -> LOI response sections
  //   everything else       -> the full proposal set
  // RFQ deliberately keeps the full set (the panel only simplifies its FLOW via
  // isRfqMode). IDIQ needs no case: an IDIQ solicitation arrives AS an RFP and
  // falls through here correctly (Eric 2026-08-18: "just do what the proposal
  // assist does now as it works for all scenarios").
  //
  // Classification uses the SHARED lib (noticeTypeToDetected -> classifyNoticeType,
  // src/lib/utils/notice-type.ts) injected as NOTICE_MODE — never a second
  // classifier, which is how these two surfaces drifted apart in the first place.
  var LOI_STAGES = [
    {key:'overview', label:'Overview', kind:'meta'},
    {key:'company_overview', label:'LOI Opening', section:'company_overview'},
    {key:'cap_past_performance', label:'Relevant Experience', section:'cap_past_performance'},
    {key:'capabilities', label:'Capability Fit', section:'capabilities'},
    {key:'differentiators', label:'Why Us', section:'differentiators'},
    {key:'poc', label:'Point of Contact', section:'poc'},
    {key:'attachments', label:'Attachments', kind:'attachments'},
    {key:'final', label:'Final Review', kind:'review'}
  ];
  var RFP_STAGES = [
    {key:'overview', label:'Overview', kind:'meta'},
    {key:'compliance', label:'Compliance Matrix', kind:'compliance'},
    {key:'outline', label:'Outline', kind:'outline'},
    {key:'technical', label:'Technical Volume', kind:'group', children:[
      {key:'exec_summary', label:'Executive Summary', section:'exec_summary'},
      {key:'technical', label:'Technical Approach', section:'technical'},
      {key:'management', label:'Staffing Plan', section:'management'},
      {key:'quality', label:'Quality Control', kind:'meta'},
      {key:'transition', label:'Transition Plan', kind:'meta'},
      {key:'risk', label:'Risk Management', kind:'meta'}
    ]},
    {key:'past_performance', label:'Past Performance', section:'past_performance'},
    {key:'pricing', label:'Pricing', kind:'deferred', defer:'pricing'},
    {key:'teaming', label:'Teaming Partners', kind:'deferred', defer:'teaming'},
    {key:'attachments', label:'Attachments', kind:'attachments'},
    {key:'final', label:'Final Review', kind:'review'},
    {key:'submit', label:'Submit Proposal', kind:'submit'}
  ];
  // A Sources Sought / RFI is a market-research RESPONSE — there is no proposal to
  // submit, so the submit stage is absent from LOI_STAGES entirely (not hidden).
  function isLoiMode(){ return NOTICE_MODE==='sources_sought' || NOTICE_MODE==='rfi'; }
  var STAGES = RFP_STAGES;
  function applyStages(){ STAGES = isLoiMode() ? LOI_STAGES : RFP_STAGES; }
  // The five progress-strip mini-bars (Compliance / Technical / Past Performance / Pricing / Attachments).
  // Each % is GROUNDED — Pricing has no source, so it's honestly 0/pending, never a guess.

  // ── State (all fetched async; the shell renders first) ──
  var S = {
    pursuit:null,       // the pipeline row
    drafts:{},          // sectionType -> {draft,wordCount,...}
    fileName:'',        // the draft-all batch fileName (the RFP name)
    compliance:[],      // persisted matrix rows
    docs:[],            // pursuit documents
    findings:[],        // scan findings
    vault:null,         // {caps,pp,certs}
    mwin:null,          // win-probability response
    gated:false,        // a Pro-gate (402/teaser) was hit
    selected:'exec_summary'
  };

  function esc(s){return h(s);}
  function money(n){ n=Number(n); if(!isFinite(n)||n<=0) return ''; if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B'; if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M'; if(n>=1e3)return '$'+Math.round(n/1e3)+'K'; return '$'+Math.round(n).toLocaleString(); }
  function parseMoney(v){ if(v==null)return 0; if(typeof v==='number')return v; var s=String(v).trim().replace(/[$,]/g,''); var m=/^([0-9.]+)\\s*([kmb])?/i.exec(s); if(!m)return 0; var n=parseFloat(m[1])||0; var u=(m[2]||'').toLowerCase(); if(u==='k')n*=1e3; else if(u==='m')n*=1e6; else if(u==='b')n*=1e9; return n; }
  function longDate(d){ var s=String(d||'').slice(0,10); if(!s)return ''; try{ return new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }catch(e){return '';} }
  function daysUntil(d){ var s=String(d||'').slice(0,10); if(!s)return null; var now=new Date(); var today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12,0,0,0); return Math.round((new Date(s+'T12:00:00')-today)/864e5); }
  function fileSize(b){ b=Number(b); if(!isFinite(b)||b<=0)return ''; if(b>=1e6)return (b/1e6).toFixed(1)+' MB'; if(b>=1e3)return Math.round(b/1e3)+' KB'; return b+' B'; }

  function sectionLabel(k){ var f={exec_summary:'Executive Summary',technical:'Technical Approach',management:'Staffing Plan',past_performance:'Past Performance',pricing:'Pricing Narrative'}; return f[k]||k; }

  // Per-stage progress (grounded). Returns {pct,state}.
  function stageProgress(st){
    if(st.kind==='compliance'){ var c=complianceProgress(S.compliance); return {pct:c.pct,state:c.state}; }
    if(st.kind==='deferred') return {pct:0,state:'pending'};       // Pricing/Teaming — no source, honest pending
    if(st.kind==='attachments'){ return (S.docs&&S.docs.length>0)?{pct:100,state:'done'}:{pct:0,state:'pending'}; }
    if(st.section){ return sectionProgressFromDraft(S.drafts[st.section]); }
    // meta stages (Overview/Outline/QC/Transition/Risk/Final/Submit): grounded only when we
    // have a real signal. Overview = done if we have the pursuit; Outline = in-progress once
    // any section is drafted; others stay pending (no fabricated completion).
    if(st.key==='overview') return S.pursuit?{pct:100,state:'done'}:{pct:0,state:'pending'};
    if(st.key==='outline'){ var any=Object.keys(S.drafts).some(function(k){return (S.drafts[k].draft||'').trim();}); return any?{pct:IN_PROGRESS_PCT,state:'in_progress'}:{pct:0,state:'pending'}; }
    return {pct:0,state:'pending'};
  }
  function dotFor(state){ if(state==='done')return '<span class="dot done">'+IC.check+'</span>'; if(state==='in_progress')return '<span class="dot prog">'+IC.half+'</span>'; return '<span class="dot pend">'+IC.circle+'</span>'; }

  // ── RENDER the whole workspace shell (called once; panels re-render on data) ──
  function shell(){
    var saved = '<span class="savestate">'+IC.file+'Draft</span>'; // NO fake timestamp — v1 doesn't autosave
    root.innerHTML =
      '<div class="wshead">'
      + '<a class="backlink" href="/opportunity-map/pursuits"><svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>Back to Pursuits</a>'
      + '<div class="wstitle">Proposal Workspace <span class="beta">Beta</span></div>'
      + saved
      + '<div class="wshead-sp"></div>'
      + '<button class="btn-sec" onclick="window.__wsShare()"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>Share</button>'
      + '</div>'
      + '<div class="hero" id="hero"></div>'
      + '<div class="pstrip" id="pstrip"></div>'
      + '<div class="cols">'
      +   '<div class="colL" id="colL"></div>'
      +   '<div class="colC" id="colC"></div>'
      +   '<div class="colR" id="colR"></div>'
      + '</div>'
      + '<div class="actionbar" id="actionbar"></div>';
    renderHero(); renderProgress(); renderRail(); renderCenter(); renderRight(); renderActionBar();
  }

  function renderHero(){
    var el=document.getElementById('hero'); if(!el)return;
    var p=S.pursuit||{};
    var title = p.title || 'Untitled pursuit';
    var ag = p.agency || '';
    var sub = p.sub_tier || p.office || '';
    var subLine = [ag, sub].filter(Boolean).map(h).join(' &middot; ');
    // chips
    var chips=[];
    var dl=p.response_deadline; var du=daysUntil(dl);
    if(dl && du!=null){ var urgent=du<=7; chips.push('<span class="chip due'+(urgent?' urgent':'')+'"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Due '+h(longDate(dl))+(du>=0?' ('+du+' day'+(du===1?'':'s')+')':'')+'</span>'); }
    // Repeat Buyer only when the DNA genuinely carries it
    var dna=Array.isArray(p.opportunity_dna)?p.opportunity_dna:[];
    var hasRepeat = dna.some(function(d){ return d && (d.key==='repeat_buyer' || /repeat buyer/i.test(String(d.label||''))); });
    if(hasRepeat) chips.push('<span class="chip dna">'+IC.check+'Repeat Buyer</span>');
    var setA = p.set_aside || ''; if(setA) chips.push('<span class="chip set">'+IC.tag+h(setA)+'</span>');
    var val = parseMoney(p.value_estimate); var vr=(p.intel_value_range&&typeof p.intel_value_range==='object')?p.intel_value_range:null; if(!val && vr && typeof vr.median==='number') val=vr.median;
    if(val>0) chips.push('<span class="chip val">Est. Value '+h(money(val))+'</span>');

    el.innerHTML =
      '<div class="hero-l">'
      + '<div class="hero-title-row"><div class="hero-title">'+esc(title)+'</div>'
      + '<button class="hero-edit" onclick="window.__wsEdit()"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>Edit</button></div>'
      + (subLine?'<div class="hero-sub">'+subLine+'</div>':'')
      + '<div class="hero-chips">'+(chips.join('')||'<span class="chip">Opportunity details loading&hellip;</span>')+'</div>'
      + '</div>'
      + '<div class="mwin" id="mwin"></div>';
    renderMwin();
  }

  function renderMwin(){
    var el=document.getElementById('mwin'); if(!el)return;
    var m=S.mwin;
    if(m===null){ el.innerHTML='<div class="mwin-lab">M-Win Score</div><div class="mwin-miss">Scoring&hellip;</div>'; return; }
    if(!m || m.grounded!==true){
      el.innerHTML='<div class="mwin-lab">M-Win Score</div><div class="mwin-miss">Complete your profile to unlock M-Win.</div>';
      return;
    }
    var score=Math.max(0,Math.min(100,Number(m.score)||0));
    var conf = score>=60?{t:'High confidence',c:'#0f9d58'}:score>=45?{t:'Moderate confidence',c:'#b26a00'}:{t:'Low confidence',c:'#d92d20'};
    var C=2*Math.PI*40, off=C*(1-score/100);
    el.innerHTML =
      '<div class="mwin-lab">M-Win Score</div>'
      + '<div class="donut"><svg width="96" height="96" viewBox="0 0 96 96">'
      +   '<circle cx="48" cy="48" r="40" fill="none" stroke="#eceff3" stroke-width="9"/>'
      +   '<circle cx="48" cy="48" r="40" fill="none" stroke="'+conf.c+'" stroke-width="9" stroke-linecap="round" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/>'
      +   '</svg><div class="num" style="color:'+conf.c+'">'+score+'%</div></div>'
      + '<div class="mwin-conf" style="color:'+conf.c+'">'+conf.t+'</div>'
      + '<button class="mwin-why" onclick="window.__wsWhy()">Why this score?</button>';
  }

  function renderProgress(){
    var el=document.getElementById('pstrip'); if(!el)return;
    var comp=complianceProgress(S.compliance);
    var tech = overallProgress(['exec_summary','technical','management'].map(function(k){return sectionProgressFromDraft(S.drafts[k]).pct;}));
    var pp = sectionProgressFromDraft(S.drafts['past_performance']).pct;
    var pricing = 0; // DEFERRED — no source, honest 0
    var att = (S.docs&&S.docs.length>0)?100:0;
    var overall = overallProgress([comp.pct, tech, pp, pricing, att]);
    function cls(pc,state){ if(state==='pending'&&pc===0)return 'pm-pend'; if(pc>=100)return 'pm-ok'; if(pc>0&&pc<40)return 'pm-low'; return 'pm-prog'; }
    function mini(lab,pc,state){ return '<div class="pmini"><div class="pm-top"><span class="pm-lab">'+lab+'</span><span class="pm-pc">'+pc+'%</span></div><div class="pm-bar '+cls(pc,state)+'"><i style="width:'+pc+'%"></i></div></div>'; }
    el.innerHTML =
      '<div class="pstrip-top"><span class="lab">Overall Proposal Progress</span><span class="pc">'+overall+'% Complete</span></div>'
      + '<div class="pbar"><i style="width:'+overall+'%"></i></div>'
      + '<div class="pminis">'
      +   mini('Compliance', comp.pct, comp.state)
      +   mini('Technical', tech, tech>=100?'done':(tech>0?'in_progress':'pending'))
      +   mini('Past Performance', pp, sectionProgressFromDraft(S.drafts['past_performance']).state)
      +   mini('Pricing', pricing, 'pending')
      +   mini('Attachments', att, att>=100?'done':'pending')
      + '</div>';
  }

  function renderRail(){
    var el=document.getElementById('colL'); if(!el)return;
    var html='<div class="railhd">Proposal Sections</div>';
    STAGES.forEach(function(st){
      var pr=stageProgress(st);
      var on = (st.section===S.selected)||(st.key===S.selected);
      html += '<button class="sect'+(on?' on':'')+'" onclick="window.__wsSelect(\\''+(st.section||st.key)+'\\')">'+dotFor(pr.state)+'<span>'+esc(st.label)+'</span></button>';
      if(st.children){
        html+='<div class="sect-sub">';
        st.children.forEach(function(ch){
          var cpr = ch.section?sectionProgressFromDraft(S.drafts[ch.section]):(ch.kind==='meta'?{state:'pending'}:{state:'pending'});
          var con=(ch.section===S.selected)||(ch.key===S.selected);
          html+='<button class="sect'+(con?' on':'')+'" onclick="window.__wsSelect(\\''+(ch.section||ch.key)+'\\')">'+dotFor(cpr.state)+'<span>'+esc(ch.label)+'</span></button>';
        });
        html+='</div>';
      }
    });
    html += '<button class="addsect" onclick="window.__wsAddSection()"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add Custom Section</button>';
    el.innerHTML=html;
  }

  function findStage(key){
    for(var i=0;i<STAGES.length;i++){ var s=STAGES[i]; if(s.key===key||s.section===key)return s; if(s.children){ for(var j=0;j<s.children.length;j++){ var c=s.children[j]; if(c.key===key||c.section===key)return c; } } }
    return null;
  }

  function renderCenter(){
    var el=document.getElementById('colC'); if(!el)return;
    var st=findStage(S.selected)||{key:S.selected,label:sectionLabel(S.selected),section:S.selected};

    // DEFERRED sections — honest "coming" empty state, NO fabricated data.
    if(st.defer==='pricing'){
      el.innerHTML='<div class="ed-head"><div class="ed-title">Pricing</div><span class="pill pending">Not started</span></div>'
        + '<div class="deferbox"><svg viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'
        + '<h4>Upload your pricing workbook</h4><p>Pricing and margin come from your own cost workbook &mdash; Mindy won&rsquo;t invent a number. Upload your pricing workbook to build this section.</p>'
        + '<span class="coming">Coming soon</span></div>';
      return;
    }
    if(st.defer==='teaming'){
      el.innerHTML='<div class="ed-head"><div class="ed-title">Teaming Partners</div><span class="pill pending">Not started</span></div>'
        + '<div class="deferbox">'+IC.users+'<h4>Add teaming partners</h4><p>No teaming partners are attached to this pursuit yet. Add primes and subs to build the teaming section &mdash; nothing is filled in until you do.</p>'
        + '<span class="coming">Coming soon</span></div>';
      return;
    }

    // A draftable section (has a sectionType). Everything else that isn't deferred renders a
    // grounded panel too, but only the draftable ones get the editor + Build.
    var draftable = !!st.section;
    var sectionKey = st.section || '';
    var d = draftable ? (S.drafts[sectionKey]||null) : null;
    var pr = draftable ? sectionProgressFromDraft(d) : stageProgress(st);
    var pill = pr.state==='done'?'<span class="pill approved">Approved</span>':(pr.state==='in_progress'?'<span class="pill draft">Draft</span>':'<span class="pill pending">Not started</span>');

    var upsell = S.gated ? ('<div class="upsell"><h4>Building sections is a Pro feature</h4><p>Draft Vault-grounded sections, run compliance, and export your package with Mindy Pro.</p><a href="/pricing">Upgrade to Pro '+IC.arrow+'</a></div>') : '';

    var head = '<div class="ed-head"><div class="ed-title">'+esc(st.label)+'</div>'+pill
      + (draftable?'<button class="btn-build" id="buildBtn" onclick="window.__wsBuild()">'+IC.check+'Build this section</button>':'')+'</div>'
      + '<div class="ed-progress"><span class="lab">Section Progress '+pr.pct+'%</span><div class="pbar"><i style="width:'+pr.pct+'%"></i></div></div>'
      + upsell;

    if(!draftable){
      // Compliance / Outline / Attachments / Final / Submit etc. — a grounded summary, no editor.
      var body='';
      if(st.kind==='compliance'){
        var c=complianceProgress(S.compliance);
        body = c.total>0
          ? '<div class="rempty">'+c.done+' of '+c.total+' requirements checked off ('+c.pct+'%). Assign owners and mark requirements done in the Compliance Matrix.</div>'
          : '<div class="rempty">No compliance matrix yet. <button onclick="window.__wsRunCompliance()">Run Compliance Check</button> to extract requirements from the RFP.</div>';
      } else if(st.kind==='attachments'){
        body = S.docs.length>0
          ? '<div class="rempty">'+S.docs.length+' document'+(S.docs.length===1?'':'s')+' attached to this pursuit. Missing attachments are flagged honestly &mdash; nothing is checked off automatically.</div>'
          : '<div class="rempty">No documents uploaded yet. Upload the RFP, SOW and amendments in the Documents panel.</div>';
      } else if(st.kind==='review'){
        body = '<div class="rempty">Run <button onclick="window.__wsReview()">Review Proposal</button> to check the assembled draft against every requirement for gaps and risks.</div>';
      } else if(st.kind==='submit'){
        body = '<div class="rempty">When the '+(isLoiMode()?'response':'package')+' is complete, use <b>'+(isLoiMode()?'Export response':'Prepare for Submission')+'</b> in the action bar below.</div>';
      } else {
        body = '<div class="rempty">This section is grounded from your drafts and compliance state &mdash; build the drafted sections to fill it in.</div>';
      }
      el.innerHTML = head + body;
      return;
    }

    var draftText = d && d.draft ? d.draft : '';
    var editor = draftText
      ? '<textarea class="editor" id="editor" spellcheck="false">'+esc(draftText)+'</textarea>'
      : '<textarea class="editor empty-state" id="editor" spellcheck="false" placeholder="No draft yet. Click Build this section to generate a Vault-grounded draft, or write it here."></textarea>';

    // Vault chips (real counts, filled when /api/app/vault resolves).
    var v=S.vault; var vb='';
    if(v){
      vb = '<div class="vaultbar"><span class="vlab">Using from your Vault:</span>'
        + '<span class="vchip">'+IC.check+'<b>'+v.caps+'</b> Capabilit'+(v.caps===1?'y':'ies')+'</span>'
        + '<span class="vchip">'+IC.check+'<b>'+v.pp+'</b> Past Performance</span>'
        + '<span class="vchip">'+IC.check+'<b>'+v.certs+'</b> Certification'+(v.certs===1?'':'s')+'</span>'
        + '<button class="vlink" onclick="window.__wsVaultDetails()">Show details</button></div>';
    } else {
      vb = '<div class="vaultbar"><span class="vlab">Using from your Vault:</span><span class="vchip">Loading&hellip;</span></div>';
    }

    var toolbar = '<div class="toolbar">'
      + '<button title="Bold" onclick="window.__wsFmt(\\'bold\\')"><b>B</b></button>'
      + '<button title="Italic" onclick="window.__wsFmt(\\'italic\\')"><i>I</i></button>'
      + '<button title="Bullet list" onclick="window.__wsFmt(\\'list\\')"><svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></button>'
      + '<button title="Heading" onclick="window.__wsFmt(\\'h\\')">H</button>'
      + '</div>';

    el.innerHTML = head + toolbar + editor + vb;
  }

  function renderRight(){
    var el=document.getElementById('colR'); if(!el)return;
    var p=S.pursuit||{};
    // Opportunity Details (grounded from the pursuit row)
    var det='';
    function drow(k,v){ return v?('<div class="rrow"><span class="k">'+k+'</span><span class="v">'+esc(v)+'</span></div>'):''; }
    var val=parseMoney(p.value_estimate);
    det = '<div class="rcard"><div class="rcard-hd"><span class="t">'+IC.info+'Opportunity Details</span></div><div class="rcard-bd">'
      + drow('Agency', p.agency||'')
      + drow('Contract Type', p.notice_type||'')
      + drow('Solicitation', p.solicitation_number||p.notice_id||'')
      + drow('Due Date', longDate(p.response_deadline))
      + drow('NAICS', p.naics_code||'')
      + drow('Set-Aside', p.set_aside||'')
      + (!(p.agency||p.notice_type||p.naics_code)?'<div class="rempty">Opportunity details are loading&hellip;</div>':'')
      + '</div></div>';

    // Documents
    var docs='';
    if(S.docs===null){ docs='<div class="rcard-bd"><div class="rempty">Loading&hellip;</div></div>'; }
    else if(S.docs.length===0){ docs='<div class="rcard-bd"><div class="rempty">No documents uploaded. <button onclick="window.__wsManageDocs()">Upload the RFP</button> to ground your draft.</div></div>'; }
    else {
      docs='<div class="rcard-bd">'+S.docs.map(function(dc){
        var nm=dc.filename||dc.name||'Document'; var meta=[dc.type||dc.doc_type||'', fileSize(dc.size||dc.file_size)].filter(Boolean).join(' &middot; ');
        return '<div class="docitem">'+IC.doc+'<div style="min-width:0;flex:1"><div class="dnm">'+esc(nm)+'</div>'+(meta?'<div class="dmeta">'+meta+'</div>':'')+'</div></div>';
      }).join('')+'</div>';
    }
    var docHd='<div class="rcard"><div class="rcard-hd"><span class="t">'+IC.file+'Documents'+(S.docs&&S.docs.length?' <span class="dmeta" style="color:var(--faint);font-weight:700">'+S.docs.length+' uploaded</span>':'')+'</span><button class="act" onclick="window.__wsManageDocs()">Manage</button></div>'+docs+'</div>';

    // Mindy Suggestions
    var sug='';
    if(S.findings===null){ sug='<div class="rcard-bd"><div class="rempty">Loading&hellip;</div></div>'; }
    else if(S.findings.length===0){ sug='<div class="rcard-bd"><div class="rempty">Run compliance and draft a section, then Mindy flags gaps and risks here.</div></div>'; }
    else {
      sug='<div class="rcard-bd">'+S.findings.map(function(f){
        var sev=f.severity||f.level||''; var cls = /dq|disqual|error|missing/i.test(String(sev)+String(f.type||''))?'err':(/warn|risk|low/i.test(String(sev))?'warn':'ok');
        var icon = cls==='err'?IC.err:(cls==='warn'?IC.warn:IC.ok);
        var txt = f.message||f.text||f.requirement||f.title||'Finding';
        return '<div class="sugg '+cls+'"><span class="ic">'+icon+'</span><span class="tx">'+esc(txt)+'</span></div>';
      }).join('')+'</div>';
    }
    var sugHd='<div class="rcard"><div class="rcard-hd"><span class="t">'+IC.warn+'Mindy Suggestions'+(S.findings&&S.findings.length?' <span class="badge">'+S.findings.length+'</span>':'')+'</span></div>'+sug+'</div>';

    // Team — REAL compliance owners ONLY
    var team=teamFromComplianceOwners(S.compliance);
    var teamBd='';
    if(team.length===0){ teamBd='<div class="rcard-bd"><div class="rempty">Assign requirements to owners in the <button onclick="window.__wsSelect(\\'compliance\\')">Compliance Matrix</button> to build your team.</div></div>'; }
    else {
      teamBd='<div class="rcard-bd">'+team.map(function(m){
        var ini=(m.name||m.email).slice(0,2).toUpperCase();
        return '<div class="teamrow"><span class="teamav">'+esc(ini)+'</span><span class="tnm">'+esc(m.name)+'</span><span class="tct">'+m.count+' req'+(m.count===1?'':'s')+'</span></div>';
      }).join('')+'</div>';
    }
    var teamHd='<div class="rcard"><div class="rcard-hd"><span class="t">'+IC.users+'Team'+(team.length?' <span class="dmeta" style="color:var(--faint);font-weight:700">'+team.length+' member'+(team.length===1?'':'s')+'</span>':'')+'</span><button class="act" onclick="window.__wsSelect(\\'compliance\\')">Manage</button></div>'+teamBd+'</div>';

    el.innerHTML = det + docHd + sugHd + teamHd;
  }

  function renderActionBar(){
    var el=document.getElementById('actionbar'); if(!el)return;
    var comp=complianceProgress(S.compliance);
    var compSub = comp.total>0 ? ('<span class="sm">'+comp.pct+'%</span>') : '';
    el.innerHTML =
      '<button class="abtn" onclick="window.__wsRunCompliance()"><svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>Run Compliance Check '+compSub+'</button>'
      + '<button class="abtn" onclick="window.__wsGenerateNext()"><svg viewBox="0 0 24 24"><path d="M12 2v6M12 22v-6M2 12h6M22 12h-6"/><circle cx="12" cy="12" r="3"/></svg>Generate Next Section</button>'
      + '<button class="abtn" onclick="window.__wsReview()"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/></svg>Review Proposal</button>'
      + '<button class="abtn" onclick="window.__wsExport()"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>'+(isLoiMode()?'Export response (.docx)':'Export draft (.docx)')+'</button>'
      + '<div class="abar-sp"></div>'
      // A Sources Sought / RFI is a market-research RESPONSE — there is nothing to
      // "submit", so the terminal action names what actually happens: you export
      // and send the response. Same handler; honest label.
      + '<button class="abtn primary" onclick="window.__wsSubmit()"><svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>'+(isLoiMode()?'Export response':'Prepare for Submission')+'</button>';
  }

  // ── ASYNC loaders (fail-soft; shell already rendered) ──
  function loadPursuit(){
    fetch('/api/pipeline?email='+encodeURIComponent(em)+(PURSUIT_ID?'':'&includeStats=false'),{headers:hdrs()})
      .then(function(r){return r.ok?r.json():null;}).then(function(d){
        var list=(d&&d.opportunities)||[]; var row=null;
        if(PURSUIT_ID) row=list.filter(function(o){return String(o.id)===String(PURSUIT_ID);})[0]||null;
        if(!row && NOTICE_ID) row=list.filter(function(o){return String(o.notice_id)===String(NOTICE_ID);})[0]||null;
        if(!row && list.length===1) row=list[0];
        S.pursuit = row || {};
        // Resolve the section set from THIS pursuit's notice type before any render.
        NOTICE_MODE = detectNoticeMode((row&&row.notice_type)||'');
        applyStages();
        // GROUNDED: only when the workspace mounted for a REAL pursuit (a row resolved), not an empty shell.
        if(row){ track('proposal_opened', { pursuit_id: PURSUIT_ID||String(row.id||'') }); }
        // ⚠️ MUST re-render the SECTION-BEARING surfaces too, not just the hero.
        // applyStages() above swaps STAGES (LOI vs RFP) once the pursuit's notice_type
        // is known — but the rail/center/action-bar were already painted from the RFP
        // default at boot, and this handler only re-rendered hero+right. MEASURED ON PROD
        // 2026-08-18: the code shipped, /api/pipeline returned notice_type "Sources
        // Sought", applyStages() ran — and the rail still showed Transition Plan / Risk
        // Management / Submit Proposal, because nothing repainted it. A unit test on the
        // source could never catch this; only the browser did.
        renderHero(); renderRight(); renderRail(); renderCenter(); renderActionBar();
        loadMwin();          // M-Win needs the opp facts
      }).catch(function(){ S.pursuit=S.pursuit||{}; var el=document.getElementById('hero'); });
  }
  function loadMwin(){
    var p=S.pursuit||{}; var val=parseMoney(p.value_estimate);
    var qs='naics='+encodeURIComponent(p.naics_code||'')+'&setAside='+encodeURIComponent(p.set_aside||'')+'&agency='+encodeURIComponent(p.agency||'')+'&title='+encodeURIComponent(p.title||'')+(val>0?'&amount='+val:'');
    fetch('/api/app/win-probability?'+qs,{headers:hdrs()})
      .then(function(r){return r.ok?r.json():null;}).then(function(d){ S.mwin=d||{grounded:false}; renderMwin(); })
      .catch(function(){ S.mwin={grounded:false}; renderMwin(); });
  }
  function loadDrafts(){
    fetch('/api/app/proposal/drafts?email='+encodeURIComponent(em),{headers:hdrs()})
      .then(function(r){ if(r.status===402){S.gated=true;return null;} return r.ok?r.json():null;}).then(function(d){
        var secs=(d&&d.sections)||[]; S.fileName=(d&&d.fileName)||'';
        var map={}; secs.forEach(function(s){ if(s&&s.section) map[s.section]={draft:s.draft,wordCount:s.wordCount,status:s.status,approved:s.approved,profileGrounded:s.profileGrounded}; });
        S.drafts=map;
        renderRail(); renderProgress(); renderCenter();
      }).catch(function(){ renderCenter(); });
  }
  function loadCompliance(){
    if(!PURSUIT_ID){ S.compliance=[]; renderRail(); renderProgress(); renderRight(); renderActionBar(); return; }
    fetch('/api/app/proposal/compliance-state?email='+encodeURIComponent(em)+'&pipeline_id='+encodeURIComponent(PURSUIT_ID),{headers:hdrs()})
      .then(function(r){return r.ok?r.json():null;}).then(function(d){ S.compliance=(d&&d.requirements)||[]; renderRail(); renderProgress(); renderRight(); renderActionBar(); })
      .catch(function(){ S.compliance=[]; renderRight(); });
  }
  function loadDocs(){
    S.docs=null; renderRight();
    if(!PURSUIT_ID){ S.docs=[]; renderRight(); renderProgress(); return; }
    fetch('/api/app/proposal/pursuit-docs?email='+encodeURIComponent(em)+'&pipeline_id='+encodeURIComponent(PURSUIT_ID),{headers:hdrs()})
      .then(function(r){return r.ok?r.json():null;}).then(function(d){ S.docs=(d&&(d.documents||d.docs))||[]; renderRight(); renderProgress(); renderRail(); })
      .catch(function(){ S.docs=[]; renderRight(); });
  }
  function loadFindings(){
    // scan needs the matrix + a draft; if we don't have both yet, keep an honest empty state.
    S.findings=null; renderRight();
    var reqs=(S.compliance||[]).map(function(r){return {requirement:r.requirement,category:r.category,section:r.section};}).filter(function(r){return r.requirement;});
    var draftText=Object.keys(S.drafts).map(function(k){return S.drafts[k].draft||'';}).join('\\n\\n').trim();
    if(reqs.length===0 || !draftText){ S.findings=[]; renderRight(); return; }
    fetch('/api/app/proposal/scan?email='+encodeURIComponent(em),{method:'POST',headers:hdrs(),body:JSON.stringify({requirements:reqs,draftText:draftText})})
      .then(function(r){return r.ok?r.json():null;}).then(function(d){ S.findings=(d&&(d.findings||d.results))||[]; renderRight(); })
      .catch(function(){ S.findings=[]; renderRight(); });
  }
  function loadVault(){
    fetch('/api/app/vault?email='+encodeURIComponent(em),{headers:hdrs()})
      .then(function(r){return r.ok?r.json():null;}).then(function(d){
        if(!d){ S.vault={caps:0,pp:0,certs:0}; renderCenter(); return; }
        var certs=(d.identity&&Array.isArray(d.identity.certifications))?d.identity.certifications.length:0;
        S.vault={caps:(d.capabilities||[]).length, pp:(d.past_performance||[]).length, certs:certs};
        renderCenter();
      }).catch(function(){ S.vault={caps:0,pp:0,certs:0}; renderCenter(); });
  }

  // ── Interactions ──
  window.__wsSelect=function(key){ S.selected=key; renderRail(); renderCenter(); };
  window.__wsShare=function(){ try{ if(navigator.share){navigator.share({title:'Proposal Workspace',url:location.href});return;} }catch(e){} try{ navigator.clipboard.writeText(location.href); alert('Workspace link copied to clipboard.'); }catch(e2){ alert('Copy this URL to share: '+location.href); } };
  window.__wsEdit=function(){ var p=S.pursuit||{}; var href=p.notice_id?('/opportunity-map?opp='+encodeURIComponent(p.notice_id)):'/opportunity-map/pursuits'; location.href=href; };
  window.__wsWhy=function(){ var m=S.mwin; if(!m||m.grounded!==true){ alert('Complete your company profile to see your M-Win breakdown.'); return; } var lines=[]; if(m.summary)lines.push(m.summary); if(Array.isArray(m.why)&&m.why.length)lines.push('Win factors:\\n- '+m.why.join('\\n- ')); if(Array.isArray(m.risks)&&m.risks.length)lines.push('Risks:\\n- '+m.risks.join('\\n- ')); alert(lines.join('\\n\\n')||('M-Win '+m.score+'%')); };
  // The map-native vault, not /app (Eric 2026-08-13). This is the map's OWN workspace, so sending
  // the user to the old panel to read their vault threw them out of the surface they were working
  // in — and out of the redesign — mid-draft.
  window.__wsVaultDetails=function(){ location.href='/opportunity-map/vault'; };
  window.__wsManageDocs=function(){ var p=S.pursuit||{}; location.href='/app?panel=proposals'+(PURSUIT_ID?('&pursuit_id='+encodeURIComponent(PURSUIT_ID)):''); };
  window.__wsAddSection=function(){ alert('Custom sections are managed in the Proposals panel.'); location.href='/app?panel=proposals'; };
  window.__wsFmt=function(cmd){ var ta=document.getElementById('editor'); if(!ta)return; ta.focus(); /* visual-only toolbar in v1; the textarea is the editable draft */ };

  window.__wsBuild=function(){
    var st=findStage(S.selected); if(!st||!st.section){ alert('Select a draftable section first.'); return; }
    var btn=document.getElementById('buildBtn'); if(btn){ btn.disabled=true; btn.innerHTML='Building\\u2026'; }
    var reqs=(S.compliance||[]).map(function(r){return {id:r.req_key,requirement:r.requirement,category:r.category,section:r.section};}).filter(function(r){return r.requirement;});
    var body={ sectionType:st.section, fileName:S.fileName||'untitled RFP', rfpAgency:(S.pursuit&&S.pursuit.agency)||null, requirements:reqs, text:sourceTextForDraft() };
    if(PURSUIT_ID) body.pipelineId=PURSUIT_ID;   // telemetry only; omitted when absent, never invented
    fetch('/api/app/proposal/draft?email='+encodeURIComponent(em),{method:'POST',headers:hdrs(),body:JSON.stringify(body)})
      .then(function(r){ if(r.status===402){S.gated=true;renderCenter();throw new Error('gated');} return r.ok?r.json():r.json().then(function(j){throw new Error((j&&j.error)||'draft failed');}); })
      .then(function(d){ if(d&&d.success){ S.drafts[st.section]={draft:d.draft,wordCount:d.wordCount,status:'draft'}; track('section_built', { section: st.section }); renderRail(); renderProgress(); renderCenter(); } else { throw new Error((d&&d.error)||'draft failed'); } })
      .catch(function(e){ if(String(e.message)!=='gated'){ if(btn){btn.disabled=false;btn.innerHTML='Build this section';} alert('Could not build this section. '+(e.message||'')); } });
  };
  // Draft grounding text = the RFP/SOW text we have. In v1 we pass the pursuit title +
  // any compliance requirement text as the source (the engine also weaves the Vault); a
  // real RFP upload lives in the Documents/Proposals panel.
  function sourceTextForDraft(){
    var p=S.pursuit||{}; var parts=[p.title||'', p.agency||''];
    (S.compliance||[]).forEach(function(r){ if(r.requirement) parts.push(r.requirement); });
    return parts.filter(Boolean).join('\\n');
  }

  window.__wsRunCompliance=function(){ track('compliance_run', {}); location.href='/app?panel=proposals'+(PURSUIT_ID?('&pursuit_id='+encodeURIComponent(PURSUIT_ID)):'')+'&action=compliance'; };
  window.__wsGenerateNext=function(){
    // Find the first draftable section with no draft, and build it.
    var next=null; STAGES.forEach(function(st){ if(st.section && !next && !(S.drafts[st.section]&&(S.drafts[st.section].draft||'').trim())) next=st.section; if(st.children){ st.children.forEach(function(c){ if(c.section && !next && !(S.drafts[c.section]&&(S.drafts[c.section].draft||'').trim())) next=c.section; }); } });
    if(!next){ alert('All drafted sections are complete. Review the proposal before submission.'); return; }
    S.selected=next; renderRail(); renderCenter(); setTimeout(function(){ window.__wsBuild(); },50);
  };
  window.__wsReview=function(){
    var reqs=(S.compliance||[]).map(function(r){return {requirement:r.requirement,category:r.category,section:r.section};}).filter(function(r){return r.requirement;});
    var draft=Object.keys(S.drafts).map(function(k){return S.drafts[k].draft||'';}).join('\\n\\n').trim();
    if(reqs.length===0 || !draft){ alert('Run compliance and draft at least one section before reviewing.'); return; }
    // Fired only AFTER the guard passes = a real review launch (referee runs in the Proposals panel).
    track('proposal_reviewed', {});
    location.href='/app?panel=proposals'+(PURSUIT_ID?('&pursuit_id='+encodeURIComponent(PURSUIT_ID)):'')+'&action=review';
  };
  window.__wsExport=function(){ track('export_proposal', {}); location.href='/app?panel=proposals'+(PURSUIT_ID?('&pursuit_id='+encodeURIComponent(PURSUIT_ID)):'')+'&action=export'; };
  window.__wsSubmit=function(){ track('proposal_submitted', {}); location.href='/app?panel=proposals'+(PURSUIT_ID?('&pursuit_id='+encodeURIComponent(PURSUIT_ID)):'')+'&action=submit'; };

  // ── Boot ──
  S.selected='exec_summary';
  shell();
  loadPursuit();
  loadDrafts();
  loadCompliance();
  loadDocs();
  loadVault();
  // Findings depend on compliance + drafts — kick it after a beat so both are likely in.
  setTimeout(loadFindings, 900);
})();
</script>
${ACCOUNT_MENU_JS}
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
