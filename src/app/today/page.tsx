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

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Today's Intel — what changed in federal contracting today | Mindy",
  description:
    'The daily front page of public procurement: new opportunities posted today, contracts entering recompete, upcoming industry events, and which markets are moving.',
};

function fmtDate(d: string | null): string {
  if (!d) return '';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

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
      {/* ── Masthead. A newspaper nameplate, not an app header. ───────────────────────────── */}
      <div className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl items-baseline justify-between px-5 py-3">
          <Link href="/today" className="text-[13px] font-bold uppercase tracking-[0.2em] text-slate-900">
            Today&apos;s Intel
          </Link>
          <span className="text-xs text-slate-500">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5">
        {/* ── THE HERO. One story, dominant. This is the difference between a front page and a
             dashboard: everything else on this screen is visibly subordinate to it. ────────── */}
        <section className="border-b border-slate-200 py-10 md:py-14">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">{hero.kicker}</div>
          <h1 className="mt-3 max-w-4xl text-[2.1rem] font-bold leading-[1.08] tracking-tight text-slate-900 md:text-[3.4rem]">
            {hero.headline}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600 md:text-xl">{hero.standfirst}</p>
          <Link
            href={hero.href}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            {hero.cta} →
          </Link>
        </section>

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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {featured.map((o) => (
                <Link
                  key={o.noticeId}
                  href={o.href}
                  className="group flex flex-col rounded-lg border border-slate-200 p-5 transition hover:border-slate-400 hover:shadow-sm"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700">{o.agency}</span>
                  <span className="mt-2 flex-1 text-[15px] font-semibold leading-snug text-slate-900">{o.title}</span>
                  {o.closes && (
                    <span className="mt-3 text-xs text-slate-500">Closes {fmtDate(o.closes)}</span>
                  )}
                </Link>
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
    </main>
    </>
  );
}
