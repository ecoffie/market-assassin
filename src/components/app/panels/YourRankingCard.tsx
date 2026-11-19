'use client';

/**
 * "Your ranking" on For you (owner, 2026-11-19): where the company's UEI stands among every federal
 * contractor by lifetime dollars obligated, overall and in its state. Data: /api/app/my-ranking.
 * Every state says what it is — no UEI, not in the data, unavailable — and never shows a fake rank.
 */
import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { topPercent } from '@/lib/ranking/top-percent';

type Ranking = {
  uei: string; name: string | null; state: string | null; totalObligated: number;
  rankAll: number; countAll: number; rankState: number | null; countState: number | null;
  since: string | null; asOf: string | null;
};
export type RankingResponse =
  | { status: 'ok'; uei: string; ranking: Ranking }
  | { status: 'no_uei' }
  | { status: 'not_found'; uei?: string }
  | { status: 'not_ranked'; uei?: string; totalObligated?: number }
  | { status: 'unavailable'; uei?: string };

const n = (v: number) => v.toLocaleString('en-US');
export function money(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}
const year = (iso: string | null) => (iso ? iso.slice(0, 4) : null);
const monthYear = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export function RankingView({ data, onAddUei }: { data: RankingResponse | null; onAddUei?: () => void }) {
  const shell = 'rounded-xl border border-surface bg-ground p-4 md:p-5 mb-4';
  if (!data) {
    return <section aria-label="Your ranking" className={shell}><p className="text-sm text-muted">Working out your ranking…</p></section>;
  }
  if (data.status === 'no_uei') {
    return (
      <section aria-label="Your ranking" className={`${shell} flex flex-wrap items-center justify-between gap-3`} data-testid="ranking-no-uei">
        <div>
          <h2 className="text-base font-semibold text-white">See where you rank</h2>
          <p className="text-sm text-muted mt-0.5">Add your UEI in My Vault and Mindy ranks your company against every federal contractor.</p>
        </div>
        {onAddUei && <button type="button" onClick={onAddUei} className="h-10 px-4 rounded-lg bg-[#006aff] hover:bg-[#0057d1] text-white text-sm font-semibold">Add my UEI</button>}
      </section>
    );
  }
  if (data.status !== 'ok') {
    const msg = data.status === 'unavailable'
      ? 'Your ranking is unavailable right now. Try again later.'
      : `We don't see federal contract dollars for UEI ${data.uei ?? ''} in our awards data yet. New awards are added as the data refreshes.`;
    return <section aria-label="Your ranking" className={shell} data-testid={`ranking-${data.status}`}><h2 className="text-base font-semibold text-white">Your ranking</h2><p className="text-sm text-muted mt-1">{msg}</p></section>;
  }
  const r = data.ranking;
  const since = year(r.since);
  const asOf = monthYear(r.asOf);
  return (
    <section aria-label="Your ranking" className={shell} data-testid="ranking-ok">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="h-5 w-5 text-amber-500" aria-hidden />
        <h2 className="text-base font-semibold text-white">Your ranking</h2>
        <span className="text-xs text-muted truncate">{r.name || `UEI ${r.uei}`}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg bg-surface/60 p-3">
          <p className="text-xs text-muted">All federal contractors</p>
          <p className="text-2xl font-bold text-white tabular-nums">#{n(r.rankAll)}</p>
          <p className="text-xs text-muted">of {n(r.countAll)} · {topPercent(r.rankAll, r.countAll)}</p>
        </div>
        {r.state && r.rankState != null && r.countState != null ? (
          <div className="rounded-lg bg-surface/60 p-3">
            <p className="text-xs text-muted">In {r.state}</p>
            <p className="text-2xl font-bold text-white tabular-nums">#{n(r.rankState)}</p>
            <p className="text-xs text-muted">of {n(r.countState)} · {topPercent(r.rankState, r.countState)}</p>
          </div>
        ) : null}
        <div className="rounded-lg bg-surface/60 p-3">
          <p className="text-xs text-muted">Lifetime awarded</p>
          <p className="text-2xl font-bold text-white tabular-nums">{money(r.totalObligated)}</p>
          <p className="text-xs text-muted">{since ? `since ${since}` : 'all years we hold'}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        Ranked by federal contract dollars obligated to UEI {r.uei}{asOf ? `, data through ${asOf}` : ''}. Each UEI is ranked on its own.
      </p>
    </section>
  );
}

export default function YourRankingCard({ email, getAuthHeaders, onAddUei }: {
  email: string;
  getAuthHeaders: (init?: HeadersInit) => HeadersInit;
  onAddUei?: () => void;
}) {
  const [data, setData] = useState<RankingResponse | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/app/my-ranking?email=${encodeURIComponent(email)}`, { headers: getAuthHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) setData(d && d.status ? d as RankingResponse : { status: 'unavailable' }); })
      .catch(() => { if (live) setData({ status: 'unavailable' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per account
  }, [email]);
  return <RankingView data={data} onAddUei={onAddUei} />;
}
