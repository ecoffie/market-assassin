'use client';

/**
 * Market Dossier — the "one-shot" surface (Eric, Jun 2026).
 *
 * The user said what they do once; Mindy already ran the searches across 28 sources
 * and assembled their market here: open opportunities + expiring recompetes, matched
 * to their profile, with one-click actions. No searching, no tool-hopping — the
 * finished output. Drives the conversion narrative: "you just tell it what you do."
 */

import { useCallback, useEffect, useState } from 'react';
import type { AppPanel } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import MarketDataMap from '../market/MarketDataMap';

interface DossierOpp {
  id: string;
  kind: 'open' | 'recompete';
  title: string;
  agency: string;
  naics: string;
  value: number;
  deadline: string | null;
  setAside: string | null;
  url: string;
  incumbent?: string | null;
}

interface DossierData {
  success: boolean;
  profile: { naicsCodes: string[]; keywords: string[]; businessType: string; states: string[] };
  counts: { open: number; recompete: number };
  opportunities: DossierOpp[];
  generatedAt: string;
  message?: string;
}

function money(n: number): string {
  if (!n || n <= 0) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

function daysLeft(deadline: string | null): string {
  if (!deadline) return '';
  const d = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(d)) return '';
  const days = Math.ceil(d / 86400000);
  if (days < 0) return 'closed';
  if (days === 0) return 'today';
  if (days <= 14) return `${days}d left`;
  return new Date(deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function MarketDossierPanel({ email, onNavigate }: { email: string | null; onNavigate?: (p: AppPanel) => void }) {
  const [data, setData] = useState<DossierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true); setError(false);
    try {
      const res = await fetch(`/api/app/market-dossier?email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) });
      const json = await res.json();
      if (json?.success) setData(json); else setError(true);
    } catch { setError(true); }
    setLoading(false);
  }, [email]);

  useEffect(() => { load(); }, [load]);

  const naics = data?.profile?.naicsCodes?.join(',') || '';
  const open = (data?.opportunities || []).filter((o) => o.kind === 'open');
  const recompetes = (data?.opportunities || []).filter((o) => o.kind === 'recompete');

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Your Market Dossier</h1>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
          🛰️ Mindy ran 28 sources across 300+ agencies — your whole market, assembled.
          {data?.generatedAt && <span className="text-slate-600">· updated {timeAgo(data.generatedAt)}</span>}
        </p>
      </div>

      {/* Market hero (reuses the aggregator) */}
      {naics && <MarketDataMap naics={naics} email={email || undefined} />}

      {loading && <div className="text-sm text-slate-500">Assembling your market…</div>}
      {error && <div className="text-sm text-red-400">Couldn&apos;t load your dossier. <button onClick={load} className="underline">Retry</button></div>}
      {data && !loading && data.opportunities.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-sm text-slate-400">
          {data.message || 'No opportunities matched your profile yet. Add your codes/keywords in Settings.'}
        </div>
      )}

      {open.length > 0 && (
        <Section title="Open now — biddable" count={open.length}>
          {open.map((o) => <OppCard key={o.id} opp={o} onNavigate={onNavigate} />)}
        </Section>
      )}
      {recompetes.length > 0 && (
        <Section title="Coming up for recompete (18 mo)" count={recompetes.length}>
          {recompetes.map((o) => <OppCard key={o.id} opp={o} onNavigate={onNavigate} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">{title} <span className="text-slate-600">· {count}</span></h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function OppCard({ opp, onNavigate }: { opp: DossierOpp; onNavigate?: (p: AppPanel) => void }) {
  const dl = daysLeft(opp.deadline);
  const urgent = dl.endsWith('d left') || dl === 'today';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition-colors hover:border-emerald-500/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={opp.url} target="_blank" rel="noreferrer" className="font-semibold text-white hover:text-emerald-300">{opp.title}</a>
          <div className="mt-0.5 text-xs text-slate-500">
            {opp.agency || 'Federal'}{opp.naics ? ` · NAICS ${opp.naics}` : ''}{opp.incumbent ? ` · incumbent: ${opp.incumbent}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-emerald-300">{money(opp.value)}</div>
          {dl && <div className={`text-[11px] ${urgent ? 'text-amber-300 font-semibold' : 'text-slate-500'}`}>{opp.kind === 'recompete' ? `expires ${dl}` : dl}</div>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {opp.setAside && <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">🎯 {opp.setAside}</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={() => onNavigate?.('proposals')} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500">{opp.kind === 'recompete' ? 'Draft LOI' : 'Draft response'}</button>
          <button onClick={() => onNavigate?.('pipeline')} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800">Track</button>
        </div>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
