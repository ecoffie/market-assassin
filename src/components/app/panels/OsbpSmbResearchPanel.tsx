'use client';

/**
 * Navy OSBP — Find Capable Small Businesses (sourcing at scale).
 *
 * For Ashley Hodge (PSNS&IMF, Deputy of Small Business Programs): scaleable
 * access to small businesses that can actually do the work. SCORE-don't-FILTER:
 * rank winners by relevance — won the exact PSC (what's bought) > related PSC >
 * matching NAICS — so we never drop a capable firm registered under an adjacent
 * NAICS. PSC drives the sort; NAICS widens the net. Exportable.
 * (GOVT-GTM Track 1 · memory: naics_vs_psc_search.)
 */
import { useState, useCallback } from 'react';
import { authedFetch } from '../authHeaders';

interface Props { email: string }

interface Row {
  recipient_uei: string; recipient_name: string;
  total_obligated: number; award_count: number; agency_count: number;
  set_asides: string; won_set_aside: boolean;
  psc_exact: boolean; psc_family: boolean; naics_match: boolean;
  match_score: number; match_reason: string;
}

const PAGE = 50;

export default function OsbpSmbResearchPanel({ email }: Props) {
  const [psc, setPsc] = useState('');
  const [naics, setNaics] = useState('');
  const [maxM, setMaxM] = useState('25'); // $M ceiling — bias to small firms
  const [setAsideOnly, setSetAsideOnly] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('');

  const run = useCallback(async (newOffset: number, append: boolean) => {
    if (!psc.trim() && !naics.trim()) {
      setError('Enter a PSC code (what you\'re buying — best match) and/or a NAICS code.');
      return;
    }
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ email, limit: String(PAGE), offset: String(newOffset) });
      if (psc.trim()) params.set('psc', psc.trim());
      if (naics.trim()) params.set('naics', naics.trim());
      if (maxM) params.set('maxObligated', String((parseFloat(maxM) || 25) * 1_000_000));
      if (setAsideOnly) params.set('setAsideOnly', '1');
      const res = await authedFetch(`/api/app/osbp/smb-search?${params.toString()}`, email);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Search failed');
      const next = (data.results || []) as Row[];
      setRows(prev => append && prev ? [...prev, ...next] : next);
      setTotal(data.total ?? next.length);
      setOffset(newOffset);
      setLastQuery([psc && `PSC ${psc.toUpperCase()}`, naics && `NAICS ${naics}`, `≤$${maxM}M`].filter(Boolean).join(' · '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally { setLoading(false); }
  }, [email, psc, naics, maxM, setAsideOnly]);

  const exportCsv = useCallback(() => {
    if (!rows || !rows.length) return;
    const headers = ['Company', 'UEI', 'Match', 'Match Score', 'Total Federal $', 'Contracts Won', 'Agencies', 'Set-Aside Winner', 'Set-Asides Won'];
    const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([r.recipient_name, r.recipient_uei, r.match_reason, String(r.match_score), String(Math.round(r.total_obligated)), String(r.award_count), String(r.agency_count), r.won_set_aside ? 'Yes' : 'No', r.set_asides].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `capable-small-businesses-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, [rows]);

  const fmt$ = (v: number) => v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${Math.round(v)}`;
  const badge = (r: Row) => r.psc_exact ? 'bg-emerald-500/20 text-emerald-300'
    : r.psc_family ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-700 text-slate-300';

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Find Capable Small Businesses</h1>
        <p className="text-sm text-slate-400 mt-1">
          Source small businesses that have <strong>actually won the work</strong>. Ranked by relevance —
          firms that won the exact product/service (PSC) rank highest, then related work, then the industry (NAICS).
          Nothing real is filtered out. Every row is a proven federal winner; export the list for your market research.
        </p>
      </div>

      {/* Search */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">PSC Code <span className="text-emerald-400/70">(what you\'re buying — best match)</span></label>
            <input value={psc} onChange={e => setPsc(e.target.value)} placeholder="J998 (ship repair)"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-emerald-500 focus:outline-none uppercase" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">NAICS Code <span className="text-slate-600">(widens the net)</span></label>
            <input value={naics} onChange={e => setNaics(e.target.value)} placeholder="336611"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Max federal $ <span className="text-slate-600">(smaller = smaller firms)</span></label>
            <select value={maxM} onChange={e => setMaxM(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none">
              <option value="5">≤ $5M</option>
              <option value="25">≤ $25M</option>
              <option value="100">≤ $100M</option>
              <option value="100000">No limit</option>
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={() => run(0, false)} disabled={loading}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white font-medium rounded-lg transition-colors">
              {loading && offset === 0 ? 'Searching…' : 'Find businesses'}
            </button>
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={setAsideOnly} onChange={e => setSetAsideOnly(e.target.checked)}
            className="rounded border-slate-600 bg-slate-800" />
          Only firms that have won small-business set-aside work
        </label>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">{error}</div>}

      {/* Results */}
      {rows && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              {total.toLocaleString()} Capable Businesses{lastQuery ? ` · ${lastQuery}` : ''}
            </h3>
            {rows.length > 0 && (
              <button onClick={exportCsv}
                className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-sm rounded-lg transition-colors">
                ⬇ Export {rows.length} to CSV
              </button>
            )}
          </div>
          {rows.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">No matches. Try a broader PSC family or NAICS prefix.</div>
          )}
          <div className="divide-y divide-slate-800">
            {rows.map(r => (
              <div key={r.recipient_uei} className="p-4 flex items-start justify-between gap-4 hover:bg-slate-800/40">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">{r.recipient_name}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge(r)}`}>{r.match_reason}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    UEI {r.recipient_uei}
                    {r.set_asides && <span> · set-asides won: {r.set_asides}</span>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-emerald-400">{fmt$(r.total_obligated)}</div>
                  <div className="text-xs text-slate-500">{r.award_count.toLocaleString()} contracts · {r.agency_count} agencies</div>
                  <div className="text-[11px] text-slate-600">relevance {r.match_score}</div>
                </div>
              </div>
            ))}
          </div>
          {rows.length < total && (
            <div className="p-4 border-t border-slate-800 text-center">
              <button onClick={() => run(offset + PAGE, true)} disabled={loading}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-lg transition-colors">
                {loading ? 'Loading…' : `Load more (${(total - rows.length).toLocaleString()} more)`}
              </button>
            </div>
          )}
        </div>
      )}

      {!rows && !loading && (
        <p className="text-sm text-slate-500">Enter the PSC of what you\'re buying (e.g. J998 ship repair) to find every small business that\'s won that work.</p>
      )}
    </div>
  );
}
