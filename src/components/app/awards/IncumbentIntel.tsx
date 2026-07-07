'use client';

/**
 * IncumbentIntel (#57) — an on-demand "Who holds this now?" expander for OPEN
 * opportunities (My Pursuits, Today's Intel). Open opps aren't awarded yet, so
 * the useful intel is the likely INCUMBENT/predecessor contract — name, ceiling,
 * expiry, vehicle. Fetched only when the user clicks (no bulk API cost). Reuses
 * the #52 findPredecessorAward engine via /api/app/incumbent.
 */
import { useState, useCallback } from 'react';
import { authedFetch } from '@/components/app/authHeaders';
import { formatMindyCurrency } from '@/lib/mindy/formatters';

interface Incumbent {
  name: string; state: string;
  obligated: number; ceiling: number;
  expires: string | null; vehicle: string | null;
  fundingAccount: string | null; confidence: string;
  usaSpendingUrl: string;
}

const fmtDate = (s?: string | null) => {
  if (!s) return '?';
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }
  catch { return s; }
};

export default function IncumbentIntel({
  naics, agency, title, email, className = '',
}: {
  naics?: string; agency?: string; title?: string;
  email: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'none' | Incumbent>('idle');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const qs = new URLSearchParams();
      if (naics) qs.set('naics', naics);
      if (agency) qs.set('agency', agency);
      if (title) qs.set('title', title);
      const res = await authedFetch(`/api/app/incumbent?${qs.toString()}`, email);
      const data = await res.json();
      if (!data?.success) { setState('error'); return; }
      setState(data.found ? (data.incumbent as Incumbent) : 'none');
    } catch {
      setState('error');
    }
  }, [naics, agency, title, email]);

  const toggle = () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && state === 'idle') load();
  };

  return (
    <div className={className}>
      <button type="button" onClick={toggle} className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
        {open ? '▼ Who holds this now?' : '▸ Who holds this now?'}
      </button>
      {open && (
        <div className="mt-1.5">
          {state === 'loading' && <div className="text-[11px] text-slate-500">Looking up the likely incumbent on USASpending…</div>}
          {state === 'error' && <div className="text-[11px] text-slate-500">Couldn’t look up the incumbent right now.</div>}
          {state === 'none' && <div className="text-[11px] text-slate-500">No clear incumbent found — this may be new work, or the predecessor isn’t in recent USASpending data.</div>}
          {typeof state === 'object' && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-amber-200">{state.name}</span>
                {state.state && <span className="text-slate-500">({state.state})</span>}
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${state.confidence === 'high' ? 'bg-emerald-500/20 text-emerald-300' : state.confidence === 'medium' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-400'}`}>
                  {state.confidence} match
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-slate-300">
                <div><span className="text-slate-500">Ceiling: </span>{formatMindyCurrency(state.ceiling)}</div>
                {state.expires && <div><span className="text-slate-500">Expires: </span>{fmtDate(state.expires)}</div>}
                {state.vehicle && <div className="truncate"><span className="text-slate-500">Vehicle: </span>{state.vehicle}</div>}
                {state.fundingAccount && <div className="truncate"><span className="text-slate-500">Funded: </span>{state.fundingAccount.slice(0, 18)}</div>}
              </div>
              <div className="mt-1 text-[10px] text-slate-600">Likely incumbent — best match by NAICS + agency. <a href={state.usaSpendingUrl} target="_blank" rel="noreferrer" className="text-amber-400">Verify ↗</a></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
