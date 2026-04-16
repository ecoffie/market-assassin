'use client';

import { useState, useEffect, useCallback } from 'react';

interface Grant {
  id: string;
  oppNumber: string;
  title: string;
  agency: string;
  agencyCode?: string;
  category?: string;
  categoryCode?: string;
  postedDate: string;
  closeDate?: string;
  description?: string;
  status: string;
  estimatedFunding?: number;
  awardCeiling?: number;
  awardFloor?: number;
  url: string;
}

interface GrantsMetadata {
  agencies: { code: string; name: string }[];
  categories: { code: string; name: string }[];
  statusOptions: string[];
}

interface GrantsPanelProps {
  email: string;
}

const AGENCY_COLORS: Record<string, { bg: string; text: string }> = {
  HHS: { bg: 'bg-pink-500/20', text: 'text-pink-400' },
  DOD: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  NSF: { bg: 'bg-violet-500/20', text: 'text-violet-400' },
  DOE: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  USDA: { bg: 'bg-green-500/20', text: 'text-green-400' },
  NASA: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  EPA: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  ED: { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  DOJ: { bg: 'bg-red-500/20', text: 'text-red-400' },
  DOL: { bg: 'bg-lime-500/20', text: 'text-lime-400' },
  DOC: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  VA: { bg: 'bg-teal-500/20', text: 'text-teal-400' },
};

function formatCurrency(value: number | undefined): string {
  if (!value) return 'TBD';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return 'TBD';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function getDaysRemaining(closeDate: string | undefined): { days: number | null; urgent: boolean } {
  if (!closeDate) return { days: null, urgent: false };
  try {
    const close = new Date(closeDate);
    const now = new Date();
    const diffMs = close.getTime() - now.getTime();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return { days, urgent: days <= 14 && days >= 0 };
  } catch {
    return { days: null, urgent: false };
  }
}

export default function GrantsPanel({ email }: GrantsPanelProps) {
  const [metadata, setMetadata] = useState<GrantsMetadata | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalHits, setTotalHits] = useState(0);

  // Search filters
  const [keywordFilter, setKeywordFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('posted');

  // Fetch metadata on mount
  useEffect(() => {
    async function fetchMetadata() {
      try {
        const response = await fetch('/api/grants');
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setMetadata({
              agencies: data.agencies,
              categories: data.categories,
              statusOptions: data.statusOptions,
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch grants metadata:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchMetadata();
  }, []);

  // Search grants
  const handleSearch = useCallback(async () => {
    if (!keywordFilter && !agencyFilter && !categoryFilter) {
      setGrants([]);
      setTotalHits(0);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (keywordFilter) params.append('keyword', keywordFilter);
      if (agencyFilter) params.append('agency', agencyFilter);
      if (categoryFilter) params.append('category', categoryFilter);
      if (statusFilter) params.append('status', statusFilter);
      params.append('limit', '50');

      const response = await fetch(`/api/grants?${params.toString()}`, {
        headers: { 'X-User-Email': email },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.grants) {
          setGrants(data.grants);
          setTotalHits(data.totalHits || data.grants.length);
        } else if (data.error) {
          setError(data.error);
        }
      } else {
        setError('Failed to search grants');
      }
    } catch (err) {
      console.error('Grants search error:', err);
      setError('Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  }, [keywordFilter, agencyFilter, categoryFilter, statusFilter, email]);

  const getAgencyColors = (agencyCode: string | undefined) => {
    return AGENCY_COLORS[agencyCode || ''] || { bg: 'bg-gray-500/20', text: 'text-gray-400' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading grants intelligence...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <span className="text-xl">💰</span>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Annual Funding</p>
              <p className="text-2xl font-bold text-white">$700B+</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <span className="text-xl">🏛️</span>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Federal Agencies</p>
              <p className="text-2xl font-bold text-white">{metadata?.agencies.length || 0}+</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <span className="text-xl">📋</span>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Categories</p>
              <p className="text-2xl font-bold text-white">{metadata?.categories.length || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search Form */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Search Federal Grants</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Keyword</label>
            <input
              type="text"
              value={keywordFilter}
              onChange={(e) => setKeywordFilter(e.target.value)}
              placeholder="cybersecurity, research..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Agency</label>
            <select
              value={agencyFilter}
              onChange={(e) => setAgencyFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option value="">All Agencies</option>
              {metadata?.agencies.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} - {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option value="">All Categories</option>
              {metadata?.categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option value="posted">Open Now</option>
              <option value="forecasted">Forecasted</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
        <button
          onClick={handleSearch}
          disabled={searching || (!keywordFilter && !agencyFilter && !categoryFilter)}
          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {searching ? 'Searching...' : 'Search Grants'}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Search Results */}
      {grants.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex justify-between items-center">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              {totalHits.toLocaleString()} Grants Found
            </h3>
          </div>
          <div className="divide-y divide-gray-800">
            {grants.map((grant) => {
              const colors = getAgencyColors(grant.agencyCode);
              const { days, urgent } = getDaysRemaining(grant.closeDate);
              return (
                <div key={grant.id} className={`p-5 hover:bg-gray-800/50 transition-colors ${urgent ? 'border-l-4 border-l-red-500' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}>
                          {grant.agencyCode || grant.agency}
                        </span>
                        {grant.category && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-400">
                            {grant.category}
                          </span>
                        )}
                        {urgent && days !== null && (
                          <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-500/20 text-red-400 animate-pulse">
                            🔥 {days} days left
                          </span>
                        )}
                      </div>
                      <h4 className="text-white font-medium mb-1 line-clamp-2">{grant.title}</h4>
                      <p className="text-gray-500 text-xs mb-2">{grant.oppNumber}</p>
                      {grant.description && (
                        <p className="text-gray-400 text-sm line-clamp-2 mb-2">{grant.description}</p>
                      )}
                      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                        <span>Posted: {formatDate(grant.postedDate)}</span>
                        {grant.closeDate && (
                          <span>Closes: {formatDate(grant.closeDate)}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {(grant.awardCeiling || grant.estimatedFunding) && (
                        <div className="text-lg font-bold text-white mb-2">
                          {grant.awardFloor && grant.awardCeiling && grant.awardFloor !== grant.awardCeiling
                            ? `${formatCurrency(grant.awardFloor)} - ${formatCurrency(grant.awardCeiling)}`
                            : formatCurrency(grant.awardCeiling || grant.estimatedFunding)}
                        </div>
                      )}
                      <a
                        href={grant.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-3 py-1.5 bg-emerald-600/20 text-emerald-400 text-xs font-medium rounded hover:bg-emerald-600/30 transition-colors"
                      >
                        View on Grants.gov →
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Select Categories */}
      {grants.length === 0 && metadata && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Popular Categories</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {metadata.categories.slice(0, 10).map((cat) => (
              <button
                key={cat.code}
                onClick={() => {
                  setCategoryFilter(cat.code);
                  setTimeout(handleSearch, 100);
                }}
                className="p-3 rounded-lg border border-gray-700 hover:border-emerald-500/50 transition-colors text-left bg-gray-800/50"
              >
                <div className="text-sm font-medium text-white">{cat.name}</div>
                <div className="text-xs text-gray-500">{cat.code}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Call to Action */}
      {grants.length === 0 && !error && (
        <div className="bg-gradient-to-br from-emerald-900/30 to-green-900/30 border border-emerald-500/30 rounded-xl p-6 text-center">
          <p className="text-gray-300 mb-2">
            <strong className="text-white">Access $700B+ in federal grant funding!</strong>
          </p>
          <p className="text-gray-400 text-sm">
            Search by keyword, agency, or category to find grants that match your organization&apos;s mission.
            Unlike contracts, grants don&apos;t require you to compete against other bidders.
          </p>
        </div>
      )}
    </div>
  );
}
