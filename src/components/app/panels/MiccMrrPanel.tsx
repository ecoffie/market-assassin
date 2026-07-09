'use client';

/**
 * U.S. Army Contracting Command – Orlando — Market Research Report generator.
 *
 * Enter PSC + NAICS + requirement title → Mindy fills the DATA sections of the
 * official Army MAY-2026 MRR (procurement history, capable suppliers, market
 * intelligence, set-aside recommendation) from real USASpending data, brackets
 * the CO's judgment sections, and exports the .docx. Turns days of manual
 * research into a first draft. (ACC-ORLANDO-MRR-SPEC.md)
 */
import { useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { authedFetch } from '../authHeaders';

interface Props { email: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mrr = any;

export default function MiccMrrPanel({ email }: Props) {
  const [psc, setPsc] = useState('');
  const [naics, setNaics] = useState('');
  const [title, setTitle] = useState('');
  const [keyword, setKeyword] = useState('');
  const [mrr, setMrr] = useState<Mrr | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = useCallback(() => {
    const p = new URLSearchParams({ email });
    if (psc.trim()) p.set('psc', psc.trim());
    if (naics.trim()) p.set('naics', naics.trim());
    if (title.trim()) p.set('title', title.trim());
    if (keyword.trim()) p.set('keyword', keyword.trim());
    return p;
  }, [email, psc, naics, title, keyword]);

  const generate = useCallback(async () => {
    if (!psc.trim() && !naics.trim()) { setError('Enter a PSC and/or NAICS code.'); return; }
    setLoading(true); setError(null);
    try {
      const res = await authedFetch(`/api/app/micc/mrr?${params().toString()}`, email);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      setMrr(data.mrr);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, [email, psc, naics, params]);

  const downloadDocx = useCallback(async () => {
    try {
      const p = params(); p.set('format', 'docx');
      const res = await authedFetch(`/api/app/micc/mrr?${p.toString()}`, email);
      if (!res.ok) throw new Error('Could not generate .docx');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `MRR-${(title || psc || naics || 'draft').replace(/[^a-z0-9-_.]/gi, '_')}.docx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Download failed'); }
  }, [email, params, title, psc, naics]);

  const $ = (v: number) => v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v).toLocaleString()}`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Market Research Report</h1>
        <p className="text-sm text-muted mt-1">
          Auto-draft the data sections of the official Army MRR (MAY 2026 template) — procurement
          history, capable suppliers, market intelligence, and the set-aside recommendation — from
          real federal award data. Export to Word, then complete the IGE and determinations.
        </p>
      </div>

      <div className="bg-ground border border-surface rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-faint mb-1">Requirement title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Engineering & Technical Support at Fort X"
              className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-faint mb-1">Keyword <span className="text-slate-600">(optional — context)</span></label>
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="ship repair"
              className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-faint mb-1">PSC Code <span className="text-emerald-400/70">(what you\'re buying)</span></label>
            <input value={psc} onChange={e => setPsc(e.target.value)} placeholder="R425"
              className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-emerald-500 focus:outline-none uppercase" />
          </div>
          <div>
            <label className="block text-xs text-faint mb-1">NAICS Code</label>
            <input value={naics} onChange={e => setNaics(e.target.value)} placeholder="541330"
              className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-blue-500 focus:outline-none" />
          </div>
        </div>
        <button onClick={generate} disabled={loading}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-input text-white font-medium rounded-lg transition-colors">
          {loading ? 'Researching…' : 'Generate MRR draft'}
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">{error}</div>}

      {mrr && (
        <>
          <div className="bg-ground border border-emerald-500/30 rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-white">MRR draft ready</h3>
              <p className="text-xs text-faint mt-1">Data sections auto-filled from USASpending. Download the official Army template and complete the bracketed sections.</p>
            </div>
            <button onClick={downloadDocx} className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg"><Download className="h-4 w-4 shrink-0" strokeWidth={2} /> Download MRR (.docx)</button>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat n={mrr.marketIntel.supplierCount.toLocaleString()} label="Capable suppliers" sub={`competition: ${mrr.marketIntel.competition}`} />
            <Stat n={mrr.marketIntel.smallBusinessCount.toLocaleString()} label="Small businesses" sub="≤ $25M federal" />
            <Stat n={mrr.marketIntel.setAsideWinners.toLocaleString()} label="Set-aside winners" sub="proven small-biz" />
            <Stat n={mrr.procurementHistory.length.toLocaleString()} label="Prior contracts" sub="procurement history" />
          </div>

          {/* §5 market size — anchored to the PSC/NAICS (precise to the requirement) */}
          {mrr.taxonomy.marketTotal != null && (
            <div className="bg-ground border border-surface rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-emerald-300 mb-1">§5 Federal market size</p>
              <p className="text-lg font-semibold text-white">
                {$(mrr.taxonomy.marketTotal)}
                {mrr.taxonomy.psc ? <span className="text-muted text-sm font-normal"> · PSC {mrr.taxonomy.psc}</span> : null}
              </p>
              {mrr.taxonomy.topPsc && <p className="text-xs text-faint mt-1">Most-purchased: {mrr.taxonomy.topPsc} · source: USASpending</p>}
            </div>
          )}

          {/* §12 recommendation */}
          <div className="bg-ground border border-surface rounded-xl p-5">
            <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">§12 Recommended approach</p>
            <p className="text-lg font-semibold text-white">{mrr.smallBizRecommendation.recommendedSetAside}</p>
            <p className="text-sm text-muted mt-1">{mrr.smallBizRecommendation.rationale}</p>
          </div>

          {/* §9 procurement history preview */}
          {mrr.procurementHistory.length > 0 && (
            <div className="bg-ground border border-surface rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-surface text-sm font-semibold text-muted uppercase tracking-wider">§9 Procurement History (top {Math.min(mrr.procurementHistory.length, 8)})</div>
              <div className="divide-y divide-slate-800">
                {mrr.procurementHistory.slice(0, 8).map((r: Mrr) => (
                  <div key={r.recipient_uei} className="p-3 flex justify-between gap-3 text-sm">
                    <span className="text-white truncate">{r.recipient_name}</span>
                    <span className="text-faint shrink-0">{r.contract_type} · {$(r.total_obligated)} · {r.award_count}aw</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What the CO must complete — honesty */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
            <p className="text-sm font-semibold text-amber-200 mb-2">You complete these sections (Mindy doesn\'t guess your judgment):</p>
            <ul className="text-xs text-amber-200/90 space-y-1 list-disc pl-5">
              {mrr.coMustComplete.map((s: string, i: number) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ n, label, sub }: { n: string; label: string; sub: string }) {
  return (
    <div className="bg-ground border border-surface rounded-xl p-4">
      <div className="text-2xl font-bold text-white">{n}</div>
      <div className="text-xs text-faint">{label}</div>
      <div className="text-[11px] text-slate-600 mt-1">{sub}</div>
    </div>
  );
}
