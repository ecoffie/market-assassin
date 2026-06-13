'use client';

/**
 * ContractorProfileView — full-page in-app contractor profile.
 *
 * Rendered as a sub-view of the Contractors panel when the URL carries
 * `?view=profile&slug=...&company=...`. Sister surface to the
 * `ContractorSalesHistoryDrawer`, which stays alive for inline contexts
 * (Source Feed, Today's Intel, Recompetes — places where you don't want
 * to leave the current screen).
 *
 * Why a panel-view instead of a `/app/contractors/[slug]/page.tsx` route:
 * `/app/layout.tsx` is a passthrough (`return children`); the dashboard
 * shell (sidebar, ToastHost, auth, GlobalLookup) lives inside
 * `/app/page.tsx` as `AppDashboard`. A separate route would render
 * outside that shell. Panel-based view keeps everything inside one
 * mounted shell, gives a shareable URL
 * (`/app?panel=contractors&view=profile&slug=…`), and matches the rest
 * of the app's panel architecture.
 *
 * Data: reuses `/api/app/contractors/sales-history` — same endpoint the
 * drawer uses. Workspace actions (track this firm, add note, save)
 * intentionally NOT here for v0; that needs a `user_contractor_targets`
 * table and a separate "My Target Firms" PRD. For now the public page
 * is the escape hatch for deeper company detail (UEI, CAGE, address,
 * executives, treemap NAICS).
 */

import { useEffect, useMemo, useState } from 'react';
import { getMIApiHeaders } from '../authHeaders';
import type { ContractorSalesHistory } from '@/lib/contractor-sales-history';
import { formatMindyCurrency } from '@/lib/mindy/formatters';

