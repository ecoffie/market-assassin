/**
 * GET /today — TODAY'S INTEL. Tomorrow morning's newspaper for federal procurement.
 *
 * ── WHY THIS IS A ROUTE HANDLER, NOT A REACT PAGE (Eric 2026-08-15) ────────────────────────────
 * *"It looks like today's intel is not part of the map page… I would say build today's intel like
 * the saved page or watchlist or pursuit — it would be INSIDE of the frame. The way it was built
 * looks like you are adding the frame as an afterthought."*
 *
 * Exactly right, and it was structural rather than cosmetic. Every other map surface
 * (saved · favorites · pursuits · reports · vault · market · proposal · forecasts) is a route
 * handler emitting its OWN complete document with the chrome built in. /today was a React page
 * living inside the app's root layout, which hardcodes `bg-slate-950` on <body> — so it had to
 * FIGHT its own shell:
 *
 *     <style>{'body{background:#fff !important}'}</style>
 *     <div aria-hidden className="fixed inset-0 -z-10 bg-white" />
 *
 * Those two lines were the tell. A page that belongs in the frame doesn't need an !important
 * override and a fixed backdrop to undo the frame it's in. Both are GONE here — this document
 * simply IS white, the way saved/route.ts simply is white.
 *
 * The URL is unchanged (/today). Only the construction changed.
 *
 * ── The four sections (unchanged from the newspaper cut, PR #1122) ─────────────────────────────
 *   1. TODAY'S STORY   — one headline, nothing competing.
 *   2. TODAY'S LENS    — the live map (its own ?embed=1 mode); search FLOATS over it.
 *   3. TODAY'S OPPORTUNITIES — the cards.
 *   4. TODAY'S MARKET  — the numbers last, borderless: "now the numbers make sense."
 * Spacing groups 1+2 as ONE chapter; a full rule + real air separates the rest.
 *
 * Every figure is a live query (src/lib/today/intel.ts, KV-cached, refreshed by the 3-hourly
 * precompute cron). A null count is DROPPED, never rendered as 0.
 */
import { NextResponse } from 'next/server';
import { getTodayIntel, buildHeroStory, getFeaturedOpportunities, featuredLens, withLens } from '@/lib/today/intel';
import type { FeaturedOpp, TodayIntel } from '@/lib/today/intel';
import { estMoneyServer } from '@/lib/opportunities/map-data';
import { getMarketTiles } from '@/lib/today/markets';
import type { MarketTile } from '@/lib/today/markets';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '../opportunity-map/account-menu';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** HTML-escape every interpolated value — titles and agency names are raw DB text. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The opportunity IS the visual object: value leads, then agency, title, urgency, DNA chips. */
function card(o: FeaturedOpp): string {
  // The basis line has two shapes ("based on…" vs "309 comparable…"), so the prefix is
  // shape-aware — otherwise it reads "Est. from based on the prior contract".
  // estBasis is nullable: when we have no provenance for the estimate we render NO basis line
  // rather than a bare "Est. from" with nothing after it.
  const basis = o.estBasis
    ? (/^(based|from|per|using)\b/i.test(o.estBasis) ? `Est. ${o.estBasis}` : `Est. from ${o.estBasis}`)
    : '';
  // ⚠️ THESE ARE DOLLARS. They shipped as bare integers — the hero of every featured card read
  // "195479" and "8041670" instead of "$195K" and "$8M" (Eric screenshot 2026-08-15). The type
  // is `number` and the render was `esc(o.estMedian)`, so nothing was WRONG enough to fail a
  // build, a test, or a 200 — it was just unreadable, on the largest text on the page.
  // Formatted with the SHARED estMoneyServer (the same helper the map + forecast hero use), so
  // an M-Estimate reads identically wherever it appears. Never a second local formatter.
  const range = o.estLow && o.estHigh
    ? `<span class="tc-range">${esc(estMoneyServer(o.estLow))}–${esc(estMoneyServer(o.estHigh))}</span>` : '';
  const urgency = o.daysLeft != null
    ? `<span class="tc-days${o.daysLeft <= 7 ? ' soon' : ''}">${esc(o.daysLeft)}d left</span>` : '';
  const place = o.place
    // width/height ATTRIBUTES, not just CSS: an unsized inline SVG expands to fill its parent, and
    // this one rendered at 1032px over the hero. Attributes can't lose a cascade fight.
    ? `<span class="tc-place"><svg viewBox="0 0 24 24" width="13" height="13" style="flex:none"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>${esc(o.place)}</span>` : '';
  const dna = (o.dna || []).slice(0, 2)
    .map((d) => `<span class="tc-dna ${esc(d.tone || 'neutral')}">${esc(d.label)}</span>`).join('');
  return `<a class="tcard" href="${esc(o.href)}">
    <div class="tc-val">${esc(estMoneyServer(o.estMedian))}${range}</div>
    ${basis ? `<div class="tc-basis">${esc(basis)}</div>` : ''}
    <div class="tc-agency">${esc(o.agency)}</div>
    <div class="tc-title">${esc(o.title)}</div>
    <div class="tc-meta">${urgency}${place}</div>
    ${dna ? `<div class="tc-chips">${dna}</div>` : ''}
  </a>`;
}

