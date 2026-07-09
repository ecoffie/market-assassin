'use client';

/**
 * Onboarding "slurpee" choreography (Eric, Jun 2026).
 *
 * The aha moment made VISIBLE: after a user says what they do, don't just pop the
 * profile instantly — show Mindy *working* through ~25-30 federal data sources
 * (contractors, recompetes, agencies, small-business offices, forecasts, grants…),
 * then a "boom" count-up REVEAL of everything it assembled. That's the proof the
 * data fusion is real, not a lookup.
 *
 * Honest by design: the scan steps name sources Mindy genuinely fuses, and every
 * revealed number is REAL (from the profile extraction + /api/market-overview).
 * The animation paces the work; it doesn't invent it.
 *
 * Contract: parent kicks off the real fetch and passes `reveal` (null until the
 * data is ready). This component animates the scan; once `reveal` arrives AND the
 * scan has played through, it flips to the reveal. `onContinue` → confirm screen.
 */

import { useEffect, useRef, useState } from 'react';

export interface RevealStat {
  icon: string;
  /** Final numeric value to count up to. Omit `value` for a static string stat. */
  value?: number;
  display?: string;     // pre-formatted (e.g. "$1.4B") — shown instead of count-up
  label: string;
  accent?: boolean;     // emphasize (the headline market $)
}

export interface RevealData {
  headline: string;     // e.g. "Construction services"
  stats: RevealStat[];
}

interface Props {
  reveal: RevealData | null;   // null = data still loading
  onContinue: () => void;
}

// The sources Mindy fuses, surfaced as a visible scan. Order = a believable
// build: opportunities → who buys → who already holds it → what's coming → how to win.
const SCAN_STEPS: { icon: string; label: string }[] = [
  { icon: '📡', label: 'Scanning SAM.gov active solicitations' },
  { icon: '📊', label: 'Cross-referencing 5 years of USASpending awards' },
  { icon: '🏛️', label: 'Mapping your buying agencies & sub-agencies' },
  { icon: '📇', label: 'Decoding small-business offices & liaisons' },
  { icon: '🔁', label: 'Finding expiring contracts to recompete' },
  { icon: '🏢', label: 'Matching 3,500+ prime contractors' },
  { icon: '📋', label: 'Loading agency forecasts 12–18 months out' },
  { icon: '💰', label: 'Checking Grants.gov funding programs' },
  { icon: '🎯', label: 'Scoring your set-aside eligibility' },
  { icon: '🔀', label: 'Crosswalking NAICS ↔ PSC codes' },
  { icon: '🧭', label: 'Indexing agency pain points & priorities' },
  { icon: '✨', label: 'Resolving it all into your one market' },
];

const STEP_MS = 600;   // deliberate "watch it work" pace (Eric Jun 25: slow it down)

function useCountUp(target: number | undefined, run: boolean, ms = 1300): number {
  const [n, setN] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!run || target == null) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setN(Math.round(target * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, run, ms]);
  return n;
}

export default function OnboardingScan({ reveal, onContinue }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<'scanning' | 'reveal'>('scanning');

  // Advance the scan one step at a time. Hold on the last step until data is ready.
  useEffect(() => {
    if (phase !== 'scanning') return;
    if (stepIndex >= SCAN_STEPS.length - 1) {
      // Reached the end of the visible scan. Flip to reveal once data is ready;
      // otherwise keep holding here (the last step reads "Resolving…").
      if (reveal) {
        const t = setTimeout(() => setPhase('reveal'), 750);
        return () => clearTimeout(t);
      }
      return;
    }
    const t = setTimeout(() => setStepIndex((i) => i + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [stepIndex, phase, reveal]);

  const pct = Math.round(((stepIndex + 1) / SCAN_STEPS.length) * 100);

  if (phase === 'reveal' && reveal) {
    return <Reveal reveal={reveal} onContinue={onContinue} />;
  }

  // ── SCANNING ─────────────────────────────────────────────────────────────
  const visible = SCAN_STEPS.slice(0, stepIndex + 1);
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 to-slate-900 p-6">
      <div className="text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 text-2xl">
          <span className="animate-pulse">🧠</span>
        </div>
        <h3 className="mt-3 text-lg font-bold text-white">Building your Mindy…</h3>
        <p className="mt-1 text-xs text-muted">
          Cross-referencing <span className="font-semibold text-emerald-300">28 federal data sources</span> into one market
        </p>
      </div>

      {/* progress bar */}
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>

      {/* accumulating scan log */}
      <div className="mt-4 space-y-1.5">
        {visible.map((s, i) => {
          const isCurrent = i === stepIndex;
          const done = i < stepIndex || (isCurrent && !!reveal && stepIndex >= SCAN_STEPS.length - 1);
          return (
            <div key={s.label} className={`flex items-center gap-2.5 text-sm transition-opacity ${isCurrent ? 'opacity-100' : 'opacity-60'}`}>
              <span className="w-4 shrink-0 text-center">
                {done || !isCurrent
                  ? <span className="text-emerald-400">✓</span>
                  : <span className="inline-block animate-spin text-emerald-300">◌</span>}
              </span>
              <span className="text-base">{s.icon}</span>
              <span className="text-ink-soft">
                {isCurrent && !reveal && i === SCAN_STEPS.length - 1 ? 'Resolving your market…' : s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── REVEAL ───────────────────────────────────────────────────────────────────
function Reveal({ reveal, onContinue }: { reveal: RevealData; onContinue: () => void }) {
  const [run, setRun] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRun(true), 60); return () => clearTimeout(t); }, []);
  return (
    <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 to-slate-900 p-6 text-center">
      <div className="text-3xl">🎯</div>
      <h3 className="mt-2 text-xl font-black text-white">Your market is ready.</h3>
      <p className="mt-1 text-sm text-muted">
        Mindy just assembled everything for <span className="font-semibold text-emerald-300">{reveal.headline}</span>.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {reveal.stats.map((s) => <StatCell key={s.label} stat={s} run={run} />)}
      </div>

      <p className="mt-5 text-sm font-semibold text-emerald-300">You&rsquo;re armed and ready. 🚀</p>
      <button
        onClick={onContinue}
        className="mt-3 h-11 w-full rounded-xl bg-emerald-600 text-sm font-bold text-white transition-colors hover:bg-emerald-500"
      >
        Review &amp; finish setup →
      </button>
    </div>
  );
}

function StatCell({ stat, run }: { stat: RevealStat; run: boolean }) {
  const counted = useCountUp(stat.value, run);
  const shown = stat.display ?? (stat.value != null ? counted.toLocaleString() : '');
  return (
    <div className={`rounded-xl border p-3 ${stat.accent ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-surface bg-ground/70'}`}>
      <div className="text-lg">{stat.icon}</div>
      <div className={`mt-0.5 text-2xl font-black ${stat.accent ? 'text-emerald-300' : 'text-white'}`}>{shown}</div>
      <div className="text-[11px] leading-tight text-muted">{stat.label}</div>
    </div>
  );
}
