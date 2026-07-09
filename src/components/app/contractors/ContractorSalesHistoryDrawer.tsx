'use client';

import { useEffect, useMemo, useState } from 'react';
import { getMIApiHeaders } from '../authHeaders';
import type { ContractorSalesHistory } from '@/lib/contractor-sales-history';
import { formatMindyCurrency } from '@/lib/mindy/formatters';

interface ContractorSummary {
  company: string;
  contract_value_num: number;
  contract_count: string;
  agencies: string;
  naics: string;
  uei?: string;   // BQ-backed rows carry this — the exact award-history key
  slug?: string;
}

interface ContractorSalesHistoryDrawerProps {
  contractor: ContractorSummary;
  email: string | null;
  onClose: () => void;
}

function formatCurrency(value: number) {
  return formatMindyCurrency(value);
}

function formatDate(value: string | null) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ContractorSalesHistoryDrawer({
  contractor,
  email,
  onClose,
}: ContractorSalesHistoryDrawerProps) {
  const [history, setHistory] = useState<ContractorSalesHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Year-bar drill-down. Click a year → shows the agencyBreakdown
  // for that FY beneath. One year expanded at a time keeps the
  // drawer scannable.
  const [expandedYear, setExpandedYear] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ company: contractor.company });
        if (email) params.set('email', email);
        // Pass UEI/slug when available (BQ rows) so the route can resolve the
        // exact recipient even when it's not in the static contractor DB.
        if (contractor.uei) params.set('uei', contractor.uei);
        if (contractor.slug) params.set('slug', contractor.slug);

        const response = await fetch(
          `/api/app/contractors/sales-history?${params.toString()}`,
          { headers: getMIApiHeaders(email) }
        );
        const data = await response.json();

        if (cancelled) return;
        if (!response.ok || data.error) {
          setError(data.error || 'Failed to load sales history');
          setHistory(null);
          return;
        }

        setHistory(data);
      } catch (err) {
        console.error('Contractor sales history error:', err);
        if (!cancelled) setError('Failed to load sales history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [contractor.company, contractor.uei, contractor.slug, email]);

  // Fill the chart to a CONSISTENT window so every contractor's "Sales by
  // Fiscal Year" is comparable — a firm with awards only in 24–26 (e.g. EXCELL)
  // should still show the full timeline with $0 columns for the empty years,
  // like a decade-long incumbent (e.g. RQ). Eric 2026-06-04. Window = the last
  // ~10 fiscal years up to the latest year that has data; existing years keep
  // their data + agency breakdown, gaps become $0 placeholders.
  const displaySeries = useMemo(() => {
    const series = history?.series ?? [];
    if (series.length === 0) return [];
    const byYear = new Map(series.map(y => [y.fiscalYear, y]));
    const maxYear = Math.max(...series.map(y => y.fiscalYear));
    const minData = Math.min(...series.map(y => y.fiscalYear));
    // Show at least the last 10 years, but don't truncate older real data.
    const startYear = Math.min(minData, maxYear - 9);
    const out: typeof series = [];
    for (let y = startYear; y <= maxYear; y++) {
      out.push(byYear.get(y) ?? { fiscalYear: y, totalObligations: 0, awardCount: 0, agencyBreakdown: [] });
    }
    return out;
  }, [history]);

  const maxYearAmount = useMemo(() => {
    if (!displaySeries.length) return 1;
    return Math.max(...displaySeries.map((year) => year.totalObligations), 1);
  }, [displaySeries]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close award history"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-3xl overflow-y-auto border-l border-surface bg-ground-deep shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-surface bg-ground-deep/95 px-6 py-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
                Federal award history
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white">{contractor.company}</h2>
              <p className="mt-1 text-sm text-muted">
                Year-over-year sales, agency concentration, and recent awards.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-hairline px-3 py-2 text-sm text-ink-soft hover:border-slate-500 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {loading && (
            <div className="space-y-4">
              <div className="h-24 animate-pulse rounded-xl bg-ground" />
              <div className="h-64 animate-pulse rounded-xl bg-ground" />
              <div className="h-40 animate-pulse rounded-xl bg-ground" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-300">
              {error}
            </div>
          )}

          {!loading && history && (
            <>
              {history.message && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                  {history.message}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-surface bg-ground p-4">
                  <div className="text-2xl font-bold text-white">
                    {formatCurrency(history.summary.totalObligations || contractor.contract_value_num)}
                  </div>
                  <div className="mt-1 text-xs text-faint">Known federal sales</div>
                </div>
                <div className="rounded-xl border border-surface bg-ground p-4">
                  <div className="text-2xl font-bold text-emerald-400">
                    {history.summary.awardCount || contractor.contract_count}
                  </div>
                  <div className="mt-1 text-xs text-faint">Awards found</div>
                </div>
                <div className="rounded-xl border border-surface bg-ground p-4">
                  <div className="text-2xl font-bold text-blue-400">
                    {history.summary.latestFiscalYear || 'N/A'}
                  </div>
                  <div className="mt-1 text-xs text-faint">Latest fiscal year</div>
                </div>
                <div className="rounded-xl border border-surface bg-ground p-4">
                  <div className="truncate text-lg font-bold text-purple-300">
                    {history.summary.topAgency || 'Unknown'}
                  </div>
                  <div className="mt-1 text-xs text-faint">Top agency</div>
                </div>
              </div>

              <section className="rounded-xl border border-surface bg-ground p-5">
                <div className="mb-5 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Sales by Fiscal Year</h3>
                    <p className="text-sm text-faint">Federal obligations grouped by year.</p>
                  </div>
                  {/* Two escape hatches from the drawer:
                      - "Open full profile" (primary, emerald) → in-app
                        ContractorProfileView at panel-page width with
                        the wider layout, more rows, and room to grow
                        workspace actions.
                      - "Public page" (secondary, slate) → external SEO
                        page with UEI/CAGE/address/treemap (data we don't
                        yet surface in-app). Opens in new tab so the
                        drawer stays put when the user comes back. */}
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={`/app?panel=contractors&view=profile&slug=${encodeURIComponent(history.contractor.slug)}&company=${encodeURIComponent(contractor.company)}`}
                      className="rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
                    >
                      Open full profile →
                    </a>
                    <a
                      href={`/contractors/${history.contractor.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-surface px-3 py-2 text-xs font-medium text-ink-soft hover:bg-input"
                    >
                      Public page ↗
                    </a>
                  </div>
                </div>

                {displaySeries.length > 0 ? (
                  <div>
                    {/* Vertical column chart (HigherGov / GovTribe style):
                        years across the bottom, bars rising to their value.
                        Reads the spending trajectory left-to-right at a glance.
                        Click a column to drill into that year's agencies.
                        displaySeries fills empty years with $0 so the timeline
                        is consistent across contractors. */}
                    <div className="flex items-end gap-2 h-56 overflow-x-auto pb-1">
                      {displaySeries.map((year) => {
                        const isExpanded = expandedYear === year.fiscalYear;
                        const breakdown = year.agencyBreakdown || [];
                        const isZero = year.totalObligations === 0;
                        const pct = isZero ? 0 : Math.max(2, (year.totalObligations / maxYearAmount) * 100);
                        return (
                          <button
                            key={year.fiscalYear}
                            type="button"
                            onClick={() => breakdown.length > 0 && setExpandedYear(isExpanded ? null : year.fiscalYear)}
                            className={`group flex flex-col items-center justify-end flex-1 min-w-[44px] h-full rounded-md px-1 pt-1 transition-colors ${
                              breakdown.length > 0 ? 'hover:bg-surface/30 cursor-pointer' : 'cursor-default'
                            }`}
                            title={`FY ${year.fiscalYear}: ${formatCurrency(year.totalObligations)}`}
                          >
                            {/* value label on top of the column ($0 dimmed) */}
                            <span className={`text-[10px] font-semibold mb-1 whitespace-nowrap ${isZero ? 'text-slate-600' : 'text-ink-soft'}`}>
                              {isZero ? '$0' : formatCurrency(year.totalObligations)}
                            </span>
                            {/* the rising bar — $0 years show a faint baseline
                                stub so the year reads "present but zero". */}
                            {isZero ? (
                              <div className="w-full max-w-[40px] h-[2px] rounded bg-input" />
                            ) : (
                              <div
                                className={`w-full max-w-[40px] rounded-t transition-colors ${
                                  isExpanded ? 'bg-emerald-400' : 'bg-emerald-500 group-hover:bg-emerald-400'
                                }`}
                                style={{ height: `${pct}%` }}
                              />
                            )}
                            {/* year axis label */}
                            <span className={`mt-1.5 text-[11px] font-medium whitespace-nowrap ${isExpanded ? 'text-emerald-400' : isZero ? 'text-slate-600' : 'text-muted'}`}>
                              {`'${String(year.fiscalYear).slice(2)}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Drill-down: agencies for the selected year, below the chart */}
                    {expandedYear !== null && (() => {
                      const yr = history.series.find(y => y.fiscalYear === expandedYear);
                      const breakdown = (yr?.agencyBreakdown || []).slice().sort((a, b) => b.amount - a.amount);
                      if (breakdown.length === 0) return null;
                      return (
                        <div className="mt-4 rounded-lg border border-surface bg-ground/40 p-4 space-y-1.5">
                          <p className="text-[10px] uppercase tracking-wider text-faint mb-1">Agencies awarding in FY {expandedYear}</p>
                          {breakdown.slice(0, 8).map((row) => (
                            <div key={`${expandedYear}-${row.agency}`} className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-ink-soft truncate flex-1">{row.agency}</span>
                              <span className="text-faint shrink-0">{row.count} {row.count === 1 ? 'award' : 'awards'}</span>
                              <span className="text-emerald-400 font-semibold shrink-0 w-20 text-right">{formatCurrency(row.amount)}</span>
                            </div>
                          ))}
                          {breakdown.length > 8 && (
                            <p className="text-[10px] text-slate-600 italic pt-1">+{breakdown.length - 8} more agencies in FY {expandedYear}</p>
                          )}
                        </div>
                      );
                    })()}

                    {history.series.some(y => (y.agencyBreakdown || []).length > 0) && (
                      <p className="text-[10px] text-faint italic pt-3 text-center">Click any year to see which agencies awarded.</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-surface bg-ground-deep p-5 text-sm text-muted">
                    No year-by-year cached awards found yet. The contractor database still shows{' '}
                    {formatCurrency(contractor.contract_value_num)} across {contractor.contract_count} contracts.
                  </div>
                )}
              </section>

              <div className="grid gap-4 md:grid-cols-2">
                <section className="rounded-xl border border-surface bg-ground p-5">
                  <h3 className="text-lg font-semibold text-white">Top Agencies</h3>
                  <div className="mt-4 space-y-3">
                    {history.topAgencies.length ? history.topAgencies.map((agency) => (
                      <div key={agency.agency} className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-200">{agency.agency}</div>
                          <div className="text-xs text-faint">
                            {typeof agency.share === 'number' && agency.share > 0
                              ? `${(agency.share * 100).toFixed(1)}% of total obligations`
                              : `${agency.count} ${agency.count === 1 ? 'award' : 'awards'}`}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-emerald-400">{formatCurrency(agency.amount)}</div>
                      </div>
                    )) : (
                      <p className="text-sm text-faint">Agency breakdown is not cached yet.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-surface bg-ground p-5">
                  <h3 className="text-lg font-semibold text-white">Top NAICS</h3>
                  <div className="mt-4 space-y-3">
                    {history.topNaics.length ? history.topNaics.map((naics) => (
                      <div key={naics.naics} className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-200">{naics.naics}</div>
                          <div className="truncate text-xs text-faint">{naics.description || 'No description'}</div>
                        </div>
                        <div className="text-sm font-semibold text-emerald-400">{formatCurrency(naics.amount)}</div>
                      </div>
                    )) : (
                      <p className="text-sm text-faint">
                        {contractor.naics && contractor.naics !== 'N/A'
                          ? `Known profile NAICS: ${contractor.naics}`
                          : 'NAICS breakdown is not cached yet.'}
                      </p>
                    )}
                  </div>
                </section>
              </div>

              <section className="rounded-xl border border-surface bg-ground p-5">
                <h3 className="text-lg font-semibold text-white">Recent Awards</h3>
                <div className="mt-4 space-y-3">
                  {history.recentAwards.length ? history.recentAwards.map((award) => (
                    <div key={award.id} className="rounded-lg border border-surface bg-ground-deep p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h4 className="line-clamp-2 text-sm font-semibold text-white">{award.title}</h4>
                          <p className="mt-1 text-xs text-faint">
                            {award.agency} · {formatDate(award.startDate)}
                          </p>
                        </div>
                        <div className="shrink-0 text-sm font-bold text-emerald-400">
                          {formatCurrency(award.amount)}
                        </div>
                      </div>
                    </div>
                  )) : (
                    <p className="text-sm text-faint">Recent award details are not cached yet.</p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
