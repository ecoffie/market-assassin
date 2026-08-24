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
  /** Physical city — the meaningful geographic cut once a state filter is applied
   *  (with a state selected, every firm shares that state, so a state breakdown
   *  says nothing). The API has always returned these; the interface was simply
   *  narrower than the payload, which is how a field goes unused. */
  city: string | null;
  /** Most recent federal award action. Drives the "recently active" reading. */
  lastActionDate: string | null;
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
  // DEFECT-9A: prefer these — a bare `false` conflates "fewer than two exist" with
  // "we evaluated only part of the eligible population".
  ruleOfTwoDetermination?: 'met' | 'not_met' | 'undetermined';
  eligiblePopulation?: number;
  sampleSize?: number;
  sampleCoverage?: number;
  counts: Record<string, number>;
  registeredOnlyCount: number;
  businesses: Business[];
  dataAsOf: string;
  caveats: string[];
}

interface PriorContract {
  incumbent: string;
  piid: string | null;
  subAgency: string | null;
  value: number | null;
  naics: string | null;
  pscDescription: string | null;
  state: string | null;
  estimatedRecompete: string | null;
  recompeteLikelihood: string | null;
  setAside: string | null;
}

interface ProcurementHistory {
  measured: boolean;
  contracts: PriorContract[];
  totalMatching: number;
  distinctIncumbents: number;
  excludedImplausible: number;
  totalValue: number | null;
  setAsideCoverage: { withSetAside: number; total: number };
  note: string | null;
}

interface MarketEvent {
  source: 'sam' | 'ai';
  title: string;
  event_type: string;
  event_date: string | null;
  location: string | null;
  url: string | null;
  matched_office: string | null;
}

interface MarketSignals {
  measured: boolean;
  events: MarketEvent[];
  samCount: number;
  upcomingRecompetes: number | null;
  horizonMonths: number;
  note: string | null;
}

interface CompetitionDepthData {
  grounded: boolean;
  scope: { naics: string | null; state: string | null };
  resolvedAgency: string | null;
  sampled: number;
  sampledWithData: number;
  avgBidders: number | null;
  medianBidders: number | null;
  singleBidCount: number;
  singleBidPct: number | null;
  note: string;
}

interface CompetitionResp {
  measured: boolean;
  reason?: string;
  depth: CompetitionDepthData | null;
  methodology: { id: string; name: string; maturity: string; version: string; limitations: string[] } | null;
}

interface ReachGap {
  totalIdentified: number;
  relevantPool: number;
  observedInAwards: number;
  notInSample: number;
  qualificationVerified: null;
  qualificationUnknown: number;
  comparedAgainst: string[];
  caveat: string;
}

interface Context {
  history: ProcurementHistory;
  signals: MarketSignals;
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
  const [agency, setAgency] = useState('');
  const [office, setOffice] = useState('');
  const [psc, setPsc] = useState('');
  const [keyword, setKeyword] = useState('');
  const [estValue, setEstValue] = useState('');
  const [pop, setPop] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Research | null>(null);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [gap, setGap] = useState<ReachGap | null>(null);
  const [comp, setComp] = useState<CompetitionResp | null>(null);

  const params = () => {
    const p = new URLSearchParams({ email, naics });
    if (state) p.set('state', state.toUpperCase());
    if (setAside) p.set('setAside', setAside);
    return p;
  };

  /** Scope params for the acquisition-context read (history + signals). */
  const ctxParams = () => {
    const p = new URLSearchParams({ email, naics });
    if (agency) p.set('agency', agency);
    if (state) p.set('state', state.toUpperCase());
    if (keyword) p.set('keyword', keyword);
    return p;
  };

