'use client';

import { useState } from 'react';
import { authedFetch } from '../authHeaders';

/**
 * MarketCoverageBanner (#59) — teaches the user how big their market really is and
 * how agency rankings follow what was BOUGHT (keyword/PSC), not vendor NAICS.
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
  top_psc_pct?: number;
  ranking_mode?: 'keyword' | 'keyword_psc' | 'psc' | 'naics';
  ranking_label?: string;
  uses_psc_ranking?: boolean;
  keywords?: string[];           // search terms to add to alerts
}

const fmt$ = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${Math.round(n).toLocaleString()}`;

export default function MarketCoverageBanner({ coverage, email }: { coverage: MarketCoverage | null; email?: string | null }) {
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  if (!coverage || !coverage.total_market) return null;
  const hiddenPct = 100 - coverage.top_code_pct;
  const keywords = coverage.keywords || [];
  const rankingLabel = coverage.ranking_label || `keyword "${coverage.keyword}"`;

  async function addKeywords() {
    if (!email || keywords.length === 0) return;
    setAdding(true);
    try {
      await authedFetch('/api/app/keywords/add', email, {
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

      {/* Ranking teaching moment — PSC/keyword vs NAICS */}
      <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/30 px-3 py-2.5 mb-3">
        <div className="text-[10px] uppercase tracking-wider text-emerald-400/80 mb-1">How agency rankings work</div>
        <p className="text-xs text-slate-200 leading-relaxed">
          Federal buyers categorize <b className="text-white">what they bought</b> (PSC / award title keywords) — not
          who sold it (NAICS vendor industry). Your rankings follow{' '}
          <b className="text-emerald-300">{rankingLabel}</b>.
          {coverage.uses_psc_ranking && coverage.top_psc_pct
            ? ` Top product code captures ${coverage.top_psc_pct}% of keyword spend.`
            : ' NAICS codes below are for set-aside eligibility only — not ranking.'}
        </p>
      </div>

      <div className="text-xs text-slate-400 mb-1.5">
        Set-aside eligibility tracked across <b className="text-white">{coverage.coverage_pct}%</b> of this market via{' '}
        <b className="text-white">{coverage.codes_used} of {coverage.naics_count}</b> vendor NAICS codes
      </div>
      <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden mb-3">
        <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300" style={{ width: `${coverage.coverage_pct}%` }} />
      </div>

      <div className={`grid grid-cols-1 gap-3 text-xs ${keywords.length > 0 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div className="rounded-lg bg-slate-950/40 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">⚠️ Vendor NAICS (not for ranking)</div>
          <div className="text-slate-200">Top &ldquo;obvious&rdquo; code = only <b className="text-amber-400">{coverage.top_code_pct}%</b></div>
          <div className="text-slate-600 mt-0.5">NAICS tells you who <em>sold</em> — miss <b className="text-red-400">{hiddenPct}%</b> if you rank by it</div>
        </div>
        {coverage.top_psc && (
          <div className="rounded-lg bg-slate-950/40 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">💡 What&rsquo;s actually bought (PSC)</div>
            <div className="text-slate-200">{coverage.top_psc.code} <b className="text-emerald-300">{coverage.top_psc.name}</b></div>
            <div className="text-slate-600 mt-0.5">
              {coverage.uses_psc_ranking
                ? `Used to tighten rankings (${coverage.top_psc_pct || 0}% of keyword spend)`
                : 'PSC = the product itself — too broad here to rank by PSC alone'}
            </div>
          </div>
        )}
        {keywords.length > 0 && (
          <div className={`rounded-lg bg-slate-950/40 p-2.5 ${!coverage.top_psc ? 'sm:col-span-2 lg:col-span-1' : ''}`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">🔑 Search keywords for this market</div>
              {email && (
                added ? (
                  <span className="text-[11px] font-medium text-emerald-400">✓ Added</span>
                ) : (
                  <button
                    onClick={addKeywords}
                    disabled={adding}
                    className="text-[11px] font-medium text-purple-300 hover:text-purple-200 disabled:opacity-60 shrink-0"
                  >
                    {adding ? 'Adding…' : '+ Add all'}
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
      </div>

      <div className="text-[11px] text-slate-500 mt-2.5">
        💬 <b className="text-slate-400">Lesson:</b> &ldquo;{coverage.keyword}&rdquo; appears in{' '}
        <b className="text-slate-400">{coverage.naics_count} vendor NAICS</b>
        {coverage.psc_count ? ` and ${coverage.psc_count} PSC codes` : ''} — Mindy ranks agencies by{' '}
        <b className="text-slate-400">{coverage.uses_psc_ranking ? 'keyword + top PSC' : 'keyword'}</b>, not NAICS.
      </div>
    </div>
  );
}
