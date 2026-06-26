'use client';

/**
 * The Mission — reversing the shrinking industrial base (demo-day visual, Eric Jun 26).
 *
 * The biggest moat isn't a feature — it's WHY. Free agentic tools put more small
 * businesses in the game; once two are capable and bidding, the FAR 19.502-2
 * "Rule of Two" FORCES the acquisition to be set aside for small business. So free
 * tools at population scale convert Full-and-Open dollars into set-asides and
 * reverse a decade of decline in the small-business base.
 *
 * This page quantifies the dollar impact of converting X% of the ~$571.5B that
 * currently goes to large business into small-business set-asides. All figures are
 * FY2024 federal prime-contract data (sources in the footnote).
 *
 * Route: /admin/set-aside-impact
 */

import { useEffect, useState } from 'react';

interface LiveStats {
  window: { newestPosted: string | null; oldestPosted: string | null };
  activeTotal: number | null;
  biddable: { total: number; setAside: number; setAsidePct: number; fullAndOpen: number; fullAndOpenPct: number };
  dollarShareSmallBusinessPct: number;
}

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

// FY2024 federal prime-contract obligations (SBA scorecard / CRS / FPDS).
const TOTAL_B = 755;          // total federal prime obligations ($B)
const SMALL_B = 183.5;        // to small business ($B) — 28.76%
const OTSB_B = TOTAL_B - SMALL_B; // 571.5 — "Full-and-Open" / other-than-small pool
const SMALL_PRIMES = 58_681;  // # small businesses w/ prime awards (FY2022; ~½ of 2010)
const AVG_AWARD = (SMALL_B * 1e9) / SMALL_PRIMES; // ≈ $3.13M avg per small prime

const fmtB = (b: number) => `$${b.toFixed(1)}B`;
const fmtMoney = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;

const PROBLEM = [
  { stat: '58,681', label: 'small businesses won a federal prime in FY2022 — fewer than HALF the 2010 number', src: 'HigherGov / FPDS' },
  { stat: '−32%', label: 'drop in small-business prime awardees, FY2009 → FY2018', src: 'U.S. Senate Small Business Committee' },
  { stat: '−70%', label: 'collapse in small awardees at DoD alone since 2011', src: 'DoD Section 809 Panel' },
];

