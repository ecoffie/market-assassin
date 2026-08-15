/**
 * /today — TODAY'S INTEL. Tomorrow morning's newspaper for federal procurement.
 *
 * v3 (Eric 2026-08-15). The v2 page shipped nine sections of near-equal weight and read as
 * THREE PAGE TYPES FIGHTING: *"A newspaper (Today's Headline), a dashboard (Today's Market), a
 * search page (Search + Map). They all fight each other… Nothing visually tells me where to look
 * next."* The reframe that drove this rewrite:
 *
 *   *"You're still trying to answer 'How do I build a homepage?' I think the question is
 *   'How do I build tomorrow morning's newspaper?' … It should feel like: this is what happened
 *   while you were asleep."*
 *
 * FOUR SECTIONS, not nine (Eric's explicit call — the other five were cut from this page, not
 * merely demoted). Every one is "Today's ___", so the page has a single grammar:
 *
 *   1. TODAY'S STORY   — one headline. No search, no KPIs, no map. Nothing competing.
 *   2. TODAY'S LENS    — the live map. The hero IMAGE, and search FLOATS over it rather than
 *                        sitting in the headline block ("Search shouldn't be inside the hero").
 *   3. TODAY'S OPPORTUNITIES — the cards. Moved far UP (they were 8th) because they're the
 *                        strongest visual element on the page and they look like Zillow.
 *   4. TODAY'S MARKET  — the numbers, LAST, because *"now the numbers make sense — I just saw
 *                        the market."* Borderless editorial figures, not outlined KPI boxes
 *                        ("They're dashboard UI. Not editorial UI").
 *
 * SPACING IS THE OTHER HALF OF THE FIX. v2 put a uniform ~60px between every section, so *"the
 * eye never knows what belongs together."* Here, Story + Lens are ONE chapter (tight, no rule
 * between them); a chapter BREAK is a full rule + generous air. Grouping does the work that nine
 * dividers could not.
 *
 * CUT FROM THIS PAGE (still live elsewhere, and each is genuinely useful — just not a headline):
 * Top Buyers, Trending Markets, Why Today Matters, Continue Where You Left Off, and the closing
 * map CTA. `WhyTodayMatters.tsx` and `ContinueExploring.tsx` are intentionally left in the repo
 * for the next surface that wants them.
 *
 * Still true: this is a DESTINATION, not a landing page. Every figure is a live query; a null
 * count is dropped rather than rendered as 0.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTodayIntel, buildHeroStory, getFeaturedOpportunities } from '@/lib/today/intel';
import OpportunityCard from '@/components/today/OpportunityCard';
import { MindyTopNav, MindyRail } from '@/components/today/MindyChrome';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Today's Intel — what changed in federal contracting today | Mindy",
  description:
    'The daily front page of public procurement: new opportunities posted today, contracts entering recompete, upcoming industry events, and which markets are moving.',
};

export default async function TodayPage() {
  const [intel, featured] = await Promise.all([getTodayIntel(), getFeaturedOpportunities(3)]);

  const stat = (k: string) => intel.stats.find((s) => s.key === k)?.value ?? 0;
  const hero = buildHeroStory({
    newToday: stat('new_today'),
    newWeek: stat('new_week'),
    prevWeek: intel.prevWeek ?? 0,
    topAgency: intel.agencies[0],
    topMover: intel.movers[0],
  });

  return (
    // The root layout hardcodes `bg-slate-950 text-slate-100` on <body> (every other surface
    // depends on it), so a page-level bg-white alone renders INSIDE a dark shell — measured:
    // body stayed rgb(15,23,42). This fixed backdrop paints the whole viewport white for THIS
    // route only, without touching the global class every other page relies on.
    <>
    {/* The root layout hardcodes bg-slate-950 on <body> and every other surface depends on it,
        so this route repaints only itself. The fixed backdrop covers the viewport; the <style>
        also recolors <body> so the OVERSCROLL BOUNCE (Mac trackpad) and the area behind browser
        chrome don't flash slate-950 — a fixed div alone leaves that gap. Scoped to /today. */}
    <style>{'body{background:#fff !important;color:#0f172a !important}'}</style>
    <div aria-hidden className="fixed inset-0 -z-10 bg-white" />
    <main className="relative min-h-dvh bg-white text-slate-900">
      {/* ── APP CHROME. Eric 2026-08-15: "the top and side bars look the same not like a whole new
           page." /today used to carry only its own masthead, so it read as a different application
           from the map — the same complaint that killed the dark theme. Same nav, same rail, same
           routes; a visitor moving between /today and the map shouldn't notice a boundary.
           (Two implementations for now — guarded by mindy-chrome-parity.unit.test.ts. See the
           component header for why the shared-source extraction is deferred to the map phase.) */}
      <MindyTopNav />

      <div className="flex">
        <MindyRail />

        <div className="min-w-0 flex-1">
          {/* The date line survives from the old masthead — it's the newspaper signal, and it now
              sits INSIDE the shell rather than replacing it. */}
          <div className="mx-auto max-w-6xl px-5 pt-4 text-right text-xs text-slate-500">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>

      <div className="mx-auto max-w-6xl px-5">
        {/* ══ CHAPTER 1 — TODAY'S STORY + TODAY'S LENS ═══════════════════════════════════
             These two are ONE unit and are spaced as one: the headline states the story, the map
             is the evidence directly beneath it. No rule between them, and deliberately nothing
             else — no search box, no KPI row, no buttons competing for the first screen.
             (Eric: "Nothing else. No search. No map. No KPIs. One story.") */}
        <section className="pt-12 md:pt-20">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">{hero.kicker}</div>
          <h1 className="mt-4 max-w-4xl text-[2.4rem] font-bold leading-[1.05] tracking-tight text-slate-900 md:text-[4rem]">
            {hero.headline}
          </h1>
          {/* The standfirst is the ONLY body copy above the fold — the two counts that prove the
              headline, in newspaper voice rather than as labelled metrics. */}
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600 md:text-xl">{hero.standfirst}</p>
        </section>

        {/* TODAY'S LENS — the live map, tight under the story (mt-8, not a full chapter gap).
             Uses the map's OWN `?embed=1` mode: one map, one codebase, so the hero can never
             drift from the real product. `loading="lazy"` keeps it off the critical path. */}
        <section className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Today&apos;s lens</h2>
            <span className="text-xs text-slate-400">live</span>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
            <iframe
              src="/opportunity-map?embed=1"
              title="Today's Lens — live opportunity map"
              loading="lazy"
              className="h-[420px] w-full md:h-[520px]"
            />
            {/* Search FLOATS over the map rather than living in the headline block (Eric: "Search
                shouldn't be inside the hero. It should float. Exactly like the map."). A plain GET
                form — no JS, no client component — handing the query to the map, which owns search. */}
            <form
              action="/opportunity-map"
              method="get"
              className="absolute left-4 top-4 flex w-[min(26rem,calc(100%-2rem))] gap-2"
            >
              <input
                type="search"
                name="q"
                placeholder="Search agencies, markets, NAICS…"
                aria-label="Search agencies, markets, NAICS"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white/95 px-4 py-2.5 text-[15px] text-slate-900 shadow-lg outline-none backdrop-blur placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              />
            </form>
            {/* The whole map is a door. An overlay link beats making the iframe clickable, which
                would swallow the map's own pan/zoom. */}
            <Link
              href={hero.href}
              className="absolute bottom-4 right-4 rounded-lg bg-slate-900/90 px-5 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur transition hover:bg-slate-900"
            >
              {hero.cta} →
            </Link>
          </div>
        </section>

        {/* ══ CHAPTER BREAK ══ A full rule + generous air. This is the spacing that tells the eye
             "new chapter" — v2's uniform 60px gaps never did. ═══════════════════════════════ */}
        <hr className="mt-16 border-slate-200 md:mt-20" />

        {/* ══ CHAPTER 2 — TODAY'S OPPORTUNITIES ══════════════════════════════════════════════
             Moved up from 8th place: these cards are the strongest visual element on the page and
             the closest thing we have to Zillow's listing grid. Proof that the story above is made
             of real things you can bid on. */}
        {featured.length > 0 && (
          <section className="pt-14 md:pt-16">
            <div className="mb-5 flex items-baseline justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Today&apos;s opportunities
              </h2>
              <Link href="/opportunity-map" className="text-xs font-medium text-sky-700 hover:underline">
                See all on the map →
              </Link>
            </div>
            {/* The opportunity IS the visual object (Eric): value leads, then agency, title,
                urgency, DNA chips. See OpportunityCard for the full hierarchy rationale. */}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {featured.map((o) => (
                <OpportunityCard key={o.noticeId} opp={o} />
              ))}
            </div>
          </section>
        )}

        <hr className="mt-16 border-slate-200 md:mt-20" />

        {/* ══ CHAPTER 3 — TODAY'S MARKET ═════════════════════════════════════════════════════
             LAST, deliberately: "Because I just saw the market." The numbers are a closing
             summary, not an opening dashboard.

             NO BORDERED BOXES. v2 rendered these as outlined KPI cards, which is dashboard UI —
             the single strongest "this is software, not a newspaper" signal on the page. Now:
             big type, hairline separators, whitespace. Still clickable (a number you cannot click
             is a dashboard metric), but the affordance is the hover, not a box. */}
        {intel.stats.length > 0 && (
          <section className="pt-14 md:pt-16">
            <h2 className="mb-6 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Today&apos;s market
            </h2>
            <div className="grid grid-cols-2 gap-y-10 md:grid-cols-4 md:gap-y-0">
              {intel.stats.slice(0, 4).map((s, i) => (
                <Link
                  key={s.key}
                  href={s.href}
                  className={`group px-1 md:px-6 ${i > 0 ? 'md:border-l md:border-slate-200' : ''} ${i === 0 ? 'md:pl-0' : ''}`}
                >
                  <div className="font-mono text-[2.6rem] font-bold leading-none tracking-tight text-slate-900 transition group-hover:text-sky-700 md:text-[3rem]">
                    {s.value.toLocaleString()}
                  </div>
                  <div className="mt-2 text-[13px] leading-snug text-slate-500">{s.label}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="pt-16 md:pt-20" />

        <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
          Every number on this page is a live query against SAM.gov, USASpending and agency forecast
          data — nothing is estimated.
          {intel.degraded && (
            <span className="mt-1 block text-amber-600">
              Some sections are unavailable right now and have been omitted rather than shown as zero.
            </span>
          )}
        </footer>
      </div>
        </div>
      </div>
    </main>
    </>
  );
}