  async function analyze() {
    setLoading(true); setError(null); setData(null); setCtx(null); setGap(null); setComp(null);
    try {
      // Both reads fire together — the supplier market and the acquisition
      // context are independent, and the CO shouldn't wait twice.
      const [resRes, ctxRes, gapRes, compRes] = await Promise.all([
        fetch(`/api/gov-buyer/market-research?${params()}&limit=500`, {
          headers: getMIApiHeaders(email),
        }),
        fetch(`/api/gov-buyer/acquisition-context?${ctxParams()}`, {
          headers: getMIApiHeaders(email),
        }),
        fetch(`/api/gov-buyer/supplier-activation?${ctxParams()}`, {
          headers: getMIApiHeaders(email),
        }),
        fetch(`/api/gov-buyer/competition?${ctxParams()}`, {
          headers: getMIApiHeaders(email),
        }),
      ]);

      const json = await resRes.json();
      if (!resRes.ok || !json.success) {
        // Say what actually happened. "Access required" and "no results" are
        // different problems and a demo must not blur them.
        setError(json.error || `Request failed (${resRes.status})`);
        return;
      }
      setData(json as Research);

      // The context read is additive: if it fails, the determination above is
      // still valid, so we degrade those sections rather than the whole page.
      if (ctxRes.ok) {
        const cj = await ctxRes.json();
        if (cj.success) setCtx({ history: cj.history, signals: cj.signals });
      }
      if (gapRes.ok) {
        const gj = await gapRes.json();
        if (gj.success) setGap(gj.reachGap as ReachGap);
      }
      if (compRes.ok) {
        const cj = await compRes.json();
        if (cj.success) setComp(cj as CompetitionResp);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  async function downloadOutreach(onlyNew: boolean) {
    setError(null);
    const p = ctxParams();
    p.set('format', 'csv');
    if (onlyNew) p.set('onlyNew', 'true');
    const res = await fetch(`/api/gov-buyer/supplier-activation?${p}`, {
      headers: getMIApiHeaders(email),
    });
    if (!res.ok) { setError('Outreach list export failed — check access.'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Supplier_Outreach_${naics}${state ? '_' + state.toUpperCase() : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadMemo(format: 'docx' | 'pdf') {
    setError(null);
    // The memo carries the whole requirement, not just the search scope — the
    // CO typed those fields and they belong in the filed document.
    const p = params();
    p.set('format', format);
    if (agency) p.set('agency', agency);
    if (office) p.set('office', office);
    if (psc) p.set('psc', psc);
    if (keyword) p.set('keyword', keyword);
    if (title) p.set('title', title);
    if (estValue) p.set('estValue', estValue);
    if (pop) p.set('pop', pop);
    if (description) p.set('description', description);

    const res = await fetch(`/api/gov-buyer/market-research/export?${p}`, {
      headers: getMIApiHeaders(email),
    });
    if (!res.ok) { setError('Memo export failed — check access.'); return; }

    // A PDF request can legitimately come back as HTML when Chromium can't
    // launch. Say so and hand over the printable file rather than saving
    // markup under a .pdf name.
    const degraded = res.headers.get('X-Export-Degraded') === 'pdf-unavailable';
    const ext = degraded ? 'html' : format;
    if (degraded) {
      setError('PDF rendering is unavailable on the server, so the printable HTML was downloaded instead — open it and use Print → Save as PDF.');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Market_Research_${naics}${state ? '_' + state : ''}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const shown = data?.businesses ?? [];

  // ── EXECUTIVE-BRIEFING CUTS (PRD §6 Step 2: "should NOT be a search result").
  //    All derived from ScoredEntity fields the page already holds — no new query,
  //    no new endpoint. A briefing is a READING of the same data, not more data.
  const pool = shown.filter((b) => b.tier !== 'registered_only');

  // Certification mix, ordered by size. Counts FIRMS per certification, so a firm
  // holding three certs appears in three rows — that is the honest reading for
  // "how many HUBZone firms are in this market", not a partition of the pool.
  const certMix = (() => {
    const m: Record<string, number> = {};
    for (const b of pool) for (const c of b.certifications || []) m[c] = (m[c] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  })();

  // Geography ADAPTS to the query. With a state selected, every firm is in that
  // state (measured: 260/260 in WA), so a state breakdown says nothing and CITY
  // is the meaningful cut. Nationwide, the reverse. A fixed choice is useless in
  // one of the two modes.
  const geoByCity = Boolean(state.trim());
  const geoMix = (() => {
    const m: Record<string, number> = {};
    for (const b of pool) {
      const k = (geoByCity ? b.city : b.state) || null;
      if (k) m[k] = (m[k] || 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  })();

  // "Recently active" = a federal award action inside 12 months. NOT the same as
  // the Emerging tier (which is about depth of history, not recency), and not a
  // claim about the firm being new — only that the market has seen them lately.
  const recentlyActive = pool.filter((b) => {
    if (!b.lastActionDate) return false;
    return Date.now() - new Date(b.lastActionDate).getTime() < 365 * 864e5;
  }).length;
  const activityMeasured = pool.filter((b) => b.lastActionDate).length;

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
          {/*
            Layout note: every field is a BLOCK label with its own line, and the
            identity field sits on its own row. The first cut inlined
            "Signed in as" beside its input inside a flex row, which collided
            the label with the box and squeezed the email — the one field a
            demo-driver actually has to type into.
          */}
          <div className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-12">
            <label className="block lg:col-span-5">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">
                Requirement title <span className="font-normal text-slate-600">(optional)</span>
              </span>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Enterprise IT support services"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">
                NAICS <span className="text-emerald-400">*</span>
              </span>
              <input value={naics} onChange={(e) => setNaics(e.target.value.trim())}
                inputMode="numeric" placeholder="541512"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] tabular-nums text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">Place of performance</span>
              <input value={state} onChange={(e) => setState(e.target.value.trim())} placeholder="VA"
                maxLength={2}
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] uppercase text-slate-100 outline-none transition placeholder:normal-case placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">Set-aside</span>
              <select value={setAside} onChange={(e) => setSetAside(e.target.value)}
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] text-slate-100 outline-none transition focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30">
                {SET_ASIDES.map((s) => <option key={s} value={s}>{s || 'All small businesses'}</option>)}
              </select>
            </label>
          </div>

          {/* Acquisition scope — the fields a CO fills on the planning form.
              Agency is the load-bearing one: it narrows the award record AND
              is what engagement events are matched on (events are agency-keyed,
              so without it Step 5 has nothing to match). The rest document the
              requirement and travel to the memo. */}
          <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-12">
            <label className="block lg:col-span-4">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">
                Agency <span className="font-normal text-slate-600">(unlocks history + signals)</span>
              </span>
              <input value={agency} onChange={(e) => setAgency(e.target.value)}
                placeholder="e.g. Department of the Navy"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">
                Office <span className="font-normal text-slate-600">(optional)</span>
              </span>
              <input value={office} onChange={(e) => setOffice(e.target.value)}
                placeholder="e.g. NAVSUP FLC San Diego"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">
                PSC <span className="font-normal text-slate-600">(optional)</span>
              </span>
              <input value={psc} onChange={(e) => setPsc(e.target.value.trim())}
                placeholder="R425"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] uppercase text-slate-100 outline-none transition placeholder:normal-case placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">
                Keyword <span className="font-normal text-slate-600">(optional)</span>
              </span>
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. cybersecurity"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">
                Estimated value <span className="font-normal text-slate-600">(optional)</span>
              </span>
              <input value={estValue} onChange={(e) => setEstValue(e.target.value)}
                placeholder="$2,500,000"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">
                Period of performance <span className="font-normal text-slate-600">(optional)</span>
              </span>
              <input value={pop} onChange={(e) => setPop(e.target.value)}
                placeholder="12 mo base + 4 option years"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
            <label className="block lg:col-span-6">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">
                Requirement description <span className="font-normal text-slate-600">(optional — carried to the memo)</span>
              </span>
              <input value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief statement of the work to be acquired"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
          </div>

          {/* Identity + action — its own row, separated by a rule so the form
              above reads as "the requirement" and this reads as "who is asking". */}
          <div className="mt-6 flex flex-col gap-4 border-t border-white/[0.07] pt-5 sm:flex-row sm:items-end">
            <label className="block w-full sm:max-w-[340px]">
              <span className="mb-1.5 block text-[12px] font-medium text-slate-400">
                Your email <span className="font-normal text-slate-600">(agency address)</span>
              </span>
              <input value={email} onChange={(e) => setEmail(e.target.value.trim())}
                type="email" autoComplete="email" spellCheck={false}
                placeholder="you@agency.mil"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 text-[14px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30" />
            </label>
            <button onClick={analyze} disabled={loading || !naics || !email}
              className="h-11 shrink-0 rounded-lg bg-emerald-500 px-6 text-sm font-semibold text-[#06120c] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
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
                {(() => {
                  const det = data.ruleOfTwoDetermination ?? (data.ruleOfTwoMet ? 'met' : 'undetermined');
                  return (
                    <Stat label="Rule of Two"
                      value={det === 'met' ? 'MET' : det === 'not_met' ? 'NOT MET' : 'UNDETERMINED'}
                      accent={det === 'met'}
                      sub={det === 'met' ? 'Two or more responsible firms'
                        : det === 'not_met' ? 'Fewer than two, full population evaluated'
                        : 'Population not fully evaluated'} />
                  );
                })()}
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-slate-400">
                {(() => {
                  const det = data.ruleOfTwoDetermination ?? (data.ruleOfTwoMet ? 'met' : 'undetermined');
                  const covTxt = data.eligiblePopulation && (data.sampleCoverage ?? 1) < 1
                    ? <> {data.sampleSize?.toLocaleString()} of <strong className="text-slate-200">{data.eligiblePopulation.toLocaleString()}</strong> eligible
                        firms were evaluated ({((data.sampleCoverage ?? 0) * 100).toFixed(1)}%).</>
                    : null;
                  if (det === 'met') {
                    return <>Market research identified <strong className="text-slate-200">{data.marketDepth.toLocaleString()}</strong> qualified
                      small businesses with demonstrated capability. There is a reasonable expectation of receiving offers
                      from two or more responsible small business concerns at fair market prices.{covTxt}
                      {covTxt ? <> Finding two or more establishes this conclusion regardless of coverage.</> : null}</>;
                  }
                  if (det === 'not_met') {
                    return <>Fewer than two firms met the capability threshold, and the full eligible population was
                      evaluated. This is market-research evidence, not a contracting officer&rsquo;s determination.</>;
                  }
                  // DEFECT-9A: the case that used to render as a confident negative.
                  return <>Fewer than two capable firms were found, but the eligible population was only partially
                    evaluated, so Mindy <strong className="text-slate-200">cannot conclude</strong> that fewer than two
                    exist.{covTxt} Treat this as undetermined rather than as a negative Rule-of-Two finding.</>;
                })()}
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
              {/* THE BRIEFING. The PRD asks this step to read as an executive
                  briefing rather than a search result, and the difference is that
                  a briefing ANSWERS something before showing rows. Three readings
                  of the pool — who is certified, where they are, who is currently
                  active — then the list as supporting evidence. */}
              {pool.length > 0 && (
                <div className="mt-5 grid gap-5 lg:grid-cols-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">Socioeconomic mix</div>
                    {certMix.length ? (
                      <div className="mt-2 space-y-1.5">
                        {certMix.slice(0, 5).map(([cert, n]) => (
                          <div key={cert} className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                              <div className="h-full rounded-full bg-emerald-500/70"
                                style={{ width: `${Math.round((n / pool.length) * 100)}%` }} />
                            </div>
                            <span className="w-28 shrink-0 text-[12px] text-slate-400">{cert}</span>
                            <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-slate-300">{n}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-[12px] text-slate-500">No certifications recorded in this pool.</p>
                    )}
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                      Counts firms per certification, so a firm holding several appears in each.
                    </p>
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">
                      {geoByCity ? 'Concentration by city' : 'Concentration by state'}
                    </div>
                    {geoMix.length ? (
                      <>
                        <div className="mt-2 space-y-1.5">
                          {geoMix.slice(0, 5).map(([place, n]) => (
                            <div key={place} className="flex items-baseline justify-between gap-3">
                              <span className="truncate text-[12px] text-slate-400">{place}</span>
                              <span className="shrink-0 text-[12px] tabular-nums text-slate-300">{n}</span>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                          {geoMix.length.toLocaleString()} distinct {geoByCity ? 'cities' : 'states'} in the pool.
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-[12px] text-slate-500">No location recorded.</p>
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">Recent federal activity</div>
                    <div className="mt-2 text-3xl font-semibold tabular-nums text-slate-100">
                      {recentlyActive.toLocaleString()}
                    </div>
                    <p className="mt-1 text-[12px] text-slate-400">
                      firms with an award action in the last 12 months
                    </p>
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                      Measured on {activityMeasured.toLocaleString()} of {pool.length.toLocaleString()} firms that carry an
                      award date. Recency of activity — not a claim that a firm is new to the market.
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-6 overflow-x-auto">
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

            {/* Competition — OBS-009, scoped to THIS market, not the whole agency. */}
            <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                  Competition in this market
                </h2>
                {comp?.methodology && (
                  <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                    {comp.methodology.id} · {comp.methodology.maturity}
                  </span>
                )}
              </div>

              {!comp ? (
                <p className="mt-4 text-[13px] text-slate-500">Not measured — the competition read did not return.</p>
              ) : !comp.measured ? (
                <p className="mt-4 text-[13px] leading-relaxed text-slate-400">
                  {comp.reason || comp.depth?.note || 'Not measured for this scope.'}
                </p>
              ) : comp.depth ? (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat label="Average bidders" value={comp.depth.avgBidders}
                      accent={(comp.depth.avgBidders ?? 0) >= 2}
                      sub="Offers per competed award" />
                    <Stat label="Median bidders" value={comp.depth.medianBidders} />
                    <Stat label="Single-bid rate"
                      value={comp.depth.singleBidPct !== null ? `${comp.depth.singleBidPct}%` : null}
                      sub={`${comp.depth.singleBidCount} of ${comp.depth.sampledWithData} awards`} />
                    <Stat label="Sample" value={`${comp.depth.sampledWithData}/${comp.depth.sampled}`}
                      sub="Carried an offers count" />
                  </div>
                  <p className="mt-4 text-[13px] leading-relaxed text-slate-400">
                    {(comp.depth.singleBidPct ?? 0) >= 40
                      ? <>A single-bid rate of <strong className="text-slate-200">{comp.depth.singleBidPct}%</strong> indicates
                        this market is being awarded but not contested. That is the clearest signal that additional
                        suppliers, earlier outreach, or revised requirements could improve price and access — it is
                        not, by itself, evidence of a problem with any individual acquisition.</>
                      : <>Awards in this market attract an average of <strong className="text-slate-200">{comp.depth.avgBidders}</strong> offers,
                        with {comp.depth.singleBidPct}% drawing a single bid.</>}
                  </p>
                  <p className="mt-3 text-[12px] leading-relaxed text-slate-500">{comp.depth.note}</p>
                  {comp.methodology && (
                    <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
                      <strong className="text-slate-400">{comp.methodology.id} {comp.methodology.version} is Beta:</strong>{' '}
                      {comp.methodology.limitations[0]}
                    </p>
                  )}
                </>
              ) : null}
            </section>

            {/* Step 4 — procurement history (what happened before) */}
            <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">4 · Procurement history</h2>
                {ctx?.history.measured && (
                  <div className="text-[12px] text-slate-500">
                    {ctx.history.totalMatching.toLocaleString()} prior contract{ctx.history.totalMatching === 1 ? '' : 's'} · {ctx.history.distinctIncumbents.toLocaleString()} distinct incumbent{ctx.history.distinctIncumbents === 1 ? '' : 's'}
                  </div>
                )}
              </div>

              {!ctx ? (
                <p className="mt-4 text-[13px] text-slate-500">Not measured — the acquisition-context read did not return.</p>
              ) : !ctx.history.measured ? (
                <p className="mt-4 text-[13px] text-slate-500">
                  Not measured. {ctx.history.note}
                </p>
              ) : ctx.history.contracts.length === 0 ? (
                <p className="mt-4 text-[13px] leading-relaxed text-slate-400">
                  No active contracts with a future recompete date found in the award record for this scope.
                  That is a measured result, not a failed lookup — it may indicate a genuinely new requirement,
                  or a scope narrower than the award record captures. Broaden the agency or place of
                  performance to widen the search.
                </p>
              ) : (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Stat label="Prior contracts" value={ctx.history.totalMatching.toLocaleString()}
                      sub="In the award record for this scope" />
                    <Stat label="Distinct incumbents" value={ctx.history.distinctIncumbents.toLocaleString()}
                      sub="Firms that have held this work" />
                    <Stat label="Combined ceiling"
                      value={ctx.history.totalValue !== null ? money(ctx.history.totalValue) : null}
                      sub="Sum of plausible ceiling values" />
                  </div>

                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full text-left text-[13px]">
                      <thead className="text-[11px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="pb-2 pr-4">Incumbent</th>
                          <th className="pb-2 pr-4">Work</th>
                          <th className="pb-2 pr-4 text-right">Ceiling</th>
                          <th className="pb-2 pr-4">Est. recompete</th>
                          <th className="pb-2">Set-aside</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-300">
                        {ctx.history.contracts.map((c, i) => (
                          <tr key={`${c.piid ?? c.incumbent}-${i}`} className="border-t border-white/[0.06]">
                            <td className="py-2 pr-4 font-medium text-slate-100">{c.incumbent}</td>
                            <td className="py-2 pr-4 text-slate-400">{c.pscDescription || '—'}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{c.value !== null ? money(c.value) : '—'}</td>
                            <td className="py-2 pr-4 tabular-nums text-slate-400">{c.estimatedRecompete || '—'}</td>
                            {/* NULL set-aside means UNKNOWN, not "unrestricted" —
                                only 34% of the award record carries one. */}
                            <td className="py-2 text-slate-400">{c.setAside || 'Not recorded'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="mt-4 text-[12px] leading-relaxed text-slate-500">
                    Recompete dates are <strong className="text-slate-400">estimated</strong> from award period-of-performance
                    data — a planning signal, not a commitment that a solicitation issues on that date.
                    Set-aside is recorded on {ctx.history.setAsideCoverage.withSetAside} of {ctx.history.setAsideCoverage.total} matched
                    rows; &ldquo;Not recorded&rdquo; means unknown, not unrestricted.
                    {ctx.history.note ? ` ${ctx.history.note}` : ''}
                  </p>
                </>
              )}
            </section>

            {/* Step 5 — market signals (what's about to move) */}
            <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">5 · Market signals</h2>

              {!ctx ? (
                <p className="mt-4 text-[13px] text-slate-500">Not measured — the acquisition-context read did not return.</p>
              ) : (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Stat label={`Recompetes next ${ctx.signals.horizonMonths} months`}
                      value={ctx.signals.upcomingRecompetes !== null ? ctx.signals.upcomingRecompetes.toLocaleString() : null}
                      accent={(ctx.signals.upcomingRecompetes ?? 0) > 0}
                      sub="Contracts in this scope coming up for recompete" />
                    <Stat label="Engagement events"
                      value={ctx.signals.measured && ctx.signals.samCount >= 0 && agency ? ctx.signals.samCount.toLocaleString() : null}
                      sub="Industry days, sources sought, RFIs from SAM" />
                  </div>

                  {ctx.signals.events.length > 0 ? (
                    <ul className="mt-5 space-y-2">
                      {ctx.signals.events.slice(0, 8).map((ev, i) => (
                        <li key={`${ev.title}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-white/[0.06] pt-2 text-[13px]">
                          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] uppercase tracking-wider text-slate-400">
                            {ev.event_type?.replace(/_/g, ' ') || 'event'}
                          </span>
                          <span className="font-medium text-slate-200">
                            {ev.url
                              ? <a href={ev.url} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-300">{ev.title}</a>
                              : ev.title}
                          </span>
                          <span className="tabular-nums text-slate-500">{ev.event_date || 'date TBD'}</span>
                          {ev.matched_office && <span className="text-slate-500">· {ev.matched_office}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-[13px] leading-relaxed text-slate-400">
                      {ctx.signals.note || 'No engagement events posted for this agency in the look-ahead window.'}
                    </p>
                  )}

                  <p className="mt-4 text-[12px] text-slate-500">
                    Events are grounded SAM.gov postings only — no AI-discovered or inferred entries appear on
                    this surface.
                  </p>
                </>
              )}
            </section>

            {/* Reach gap — the activation half. Market research proves the
                market exists; this is who in it the office has not reached. */}
            {gap && (
              <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                  Supplier activation — the reach gap
                </h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <Stat label="Identified in NAICS" value={gap.totalIdentified.toLocaleString()}
                    sub="SAM-registered, all tiers" />
                  <Stat label="Relevant supplier pool" value={gap.relevantPool.toLocaleString()} accent
                    sub="Market-qualified candidates" />
                  <Stat label="Observed in awards" value={gap.observedInAwards.toLocaleString()}
                    sub="Matched to the sampled record" />
                  <Stat label="Not in sample" value={gap.notInSample.toLocaleString()} accent={gap.notInSample > 0}
                    sub="Candidates to reach" />
                  {/* Stage 2 is unbuilt, so this is null — "Not measured", never 0. */}
                  <Stat label="Qualification verified" value={gap.qualificationVerified}
                    sub={`Unknown for all ${gap.qualificationUnknown.toLocaleString()}`} />
                </div>

                <p className="mt-4 text-[13px] leading-relaxed text-slate-400">
                  <strong className="text-slate-200">Market-qualified</strong> means a current SAM registration
                  in this NAICS plus relevant federal past performance. It does <em>not</em> mean a firm is
                  qualified, available, or interested in this requirement — requirement-specific qualification
                  (facility access, clearances, quality certifications, capacity) is <strong className="text-slate-200">Unknown</strong> for
                  every firm and has not been evaluated.
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-slate-500">{gap.caveat}</p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button onClick={() => downloadOutreach(true)}
                    disabled={gap.notInSample === 0}
                    className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
                    Export outreach list — not in sample ({gap.notInSample})
                  </button>
                  <button onClick={() => downloadOutreach(false)}
                    className="rounded-lg border border-white/15 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08]">
                    Export full pool ({gap.relevantPool})
                  </button>
                </div>
                <p className="mt-3 text-[12px] text-slate-500">
                  CSV carries company, UEI, CAGE, location, socioeconomic status, past performance, and why each
                  firm matched. SAM.gov does not publish point-of-contact email or phone through its public API,
                  so each row links to the SAM record instead.
                </p>
              </section>
            )}

            {/* Step 6 — the payoff */}
            <section className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">6 · Documented market research</h2>
              <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-300">
                A formatted Market Research Determination — the requirement, the finding, the
                capability-tier breakdown, the identified businesses, the procurement history, the
                market signals, and the methodology and caveats — ready to file with the acquisition
                package.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={() => downloadMemo('docx')}
                  className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] transition hover:bg-emerald-400">
                  Download memo (.docx)
                </button>
                <button onClick={() => downloadMemo('pdf')}
                  className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.08] px-5 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/[0.16]">
                  Download memo (PDF)
                </button>
              </div>
              <p className="mt-3 text-[12px] text-slate-500">
                Both formats render the same determination — the Word version for editing, the PDF for filing.
              </p>
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
