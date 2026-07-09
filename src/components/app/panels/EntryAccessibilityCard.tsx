'use client';

/**
 * EntryAccessibilityCard — SAT / Entry Accessibility table for Market
 * Research. Replaces the deleted "Start Here" 3-card row (2026-05-25).
 * Shown on Market Map (default) and Reports view; also used in the
 * Market Analytics lens modal. Ports EntryPointsTab from MA ReportsDisplay.
 *
 * Data source: reportData.simplifiedAcquisition (same shape MA uses).
 * Falls back to an honest empty-state when the award sample didn't
 * surface small contracts (e.g. construction NAICS that skew to mega
 * contracts via USAspending's FY-broken pagination — task #32).
 */
import { useState } from 'react';
import type { SimplifiedAcquisitionReport } from '@/types/federal-market-assassin';

type SortCol = 'score' | 'satPercent' | 'satContracts' | 'avgAward' | 'micro' | 'agency';

interface EntryAccessibilityCardProps {
  data?: SimplifiedAcquisitionReport;
}

export function EntryAccessibilityCard({ data }: EntryAccessibilityCardProps) {
  const [sortCol, setSortCol] = useState<SortCol>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  if (!data || data.agencies.length === 0) {
    return (
      <section className="rounded-xl border border-surface bg-ground p-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-amber-400">Entry Accessibility</h3>
          <span className="text-xs text-faint">
            SAT = Simplified Acquisition Threshold ($350K)
          </span>
        </div>
        <p className="text-sm text-muted">
          No simplified-acquisition data surfaced in this market.
        </p>
        <p className="mt-2 text-xs text-faint">
          SAT contracts are computed from individual award amounts. Some
          industries (heavy construction, large IT modernization) skew
          toward mega-contracts in the sample window, which can hide
          smaller SAT awards. Try a narrower NAICS or a different state.
        </p>
      </section>
    );
  }

  const { summary, recommendations, agencies } = data;

  const sortedAgencies = [...agencies].sort((a, b) => {
    let cmp = 0;
    if (sortCol === 'score') cmp = a.satFriendlinessScore - b.satFriendlinessScore;
    else if (sortCol === 'satPercent') cmp = a.satPercent - b.satPercent;
    else if (sortCol === 'satContracts') cmp = a.satContractCount - b.satContractCount;
    else if (sortCol === 'avgAward') cmp = a.avgSATAwardSize - b.avgSATAwardSize;
    else if (sortCol === 'micro') cmp = a.microContractCount - b.microContractCount;
    else if (sortCol === 'agency') cmp = a.agency.localeCompare(b.agency);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortCol(col);
      setSortDir(col === 'agency' ? 'asc' : 'desc');
    }
  };

  const SortHeader = ({
    col, label, align = 'right',
  }: { col: SortCol; label: string; align?: 'left' | 'right' | 'center' }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-4 py-3 text-${align} text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-surface/50 transition-colors ${
        sortCol === col ? 'text-cyan-400' : 'text-muted'
      }`}
    >
      <div className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {sortCol === col && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}
      </div>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-xl p-5">
        <h3 className="text-xl font-bold text-amber-400 mb-2">Entry Accessibility — Where Small Biz Wins</h3>
        <p className="text-muted text-sm">
          Contracts under $350K use simplified acquisition (faster, less paperwork). Micro-purchases under $15K use government purchase cards. These are the easiest first wins.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface/50 rounded-xl p-4 border border-hairline/50">
          <div className="text-xs text-faint uppercase tracking-wider mb-1">SAT Contracts</div>
          <div className="text-2xl font-bold text-amber-400">{summary.totalSATContracts.toLocaleString()}</div>
          <div className="text-xs text-faint mt-1">${(summary.totalSATSpending / 1e6).toFixed(2)}M total</div>
        </div>
        <div className="bg-surface/50 rounded-xl p-4 border border-hairline/50">
          <div className="text-xs text-faint uppercase tracking-wider mb-1">Micro-Purchases</div>
          <div className="text-2xl font-bold text-green-400">{summary.totalMicroContracts.toLocaleString()}</div>
          <div className="text-xs text-faint mt-1">${(summary.totalMicroSpending / 1e6).toFixed(2)}M total</div>
        </div>
        <div className="bg-surface/50 rounded-xl p-4 border border-hairline/50">
          <div className="text-xs text-faint uppercase tracking-wider mb-1">Avg SAT %</div>
          <div className="text-2xl font-bold text-cyan-400">{summary.avgSATPercent}%</div>
          <div className="text-xs text-faint mt-1">across {summary.totalAgenciesAnalyzed} agencies</div>
        </div>
        <div className="bg-surface/50 rounded-xl p-4 border border-hairline/50">
          <div className="text-xs text-faint uppercase tracking-wider mb-1">SAT-Friendly</div>
          <div className="text-2xl font-bold text-emerald-400">{summary.satFriendlyAgencies}</div>
          <div className="text-xs text-faint mt-1">agencies with &gt;50% SAT</div>
        </div>
      </div>

      <div className="bg-surface/50 rounded-xl border border-hairline/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-hairline/50">
          <h4 className="text-lg font-semibold text-slate-200">Agency Rankings by Entry Accessibility</h4>
          <p className="text-xs text-faint mt-1">Click any column header to sort</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-ground/50">
              <tr>
                <SortHeader col="agency" label="Agency" align="left" />
                <SortHeader col="satPercent" label="SAT %" />
                <SortHeader col="satContracts" label="SAT Contracts" />
                <SortHeader col="avgAward" label="Avg Award" />
                <SortHeader col="micro" label="Micro" />
                <SortHeader col="score" label="Score" align="center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {sortedAgencies.map((a, i) => (
                <tr key={`${a.agency}-${i}`} className="hover:bg-input/20 transition">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-slate-200">{a.agency}</div>
                    {a.parentAgency && a.parentAgency !== a.agency && (
                      <div className="text-xs text-faint">{a.parentAgency}</div>
                    )}
                    {a.isEstimated && (
                      <span className="text-[10px] text-slate-600 italic">estimated</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm font-bold ${
                      a.satPercent > 50 ? 'text-emerald-400' :
                      a.satPercent > 25 ? 'text-amber-400' : 'text-faint'
                    }`}>
                      {a.satPercent}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-ink-soft">
                    {a.satContractCount.toLocaleString()}
                    <span className="text-faint text-xs ml-1">/ {a.totalContractCount.toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-ink-soft">
                    ${a.avgSATAwardSize > 1000 ? `${(a.avgSATAwardSize / 1000).toFixed(0)}K` : a.avgSATAwardSize.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-ink-soft">
                    {a.microContractCount > 0 ? (
                      <span className="text-green-400">{a.microContractCount}</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                      a.accessibilityLevel === 'high' ? 'bg-emerald-500/20 text-emerald-400' :
                      a.accessibilityLevel === 'moderate' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-slate-600/20 text-faint'
                    }`}>
                      {a.satFriendlinessScore}
                      <span className="ml-1 text-[10px] font-normal">
                        {a.accessibilityLevel === 'high' ? 'High' :
                         a.accessibilityLevel === 'moderate' ? 'Mod' : 'Low'}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {recommendations.length > 0 && (
        <div className="bg-surface/50 rounded-xl p-5 border border-hairline/50">
          <h4 className="text-lg font-semibold text-slate-200 mb-3">Entry Strategy Recommendations</h4>
          <ul className="space-y-3">
            {recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="text-amber-400 mt-0.5 text-lg leading-none">→</span>
                <span className="text-sm text-ink-soft">{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-ground/30 rounded-lg p-4 border border-hairline/30">
        <div className="flex flex-wrap gap-4 text-xs text-faint">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            High (&gt;50% SAT) — Highly Accessible
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            Moderate (25-50% SAT)
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-500"></span>
            Low (&lt;25% SAT)
          </div>
          <div className="ml-auto">
            SAT = Simplified Acquisition Threshold ($350K) | Micro = Government Purchase Card ($15K)
          </div>
        </div>
      </div>
    </div>
  );
}