export default function SetAsideImpactPage() {
  const [pct, setPct] = useState(10);
  const [live, setLive] = useState<LiveStats | null>(null);

  useEffect(() => {
    fetch('/api/admin/set-aside-stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.success) setLive(d as LiveStats); })
      .catch(() => {});
  }, []);

  const redirected = OTSB_B * (pct / 100);          // $B moved to small business
  const newSmall = SMALL_B + redirected;            // $B
  const newSharePct = (newSmall / TOTAL_B) * 100;
  const perBusiness = (redirected * 1e9) / SMALL_PRIMES;     // more per existing small biz
  const sustained = (redirected * 1e9) / AVG_AWARD;          // businesses at avg award size

  const smallWidth = (newSmall / TOTAL_B) * 100;
  const baseSmallWidth = (SMALL_B / TOTAL_B) * 100;

  return (
    <div className="min-h-dvh bg-slate-950 px-6 py-8 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <h1 className="text-2xl font-black">The Mission — reversing the shrinking industrial base</h1>
          <p className="mt-1 text-sm text-slate-400">
            Free agentic tools put more small businesses in the game. Once two are capable and bidding, the <span className="font-semibold text-emerald-300">FAR 19.502-2 &ldquo;Rule of Two&rdquo;</span> <span className="italic">forces</span> the contract to be set aside for small business. At scale, free tools turn Full-and-Open dollars into set-asides.
          </p>
        </header>

        {/* ── the gap, measured LIVE from our own platform ────────────────── */}
        <div className="mb-6 rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/30 to-slate-950 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-300">The gap — measured live, right now</h2>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {live ? `${live.biddable.total.toLocaleString()} live solicitations · ${fmtDate(live.window.oldestPosted)}–${fmtDate(live.window.newestPosted)}` : 'loading…'}
            </span>
          </div>
          {live ? (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="text-3xl font-black text-emerald-300">{live.biddable.setAsidePct}%</div>
                  <p className="mt-1 text-[12px] text-slate-400">of biddable solicitations are set aside for small business</p>
                </div>
                <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4">
                  <div className="text-3xl font-black text-rose-300">{live.biddable.fullAndOpenPct}%</div>
                  <p className="mt-1 text-[12px] text-slate-300">are still <span className="font-semibold">full-and-open</span> — and they carry the bigger dollars</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="text-3xl font-black text-white">{live.dollarShareSmallBusinessPct}%</div>
                  <p className="mt-1 text-[12px] text-slate-400">of all federal <span className="font-semibold">dollars</span> reach small business (SBA FY2024)</p>
                </div>
              </div>
              <p className="mt-3 text-[12px] text-slate-400">
                The real discrepancy: small businesses win <span className="font-semibold text-slate-200">~half the solicitations but only ~{live.dollarShareSmallBusinessPct}% of the money</span> — because the set-asides are the <span className="font-semibold">small</span> contracts and the big ones stay open. Measured from our own SAM cache (true biddable solicitations only; DLA parts-buy award notices excluded), refreshed daily.
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Measuring live from our SAM opportunity cache…</p>
          )}
        </div>

        {/* ── the problem ─────────────────────────────────────────────────── */}
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {PROBLEM.map((p) => (
            <div key={p.stat} className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4">
              <div className="text-2xl font-black text-rose-300">{p.stat}</div>
              <p className="mt-1 text-[12px] leading-snug text-slate-300">{p.label}</p>
              <p className="mt-1 text-[10px] text-slate-500">{p.src}</p>
            </div>
          ))}
        </div>

        {/* ── the calculator ──────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/30 to-slate-950 p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-emerald-300">If we convert</p>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-black text-white tabular-nums">{pct}%</span>
                <span className="text-sm text-slate-400">of the $571.5B Full-and-Open pool into set-asides…</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-slate-400">→ redirected to small business</p>
              <div className="text-4xl font-black text-emerald-300 tabular-nums">{fmtB(redirected)}<span className="text-base font-semibold text-slate-400">/yr</span></div>
            </div>
          </div>

          {/* slider */}
          <input
            type="range" min={1} max={25} value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="mt-5 w-full accent-emerald-400"
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
            {[1, 5, 10, 15, 20, 25].map((m) => <span key={m}>{m}%</span>)}
          </div>

          {/* stacked bar: small business share grows */}
          <div className="mt-5">
            <div className="relative h-9 w-full overflow-hidden rounded-lg bg-slate-800">
              {/* new (grown) small-business share */}
              <div className="absolute inset-y-0 left-0 bg-emerald-500/80 transition-all duration-200" style={{ width: `${smallWidth}%` }} />
              {/* the converted slice (lighter) sits at the leading edge */}
              <div className="absolute inset-y-0 bg-emerald-300/40 transition-all duration-200" style={{ left: `${baseSmallWidth}%`, width: `${smallWidth - baseSmallWidth}%` }} />
              <div className="absolute inset-0 flex items-center justify-between px-3 text-[11px] font-semibold">
                <span className="text-white">Small business {newSharePct.toFixed(1)}%</span>
                <span className="text-slate-400">Other-than-small {(100 - newSharePct).toFixed(1)}%</span>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">FY2024 baseline: small business 28.8% (${SMALL_B}B) · other-than-small 71.2% (${OTSB_B.toFixed(1)}B) of ${TOTAL_B}B total.</p>
          </div>

          {/* context cards */}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-2xl font-black text-white">{fmtMoney(perBusiness)}</div>
              <p className="mt-1 text-[11px] text-slate-400">more, on average, for each of today&rsquo;s {SMALL_PRIMES.toLocaleString()} small-business primes</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-2xl font-black text-white">{Math.round(sustained).toLocaleString()}</div>
              <p className="mt-1 text-[11px] text-slate-400">more small businesses sustained at the current avg award (~{fmtMoney(AVG_AWARD)}) — toward rebuilding the base</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-2xl font-black text-emerald-300">{fmtB(newSmall)}</div>
              <p className="mt-1 text-[11px] text-slate-400">new small-business total ({newSharePct.toFixed(1)}% of all federal contracting)</p>
            </div>
          </div>
        </div>

        {/* ── the mechanism ───────────────────────────────────────────────── */}
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">How free tools trigger it — the Rule of Two</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <span className="rounded-lg bg-emerald-500/15 px-3 py-1.5 font-semibold text-emerald-200">Free agentic tools</span>
            <span className="text-slate-600">→</span>
            <span className="rounded-lg bg-slate-800 px-3 py-1.5">more small businesses capable &amp; bidding</span>
            <span className="text-slate-600">→</span>
            <span className="rounded-lg bg-slate-800 px-3 py-1.5">two qualified small bids on an opp</span>
            <span className="text-slate-600">→</span>
            <span className="rounded-lg bg-slate-800 px-3 py-1.5">Rule of Two forces a set-aside</span>
            <span className="text-slate-600">→</span>
            <span className="rounded-lg bg-emerald-500/15 px-3 py-1.5 font-semibold text-emerald-200">the base grows back</span>
          </div>
          <p className="mt-3 text-[12px] text-slate-400">
            FAR 19.502-2: when a contracting officer reasonably expects offers from at least <span className="font-semibold text-slate-200">two responsible small businesses</span> at fair market prices, the acquisition <span className="font-semibold text-slate-200">must</span> be set aside for small business. Mindy&rsquo;s free tier is the lever that creates those two qualified bidders — at population scale.
          </p>
        </div>

        <p className="mt-4 text-[10px] leading-relaxed text-slate-500">
          Sources: FY2024 federal prime-contract obligations ≈ $755B (CRS / FPDS); small-business prime dollars $183.5B = 28.76% (SBA FY2024 Procurement Scorecard); other-than-small ≈ $571.5B by subtraction. Decline figures: HigherGov/FPDS (58,681 in FY2022, &lt;½ of 2010), U.S. Senate Small Business Committee (−32% FY09→FY18), DoD Section 809 Panel (−70% since 2011). &ldquo;Sustained&rdquo; / per-business figures are illustrative at the current average award size, not a forecast.
        </p>
      </div>
    </div>
  );
}
