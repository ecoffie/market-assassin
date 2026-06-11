'use client';

import { useState } from 'react';

/**
 * MarketCoverageBanner (#59) — teaches the user how big their market really is and
 * how many codes make it up. Eric: "let users know how many codes make up the
 * total market — it's a great lesson." Renders the keyword_coverage payload from
 * /api/app/target-market-research:
 *   - total market $ + coverage bar (% tracked, codes used / total)
 *   - the "obvious NAICS = only X%" warning (the 72%-hidden lesson)
 *   - the PSC view ("what was actually bought" — the GovCon-expert insight:
 *     PSC = the product, NAICS = the vendor's industry)
 */

export interface MarketCoverage {
  keyword: string;
  total_market: number;
  naics_count: number;
  codes_used: number;
  coverage_pct: number;          // e.g. 91
  top_code_pct: number;          // e.g. 28
  psc_count?: number;
  top_psc?: { code: string; name: string } | null;
  keywords?: string[];           // search terms to add to alerts
}

const fmt$ = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${Math.round(n).toLocaleString()}`;

export default function MarketCoverageBanner({ coverage, email }: { coverage: MarketCoverage | null; email?: string | null }) {
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  if (!coverage || !coverage.total_market) return null;
  const hiddenPct = 100 - coverage.top_code_pct;
  const keywords = coverage.keywords || [];

  async function addKeywords() {
    if (!email || keywords.length === 0) return;
    setAdding(true);
    try {
      await fetch('/api/app/keywords/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, keywords }),
      });
      setAdded(true);
    } catch { /* non-fatal */ }
    finally { setAdding(false); }
  }
  return (
    <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-blue-900/15 to-purple-600/10 p-4 mb-4">
      <div className="flex items-baseline justify-between mb-2.5">
        <div className="text-sm font-semibold text-white">📊 Market coverage for &ldquo;{coverage.keyword}&rdquo;</div>
        <div className="text-sm font-semibold text-emerald-300">{fmt$(coverage.total_market)} market</div>
      </div>

      <div className="text-xs text-slate-400 mb-1.5">
        Mindy is tracking <b className="text-white">{coverage.coverage_pct}%</b> of this market across{' '}
        <b className="text-white">{coverage.codes_used} of {coverage.naics_count}</b> buying NAICS codes
      </div>
      <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden mb-3">
        <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300" style={{ width: `${coverage.coverage_pct}%` }} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-slate-950/40 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">⚠️ The single &ldquo;obvious&rdquo; NAICS</div>
          <div className="text-slate-200">= only <b className="text-amber-400">{coverage.top_code_pct}%</b> of the market</div>
          <div className="text-slate-600 mt-0.5">Search just that → miss <b className="text-red-400">{hiddenPct}%</b> of the money</div>
        </div>
        {coverage.top_psc && (
          <div className="rounded-lg bg-slate-950/40 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">💡 What&rsquo;s actually bought (PSC)</div>
            <div className="text-slate-200">{coverage.top_psc.code} <b className="text-emerald-300">{coverage.top_psc.name}</b></div>
            <div className="text-slate-600 mt-0.5">PSC = the product itself, not the vendor&rsquo;s industry</div>
          </div>
        )}
      </div>

      {/* SEARCH KEYWORDS — the terms to add to alerts so you catch body-buried opps. */}
      {keywords.length > 0 && (
        <div className="rounded-lg bg-slate-950/40 p-2.5 mt-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">🔑 Search keywords for this market</div>
            {email && (
              added ? (
                <span className="text-[11px] font-medium text-emerald-400">✓ Added to your alerts</span>
              ) : (
                <button
                  onClick={addKeywords}
                  disabled={adding}
                  className="text-[11px] font-medium text-purple-300 hover:text-purple-200 disabled:opacity-60"
                >
                  {adding ? 'Adding…' : '+ Add all to my alerts'}
                </button>
              )
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((kw) => (
              <span key={kw} className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">{kw}</span>
            ))}
          </div>
        </div>
      )}

      <div className="text-[11px] text-slate-500 mt-2.5">
        💬 <b className="text-slate-400">Lesson:</b> &ldquo;{coverage.keyword}&rdquo; is bought under <b className="text-slate-400">{coverage.naics_count} NAICS codes</b>
        {coverage.psc_count ? ` and ${coverage.psc_count} PSC codes` : ''} — Mindy searches by keyword so you never miss the {hiddenPct}% hiding in non-obvious codes.
      </div>
    </div>
  );
}
