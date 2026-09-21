'use client';
import { useState, useMemo, useEffect } from 'react';
import { Ban, Check } from 'lucide-react';
import { BID_GATES, BID_FACTORS, evaluateBidDecision } from '@/lib/proposal/bid-decision';
import { authedFetch } from '../authHeaders';

interface DerivedGate { id: string; question: string; detail?: string; help?: string; source?: string }

/**
 * Step 1 — Bid / No-Bid (Eric's workflow: decide if you can/should bid BEFORE
 * the compliance matrix). Hard GATES first (any No = No-Bid, stop), then Eric's
 * 10-factor self-assessment SCORECARD → %  → pursue/watch/skip. On a bid
 * decision, calls onDecision so the parent can unlock the matrix.
 *
 * The gates are derived from THIS solicitation when a pipelineId is available
 * (Eric QC: generic gates felt like generic data) — falling back to the
 * universal eliminators otherwise.
 */
export default function BidDecisionGate({ onProceed, email, pipelineId }: { onProceed: () => void; email?: string; pipelineId?: string | null }) {
  const [gates, setGates] = useState<Record<string, boolean | undefined>>({});
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [showScorecard, setShowScorecard] = useState(false);
  // Opportunity-specific gates (loaded from the solicitation); fall back to the
  // generic eliminators if we can't derive any.
  const [derivedGates, setDerivedGates] = useState<DerivedGate[] | null>(null);
  const [loadingGates, setLoadingGates] = useState(false);
  const [savedDecision, setSavedDecision] = useState<string | null>(null);

  // Persist the bid/no-bid decision on the pursuit (best-effort — doesn't block
  // the flow). The decision used to vanish; now it's recorded + workspace-visible.
  const saveDecision = (decision: 'pursue' | 'watch' | 'skip', score?: number) => {
    setSavedDecision(decision);
    if (!email || !pipelineId) return;
    authedFetch(`/api/app/proposal/bid-gates?email=${encodeURIComponent(email)}`, email, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline_id: pipelineId, decision, score }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (!email || !pipelineId) return;
    setLoadingGates(true);
    authedFetch(`/api/app/proposal/bid-gates?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(pipelineId)}`, email)
      .then(r => r.json())
      .then(d => { if (d.success && d.gates?.length) setDerivedGates(d.gates); })
      .catch(() => {})
      .finally(() => setLoadingGates(false));
  }, [email, pipelineId]);

  const activeGates: DerivedGate[] = derivedGates || BID_GATES.map(g => ({ id: g.id, question: g.question, detail: g.help }));
  const gateAnswered = activeGates.every(g => typeof gates[g.id] === 'boolean');
  const failedGate = activeGates.find(g => gates[g.id] === false);

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
    : 'text-ink-soft';

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 mb-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-white">① Bid / No-Bid — should you pursue this?</h3>
        <p className="text-xs text-muted mt-0.5">Before the compliance matrix: a few deal-breakers, then a quick fit score. Don&apos;t spend days on a bid you can&apos;t win.</p>
      </div>

      {/* Part 1 — hard gates (opportunity-specific when available) */}
      <div className="space-y-2 mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          {derivedGates ? 'Deal-breakers from THIS solicitation — any “No” means walk away' : 'Deal-breakers — any “No” means walk away'}
        </p>
        {loadingGates && <div className="text-xs text-faint">Reading the solicitation for deal-breakers…</div>}
        {activeGates.map(g => (
          <div key={g.id} className="flex items-start justify-between gap-3 rounded-lg border border-surface bg-ground-deep/40 p-2.5">
            <div className="text-xs">
              <div className="text-slate-200">{g.question}</div>
              {(g.detail || g.help) && <div className="text-faint mt-0.5">{g.detail || g.help}{g.source && <span className="text-slate-600"> · {g.source}</span>}</div>}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => setGates(p => ({ ...p, [g.id]: true }))} className={`rounded px-2.5 py-1 text-xs font-medium ${gates[g.id] === true ? 'bg-emerald-600 text-white' : 'bg-surface text-muted hover:bg-input'}`}>Yes</button>
              <button onClick={() => setGates(p => ({ ...p, [g.id]: false }))} className={`rounded px-2.5 py-1 text-xs font-medium ${gates[g.id] === false ? 'bg-red-600 text-white' : 'bg-surface text-muted hover:bg-input'}`}>No</button>
            </div>
          </div>
        ))}
      </div>

      {/* Gate failure → No-Bid */}
      {failedGate && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
          <div className="inline-flex items-center gap-1.5 font-semibold text-red-300"><Ban className="h-4 w-4 shrink-0" strokeWidth={2} /> No-Bid recommended</div>
          <div className="text-ink-soft mt-1">Deal-breaker: <span className="text-red-200">{failedGate.question.replace(/\?$/, '')}</span> — this disqualifies you regardless of how good the fit is. Don&apos;t spend time on the matrix. (You can still proceed to track it or subcontract.)</div>
          <button onClick={onProceed} className="text-[11px] text-muted hover:text-slate-200 mt-2 underline">Proceed anyway →</button>
        </div>
      )}

      {/* Part 2 — scorecard (only once gates pass) */}
      {gateAnswered && !failedGate && (
        <div className="mt-3">
          {!showScorecard ? (
            <button onClick={() => setShowScorecard(true)} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 px-4 py-2 text-sm font-semibold text-white">
              <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} /> Clears the deal-breakers — score the fit →
            </button>
          ) : (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-faint mb-2">Fit scorecard — rate each 0 (poor) to 10 (excellent)</p>
              <div className="space-y-2">
                {BID_FACTORS.map(f => {
                  const v = ratings[f.id];
                  const tipFor = (val: number) => val >= 7 ? f.positive : val >= 3 ? f.neutral : f.negative;
                  return (
                    <div key={f.id} className="rounded-lg border border-surface bg-ground-deep/40 p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-medium text-slate-200">{f.label}</span>
                        <span className="text-xs font-mono text-muted w-8 text-right">{typeof v === 'number' ? v : '—'}</span>
                      </div>
                      <input type="range" min={0} max={10} value={typeof v === 'number' ? v : 5}
                        onChange={e => setRatings(p => ({ ...p, [f.id]: Number(e.target.value) }))}
                        className="w-full accent-amber-500" />
                      {typeof v === 'number' && <div className="text-[11px] text-faint mt-0.5">{tipFor(v)}</div>}
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
                    <div className="text-xs text-muted mt-0.5">{result.rated} of {BID_FACTORS.length} factors rated</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => saveDecision('skip', result.score)}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${savedDecision === 'skip' ? 'bg-red-600 text-white' : 'bg-surface text-ink-soft hover:bg-input'}`}
                      title="Record a No-Bid on this pursuit"
                    >
                      {savedDecision === 'skip' ? <><Check className="h-4 w-4 shrink-0" strokeWidth={2.5} /> No-Bid recorded</> : 'Record No-Bid'}
                    </button>
                    <button
                      onClick={() => { saveDecision(result.recommendation === 'no-bid' ? 'watch' : result.recommendation, result.score); onProceed(); }}
                      className="rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-semibold text-white"
                    >
                      Build the matrix →
                    </button>
                  </div>
                </div>
                {savedDecision && savedDecision !== 'skip' && (
                  <p className="text-[11px] text-muted mt-2">Decision recorded on this pursuit ({savedDecision}, {result.score}% fit).</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
