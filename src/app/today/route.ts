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
import { getTodayIntel, buildHeroStory, getFeaturedOpportunities } from '@/lib/today/intel';
import type { FeaturedOpp, TodayIntel } from '@/lib/today/intel';
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
  const range = o.estLow && o.estHigh
    ? `<span class="tc-range">${esc(o.estLow)}–${esc(o.estHigh)}</span>` : '';
  const urgency = o.daysLeft != null
    ? `<span class="tc-days${o.daysLeft <= 7 ? ' soon' : ''}">${esc(o.daysLeft)}d left</span>` : '';
  const place = o.place
    ? `<span class="tc-place"><svg viewBox="0 0 24 24"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>${esc(o.place)}</span>` : '';
  const dna = (o.dna || []).slice(0, 2)
    .map((d) => `<span class="tc-dna ${esc(d.tone || 'neutral')}">${esc(d.label)}</span>`).join('');
  return `<a class="tcard" href="${esc(o.href)}">
    <div class="tc-val">${esc(o.estMedian)}${range}</div>
    ${basis ? `<div class="tc-basis">${esc(basis)}</div>` : ''}
    <div class="tc-agency">${esc(o.agency)}</div>
    <div class="tc-title">${esc(o.title)}</div>
    <div class="tc-meta">${urgency}${place}</div>
    ${dna ? `<div class="tc-chips">${dna}</div>` : ''}
  </a>`;
}

