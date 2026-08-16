'use client';

/**
 * /gov/market-research — the Market Research Workspace (Gold Coast demo surface).
 *
 * THE STORY, in one page: tell Mindy what you need to buy → Mindy analyzes the
 * market → you download the determination memo you were going to write anyway.
 *
 * Deliberately NOT the six-step workspace from the PRD. That is the post-
 * conference build. This is the ONE workflow a contracting officer recognizes
 * as their own daily work — requirement in, documented market research out —
 * over engines that already exist and are already grounded.
 *
 * DISCIPLINE (the Observatory rule, and the reason this demo is defensible):
 * a number is either MEASURED or it says so. Nothing here renders 0 for
 * "we could not determine" — a failed lookup shows "Not measured", never a
 * confident zero. That distinction is what a KO will test in the room.
 */
import { useState } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';

interface Business {
  uei: string;
  legalBusinessName: string;
  state: string | null;
  certifications: string[];
  totalObligated: number;
  awardCount: number;
  distinctAgencyCount: number;
  tier: string;
}

interface Research {
  marketDepth: number;
  capableDepth: number;
  ruleOfTwoMet: boolean;
  counts: Record<string, number>;
  registeredOnlyCount: number;
  businesses: Business[];
  dataAsOf: string;
  caveats: string[];
}

const TIER_LABEL: Record<string, string> = {
  active_performer: 'Active Performer',
  capable: 'Capable',
  emerging: 'Emerging',
  registered_only: 'Registered Only',
};

const SET_ASIDES = ['', '8(a)', 'HUBZone', 'SDVOSB', 'WOSB', 'EDWOSB', 'Small Business'];

