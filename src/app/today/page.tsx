/**
 * /today — TODAY'S INTEL. The daily front page of the public procurement market.
 *
 * Eric 2026-08-15: "Design Today's Intel as a DESTINATION, not as a landing page. A landing page
 * tries to convert. Today's Intel should try to INFORM." So: no feature grid, no product tour, no
 * marketing paragraphs — the page demonstrates the product by BEING useful. Conversion (opening
 * the map, signing up, coming back tomorrow) is a consequence of that, not the page's job.
 *
 * Borrowed from Zillow: the SHAPE — "continue where you left off", activity-based rows, a small
 * set of entry points. NOT borrowed: the illustrated "Buy a home / Finance a home / Sell a home"
 * marketing cards, or the search-first hero. Zillow asks "what are you looking for?"; Mindy
 * answers "here's what changed today", because discovery beats search.
 *
 * ROUTING: deliberately a NEW route. getmindy.ai/ still host-rewrites to /mindy-landing and the
 * map-migration gate ("no migration — everything on the map must pass first") is untouched. When
 * the map clears that gate, repointing the apex here is a one-line change instead of a cutover.
 *
 * SIGNED-OUT: real aggregate numbers are public — that IS the 10-second proof. The personal
 * blocks ("continue where you left off") appear only when signed in: data behind glass, a
 * read-only preview with an honest door, never a blank wall.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTodayIntel } from '@/lib/today/intel';
import ContinueExploring from '@/components/today/ContinueExploring';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Today's Intel — what changed in federal contracting today | Mindy",
  description:
    'The daily front page of public procurement: new opportunities posted today, contracts entering recompete, upcoming industry events, and which markets are moving.',
};

function StatCard({ value, label, href }: { value: number; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-white/10 bg-white/5 p-5 transition hover:border-white/25 hover:bg-white/[0.08]"
    >
      <div className="font-mono text-3xl font-semibold tracking-tight text-white md:text-4xl">
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-sm leading-snug text-slate-400">{label}</div>
      <div className="mt-3 text-xs font-medium text-sky-300 opacity-0 transition group-hover:opacity-100">
        Open on the map →
      </div>
    </Link>
  );
}

export default async function TodayPage() {
  const intel = await getTodayIntel();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <main className="min-h-dvh bg-[#0b1220] text-white">
      <div className="mx-auto max-w-5xl px-5 py-10 md:py-14">
        {/* ── The masthead. A date and a real headline — a front page, not a hero. ── */}
        <header className="mb-8">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300">
              Today&apos;s Intel
            </span>
            <span className="text-xs text-slate-500">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight md:text-4xl">
            {greeting}. Here&apos;s what changed in public procurement.
          </h1>
          {/* The one-sentence headline — composed from the queried numbers, never written by a model. */}
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-slate-300 md:text-base">
            {intel.headline}
          </p>
        </header>

        {/* ── Today's market. Every number is a live query and a door to the map. ── */}
        {intel.stats.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Today&apos;s market</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {intel.stats.slice(0, 4).map((s) => (
                <StatCard key={s.key} value={s.value} label={s.label} href={s.href} />
              ))}
            </div>
          </section>
        )}

        {/* ── Biggest changes: real week-over-week deltas, not a sentiment read. ── */}
        {intel.movers.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Biggest changes</h2>
            <p className="mb-3 text-xs text-slate-500">
              Opportunities posted this week vs last week, by industry.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {intel.movers.map((m) => (
                <Link
                  key={m.naics}
                  href={m.href}
                  className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3 transition hover:border-white/25"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">{m.name}</span>
                    <span className="block text-xs text-slate-500">
                      {m.lastWeek.toLocaleString()} → {m.thisWeek.toLocaleString()} this week
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-mono text-sm font-semibold text-emerald-300">
                    +{m.pctChange}%
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Who's buying. Straight into a filtered map view. ── */}
        {intel.agencies.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Who&apos;s buying this week</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {intel.agencies.map((a) => (
                <Link
                  key={a.agency}
                  href={a.href}
                  className="rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-white/25"
                >
                  <div className="font-mono text-xl font-semibold text-white">{a.newThisWeek.toLocaleString()}</div>
                  <div className="mt-0.5 truncate text-sm text-slate-300">{a.display}</div>
                  <div className="text-xs text-slate-500">posted this week</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Continue where you left off — the Zillow idea that genuinely translates. Client
             component: signed-out users get the four entry points instead, never a blank wall. ── */}
        <ContinueExploring />

        {/* ── The door. One CTA, straight to the map. ── */}
        <section className="mt-12 rounded-2xl border border-sky-400/25 bg-sky-400/[0.07] p-6 text-center md:p-8">
          <h2 className="text-lg font-semibold md:text-xl">Open Today&apos;s Lens</h2>
          <p className="mx-auto mt-1.5 max-w-lg text-sm text-slate-300">
            The map, pre-filtered to what moved today. Browse it the way you&apos;d browse listings —
            no search required.
          </p>
          <Link
            href="/opportunity-map"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-sky-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-sky-400"
          >
            Open the map →
          </Link>
        </section>

        <footer className="mt-10 text-center text-xs text-slate-600">
          Every number on this page is a live query against SAM.gov, USASpending and agency forecast
          data — nothing is estimated.
          {intel.degraded && (
            <span className="mt-1 block text-amber-400/80">
              Some sections are unavailable right now and have been omitted rather than shown as zero.
            </span>
          )}
        </footer>
      </div>
    </main>
  );
}