function render(intel: TodayIntel, featured: FeaturedOpp[]): string {
  const stat = (k: string) => intel.stats.find((s) => s.key === k)?.value ?? 0;
  const hero = buildHeroStory({
    newToday: stat('new_today'),
    newWeek: stat('new_week'),
    prevWeek: intel.prevWeek ?? 0,
    topAgency: intel.agencies[0],
    topMover: intel.movers[0],
  });
  const dateLine = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Today's Intel — what changed in federal contracting today | Mindy</title>
<meta name="description" content="The daily front page of public procurement: new opportunities posted today, contracts entering recompete, upcoming industry events, and which markets are moving.">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--ink:#111c26;--sub:#6b7787;--faint:#9aa5b3;--line:#e6eaef;--hair:#f0f3f7;--wash:#f7f9fb;--blue:#006aff;--jan:#006aff;--green:#22a06b;--red:#e5484d}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased}
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
  .zrail svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .zrail a span{font:600 10px Inter,system-ui,sans-serif;letter-spacing:.01em;line-height:1}
  .main{margin-left:64px}
  .wrap{max-width:1080px;margin:0 auto;padding:0 24px 72px}
  @media(max-width:760px){.zrail{display:none}.main{margin-left:0}}
  /* ── Dateline ── */
  .tdate{text-align:right;font:500 12px Inter,system-ui,sans-serif;color:var(--faint);padding-top:16px}
  /* ── CHAPTER 1 — the story. One headline, nothing competing. ── */
  .thero{padding-top:48px}
  .tkicker{font:800 11px Inter,system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#1668c4}
  .thead{font:700 clamp(2.3rem,5.2vw,4rem)/1.05 Inter,system-ui,sans-serif;letter-spacing:-.025em;margin-top:16px;max-width:20ch}
  .tstand{font:400 clamp(1.05rem,1.6vw,1.25rem)/1.6 Inter,system-ui,sans-serif;color:var(--sub);margin-top:20px;max-width:60ch}
  /* ── CHAPTER 1b — the lens. TIGHT under the story: they are ONE chapter. ── */
  .tlens{margin-top:32px}
  .tlens-h{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px}
  .tlabel{font:800 11px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--sub)}
  .tlive{font:500 12px Inter,system-ui,sans-serif;color:var(--faint)}
  .tframe{position:relative;border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(17,28,38,.06)}
  .tframe iframe{display:block;width:100%;height:520px;border:0}
  @media(max-width:760px){.tframe iframe{height:400px}}
  /* Search FLOATS over the map — never inside the headline block. */
  .tsearch{position:absolute;left:16px;top:16px;width:min(26rem,calc(100% - 2rem))}
  .tsearch input{width:100%;border:1px solid #d4dae2;border-radius:10px;background:rgba(255,255,255,.96);
    backdrop-filter:blur(6px);padding:11px 15px;font:400 15px Inter,system-ui,sans-serif;color:var(--ink);
    box-shadow:0 4px 14px rgba(17,28,38,.10);outline:none}
  .tsearch input::placeholder{color:var(--faint)}
  .tsearch input:focus{border-color:var(--jan);box-shadow:0 0 0 3px rgba(0,106,255,.15)}
  .tcta{position:absolute;right:16px;bottom:16px;background:rgba(17,28,38,.92);color:#fff;text-decoration:none;
    padding:11px 20px;border-radius:10px;font:600 14px Inter,system-ui,sans-serif;backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(17,28,38,.24)}
  .tcta:hover{background:#111c26}
  /* ── CHAPTER BREAK — a full rule + real air. This is what tells the eye "new chapter";
       the old uniform 60px gaps never did. ── */
  .tbreak{border:0;border-top:1px solid var(--line);margin-top:72px}
  .tsection{padding-top:60px}
  .tsec-h{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:20px}
  .tsec-h a{font:600 12px Inter,system-ui,sans-serif;color:var(--jan);text-decoration:none}
  .tsec-h a:hover{text-decoration:underline}
  /* ── CHAPTER 2 — the cards. ── */
  .tcards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
  @media(max-width:900px){.tcards{grid-template-columns:1fr}}
  .tcard{display:block;border:1px solid var(--line);border-radius:14px;padding:22px;text-decoration:none;color:inherit;background:#fff;transition:border-color .15s,box-shadow .15s}
  .tcard:hover{border-color:#c3cbd6;box-shadow:0 4px 16px rgba(17,28,38,.08)}
  .tc-val{font:700 2.6rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-.02em}
  .tc-range{font:500 .82rem/1 Inter,system-ui,sans-serif;color:var(--faint);margin-left:9px;letter-spacing:0}
  .tc-basis{font:400 12px Inter,system-ui,sans-serif;color:var(--faint);margin-top:9px}
  .tc-agency{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#1668c4;margin-top:16px}
  .tc-title{font:600 16px/1.35 Inter,system-ui,sans-serif;margin-top:7px}
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
  .tstats{display:grid;grid-template-columns:repeat(4,1fr)}
  @media(max-width:900px){.tstats{grid-template-columns:repeat(2,1fr);row-gap:40px}}
  .tstat{display:block;text-decoration:none;color:inherit;padding:0 24px}
  .tstat:first-child{padding-left:0}
  @media(min-width:901px){.tstat+.tstat{border-left:1px solid var(--line)}}
  .tstat-v{font:700 3rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-.025em;transition:color .15s}
  .tstat:hover .tstat-v{color:var(--jan)}
  .tstat-l{font:400 13px/1.4 Inter,system-ui,sans-serif;color:var(--sub);margin-top:9px}
  .tfoot{border-top:1px solid var(--line);margin-top:72px;padding:26px 0;text-align:center;font:400 12px Inter,system-ui,sans-serif;color:var(--faint)}
  .tfoot .warn{display:block;margin-top:5px;color:#b54708}
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
  <div class="tdate">${esc(dateLine)}</div>

  <section class="thero">
    <div class="tkicker">${esc(hero.kicker)}</div>
    <h1 class="thead">${esc(hero.headline)}</h1>
    <p class="tstand">${esc(hero.standfirst)}</p>
  </section>

  <section class="tlens">
    <div class="tlens-h"><h2 class="tlabel">Today's lens</h2><span class="tlive">live</span></div>
    <div class="tframe">
      <iframe src="/opportunity-map?embed=1" title="Today's Lens — live opportunity map" loading="lazy"></iframe>
      <form class="tsearch" action="/opportunity-map" method="get">
        <input type="search" name="q" placeholder="Search agencies, markets, NAICS…" aria-label="Search agencies, markets, NAICS">
      </form>
      <a class="tcta" href="${esc(hero.href)}">${esc(hero.cta)} →</a>
    </div>
  </section>

  <hr class="tbreak">

  ${featured.length ? `<section class="tsection">
    <div class="tsec-h"><h2 class="tlabel">Today's opportunities</h2><a href="/opportunity-map">See all on the map →</a></div>
    <div class="tcards">${featured.map(card).join('')}</div>
  </section>
  <hr class="tbreak">` : ''}

  ${intel.stats.length ? `<section class="tsection">
    <h2 class="tlabel" style="margin-bottom:24px">Today's market</h2>
    <div class="tstats">${intel.stats.slice(0, 4).map((s) => `<a class="tstat" href="${esc(s.href)}">
      <div class="tstat-v">${esc(s.value.toLocaleString())}</div>
      <div class="tstat-l">${esc(s.label)}</div>
    </a>`).join('')}</div>
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
</body></html>`;
}

export async function GET() {
  const [intel, featured] = await Promise.all([getTodayIntel(), getFeaturedOpportunities(3)]);
  return new NextResponse(render(intel, featured), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
