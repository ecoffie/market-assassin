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

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ company: contractor.company });
        if (email) params.set('email', email);

        const response = await fetch(
          `/api/mi-beta/contractors/sales-history?${params.toString()}`,
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
  }, [contractor.company, email]);

  const maxYearAmount = useMemo(() => {
    if (!history?.series.length) return 1;
    return Math.max(...history.series.map((year) => year.totalObligations), 1);
  }, [history]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close award history"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-3xl overflow-y-auto border-l border-slate-800 bg-slate-950 shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-6 py-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
                Federal award history
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white">{contractor.company}</h2>
              <p className="mt-1 text-sm text-slate-400">
                Year-over-year sales, agency concentration, and recent awards.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {loading && (
            <div className="space-y-4">
              <div className="h-24 animate-pulse rounded-xl bg-slate-900" />
              <div className="h-64 animate-pulse rounded-xl bg-slate-900" />
              <div className="h-40 animate-pulse rounded-xl bg-slate-900" />
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
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <div className="text-2xl font-bold text-white">
                    {formatCurrency(history.summary.totalObligations || contractor.contract_value_num)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Known federal sales</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <div className="text-2xl font-bold text-emerald-400">
                    {history.summary.awardCount || contractor.contract_count}
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
                  <div className="truncate text-lg font-bold text-purple-300">
                    {history.summary.topAgency || 'Unknown'}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Top agency</div>
                </div>
              </div>

              <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Sales by Fiscal Year</h3>
                    <p className="text-sm text-slate-500">Federal obligations grouped by year.</p>
                  </div>
                  <a
                    href={`/contractors/${history.contractor.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
                  >
                    Public page
                  </a>
                </div>

                {history.series.length > 0 ? (
                  <div className="space-y-3">
                    {history.series.map((year) => (
                      <div key={year.fiscalYear} className="grid grid-cols-[4rem_1fr_6rem] items-center gap-3">
                        <div className="text-sm font-medium text-slate-300">FY {year.fiscalYear}</div>
                        <div className="h-4 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.max(4, (year.totalObligations / maxYearAmount) * 100)}%` }}
                          />
                        </div>
                        <div className="text-right text-sm font-semibold text-white">
                          {formatCurrency(year.totalObligations)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-5 text-sm text-slate-400">
                    No year-by-year cached awards found yet. The contractor database still shows{' '}
                    {formatCurrency(contractor.contract_value_num)} across {contractor.contract_count} contracts.
                  </div>
                )}
              </section>

              <div className="grid gap-4 md:grid-cols-2">
                <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                  <h3 className="text-lg font-semibold text-white">Top Agencies</h3>
                  <div className="mt-4 space-y-3">
                    {history.topAgencies.length ? history.topAgencies.map((agency) => (
                      <div key={agency.agency} className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-200">{agency.agency}</div>
                          <div className="text-xs text-slate-500">{agency.count} awards</div>
                        </div>
                        <div className="text-sm font-semibold text-emerald-400">{formatCurrency(agency.amount)}</div>
                      </div>
                    )) : (
                      <p className="text-sm text-slate-500">Agency breakdown is not cached yet.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                  <h3 className="text-lg font-semibold text-white">Top NAICS</h3>
                  <div className="mt-4 space-y-3">
                    {history.topNaics.length ? history.topNaics.map((naics) => (
                      <div key={naics.naics} className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-200">{naics.naics}</div>
                          <div className="truncate text-xs text-slate-500">{naics.description || 'No description'}</div>
                        </div>
                        <div className="text-sm font-semibold text-emerald-400">{formatCurrency(naics.amount)}</div>
                      </div>
                    )) : (
                      <p className="text-sm text-slate-500">
                        {contractor.naics && contractor.naics !== 'N/A'
                          ? `Known profile NAICS: ${contractor.naics}`
                          : 'NAICS breakdown is not cached yet.'}
                      </p>
                    )}
                  </div>
                </section>
              </div>

              <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <h3 className="text-lg font-semibold text-white">Recent Awards</h3>
                <div className="mt-4 space-y-3">
                  {history.recentAwards.length ? history.recentAwards.map((award) => (
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
                  )) : (
                    <p className="text-sm text-slate-500">Recent award details are not cached yet.</p>
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
