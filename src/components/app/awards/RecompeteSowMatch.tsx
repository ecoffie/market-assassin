'use client';

/**
 * RecompeteSowMatch — lazy "Find incumbent SOW" for Expiring Contracts (#67).
 * Calls /api/app/recompete-sow on demand; labels matches honestly.
 */
import { useState, useCallback } from 'react';
import { authedFetch } from '@/components/app/authHeaders';

interface SowMatch {
  title: string;
  sowDocType: string | null;
  sowFilename: string | null;
  scorePct: number;
  snippet: string;
  samUrl: string | null;
  solicitationNumber: string | null;
  label: string;
}

interface MatchResponse {
  success: boolean;
  verdict: 'confident_match' | 'no_confident_match';
  reason?: string;
  match: SowMatch | null;
  possible?: SowMatch;
  error?: string;
}

const DOC_BADGE: Record<string, string> = {
  sow: 'SOW',
  pws: 'PWS',
  soo: 'SOO',
  combined: 'Combined',
  specs: 'Specs',
};

export default function RecompeteSowMatch({
  piid,
  naics,
  agency,
  description,
  email,
  className = '',
}: {
  piid?: string;
  naics?: string;
  agency?: string;
  description?: string;
  email: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | MatchResponse>('idle');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const qs = new URLSearchParams();
      if (piid) qs.set('piid', piid);
      if (naics) qs.set('naics', naics);
      if (agency) qs.set('agency', agency);
      if (description) qs.set('description', description);
      const res = await authedFetch(`/api/app/recompete-sow?${qs.toString()}`, email);
      const data = (await res.json()) as MatchResponse;
      if (!data?.success) {
        setState('error');
        return;
      }
      setState(data);
    } catch {
      setState('error');
    }
  }, [piid, naics, agency, description, email]);

  const toggle = () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && state === 'idle') void load();
  };

  const renderMatch = (m: SowMatch, confident: boolean) => (
    <div className={`rounded-lg border p-3 text-xs ${confident ? 'border-emerald-500/30 bg-emerald-500/[0.04]' : 'border-slate-700 bg-slate-900/50'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white">{m.title || 'Recovered scope document'}</span>
        {m.sowDocType && (
          <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">
            {DOC_BADGE[m.sowDocType] || m.sowDocType.toUpperCase()}
          </span>
        )}
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${confident ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
          {m.scorePct}% similar
        </span>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">{m.label}</p>
      {m.sowFilename && <p className="mt-1 text-slate-400">📄 {m.sowFilename}</p>}
      {m.snippet && <p className="mt-2 leading-5 text-slate-300">{m.snippet}</p>}
      <div className="mt-2 flex flex-wrap gap-3">
        {m.samUrl && (
          <a href={m.samUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:text-amber-300">
            View source notice →
          </a>
        )}
        {m.solicitationNumber && (
          <span className="text-slate-500">Sol# {m.solicitationNumber}</span>
        )}
      </div>
    </div>
  );

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
      >
        {open ? '▼ Find incumbent SOW' : '▸ Find incumbent SOW'}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {state === 'loading' && (
            <div className="text-[11px] text-slate-500">Searching recovered SOW/PWS documents by semantic similarity…</div>
          )}
          {state === 'error' && (
            <div className="text-[11px] text-slate-500">Couldn&apos;t run the SOW match right now.</div>
          )}
          {typeof state === 'object' && state.verdict === 'confident_match' && state.match && (
            renderMatch(state.match, true)
          )}
          {typeof state === 'object' && state.verdict === 'no_confident_match' && (
            <>
              {state.possible ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-amber-400/90">
                    No confident match — showing best candidate for review (semantic similarity only).
                  </p>
                  {renderMatch(state.possible, false)}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">
                  No confident SOW match found for this recompete
                  {state.reason === 'no_candidates'
                    ? ' (no recovered scope docs in this agency/NAICS slice yet).'
                    : '. Best candidate scored below our confidence bar — not shown to avoid a wrong link.'}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