const money = (n: number) =>
  n >= 1_000_000_000 ? `$${(n / 1_000_000_000).toFixed(1)}B`
  : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K`
  : `$${n}`;

/** A measured value, or an explicit statement that it is not measured. Never 0. */
function Stat({ label, value, sub, accent }: { label: string; value: string | number | null; sub?: string; accent?: boolean }) {
  const unknown = value === null || value === undefined;
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className={`text-3xl font-semibold tabular-nums ${unknown ? 'text-slate-500' : accent ? 'text-emerald-300' : 'text-slate-100'}`}>
        {unknown ? 'Not measured' : value}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      {sub && <div className="mt-1 text-[12px] text-slate-500">{sub}</div>}
    </div>
  );
}

export default function GovMarketResearchPage() {
  const [email, setEmail] = useState('');
  const [naics, setNaics] = useState('541512');
  const [state, setState] = useState('VA');
  const [setAside, setSetAside] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Research | null>(null);

  const params = () => {
    const p = new URLSearchParams({ email, naics });
    if (state) p.set('state', state.toUpperCase());
    if (setAside) p.set('setAside', setAside);
    return p;
  };

  async function analyze() {
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch(`/api/gov-buyer/market-research?${params()}&limit=500`, {
        headers: getMIApiHeaders(email),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        // Say what actually happened. "Access required" and "no results" are
        // different problems and a demo must not blur them.
        setError(json.error || `Request failed (${res.status})`);
        return;
      }
      setData(json as Research);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  async function downloadMemo() {
    const res = await fetch(`/api/gov-buyer/market-research/export?${params()}`, {
      headers: getMIApiHeaders(email),
    });
    if (!res.ok) { setError('Memo export failed — check access.'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Market_Research_${naics}${state ? '_' + state : ''}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const shown = data?.businesses ?? [];

  return (
    <div className="min-h-screen bg-[#070c10] text-slate-200">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-400">Mindy for Government</div>
          <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">Market Research Workspace</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-400">
            Tell Mindy what you need to buy. Mindy analyzes the supplier market, assesses small-business
            depth and competition, and produces the documented market research that supports your
            acquisition strategy.
          </p>
        </header>

        {/* Step 1 — the requirement */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">1 · The requirement</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <label className="lg:col-span-2 text-[12px] text-slate-400">
              Requirement title <span className="text-slate-600">(optional)</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Enterprise IT support services"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[14px] text-slate-100 placeholder:text-slate-600" />
            </label>
            <label className="text-[12px] text-slate-400">
              NAICS <span className="text-emerald-400">*</span>
              <input value={naics} onChange={(e) => setNaics(e.target.value.trim())}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[14px] text-slate-100" />
            </label>
            <label className="text-[12px] text-slate-400">
              Place of performance
              <input value={state} onChange={(e) => setState(e.target.value.trim())} placeholder="VA"
                maxLength={2}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[14px] uppercase text-slate-100" />
            </label>
            <label className="text-[12px] text-slate-400">
              Set-aside
              <select value={setAside} onChange={(e) => setSetAside(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[14px] text-slate-100">
                {SET_ASIDES.map((s) => <option key={s} value={s}>{s || 'All small businesses'}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-[12px] text-slate-400">
              Signed in as
              <input value={email} onChange={(e) => setEmail(e.target.value.trim())}
                placeholder="you@agency.mil"
                className="mt-1 w-[260px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[14px] text-slate-100 placeholder:text-slate-600" />
            </label>
            <button onClick={analyze} disabled={loading || !naics || !email}
              className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] transition hover:bg-emerald-400 disabled:opacity-40">
              {loading ? 'Analyzing market…' : 'Analyze Market'}
            </button>
          </div>
        </section>

        {error && (
          <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-4 text-[14px] text-amber-200">
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Step 2 — the finding */}
            <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">2 · Market depth &amp; the Rule of Two</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Qualified small businesses" value={data.marketDepth.toLocaleString()} accent
                  sub="Excludes registered-only firms" />
                <Stat label="Capable depth" value={data.capableDepth.toLocaleString()}
                  sub="Active performers + capable" />
                <Stat label="Active performers" value={(data.counts.active_performer ?? 0).toLocaleString()}
                  sub="Won relevant work recently" />
                <Stat label="Rule of Two" value={data.ruleOfTwoMet ? 'MET' : 'NOT MET'} accent={data.ruleOfTwoMet}
                  sub={data.ruleOfTwoMet ? 'Two or more responsible firms' : 'Insufficient capable depth'} />
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-slate-400">
                {data.ruleOfTwoMet
                  ? <>Market research identified <strong className="text-slate-200">{data.marketDepth.toLocaleString()}</strong> qualified
                    small businesses with demonstrated capability. There is a reasonable expectation of receiving offers
                    from two or more responsible small business concerns at fair market prices.</>
                  : <>Capable depth is below the Rule-of-Two threshold for this scope. Consider broadening the place of
                    performance or the set-aside before making a determination.</>}
              </p>
            </section>

            {/* Step 3 — the suppliers */}
            <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">3 · The supplier market</h2>
                <div className="text-[12px] text-slate-500">
                  {Object.entries(data.counts).map(([k, v]) => `${TIER_LABEL[k] ?? k}: ${v}`).join(' · ')}
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-[11px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="pb-2 pr-4">Business</th>
                      <th className="pb-2 pr-4">State</th>
                      <th className="pb-2 pr-4">Tier</th>
                      <th className="pb-2 pr-4 text-right">5yr federal $</th>
                      <th className="pb-2 pr-4 text-right">Awards</th>
                      <th className="pb-2">Certifications</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {shown.slice(0, 25).map((b) => (
                      <tr key={b.uei} className="border-t border-white/[0.06]">
                        <td className="py-2 pr-4 font-medium text-slate-100">{b.legalBusinessName}</td>
                        <td className="py-2 pr-4 text-slate-400">{b.state || '—'}</td>
                        <td className="py-2 pr-4">{TIER_LABEL[b.tier] ?? b.tier}</td>
                        {/* A firm with no award history shows "—", never $0: the
                            absence of a measurement, not a measurement of zero. */}
                        <td className="py-2 pr-4 text-right tabular-nums">{b.awardCount > 0 ? money(b.totalObligated) : '—'}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{b.awardCount || '—'}</td>
                        <td className="py-2 text-slate-400">{b.certifications?.length ? b.certifications.join(', ') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shown.length > 25 && (
                <p className="mt-3 text-[12px] text-slate-500">
                  Showing the top 25 of {shown.length.toLocaleString()} by capability. The memo carries the top 50.
                </p>
              )}
            </section>

            {/* Step 4 — the payoff */}
            <section className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">4 · Documented market research</h2>
              <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-300">
                A formatted Market Research Determination — the finding, the capability-tier breakdown,
                the identified businesses, and the methodology and caveats — as a Word document you can
                file with the acquisition package.
              </p>
              <button onClick={downloadMemo}
                className="mt-4 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] transition hover:bg-emerald-400">
                Download Market Research Memo (.docx)
              </button>
            </section>

            {/* Provenance — always visible, never a footnote */}
            <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Methodology &amp; caveats</h2>
              <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-slate-400">
                {data.caveats.map((c) => <li key={c} className="flex gap-2"><span className="text-slate-600">•</span><span>{c}</span></li>)}
              </ul>
              <p className="mt-4 text-[12px] text-slate-500">
                Sources: SAM.gov entity registrations + USASpending.gov award history.
                Data as of {new Date(data.dataAsOf).toLocaleDateString()}.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
