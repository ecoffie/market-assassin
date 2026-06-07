'use client';
import { useState, useMemo } from 'react';
import { BID_GATES, BID_FACTORS, evaluateBidDecision } from '@/lib/proposal/bid-decision';

/**
 * Step 1 — Bid / No-Bid (Eric's workflow: decide if you can/should bid BEFORE
 * the compliance matrix). Hard GATES first (any No = No-Bid, stop), then Eric's
 * 10-factor self-assessment SCORECARD → %  → pursue/watch/skip. On a bid
 * decision, calls onDecision so the parent can unlock the matrix.
 */
export default function BidDecisionGate({ onProceed }: { onProceed: () => void }) {
  const [gates, setGates] = useState<Record<string, boolean | undefined>>({});
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [showScorecard, setShowScorecard] = useState(false);

  const gateAnswered = BID_GATES.every(g => typeof gates[g.id] === 'boolean');
  const failedGate = BID_GATES.find(g => gates[g.id] === false);

  const result = useMemo(() => evaluateBidDecision({
    gates: gates as Record<string, boolean>,
    ratings,
  }), [gates, ratings]);

  // Static class maps (Tailwind JIT can't see interpolated class names).
  const recBox = result.recommendation === 'pursue' ? 'border-emerald-500/40 bg-emerald-500/10'
    : result.recommendation === 'watch' ? 'border-amber-500/40 bg-amber-500/10'
    : 'border-slate-500/40 bg-slate-500/10';
  const recText = result.recommendation === 'pursue' ? 'text-emerald-300'
    : result.recommendation === 'watch' ? 'text-amber-300'
    : 'text-slate-300';

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 mb-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-white">① Bid / No-Bid — should you pursue this?</h3>
        <p className="text-xs text-slate-400 mt-0.5">Before the compliance matrix: a few deal-breakers, then a quick fit score. Don&apos;t spend days on a bid you can&apos;t win.</p>
      </div>

      {/* Part 1 — hard gates */}
      <div className="space-y-2 mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Deal-breakers — any &quot;No&quot; means walk away</p>
        {BID_GATES.map(g => (
          <div key={g.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
            <div className="text-xs">
              <div className="text-slate-200">{g.question}</div>
              <div className="text-slate-500 mt-0.5">{g.help}</div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => setGates(p => ({ ...p, [g.id]: true }))} className={`rounded px-2.5 py-1 text-xs font-medium ${gates[g.id] === true ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>Yes</button>
              <button onClick={() => setGates(p => ({ ...p, [g.id]: false }))} className={`rounded px-2.5 py-1 text-xs font-medium ${gates[g.id] === false ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>No</button>
            </div>
          </div>
        ))}
      </div>

      {/* Gate failure → No-Bid */}
      {failedGate && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
          <div className="font-semibold text-red-300">🛑 No-Bid recommended</div>
          <div className="text-slate-300 mt-1">Deal-breaker: <span className="text-red-200">{failedGate.question.replace(/\?$/, '')}</span> — this disqualifies you regardless of how good the fit is. Don&apos;t spend time on the matrix. (You can still proceed to track it or subcontract.)</div>
          <button onClick={onProceed} className="text-[11px] text-slate-400 hover:text-slate-200 mt-2 underline">Proceed anyway →</button>
        </div>
      )}

      {/* Part 2 — scorecard (only once gates pass) */}
      {gateAnswered && !failedGate && (
        <div className="mt-3">
          {!showScorecard ? (
            <button onClick={() => setShowScorecard(true)} className="w-full rounded-lg bg-amber-600 hover:bg-amber-500 px-4 py-2 text-sm font-semibold text-white">
              ✓ Clears the deal-breakers — score the fit →
            </button>
          ) : (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Fit scorecard — rate each 0 (poor) to 10 (excellent)</p>
              <div className="space-y-2">
                {BID_FACTORS.map(f => {
                  const v = ratings[f.id];
                  const tipFor = (val: number) => val >= 7 ? f.positive : val >= 3 ? f.neutral : f.negative;
                  return (
                    <div key={f.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-medium text-slate-200">{f.label}</span>
                        <span className="text-xs font-mono text-slate-400 w-8 text-right">{typeof v === 'number' ? v : '—'}</span>
                      </div>
                      <input type="range" min={0} max={10} value={typeof v === 'number' ? v : 5}
                        onChange={e => setRatings(p => ({ ...p, [f.id]: Number(e.target.value) }))}
                        className="w-full accent-amber-500" />
                      {typeof v === 'number' && <div className="text-[11px] text-slate-500 mt-0.5">{tipFor(v)}</div>}
                    </div>
                  );
                })}
              </div>

              {/* Result */}
              <div className={`mt-3 rounded-lg border p-3 ${recBox}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`text-lg font-bold ${recText}`}>
                      {result.score}% fit · {result.recommendation === 'pursue' ? 'PURSUE' : result.recommendation === 'watch' ? 'WATCH / VERIFY' : 'LIKELY SKIP'}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{result.rated} of {BID_FACTORS.length} factors rated</div>
                  </div>
                  <button onClick={onProceed} className="rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-semibold text-white shrink-0">
                    Build the matrix →
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
