import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mindy Enterprise — the federal change-history feed',
  description: 'A bulk API into the recorded diff of every federal contract — what slipped, what grew, who lost — joined to financials. For funds, lenders, PE, and surety.',
};

const CONTACT = 'mailto:hello@getmindy.ai?subject=Mindy%20Enterprise%20%2F%20API%20feed%20inquiry';

const BUYERS: { who: string; q: string }[] = [
  { who: 'Funds & traders', q: 'Which of my watchlist’s federal revenue is at risk — before the 8-K?' },
  { who: 'Lenders & factors', q: 'Is this federal receivable real, how long does it run, will they keep it?' },
  { who: 'PE & search funds', q: 'Is this target’s revenue real, and does it survive recompete?' },
  { who: 'Surety & insurance', q: 'This contractor’s performance history and concentration risk.' },
];

const ENDPOINTS: { name: string; body: string; returns: string }[] = [
  { name: 'recompete-risk', body: 'POST a book of UEIs', returns: 'per firm: revenue expiring in 6/12/18-month windows, slip history, concentration, a risk score. "$26.2B of Boeing’s federal revenue is up for recompete in 12 months."' },
  { name: 'uei → financials', body: 'POST a book of UEIs', returns: 'ticker + SEC revenue joined to the federal footprint → exposure as a % of the company. Private incumbents return an honest miss, never a fabricated figure.' },
  { name: 'change-history', body: 'POST UEIs + a window', returns: 'the append-only log of what moved — every slip, ceiling change, and incumbent novation on the book. The record that exists in exactly one place.' },
];

export default function Enterprise() {
  return (
    <main className="min-h-dvh bg-[#0b0f17] text-slate-100 [color-scheme:dark]">
      <div className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-400/80">Mindy · Enterprise / API</p>
        <h1 className="mt-5 text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Everyone can see what <span className="italic text-slate-400">is</span>.<br />Nobody can see what <span className="text-amber-300">changed</span>.
        </h1>
        <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-slate-300">
          USASpending has no “as of” query — it serves today’s state and forgets yesterday’s. So the
          record of what <span className="text-slate-100">moved</span> — which contracts slipped, which ceilings grew, which incumbents
          quietly lost — does not exist anywhere, for anyone, unless someone was writing it down while it
          happened. <span className="font-semibold text-white">We are writing it down.</span>
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={CONTACT} className="inline-flex items-center justify-center rounded-lg bg-amber-400 px-5 py-3 text-[15px] font-bold text-[#231a02] hover:bg-amber-300">Talk to us about the feed →</a>
          <span className="inline-flex items-center text-[13px] text-slate-500">Data license · volume-based · annual · not a seat</span>
        </div>

        {/* Who it's for */}
        <section className="mt-20">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.14em] text-slate-500">Who it’s for</h2>
          <div className="mt-5 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] sm:grid-cols-2">
            {BUYERS.map((b) => (
              <div key={b.who} className="border border-white/[0.06] p-6">
                <div className="text-[13px] font-semibold uppercase tracking-wide text-amber-300/90">{b.who}</div>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-300">“{b.q}”</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px] text-slate-500">None of them want a seat, a dashboard, or a login. They want the change, as a feed into their own systems, for their whole book at once.</p>
        </section>

        {/* The feed */}
        <section className="mt-20">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.14em] text-slate-500">The feed — bulk endpoints, not a UI</h2>
          <div className="mt-5 space-y-3">
            {ENDPOINTS.map((e) => (
              <div key={e.name} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <code className="font-mono text-[15px] font-semibold text-amber-200">{e.name}</code>
                  <span className="font-mono text-[12px] text-slate-500">{e.body}</span>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-300">{e.returns}</p>
              </div>
            ))}
          </div>
        </section>

        {/* The moat */}
        <section className="mt-20 rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-8">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.14em] text-amber-400/80">Why it’s defensible</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-slate-200">
            The data is public — SAM.gov, USASpending. The <span className="font-semibold text-white">recorded diff</span> is not. Every night the source
            overwrites the row with the current truth and the past is gone; upstream keeps no copy. So we write
            the change to an append-only log first. In three years that log answers questions no amount of funding
            can reconstruct — because the raw material stopped existing the day it changed. <span className="text-amber-200">A competitor starting in 2029 starts with an empty log in 2029.</span>
          </p>
        </section>

        {/* Contact */}
        <section className="mt-20 text-center">
          <h2 className="text-balance text-2xl font-bold sm:text-3xl">Point your models at the change, not the state.</h2>
          <p className="mx-auto mt-3 max-w-lg text-[15px] text-slate-400">Pricing is bespoke — volume, freshness, SLA, and integration. Tell us your book and how you ingest.</p>
          <a href={CONTACT} className="mt-6 inline-flex items-center justify-center rounded-xl bg-amber-400 px-6 py-3 text-[15px] font-bold text-[#231a02] hover:bg-amber-300">Contact sales</a>
          <p className="mt-4 font-mono text-[12px] text-slate-600">hello@getmindy.ai · typically replies within a business day</p>
        </section>

        <footer className="mt-24 border-t border-white/10 pt-6 font-mono text-[11px] leading-relaxed text-slate-600">
          Mindy · GovCon Giants AI. Figures verified against USASpending &amp; SAM.gov; contract data measured in production.
        </footer>
      </div>
    </main>
  );
}
