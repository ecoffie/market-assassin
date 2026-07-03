'use client';

/**
 * AwardDetailDrawer (#53) — ONE reusable Contract Summary panel, dropped wherever
 * an award/incumbent/recompete appears (Eric: "tie this data into all facets of
 * Mindy"). Self-fetching from the #50 award-detail API; shows the real
 * obligated→ceiling, the parent vehicle (can you bid?), period of performance,
 * and the incumbent detail. Used by Expiring Contracts, task orders, My Pursuits,
 * etc. — consistent look, one place to improve.
 *
 * Pass EITHER an awardId (generated_internal_id) to fetch live, OR a partial
 * `seed` of fields you already have (so the drawer renders instantly and only
 * fetches the gaps).
 */
import { useState, useEffect, useCallback } from 'react';
import { authedFetch } from '@/components/app/authHeaders';
import { formatMindyCurrency } from '@/lib/mindy/formatters';

export interface AwardDetailData {
  obligated: number;
  ceiling: number;
  parentIdvId: string | null;
  parentIdvPiid: string | null;
  popStart: string | null;
  popEnd: string | null;
  popPotentialEnd: string | null;
  recipientName: string;
  recipientCity: string;
  recipientState: string;
  recipientCongressionalDistrict: string;
  naicsDescription: string;
  pscDescription: string;
  fundingAccount: string | null;
  usaSpendingUrl: string;
}

const fmtDate = (s?: string | null) => {
  if (!s) return '?';
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return s; }
};

export default function AwardDetailDrawer({
  awardId,
  piid,
  fallbackUrl,
  email,
  className = '',
}: {
  awardId?: string;                // generated_internal_id (preferred)
  piid?: string;                   // raw display PIID — resolved server-side
  fallbackUrl?: string;            // USASpending link to offer if detail unavailable
  email: string | null;
  className?: string;
}) {
  const [state, setState] = useState<'loading' | 'error' | AwardDetailData>('loading');

  const load = useCallback(async () => {
    const q = awardId ? `id=${encodeURIComponent(awardId)}` : piid ? `piid=${encodeURIComponent(piid)}` : '';
    if (!q) { setState('error'); return; }
    setState('loading');
    try {
      const res = await authedFetch(`/api/app/award-detail?${q}`, email);
      const data = await res.json().catch(() => null);
      setState(data?.success ? (data.detail as AwardDetailData) : 'error');
    } catch {
      setState('error');
    }
  }, [awardId, piid, email]);

  useEffect(() => { load(); }, [load]);

  if (state === 'loading') {
    return <div className={`rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-500 ${className}`}>Loading award detail from USASpending…</div>;
  }
  if (state === 'error') {
    return (
      <div className={`rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-500 ${className}`}>
        Live spend detail isn’t on file for this award number.
        {fallbackUrl && <> <a href={fallbackUrl} target="_blank" rel="noreferrer" className="text-amber-400 hover:text-amber-300" onClick={(e) => e.stopPropagation()}>Look it up on USASpending ↗</a></>}
      </div>
    );
  }
  const d = state;
  return (
    <div className={`rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-4 ${className}`}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Obligated → Ceiling</div>
          <div className="text-sm font-semibold text-emerald-300">{formatMindyCurrency(d.obligated)} → {formatMindyCurrency(d.ceiling)}</div>
          <div className="text-[10px] text-slate-600">the real prize size</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Parent vehicle (IDV)</div>
          <div className="text-sm font-medium text-white truncate">{d.parentIdvPiid || d.parentIdvId || '—'}</div>
          <div className="text-[10px] text-slate-600">{(d.parentIdvId || d.parentIdvPiid) ? 'get on this to compete' : 'standalone award'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Period of performance</div>
          <div className="text-sm font-medium text-white">{fmtDate(d.popStart)} → {fmtDate(d.popPotentialEnd || d.popEnd)}</div>
          <div className="text-[10px] text-slate-600">recompete window</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Incumbent</div>
          <div className="text-sm font-medium text-white truncate">{[d.recipientCity, d.recipientState].filter(Boolean).join(', ') || '—'}</div>
          <div className="text-[10px] text-slate-600">
            {d.recipientCongressionalDistrict ? `CD ${d.recipientState}-${d.recipientCongressionalDistrict}` : ''}
            {d.fundingAccount ? `${d.recipientCongressionalDistrict ? ' · ' : ''}${d.fundingAccount.slice(0, 22)}` : ''}
          </div>
        </div>
      </div>
      {(d.naicsDescription || d.pscDescription) && (
        <div className="mt-2 text-[11px] text-slate-500">
          {d.naicsDescription && <span>NAICS: {d.naicsDescription}</span>}
          {d.naicsDescription && d.pscDescription && <span className="text-slate-700"> · </span>}
          {d.pscDescription && <span>PSC: {d.pscDescription}</span>}
        </div>
      )}
      {d.usaSpendingUrl && (
        <a href={d.usaSpendingUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-amber-400 hover:text-amber-300">Full Contract Summary on USASpending ↗</a>
      )}
    </div>
  );
}