function render(intel: TodayIntel, featured: FeaturedOpp[], tiles: MarketTile[]): string {
  const stat = (k: string) => intel.stats.find((s) => s.key === k)?.value ?? 0;
  const heroBase = buildHeroStory({
    newToday: stat('new_today'),
    newWeek: stat('new_week'),
    prevWeek: intel.prevWeek ?? 0,
    topAgency: intel.agencies[0],
    topMover: intel.movers[0],
  });
  // TODAY'S LENS — the briefing doesn't just LINK to the map, it CONFIGURES it. Derived from what
  // the featured cards genuinely SHARE (see featuredLens: filterable strands only, 2+ cards, empty
  // when nothing clears the bar), so it costs no API call and works for anonymous visitors — the
  // real /app lens is profile-scoped and unavailable here.
  //
  // It COMPOSES with the branch's own subject: the concentration headline names DoD, so the link
  // becomes DoD AND today's lens. Both are read by independent handlers on the map.
  const lens = featuredLens(featured);
  const hero = { ...heroBase, href: withLens(heroBase.href, lens.strategy) };
  // ── MORNING BRIEF — "if you only have five minutes". DERIVED, never written by an LLM: the
  //    markets named are the real top week-over-week movers that clear both thresholds. If none
  //    clear, the block is DROPPED rather than softened into a guess.
  const MOVER_PCT = 20, MOVER_MIN = 25;
  const brief = (intel.movers || [])
    .filter((m) => m.pctChange >= MOVER_PCT && m.thisWeek >= MOVER_MIN)
    .slice(0, 2);
  // ── TODAY'S OBSERVATION — one sentence, from the data. Restates the SAME concentration figure
  //    the headline uses, so the two can never disagree; dropped when it doesn't clear the bar.
  const topAg = intel.agencies[0];
  const weekTotal = intel.stats.find((x) => x.key === 'new_week')?.value ?? 0;
  const share = topAg && weekTotal > 0 ? Math.round((topAg.newThisWeek / weekTotal) * 100) : 0;
  const observation = share >= 40
    ? `${topAg!.display} generated ${share >= 60 ? 'two-thirds' : 'more than a third'} of all new opportunities this week.`
    : '';
  const dateLine = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Today's Intel — what changed in federal contracting today | Mindy</title>
<meta name="description" content="The daily front page of public procurement: new opportunities posted today, contracts entering recompete, upcoming industry events, and which markets are moving.">
<style>
  /* THREE VOICES, each with a job (the editorial pass, Eric 2026-08-15):
       Libre Baskerville — headlines/decks/titles. A transitional serif reads as a document of
         record; every masthead sets news in a serif against a sans interface, and that contrast is
         what says "publication" rather than "software". The page was ALL Inter before, which is
         why it read as a dashboard no matter how the sections were ordered.
       Inter — chrome and labels ONLY.
       IBM Plex Mono, tabular — every dollar figure. These are LEDGER numbers; Bloomberg sets
         prices fixed-width so columns align. */
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  /* Palette from the SUBJECT's own materials — government bond paper, seal blue (GSA/DoD, not a
     SaaS blue), oxblood for urgency (a date-stamp red). Neutrals biased warm so nothing reads as
     default grey. Kept --jan/--line/--wash etc. as aliases so the shared chrome CSS still resolves. */
  :root{--ink:#12100E;--sub:#7A7266;--faint:#9a9384;--line:#DCD8CF;--hair:#EDEAE3;--wash:#F3F0E9;
        --paper:#FBFAF7;--body:#3A352E;--seal:#1B3A6B;--stamp:#8C2F1E;
        --blue:#1B3A6B;--jan:#1B3A6B;--green:#22a06b;--red:#8C2F1E}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:var(--paper);-webkit-font-smoothing:antialiased}
  /* ── App chrome: top nav + left rail. VERBATIM from opportunity-map ZHEAD/ZRAIL so a visitor
       crossing between /today and the map cannot perceive a boundary. ── */
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
  /* ⚠️ EVERY chrome SVG needs an explicit size. Without it they expand to fill the flex parent —
     measured 445x445 black shapes over the hero. The map's own stylesheet has this rule; /today's
     copy had dropped it. */
  .zhead svg,.zh-left a svg,.zh-right a svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;vertical-align:middle}
  .zrail svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .zrail a span{font:600 10px Inter,system-ui,sans-serif;letter-spacing:.01em;line-height:1}
  .main{margin-left:64px}
  .wrap{max-width:1080px;margin:0 auto;padding:0 24px 72px}
  @media(max-width:760px){.zrail{display:none}.main{margin-left:0}}
  /* ── Dateline ── */
  .tdate{text-align:right;font:500 12px Inter,system-ui,sans-serif;color:var(--faint);padding-top:16px}
  /* ── CHAPTER 1 — the story. One headline, nothing competing. ── */
  .thero{padding-top:48px}
  /* DATELINE — every front page carries one; the cheapest convincing editorial signal there is. */
  .dline{padding-top:38px;font:600 10px Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--sub)}
  .dline b{color:var(--ink);font-weight:700}
  .tkicker{display:none}
  /* Clamp settles sooner than it used to: at ~1990px the old 5.2vw hit near-max and the headline
     overwhelmed the map (Eric: "almost too dominant"). ~18% smaller, capped. */
  .thead{font:700 clamp(2.2rem,3.6vw,3.2rem)/1.16 "Libre Baskerville",Georgia,serif;letter-spacing:-.012em;margin-top:18px;max-width:22ch;text-wrap:balance}
  .tstand{font:400 1.16rem/1.62 "Libre Baskerville",Georgia,serif;color:var(--body);margin-top:24px;max-width:52ch}
  .tstand b{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
  /* MORNING BRIEF — the editor's column. Read SECOND, right after the headline. */
  .tfive{margin-top:26px;padding-top:20px;border-top:2px solid var(--ink);max-width:58ch}
  .tfive-k{font:700 9.5px Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--stamp);display:block;margin-bottom:12px}
  .tfive-t{font:italic 400 1.32rem/1.5 "Libre Baskerville",Georgia,serif;color:var(--ink)}
  .tfive-t b{font-weight:700;font-style:normal}
  .tfive-w{font:400 12px Inter,system-ui,sans-serif;color:var(--sub);margin-top:12px;font-variant-numeric:tabular-nums}
  /* TODAY'S OBSERVATION — one line, from the data, never from a person. */
  .obs{margin-top:46px;padding:30px 0 0;border-top:1px solid var(--line);text-align:center}
  .obs-k{font:700 9.5px Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--sub);display:block;margin-bottom:14px}
  .obs-t{font:italic 400 1.5rem/1.45 "Libre Baskerville",Georgia,serif;color:var(--ink);max-width:34ch;margin:0 auto}
  /* ── CHAPTER 1b — the lens. TIGHT under the story: they are ONE chapter. ── */
  /* FULL BLEED, rail-aware. 50vw measures from the VIEWPORT, but this column starts after the
     64px rail — using it pushed the map 126px past the right edge (body scrollWidth 1638 > 1512).
     The wrap is max-width:1080 + 24px padding inside a flexible column, so bleeding to the column's
     own padding edge is both correct and simpler. */
  .tlens{margin-top:52px;margin-left:calc(-50vw + 50% + 32px);margin-right:calc(-50vw + 50% + 32px);max-width:100vw}
  @media(max-width:760px){.tlens{margin-left:-24px;margin-right:-24px}}
  .tlens-h{display:none}   /* a caption naming the thing directly beneath it — the map is visibly a map */
  .tlabel{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--ink)}
  .tlive{font:500 12px Inter,system-ui,sans-serif;color:var(--faint)}
  /* THE MAP IS THE PHOTOGRAPH, not a widget. A rounded, bordered, shadowed card says "module";
     a photograph BLEEDS. Hairline top+bottom only — the print convention for a full-bleed plate.
     Height raised to co-star scale (Eric: "the map should be co-star, not supporting actor"). */
  .tframe{position:relative;overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--wash)}
  .tframe iframe{display:block;width:100%;height:min(72vh,780px);border:0}
  @media(max-width:760px){.tframe iframe{height:56vh}}
  /* Search lives INSIDE the map, once you've decided to explore — never in the headline block. */
  .tsearch{display:none}
  /* Sits ABOVE the map's zoom controls + attribution strip (see the .mcount note). */
  .tcta{position:absolute;right:28px;bottom:74px;background:var(--seal);color:#fff;text-decoration:none;
    padding:14px 26px;font:600 14px Inter,system-ui,sans-serif;box-shadow:0 8px 26px rgba(18,16,14,.30)}
  .tcta:hover{background:#12294D}
  /* LIVE badge + activity count — the map states what it is showing, so it can't read as empty. */
  .mlive{position:absolute;left:24px;top:20px;display:inline-flex;align-items:center;gap:7px;background:#fff;
    border:1px solid var(--line);padding:7px 13px;font:700 9px Inter,system-ui,sans-serif;letter-spacing:.16em;
    text-transform:uppercase;color:var(--stamp);box-shadow:0 2px 10px rgba(18,16,14,.10)}
  .mlive::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--stamp);animation:pulse 2.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.82)}}
  @media (prefers-reduced-motion:reduce){.mlive::before{animation:none}}
  /* ⚠️ BOTTOM-LEFT AND BOTTOM-RIGHT BELONG TO THE MAP, NOT TO US. The embedded Leaflet map
     puts its legend (Open · Recompete · Forecast) bottom-left and its zoom controls + attribution
     bottom-right. Both of these overlays originally sat at bottom:24-28px and landed directly on
     top of them — the count pill covered the legend text, and the CTA covered the +/- buttons,
     so the map could not be zoomed from the front page. Caught by screenshot; nothing in the
     DOM can detect it, because the collision is with content inside a cross-origin iframe.
     The count moves up beside the LIVE badge; the CTA lifts clear of the controls. */
  .mcount{position:absolute;left:24px;top:20px;transform:translateX(80px);background:#fff;
    border:1px solid var(--line);padding:7px 13px;
    font:400 12px Inter,system-ui,sans-serif;color:var(--body);box-shadow:0 2px 10px rgba(18,16,14,.10)}
  .mcount b{font:600 12px "IBM Plex Mono",monospace;color:var(--ink);font-variant-numeric:tabular-nums}
  /* ── CHAPTER BREAK — a full rule + real air. This is what tells the eye "new chapter";
       the old uniform 60px gaps never did. ── */
  .tbreak{border:0;border-top:1px solid var(--line);margin-top:72px}
  .tsection{padding-top:60px}
  .tsec-h{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:20px}
  .tsec-h a{font:600 12px Inter,system-ui,sans-serif;color:var(--jan);text-decoration:none}
  .tsec-h a:hover{text-decoration:underline}
  /* ── CHAPTER 2 — the cards. ── */
  .tcards{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line)}
  @media(max-width:900px){.tcards{grid-template-columns:1fr}}
  .tcard{display:block;border:0;padding:30px 28px 26px;text-decoration:none;color:inherit;background:#fff;transition:background .15s}
  .tcard:hover{background:var(--wash)}
  .tc-val{font:600 3.1rem/.95 "IBM Plex Mono",monospace;letter-spacing:-.045em;font-variant-numeric:tabular-nums}
  .tc-range{font:500 .82rem/1 Inter,system-ui,sans-serif;color:var(--faint);margin-left:9px;letter-spacing:0}
  .tc-basis{font:400 12px Inter,system-ui,sans-serif;color:var(--faint);margin-top:9px}
  .tc-agency{font:700 10px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--seal);margin-top:18px}
  .tc-title{font:700 1.08rem/1.36 "Libre Baskerville",Georgia,serif;margin-top:8px;color:var(--ink)}
  .tc-meta{display:flex;align-items:center;gap:14px;margin-top:14px;flex-wrap:wrap}
  .tc-days{font:600 12px Inter,system-ui,sans-serif;color:var(--sub);background:var(--wash);border:1px solid var(--line);border-radius:6px;padding:3px 8px}
  .tc-days.soon{color:#b54708;background:#fffaeb;border-color:#fedf89}
  .tc-place{display:inline-flex;align-items:center;gap:5px;font:400 12px Inter,system-ui,sans-serif;color:var(--sub)}
  .tc-place svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2}
  .tc-chips{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
  .tc-dna{font:600 11px Inter,system-ui,sans-serif;padding:4px 9px;border-radius:6px;background:var(--wash);color:var(--sub);border:1px solid var(--line)}
  .tc-dna.good{background:#ecfdf3;color:#027a48;border-color:#abefc6}
  .tc-dna.warn{background:#fffaeb;color:#b54708;border-color:#fedf89}
  /* ── CHAPTER 3 — the market. BORDERLESS: outlined KPI boxes are dashboard UI, not editorial. ── */
  .tlenshint{display:block;margin-top:10px;font:500 13px/1.4 var(--sans);color:var(--muted)}
  .tstats{display:grid;grid-template-columns:repeat(4,1fr)}
  @media(max-width:900px){.tstats{grid-template-columns:repeat(2,1fr);row-gap:40px}}
  .tstat{display:block;text-decoration:none;color:inherit;padding:0 24px}
  .tstat:first-child{padding-left:0}
  @media(min-width:901px){.tstat+.tstat{border-left:1px solid var(--line)}}
  .tstat-v{font:600 2.7rem/1 "IBM Plex Mono",monospace;letter-spacing:-.035em;font-variant-numeric:tabular-nums;transition:color .15s}
  .tstat:hover .tstat-v{color:var(--seal)}
  .tstat-l{font:400 13px/1.4 Inter,system-ui,sans-serif;color:var(--sub);margin-top:9px}
  .tfoot{border-top:1px solid var(--line);margin-top:72px;padding:26px 0;text-align:center;font:400 12px Inter,system-ui,sans-serif;color:var(--faint)}
  .tfoot .warn{display:block;margin-top:5px;color:#b54708}

  /* ── THE STATEFUL BOTTOM HALF (docs/today-page-states.md) ────────────────────────────────
     Discovery (anonymous) · Momentum (authenticated) · Recovery (expired). Server-renders
     the discovery tiles so the page is NEVER empty before hydration; JS swaps in the
     personalized half only once a valid token proves there is one. */
  .mkts{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line)}
  @media(max-width:900px){.mkts{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:560px){.mkts{grid-template-columns:1fr}}
  .mkt{display:flex;flex-direction:column;justify-content:space-between;gap:16px;background:#fff;padding:26px 24px;
    text-decoration:none;color:inherit;transition:background .15s}
  .mkt:hover{background:var(--wash)}
  .mkt-n{font:700 1.05rem/1.3 "Libre Baskerville",Georgia,serif;color:var(--ink)}
  /* Plex Mono renders the comma as a full-width glyph, so "7,819" read as "7 , 819".
     Inter's tabular figures keep the columns aligned without the gap. */
  .mkt-c{font:600 1.9rem/1 Inter,system-ui,sans-serif;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:var(--seal)}
  .mkt-l{font:400 12px Inter,system-ui,sans-serif;color:var(--faint);margin-top:5px}
  .mkt-go{font:600 12px Inter,system-ui,sans-serif;color:var(--jan)}

  /* Momentum rows — work, not cards. The next action dominates; the title is context. */
  .ymrow{display:flex;align-items:baseline;gap:16px;padding:15px 0;border-bottom:1px solid var(--hair,#eceff3);
    text-decoration:none;color:inherit}
  .ymrow:last-child{border-bottom:0}
  .ymrow:hover .ymt{color:var(--seal)}
  /* Both are BLOCKS. As inline spans the agency ran straight on from the title
     ("…Fort Macon Fence ExtensionHOMELAND SECURITY, DEPARTMENT OF") — caught in a screenshot,
     not by any assertion, because the text was all present and correct. */
  .ymt{display:block;font:600 .97rem/1.4 Inter,system-ui,sans-serif;color:var(--ink)}
  .ymsub{display:block;font:400 12px Inter,system-ui,sans-serif;color:var(--faint);margin-top:3px}
  .ymwhen{font:500 12px Inter,system-ui,sans-serif;color:var(--faint);white-space:nowrap;font-variant-numeric:tabular-nums}
  .ymdue{font:600 12px Inter,system-ui,sans-serif;white-space:nowrap;border-radius:6px;padding:3px 8px;
    background:var(--wash);border:1px solid var(--line);color:var(--sub)}
  .ymdue.soon{color:#b54708;background:#fffaeb;border-color:#fedf89}
  .ymdue.past{color:var(--faint);background:transparent;border-color:transparent}
  .ymcols{display:grid;grid-template-columns:1fr 1fr;gap:0 48px}
  @media(max-width:860px){.ymcols{grid-template-columns:1fr;gap:0}}
  .ymblock{padding-top:8px}
  .ymblock h3{font:700 10px Inter,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;
    color:var(--seal);margin-bottom:4px}
  .ymsince{font:400 .95rem/1.5 Inter,system-ui,sans-serif;color:var(--sub);margin-bottom:26px}
  .ymsince b{font:600 .95rem "IBM Plex Mono",monospace;color:var(--ink);font-variant-numeric:tabular-nums}
  /* Recovery — acknowledges history rather than pretending the visitor is new. */
  .rec{border:1px solid var(--line);background:var(--paper);padding:28px 30px;display:flex;
    align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
  .rec-t{font:700 1.15rem/1.4 "Libre Baskerville",Georgia,serif;color:var(--ink)}
  .rec-s{font:400 .92rem/1.5 Inter,system-ui,sans-serif;color:var(--sub);margin-top:6px;max-width:52ch}
  .rec-b{background:var(--seal);color:#fff;text-decoration:none;padding:12px 22px;
    font:600 13px Inter,system-ui,sans-serif;white-space:nowrap}
  .rec-b:hover{background:#12294D}
  ${ACCOUNT_MENU_CSS}
</style></head><body>
<header class="zhead">
  <nav class="zh-left">
    <a href="/opportunity-map">Opportunities</a>
    <a href="/opportunity-map?mode=buyers">Players</a>
    <a href="/opportunity-map/pursuits">Pursuits</a>
    <a href="/opportunity-map/reports">Markets</a>
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
  <a href="/opportunity-map/saved" title="Watchlist — saved searches &amp; new matches"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Watchlist</span></a>
  <a href="/opportunity-map/favorites" title="Saved — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Saved</span></a>
  <a href="/opportunity-map/pursuits" title="Pursuits — opportunities you are actively working"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Pursuits</span></a>
</nav>
<div class="main"><div class="wrap">
  <div class="dline"><b>Federal Procurement Desk</b> · ${esc(dateLine)}</div>

  <section class="thero">
    <h1 class="thead">${esc(hero.headline)}</h1>
    <p class="tstand">${esc(hero.standfirst)}</p>
    ${brief.length ? `<div class="tfive">
      <span class="tfive-k">Morning brief</span>
      <p class="tfive-t">Start with <b>${esc(brief[0].name)}</b>${brief[1] ? ` and <b>${esc(brief[1].name)}</b>` : ''} — ${brief.length > 1 ? 'both' : 'it'} jumped ${brief.length > 1 ? `more than ${Math.min(...brief.map((b) => b.pctChange))}%` : `${brief[0].pctChange}%`} this week.</p>
      <p class="tfive-w">${brief.map((b) => `${esc(b.name.toLowerCase())} ${b.lastWeek} → ${b.thisWeek} postings`).join(' · ')}</p>
    </div>` : ''}
  </section>

  <section class="tlens">
    <div class="tframe">
      <span class="mlive">Live</span>
      ${/* ⚠️ The map route reads ONLY `embed` server-side (route.ts:8139) — every other filter
           is applied client-side after boot. So a `?posted=7` here would be DEAD WEIGHT: a URL
           that reads like it filters while changing nothing. Removed rather than shipped, and
           the pill below is labelled to match what the map GENUINELY shows (all open pins in
           view), not what I wish it showed. Narrowing the embed to a date window needs the map
           to accept the param first; that is a map change, not a caption change. */''}
      <iframe src="/opportunity-map?embed=1" title="Live opportunity map" loading="lazy"></iframe>
      ${/* This pill labels THE MAP BENEATH IT, so it cites what the map actually shows — every
           open opportunity — not a date window the embed does not apply. It previously read
           "16 posted today" beside an unfiltered map: two different windows under one caption,
           and the smaller number made a live market look dead. */''}
      <span class="mcount"><b>${esc(stat('active').toLocaleString())}</b> open opportunities</span>
      <a class="tcta" href="${esc(hero.href)}">${esc(hero.cta)} →</a>
      ${/* Name the lens the button is about to apply. A configured link the user cannot SEE is
           the same opacity problem as a filter with a blank control — they should know what
           the map will show before they click, and recognise it when they get there (the map
           renders the same strands as its own "Today's Lens" pill). Omitted entirely when no
           strand clears the 2-card bar, rather than announcing a pattern that is not there. */''}
      ${lens.labels.length ? `<span class="tlenshint">Opens filtered to ${esc(lens.labels.join(' · '))}</span>` : ''}
    </div>
  </section>

  ${observation ? `<div class="obs">
    <span class="obs-k">Today's observation</span>
    <p class="obs-t">${esc(observation)}</p>
  </div>` : ''}

  <hr class="tbreak">

  ${featured.length ? `<section class="tsection">
    <div class="tsec-h"><h2 class="tlabel">Today's opportunities</h2><a href="/opportunity-map">See all on the map →</a></div>
    <div class="tcards">${featured.map(card).join('')}</div>
  </section>
  <hr class="tbreak">` : ''}

  ${intel.stats.length ? `<section class="tsection">
    <h2 class="tlabel" style="margin-bottom:24px">Today's market</h2>
    ${/* A stat with no href renders as a <div>, not an <a>: the Events tile counts something the
         map cannot show (events live inside an opportunity's drawer; there is no events page),
         and a link to a map that can't express it is exactly the dead end this page is removing.
         Every OTHER tile lands on an already-configured map. */''}
    <div class="tstats">${intel.stats.slice(0, 4).map((s) => s.href
      ? `<a class="tstat" href="${esc(s.href)}">
      <div class="tstat-v">${esc(s.value.toLocaleString())}</div>
      <div class="tstat-l">${esc(s.label)}</div>
    </a>`
      : `<div class="tstat tstat-static">
      <div class="tstat-v">${esc(s.value.toLocaleString())}</div>
      <div class="tstat-l">${esc(s.label)}</div>
    </div>`).join('')}</div>
  </section>` : ''}

  ${/* THE STATEFUL BOTTOM HALF. The discovery tiles are SERVER-RENDERED, so the page is
       complete and useful before any JS runs and for every visitor who never authenticates.
       Hydration only ever REPLACES this with something better (momentum) or acknowledges a
       lapsed session (recovery) — it can never leave the region empty, which is the whole
       point of the fallback hierarchy in docs/today-page-states.md. */''}
  ${tiles.length ? `<hr class="tbreak">
  <section class="tsection" id="ymSection">
    <div class="tsec-h">
      <h2 class="tlabel" id="ymHead">Start exploring</h2>
      <a href="/opportunity-map" id="ymMore">Open the full map →</a>
    </div>
    <p class="ymsince" id="ymLede">Most contractors begin with one of these markets.</p>
    <div id="ymBody">
      <div class="mkts">${tiles.map((t) => `<a class="mkt" href="${esc(t.href)}">
        <div>
          <div class="mkt-n">${esc(t.name)}</div>
          <div class="mkt-c" style="margin-top:14px">${esc(t.active.toLocaleString())}</div>
          <div class="mkt-l">active opportunities</div>
        </div>
        <div class="mkt-go">Explore →</div>
      </a>`).join('')}</div>
    </div>
  </section>` : ''}

  <div class="tfoot">
    Every number on this page is a live query against SAM.gov, USASpending and agency forecast data — nothing is estimated.
    ${intel.degraded ? '<span class="warn">Some sections are unavailable right now and have been omitted rather than shown as zero.</span>' : ''}
  </div>
</div></div>
${/* ACCOUNT_MENU_JS ships its OWN <script> tags (see account-menu.ts) — wrapping it again
     produced <script><script>, which parses as a stray `<` and threw
     "SyntaxError: Unexpected token '<'" in the console. Interpolate it BARE, exactly as
     saved/route.ts does. Caught by a pageerror listener, not by eyeballing the render: the
     page LOOKED perfect because the account menu is the only thing that script powers. */''}
${ACCOUNT_MENU_JS}
${YOUR_MARKET_JS}
</body></html>`;
}

/**
 * Client hydration for the stateful bottom half.
 *
 * WHY CLIENT-SIDE: the MI session token lives in localStorage (not a cookie), so the server
 * genuinely cannot know who the visitor is at render time. The server therefore renders the
 * always-valid DISCOVERY half, and this script upgrades it in place.
 *
 * ⚠️ NO BACKTICKS ANYWHERE BELOW — not in code, not in comments. This file builds HTML by
 * concatenating template literals, and a stray backtick TERMINATES the literal and breaks the
 * build. That has happened four separate times in this file; string concatenation only.
 *
 * ⚠️ The STATE comes from the server's verdict on the token, not from anything decoded here.
 * The client sends whatever token it has and does as it is told.
 */
const YOUR_MARKET_JS = '<script>(function(){' +
  'var sec=document.getElementById("ymSection"); if(!sec) return;' +
  'var tk=""; try{ tk=localStorage.getItem("mi_beta_auth_token")||""; }catch(e){}' +
  // No token at all: the server-rendered discovery half is already the right answer. Do
  // nothing rather than fetch — an anonymous visitor should cost zero round trips.
  'if(!tk) return;' +
  'var head=document.getElementById("ymHead"), lede=document.getElementById("ymLede"),' +
  '    body=document.getElementById("ymBody"), more=document.getElementById("ymMore");' +
  'function esc(s){ var d=document.createElement("div"); d.textContent=(s==null?"":String(s)); return d.innerHTML; }' +
  'function when(iso){ var t=Date.parse(iso); if(isNaN(t)) return "";' +
  '  var m=Math.max(0,Math.round((Date.now()-t)/60000));' +
  '  if(m<60) return m<=1?"just now":m+"m ago";' +
  '  var h=Math.round(m/60); if(h<24) return h+"h ago";' +
  '  var d=Math.round(h/24); return d===1?"yesterday":d+"d ago"; }' +
  'function due(d){ if(d===null||d===undefined) return "";' +
  '  if(d<0) return "<span class=\\"ymdue past\\">closed "+Math.abs(d)+"d ago</span>";' +
  '  if(d<=7) return "<span class=\\"ymdue soon\\">"+(d===0?"due today":"due in "+d+"d")+"</span>";' +
  '  return "<span class=\\"ymdue\\">due in "+d+"d</span>"; }' +
  'function rows(list,kind){ return list.map(function(o){' +
  '  var right = kind==="viewed" ? "<span class=\\"ymwhen\\">"+esc(when(o.viewedAt))+"</span>" : due(o.daysLeft);' +
  '  var sub = kind==="pursuit" && o.nextAction ? o.nextAction : o.agency;' +
  '  return "<a class=\\"ymrow\\" href=\\""+esc(o.href)+"\\"><span style=\\"flex:1\\">" +' +
  '    "<span class=\\"ymt\\">"+esc(o.title)+"</span>" +' +
  '    (sub?"<span class=\\"ymsub\\">"+esc(sub)+"</span>":"") + "</span>" + right + "</a>";' +
  '}).join(""); }' +
  'fetch("/api/today/your-market",{headers:{"x-mi-auth-token":tk}}).then(function(r){return r.json();}).then(function(d){' +
  '  if(!d) return;' +
  // STATE 3 — RECOVERY. A lapsed session is NOT a first visit: this visitor has history, it
  // just is not readable until they authenticate. Say so, and keep today's page working.
  '  if(d.state==="expired"){' +
  '    head.textContent="Welcome back";' +
  '    lede.textContent="Sign in to resume your saved markets, pursuits and recommendations. Meanwhile, here is what is happening today.";' +
  '    more.textContent="Sign in \\u2192"; more.setAttribute("href","/app");' +
  '    return;' +   // discovery tiles stay put underneath — never an empty region
  '  }' +
  '  if(d.state!=="authenticated") return;' +
  // STATE 2 — MOMENTUM, but only if there is genuinely something to show. A signed-in user
  // with no history FALLS THROUGH to the discovery tiles (hierarchy: Your Market -> Explore
  // by Market -> Featured). We never print a heading over an empty list.
  '  var v=(d.recentlyViewed||[]), p=(d.pursuits||[]), rc=(d.recommended||[]);' +
  '  if(!v.length && !p.length && !rc.length) return;' +
  '  head.textContent="Your market";' +
  '  more.textContent="Open your pursuits \\u2192"; more.setAttribute("href","/opportunity-map/pursuits");' +
  '  if(typeof d.sinceLastVisit==="number" && d.lastVisitAt){' +
  '    lede.innerHTML="<b>"+esc(d.sinceLastVisit.toLocaleString())+"</b> new opportunities posted since your last visit "+esc(when(d.lastVisitAt))+".";' +
  '  } else { lede.textContent="Where you left off."; }' +
  '  var html="<div class=\\"ymcols\\">";' +
  '  if(v.length) html+="<div class=\\"ymblock\\"><h3>Pick up where you left off</h3>"+rows(v,"viewed")+"</div>";' +
  '  if(p.length) html+="<div class=\\"ymblock\\"><h3>Your work</h3>"+rows(p,"pursuit")+"</div>";' +
  '  html+="</div>";' +
  '  if(rc.length) html+="<div class=\\"ymblock\\" style=\\"margin-top:34px\\"><h3>Recommended for you</h3>"+rows(rc,"rec")+"</div>";' +
  '  body.innerHTML=html;' +
  // A failed fetch leaves the discovery tiles exactly as rendered. Degrading to a genuinely
  // useful section beats degrading to an apology.
  '}).catch(function(){});' +
  '})();</script>';

export async function GET() {
  const [intel, featured, tiles] = await Promise.all([
    getTodayIntel(),
    getFeaturedOpportunities(3),
    // Never let the discovery half take the page down with it — a tile failure degrades to
    // "no tiles" (and the page still ends on Featured), not a 500.
    getMarketTiles().catch((err) => { console.error('[today] market tiles failed:', err); return [] as MarketTile[]; }),
  ]);
  return new NextResponse(render(intel, featured, tiles), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
