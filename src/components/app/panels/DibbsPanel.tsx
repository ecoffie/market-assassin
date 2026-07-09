'use client';

/**
 * DIBBS panel — search DLA small-buy RFQs (the ~3.3M NSN/parts solicitations DLA
 * posts on its own Internet Bid Board, NOT SAM). Data lands in dibbs_rfqs via the
 * Apify sync cron; this panel searches it by keyword / NSN / FSC, soonest deadline
 * first, expired hidden by default.
 *
 * Authed /api/app route → MUST send getMIApiHeaders(email) or it 401s.
 */
import { useState, useCallback, useEffect } from 'react';
import { Package, Flame, Zap } from 'lucide-react';
import { authedFetch } from '../authHeaders';
import type { AppTier } from '../UnifiedSidebar';

interface Props {
  email: string | null;
  tier: AppTier;
}

interface Rfq {
  solicitationNumber: string;
  nsn: string | null;
  fsc: string | null;
  description: string | null;
  quantity: number | null;
  unitOfIssue: string | null;
  returnByDate: string | null;
  buyer: string | null;
  status: string | null;
  url: string | null;
  pdfUrl: string | null;
}

const PAGE = 50;

function formatDate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((dt.getTime() - today.getTime()) / 86400000);
}

export default function DibbsPanel({ email }: Props) {
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [nsn, setNsn] = useState('');
  const [fsc, setFsc] = useState('');
  const [sort, setSort] = useState<'deadline' | 'newest'>('deadline');
  const [includeExpired, setIncludeExpired] = useState(false);

  const search = useCallback(
    async (offset = 0) => {
      if (!email) return;
      if (offset === 0) setIsLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          email,
          sort,
          limit: String(PAGE),
          offset: String(offset),
        });
        if (q.trim()) params.set('q', q.trim());
        if (nsn.trim()) params.set('nsn', nsn.trim());
        if (fsc.trim()) params.set('fsc', fsc.trim());
        if (includeExpired) params.set('includeExpired', '1');

        const res = await authedFetch(`/api/app/dibbs?${params.toString()}`, email);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Search failed');
        setRfqs(prev => (offset === 0 ? data.rfqs : [...prev, ...data.rfqs]));
        setTotal(data.total || 0);
        setHasMore(!!data.hasMore);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        setIsLoading(false);
        setLoadingMore(false);
      }
    },
    [email, q, nsn, fsc, sort, includeExpired],
  );

  // Initial load + re-search when sort/expired toggles change.
  useEffect(() => {
    search(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, includeExpired]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(0);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Package className="h-5 w-5 shrink-0" strokeWidth={2} /> DIBBS — DLA Small-Buy RFQs
        </h1>
        <p className="text-sm text-muted mt-1">
          DLA Internet Bid Board solicitations (NSN / parts) — the small-buy market that
          isn&apos;t on SAM.gov. Search by keyword, NSN, or FSC.
        </p>
      </div>

      {/* Search / filters */}
      <form onSubmit={onSubmit} className="bg-ground border border-surface rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Keyword or solicitation # (e.g. helmet, SPE1C1-26-Q-0325)"
            className="flex-1 px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-emerald-500 outline-none"
          />
          <input
            value={nsn}
            onChange={e => setNsn(e.target.value)}
            placeholder="NSN (e.g. 8415)"
            className="w-full md:w-40 px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-emerald-500 outline-none"
          />
          <input
            value={fsc}
            onChange={e => setFsc(e.target.value)}
            placeholder="FSC (e.g. 8415)"
            className="w-full md:w-32 px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-emerald-500 outline-none"
          />
          <button
            type="submit"
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Search
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-ink-soft">
            Sort
            <select
              value={sort}
              onChange={e => setSort(e.target.value as 'deadline' | 'newest')}
              className="px-2 py-1 bg-surface border border-hairline rounded text-white text-sm focus:border-emerald-500 outline-none"
            >
              <option value="deadline">Soonest deadline</option>
              <option value="newest">Newest posted</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={includeExpired}
              onChange={e => setIncludeExpired(e.target.checked)}
              className="accent-emerald-500"
            />
            Include expired
          </label>
          {!isLoading && (
            <span className="text-faint ml-auto">
              {total.toLocaleString()} RFQ{total === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">{error}</div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && rfqs.length === 0 && (
        <div className="text-center py-12 text-muted">
          <p className="text-lg mb-1">No DIBBS RFQs match.</p>
          <p className="text-sm text-faint">
            Try a broader keyword, or a shorter NSN/FSC prefix (e.g. just the 4-digit FSC). New
            RFQs sync daily.
          </p>
        </div>
      )}

      {/* Results */}
      {!isLoading && rfqs.length > 0 && (
        <div className="space-y-3">
          {rfqs.map(r => {
            const dl = daysUntil(r.returnByDate);
            const isUrgent = dl !== null && dl >= 0 && dl <= 3;
            const isSoon = dl !== null && dl > 3 && dl <= 10;
            return (
              <a
                key={r.solicitationNumber}
                href={r.url || r.pdfUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={`block bg-ground border rounded-xl p-4 hover:border-emerald-500/50 transition-colors ${
                  isUrgent ? 'border-red-500/50 bg-red-500/5' : 'border-surface'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      {r.fsc && (
                        <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded" title="Federal Supply Classification">
                          FSC {r.fsc}
                        </span>
                      )}
                      {r.nsn && (
                        <span className="px-2 py-0.5 text-xs bg-input text-ink-soft rounded" title="National Stock Number">
                          NSN {r.nsn}
                        </span>
                      )}
                      {isUrgent && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded font-medium">
                          <Flame className="h-3 w-3 shrink-0" strokeWidth={2} /> {dl} day{dl === 1 ? '' : 's'} left
                        </span>
                      )}
                      {isSoon && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">
                          <Zap className="h-3 w-3 shrink-0" strokeWidth={2} /> {dl} days left
                        </span>
                      )}
                    </div>
                    <h3 className="font-medium text-white mb-1 line-clamp-2">
                      {r.description || r.solicitationNumber}
                    </h3>
                    <p className="text-xs text-faint mt-1">
                      #{r.solicitationNumber}
                      {r.quantity != null && (
                        <span className="ml-2">
                          · Qty {r.quantity.toLocaleString()}
                          {r.unitOfIssue ? ` ${r.unitOfIssue}` : ''}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {r.returnByDate && (
                      <div className={`text-sm font-medium ${isUrgent ? 'text-red-300' : 'text-white'}`}>
                        Due {formatDate(r.returnByDate)}
                      </div>
                    )}
                    <div className="mt-2 flex flex-col items-end gap-1">
                      <span className="text-xs text-emerald-400 hover:text-emerald-300">View on DIBBS →</span>
                      {r.pdfUrl && (
                        <span
                          className="text-xs text-faint hover:text-ink-soft"
                          onClick={e => {
                            e.preventDefault();
                            window.open(r.pdfUrl!, '_blank', 'noopener,noreferrer');
                          }}
                        >
                          Solicitation PDF ↗
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </a>
            );
          })}

          {hasMore && (
            <button
              onClick={() => search(rfqs.length)}
              disabled={loadingMore}
              className="w-full py-3 bg-surface hover:bg-input disabled:opacity-50 text-slate-200 font-medium rounded-lg border border-hairline transition-colors"
            >
              {loadingMore ? 'Loading…' : `Load more (${(total - rfqs.length).toLocaleString()} more)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
