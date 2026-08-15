/**
 * /today — TODAY'S INTEL. The front page of public procurement.
 *
 * v2 (Eric 2026-08-15, after seeing v1 beside Zillow): "You're still designing it like an ADMIN
 * DASHBOARD, not the FRONT PAGE of a newspaper… The first thing I feel is 'interesting statistics'.
 * I don't yet feel 'I have to click'." Four changes, all structural rather than cosmetic:
 *
 *   1. A HERO STORY. v1's "Good afternoon, here's what changed" was a greeting, and the actual
 *      news sat in 15px grey text beneath it. Zillow's hero is ~4x the weight of anything else on
 *      screen; v1 gave the headline and the stat cards near-equal weight, which is precisely what
 *      makes a page read as a dashboard. Now: one dominant story, then supporting blocks.
 *   2. TOP BUYERS, TRENDING MARKETS, FEATURED OPPORTUNITIES — discovery rows, the Zillow
 *      "Homes for you / Recently viewed" pattern translated to procurement.
 *   3. WHITE. "Your map is white. Your reports are white. Your pursuit pages are white. Today's
 *      Intel suddenly becoming black makes it feel like a different application." Bloomberg, not
 *      Hacker News.
 *   4. Every tile is a DOOR into the map. A number you cannot click is a dashboard metric.
 *
 * Still true from v1: this is a DESTINATION, not a landing page — it informs, and conversion is a
 * consequence. Every figure is a live query; a null count is dropped rather than rendered as 0.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTodayIntel, buildHeroStory, getFeaturedOpportunities } from '@/lib/today/intel';
import ContinueExploring from '@/components/today/ContinueExploring';
import OpportunityCard from '@/components/today/OpportunityCard';
import WhyTodayMatters from '@/components/today/WhyTodayMatters';
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
        {/* ── THE HERO. One story, dominant — then the market PROVING it. ──────────────────
             Eric 2026-08-15: *"Right now it says 'Here are today's numbers.' I want it to feel
             like: Here's today's story—and here's the market proving it."* So the headline is
             immediately followed by a search box and the LIVE map, which is our equivalent of
             Zillow's hero photograph — and a stronger one, because it's the actual product
             rather than a stock image. */}
        <section className="pt-10 md:pt-14">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">{hero.kicker}</div>
          <h1 className="mt-3 max-w-4xl text-[2.1rem] font-bold leading-[1.08] tracking-tight text-slate-900 md:text-[3.4rem]">
            {hero.headline}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600 md:text-xl">{hero.standfirst}</p>

          {/* Zillow's hero is a SEARCH BOX over the photo. A plain GET form needs no JS and no
              client component — it hands the query to the map, which owns search. */}
          <form action="/opportunity-map" method="get" className="mt-6 flex max-w-2xl gap-2">
            <input
              type="search"
              name="q"
              placeholder="Search agencies, markets, NAICS…"
              aria-label="Search agencies, markets, NAICS"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-3 text-[15px] text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Search
            </button>
          </form>
        </section>

        {/* ── TODAY'S LENS — the live map, directly under the story. ───────────────────────
             Uses the map's OWN `?embed=1` mode, which exists precisely for this ("map only —
             hide the sidebar/rail/scoreboard so the SAME map can be dropped" elsewhere). Not a
             screenshot and not a reimplementation: one map, one codebase, so it can never drift
             from the real thing. `loading="lazy"` keeps it off the critical path. */}
        <section className="pb-8 pt-6">
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
            <iframe
              src="/opportunity-map?embed=1"
              title="Today's Lens — live opportunity map"
              loading="lazy"
              className="h-[380px] w-full md:h-[460px]"
            />
            {/* The whole map is a door. An overlay link beats making the iframe itself clickable
                (which would swallow the map's own pan/zoom). Sits bottom-right, out of the way. */}
            <Link
              href={hero.href}
              className="absolute bottom-4 right-4 rounded-lg bg-slate-900/90 px-5 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur transition hover:bg-slate-900"
            >
              {hero.cta} →
            </Link>
          </div>
        </section>

        <div className="border-b border-slate-200" />

        {/* ── Today's market. Supporting evidence, deliberately smaller than the hero. ─────── */}
        {intel.stats.length > 0 && (
          <section className="border-b border-slate-200 py-8">
            <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Today&apos;s market</h2>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-slate-200 md:grid-cols-4">
              {intel.stats.slice(0, 4).map((s) => (
                <Link key={s.key} href={s.href} className="group bg-white p-5 transition hover:bg-slate-50">
                  <div className="font-mono text-3xl font-bold tracking-tight text-slate-900">
                    {s.value.toLocaleString()}
                  </div>
                  <div className="mt-1 text-[13px] leading-snug text-slate-500">{s.label}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── WHY TODAY MATTERS. The editorial section (Eric: "the biggest thing"). Sits between
             the KPI row and the discovery rows: the numbers above, restated as one sentence each
             that a contractor can act on. Composed from the SAME intel — no extra query, and it
             can never disagree with the row above it. */}
        <WhyTodayMatters intel={intel} />

        {/* ── Top buyers. Named "Top Buyers Today" per Eric — clicking filters the map. ────── */}
        {intel.agencies.length > 0 && (
          <section className="border-b border-slate-200 py-8">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Top buyers</h2>
              <span className="text-xs text-slate-400">posted this week</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {intel.agencies.map((a) => (
                <Link
                  key={a.agency}
                  href={a.href}
                  className="group flex items-baseline justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3.5 transition hover:border-slate-400"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold text-slate-900">{a.display}</span>
                    <span className="text-xs text-sky-700 opacity-0 transition group-hover:opacity-100">View on map →</span>
                  </span>
                  <span className="font-mono text-lg font-bold text-slate-900">{a.newThisWeek.toLocaleString()}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Trending markets. Discovery: the industries moving, week over week. ──────────── */}
        {intel.movers.length > 0 && (
          <section className="border-b border-slate-200 py-8">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Trending markets</h2>
              <span className="text-xs text-slate-400">vs last week</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {intel.movers.map((m) => (
                <Link
                  key={m.naics}
                  href={m.href}
                  className="rounded-lg border border-slate-200 px-4 py-3.5 transition hover:border-slate-400"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-semibold text-slate-900">{m.name}</span>
                    <span className="whitespace-nowrap font-mono text-sm font-bold text-emerald-700">↑ {m.pctChange}%</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {m.lastWeek.toLocaleString()} → {m.thisWeek.toLocaleString()} postings
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Continue where you left off / entry points (client: signed-in vs first-time). ─ */}
        <div className="border-b border-slate-200 py-8">
          <ContinueExploring />
        </div>

        {/* ── Featured opportunities. THREE. Proof that the numbers above are real things you
             can actually bid on — not a listing page. ─────────────────────────────────────── */}
        {featured.length > 0 && (
          <section className="border-b border-slate-200 py-8">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Featured opportunities</h2>
              <Link href="/opportunity-map" className="text-xs font-medium text-sky-700 hover:underline">
                See all on the map →
              </Link>
            </div>
            {/* The opportunity IS the visual object (Eric): value leads, then agency, title,
                urgency, DNA chips. See OpportunityCard for the full hierarchy rationale. */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {featured.map((o) => (
                <OpportunityCard key={o.noticeId} opp={o} />
              ))}
            </div>
          </section>
        )}

        {/* ── The door, again. ─────────────────────────────────────────────────────────────── */}
        <section className="py-10 text-center">
          <h2 className="text-xl font-bold text-slate-900 md:text-2xl">See it all on the map</h2>
          <p className="mx-auto mt-2 max-w-lg text-[15px] text-slate-600">
            Every opportunity above, plotted where the work is. Browse it the way you&apos;d browse
            listings — no search required.
          </p>
          <Link
            href="/opportunity-map"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-sky-600 px-7 py-3 text-sm font-semibold text-white transition hover:bg-sky-500"
          >
            Open the map →
          </Link>
        </section>

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
