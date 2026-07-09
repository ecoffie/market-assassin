'use client';

/**
 * Market Data Map — the onboarding conversion moment (Eric, Jun 2026).
 *
 * Right after a user says what they do, show the BREADTH of what Mindy knows about
 * THEIR market: market size $, and the count + $ of forecasts, recompetes, grants,
 * and competitors. Per the decision: every count + $ is FREE (proof the treasure
 * exists); the DETAIL behind each tile is locked behind Pro. Powered by the
 * /api/market-overview aggregator (proprietary data x public APIs, one market).
 */

import { useEffect, useState } from 'react';

interface Tile {
  key: string;
  label: string;
  icon: string;
  count: number;
  value: number;
  locked: boolean;
  detailPanel: string;
  note?: string;
}

interface MarketOverview {
  success: boolean;
  tier: 'free' | 'pro' | 'team' | 'none';
  market: { keyword: string | null; totalMarket: number; naicsCount: number; codes: string[]; topPsc: { code: string; name: string } | null };
  tiles: Tile[];
}

export interface MarketDataMapProps {
  keyword?: string;
  naics?: string;       // comma list
  state?: string;       // comma list
  email?: string;
  /** Where the locked-chip CTA points (default the pricing/upgrade page). */
  upgradeHref?: string;
  className?: string;
  /** Pre-fetched overview (e.g. onboarding already loaded it) → skip the fetch. */
  initialData?: MarketOverview | null;
}

function money(n: number): string {
  if (!n || n <= 0) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

export default function MarketDataMap({ keyword, naics, state, email, upgradeHref = '/pricing', className, initialData }: MarketDataMapProps) {
  const [data, setData] = useState<MarketOverview | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Parent already fetched it (onboarding) → use it, skip the round-trip.
    if (initialData) { setData(initialData); setLoading(false); setError(false); return; }
    if (!keyword && !naics) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const qs = new URLSearchParams();
    if (keyword) qs.set('keyword', keyword);
    if (naics) qs.set('naics', naics);
    if (state) qs.set('state', state);
    if (email) qs.set('email', email);
    fetch(`/api/market-overview?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { if (d?.success) setData(d); else setError(true); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [keyword, naics, state, email, initialData]);

  if (loading) {
    return (
      <div className={`rounded-2xl border border-surface bg-ground/60 p-6 ${className || ''}`}>
        <div className="h-5 w-48 animate-pulse rounded bg-surface" />
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface/60" />)}
        </div>
      </div>
    );
  }
  // Graceful fallback — NEVER silently vanish (a demo killer). If the live fetch
  // failed, keep a slim placeholder card instead of returning null.
  if (error || !data) {
    return (
      <div className={`rounded-2xl border border-surface bg-ground/60 p-5 text-center ${className || ''}`}>
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Your federal market</p>
        <p className="mt-1 text-sm text-muted">Mapping forecasts, recompetes &amp; grants for your codes…</p>
      </div>
    );
  }

  const isPaid = data.tier === 'pro' || data.tier === 'team';
  const m = data.market;

  return (
    <div className={`rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 to-slate-900 p-6 ${className || ''}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Your federal market</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">{money(m.totalMarket)}</span>
            <span className="text-sm text-muted">/ yr · {m.naicsCount} NAICS · {m.codes.join(', ')}{m.topPsc ? ` · PSC ${m.topPsc.code}` : ''}</span>
          </div>
        </div>
        {!isPaid && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200">
            🔒 Counts free · open the details with Pro
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.tiles.map((t) => (
          <TileCard key={t.key} tile={t} isPaid={isPaid} upgradeHref={upgradeHref} />
        ))}
      </div>

      {!isPaid && (
        <a
          href={upgradeHref}
          className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
        >
          Unlock your full market with Pro →
        </a>
      )}
    </div>
  );
}

function TileCard({ tile, isPaid, upgradeHref }: { tile: Tile; isPaid: boolean; upgradeHref: string }) {
  const showValue = tile.value > 0;
  const inner = (
    <div className="relative h-full rounded-xl border border-surface bg-ground/70 p-4 transition-colors hover:border-emerald-500/40">
      <div className="text-lg">{tile.icon}</div>
      <div className="mt-1 text-2xl font-bold text-white">{tile.count.toLocaleString()}</div>
      <div className="text-[11px] leading-tight text-muted">{tile.label}</div>
      {showValue && <div className="mt-1 text-xs font-semibold text-emerald-300">{money(tile.value)}{tile.note ? ` ${tile.note}` : ''}</div>}
      {!isPaid && tile.locked && (
        <span className="absolute right-2 top-2 text-xs text-amber-300" title="Open the list with Pro">🔒</span>
      )}
    </div>
  );
  // Locked + free user → the whole tile routes to upgrade; paid → routes to the panel.
  const href = isPaid ? `/app?panel=${tile.detailPanel}` : upgradeHref;
  return <a href={href} className="block">{inner}</a>;
}