interface ContractorProfileViewProps {
  slug: string;
  company: string;
  email: string | null;
  onBack: () => void;
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

export default function ContractorProfileView({
  slug,
  company,
  email,
  onBack,
}: ContractorProfileViewProps) {
  const [history, setHistory] = useState<ContractorSalesHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ company, slug });
        if (email) params.set('email', email);

        const response = await fetch(
          `/api/app/contractors/sales-history?${params.toString()}`,
          { headers: getMIApiHeaders(email) }
        );
        const data = await response.json();

        if (cancelled) return;
        if (!response.ok || data.error) {
          setError(data.error || 'Failed to load profile');
          setHistory(null);
          return;
        }

        setHistory(data);
      } catch (err) {
        console.error('Contractor profile load error:', err);
        if (!cancelled) setError('Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [slug, company, email]);

  // Same chart-windowing logic the drawer uses: pad to a consistent
  // ~10-year window so a 2024-2026-only firm and a decade-long incumbent
  // are visually comparable.
  const displaySeries = useMemo(() => {
    const series = history?.series ?? [];
    if (series.length === 0) return [];
    const byYear = new Map(series.map(y => [y.fiscalYear, y]));
    const maxYear = Math.max(...series.map(y => y.fiscalYear));
    const minData = Math.min(...series.map(y => y.fiscalYear));
    const startYear = Math.min(minData, maxYear - 9);
    const out: typeof series = [];
    for (let y = startYear; y <= maxYear; y++) {
      out.push(byYear.get(y) ?? { fiscalYear: y, totalObligations: 0, awardCount: 0, agencyBreakdown: [] });
    }
    return out;
  }, [history]);

  const maxYearAmount = useMemo(() => {
    if (!displaySeries.length) return 1;
    return Math.max(...displaySeries.map((y) => y.totalObligations), 1);
  }, [displaySeries]);

  return (
    <div className="space-y-6 p-6">
      {/* Header — Back to Contractors + the Open public page escape hatch.
          We keep the public link visible because the SEO page has fields
          we don't surface here yet (UEI/CAGE/address/executives, treemap). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-400"
        >
          <span aria-hidden="true">←</span>
          <span>Back to contractors</span>
        </button>
        <a
          href={`/contractors/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
          title="Opens the public SEO page with UEI, CAGE, address, executives, and a fuller treemap"
        >
          Open public page
          <span aria-hidden="true">↗</span>
        </a>
      </div>

      {/* Title block */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
          Federal Contractor Profile
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white md:text-4xl">
          {company}
        </h1>
        {history && (
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Year-over-year federal sales, agency concentration, NAICS activity, and recent awards.
          </p>
        )}
      </div>

      {loading && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-900" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-slate-900" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="h-72 animate-pulse rounded-xl bg-slate-900" />
            <div className="h-72 animate-pulse rounded-xl bg-slate-900" />
          </div>
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

          {/* Stat cards */}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-2xl font-bold text-white">
                {formatCurrency(history.summary.totalObligations || 0)}
              </div>
              <div className="mt-1 text-xs text-slate-500">Known federal sales</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-2xl font-bold text-emerald-400">
                {Number(history.summary.awardCount || 0).toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-slate-500">Awards found</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-2xl font-bold text-blue-400">
                {history.summary.latestFiscalYear || 'N/A'}
              </div>
              <div className="mt-1 text-xs text-slate-500">Latest fiscal year</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="truncate text-lg font-bold text-purple-300" title={history.summary.topAgency || ''}>
                {history.summary.topAgency || 'Unknown'}
              </div>
              <div className="mt-1 text-xs text-slate-500">Top agency</div>
            </div>
          </div>

          {/* Sales by Fiscal Year — same column chart + year-drill UX as
              the drawer, just at panel-page width. */}
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Sales by Fiscal Year</h3>
                <p className="text-sm text-slate-500">Click a year to see which agencies awarded.</p>
              </div>
            </div>

            {displaySeries.length > 0 ? (
              <div>
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
                          breakdown.length > 0 ? 'hover:bg-slate-800/30 cursor-pointer' : 'cursor-default'
                        }`}
                        title={`FY ${year.fiscalYear}: ${formatCurrency(year.totalObligations)}`}
                      >
                        <span className={`text-[10px] font-semibold mb-1 whitespace-nowrap ${isZero ? 'text-slate-600' : 'text-slate-300'}`}>
                          {isZero ? '$0' : formatCurrency(year.totalObligations)}
                        </span>
                        {isZero ? (
                          <div className="w-full max-w-[40px] h-[2px] rounded bg-slate-700" />
                        ) : (
                          <div
                            className={`w-full max-w-[40px] rounded-t transition-colors ${
                              isExpanded ? 'bg-emerald-400' : 'bg-emerald-500 group-hover:bg-emerald-400'
                            }`}
                            style={{ height: `${pct}%` }}
                          />
                        )}
                        <span className={`mt-1.5 text-[11px] font-medium whitespace-nowrap ${isExpanded ? 'text-emerald-400' : isZero ? 'text-slate-600' : 'text-slate-400'}`}>
                          {`'${String(year.fiscalYear).slice(2)}`}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {expandedYear !== null && (() => {
                  const yr = history.series.find((y) => y.fiscalYear === expandedYear);
                  const breakdown = (yr?.agencyBreakdown || []).slice().sort((a, b) => b.amount - a.amount);
                  if (breakdown.length === 0) return null;
                  return (
                    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                        Agencies awarding in FY {expandedYear}
                      </p>
                      {breakdown.slice(0, 12).map((row) => (
                        <div key={`${expandedYear}-${row.agency}`} className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-slate-300 truncate flex-1">{row.agency}</span>
                          <span className="text-slate-500 shrink-0">{row.count} {row.count === 1 ? 'award' : 'awards'}</span>
                          <span className="text-emerald-400 font-semibold shrink-0 w-20 text-right">{formatCurrency(row.amount)}</span>
                        </div>
                      ))}
                      {breakdown.length > 12 && (
                        <p className="text-[10px] text-slate-600 italic pt-1">
                          +{breakdown.length - 12} more agencies in FY {expandedYear}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-5 text-sm text-slate-400">
                No year-by-year cached awards found yet.
              </div>
            )}
          </section>

          {/* Top Agencies + Top NAICS — wider grid than the drawer. */}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="text-lg font-semibold text-white">Top Federal Agencies</h3>
              <div className="mt-4 space-y-3">
                {history.topAgencies.length ? history.topAgencies.map((agency) => (
                  <div key={agency.agency} className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-200">{agency.agency}</div>
                      <div className="text-xs text-slate-500">{agency.count} awards</div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold text-emerald-400">{formatCurrency(agency.amount)}</div>
                  </div>
                )) : (
                  <p className="text-sm text-slate-500">Agency breakdown is not cached yet.</p>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="text-lg font-semibold text-white">Top NAICS Activity</h3>
              <div className="mt-4 space-y-3">
                {history.topNaics.length ? history.topNaics.map((naics) => (
                  <div key={naics.naics} className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-medium text-slate-200">{naics.naics}</div>
                      <div className="truncate text-xs text-slate-500">{naics.description || 'No description'}</div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold text-emerald-400">{formatCurrency(naics.amount)}</div>
                  </div>
                )) : (
                  <p className="text-sm text-slate-500">NAICS breakdown is not cached yet.</p>
                )}
              </div>
            </section>
          </div>

          {/* Recent Awards — full-width table, more rows than the drawer. */}
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Recent Federal Awards</h3>
              <a
                href={`/contractors/${slug}/contracts`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-slate-400 hover:text-emerald-400"
              >
                See all on public page ↗
              </a>
            </div>
            {history.recentAwards.length ? (
              <div className="space-y-3">
                {history.recentAwards.map((award) => (
                  <div key={award.id} className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h4 className="line-clamp-2 text-sm font-semibold text-white">{award.title}</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          {award.agency} · {formatDate(award.startDate)}
                        </p>
                      </div>
                      <div className="shrink-0 text-sm font-bold text-emerald-400">
                        {formatCurrency(award.amount)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Recent award details are not cached yet.</p>
            )}
          </section>

          {/* "Want more?" — quietly direct power users to the SEO page
              for fields not yet in this view. Mirrors the way Linear and
              GitHub link to the canonical "view in browser" surface. */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-200">Need UEI, CAGE, address, or executive comp?</p>
                <p className="mt-1 max-w-xl text-xs text-slate-500">
                  The public profile carries Parent UEI, CAGE Code, registered HQ address, FFATA-disclosed
                  executive compensation, and a NAICS treemap. We&rsquo;ll pull these into the in-app view
                  next.
                </p>
              </div>
              <a
                href={`/contractors/${slug}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
              >
                Open public page ↗
              </a>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
