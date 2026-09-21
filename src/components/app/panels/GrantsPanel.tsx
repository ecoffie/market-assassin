'use client';

import { useState, useEffect, useCallback } from 'react';
import { Star, Flame, Zap, Search, FlaskConical, ShieldCheck, BarChart3, Medal, HeartPulse } from 'lucide-react';
import type { AppTier } from '../UnifiedSidebar';
import { useAppTracker } from '../track';

interface GrantsPanelProps {
  email: string | null;
  tier: AppTier;
}

interface Grant {
  id: string;
  oppNumber: string;
  title: string;
  agency: string;
  agencyCode?: string;
  postedDate?: string;
  closeDate?: string;
  status?: string;
  docType?: string;
  url: string;
  score?: number; // profile-relevance score when sorted by relevance
}

interface GrantsMetadata {
  agencies: { code: string; name: string }[];
  categories: { code: string; name: string }[];
}

export default function GrantsPanel({ email, tier }: GrantsPanelProps) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [metadata, setMetadata] = useState<GrantsMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedAgency, setSelectedAgency] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('posted');
  const [error, setError] = useState<string | null>(null);
  const [totalHits, setTotalHits] = useState(0);       // TRUE total (e.g. 1209)
  const [sortedByRelevance, setSortedByRelevance] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // 'relevance' = ranked for me; 'newest' = browse everything unranked.
  const [sort, setSort] = useState<'relevance' | 'newest'>(email ? 'relevance' : 'newest');
  const track = useAppTracker(email);

  // Load metadata on mount
  useEffect(() => {
    loadMetadata();
  }, []);

  // page_view once per email-resolution.
  useEffect(() => {
    if (!email) return;
    track('page_view', 'grants');
  }, [email, track]);

  const loadMetadata = async () => {
    try {
      const res = await fetch('/api/grants');
      if (res.ok) {
        const data = await res.json();
        setMetadata({
          agencies: data.agencies || [],
          categories: data.categories || [],
        });
      }
    } catch (err) {
      console.error('Failed to load grants metadata:', err);
    }
    // After metadata, load initial grants
    searchGrants('', '', '', 'posted', email ? 'relevance' : 'newest', 0);
  };

  const searchGrants = useCallback(async (
    keyword: string,
    agency: string,
    category: string,
    status: string,
    sortMode: 'relevance' | 'newest',
    offset = 0,
  ) => {
    if (offset > 0) setLoadingMore(true); else setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (keyword) params.set('keyword', keyword);
      if (agency) params.set('agency', agency);
      if (category) params.set('category', category);
      params.set('status', status);
      params.set('limit', '25');
      params.set('offset', String(offset));
      params.set('sort', sortMode);
      // Email lets the API rank grants by profile (NAICS / keywords / agencies)
      // when sort='relevance'. sort='newest' browses everything, unranked.
      if (email) params.set('email', email);

      const res = await fetch(`/api/grants?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        // Append on "load more", replace on a fresh search.
        setGrants(prev => offset > 0 ? [...prev, ...(data.grants || [])] : (data.grants || []));
        setTotalHits(data.total || 0);
        setHasMore(!!data.hasMore);
        setHasProfile(!!data.hasProfile);
        setSortedByRelevance(!!data.sortedByRelevance);
      } else {
        setError(data.error || 'Failed to search grants');
        if (offset === 0) setGrants([]);
      }
    } catch (err) {
      console.error('Grant search error:', err);
      setError('Failed to connect to Grants.gov');
      if (offset === 0) setGrants([]);
    } finally {
      setIsLoading(false);
      setLoadingMore(false);
    }
  }, [email]);

  const handleSearch = () => {
    searchGrants(searchKeyword, selectedAgency, selectedCategory, selectedStatus, sort, 0);
    track('tool_use', 'grants', {
      action: 'search',
      // Length signals (vs values) — captures intent without leaking
      // the user's specific keywords.
      has_keyword: !!searchKeyword,
      has_agency: !!selectedAgency,
      has_category: !!selectedCategory,
      status: selectedStatus,
    });
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const getDaysUntilClose = (closeDate?: string) => {
    if (!closeDate) return null;
    const close = new Date(closeDate);
    const now = new Date();
    const diff = Math.ceil((close.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Federal Grants</h1>
          <p className="text-muted mt-1">
            Search open and forecasted opportunities from Grants.gov
            {totalHits > 0 && (
              <span className="text-emerald-400 ml-2">
                Showing {grants.length} of {totalHits.toLocaleString()}
              </span>
            )}
          </p>
        </div>
        {/* Sort toggle — "For me" (profile rank) vs "Newest" (browse all).
            Only shown when the user has a profile to rank by. */}
        {hasProfile && (
          <div className="inline-flex rounded-lg border border-hairline bg-surface p-0.5 text-sm">
            <button
              onClick={() => { setSort('relevance'); searchGrants(searchKeyword, selectedAgency, selectedCategory, selectedStatus, 'relevance', 0); }}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors ${sort === 'relevance' ? 'bg-emerald-600 text-white' : 'text-muted hover:text-white'}`}
            >
              <Star className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> For me
            </button>
            <button
              onClick={() => { setSort('newest'); searchGrants(searchKeyword, selectedAgency, selectedCategory, selectedStatus, 'newest', 0); }}
              className={`px-3 py-1.5 rounded-md transition-colors ${sort === 'newest' ? 'bg-emerald-600 text-white' : 'text-muted hover:text-white'}`}
            >
              Newest
            </button>
          </div>
        )}
      </div>

      {/* Search & Filters */}
      <div className="space-y-4">
        {/* Search Row */}
        <div className="flex gap-3">
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search grants (e.g., cybersecurity, SBIR, research)"
            className="flex-1 px-4 py-2.5 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
          />
          <button
            onClick={handleSearch}
            disabled={isLoading}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white font-medium rounded-lg transition-colors"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap gap-3">
          {/* Agency Filter */}
          <select
            value={selectedAgency}
            onChange={(e) => setSelectedAgency(e.target.value)}
            className="px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm focus:border-emerald-500 outline-none"
          >
            <option value="">All Agencies</option>
            {metadata?.agencies.map((a) => (
              <option key={a.code} value={a.code}>{a.name}</option>
            ))}
          </select>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm focus:border-emerald-500 outline-none"
          >
            <option value="">All Categories</option>
            {metadata?.categories.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm focus:border-emerald-500 outline-none"
          >
            <option value="posted">Open Now</option>
            <option value="forecasted">Forecasted</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Grant List */}
      {!isLoading && grants.length > 0 && (
        <div className="space-y-3">
          {grants.map((grant) => {
            const daysLeft = getDaysUntilClose(grant.closeDate);
            const isUrgent = daysLeft !== null && daysLeft <= 7 && daysLeft >= 0;
            const isClosingSoon = daysLeft !== null && daysLeft <= 14 && daysLeft > 7;

            return (
              <a
                key={grant.id}
                href={grant.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`block bg-ground border rounded-xl p-4 hover:border-emerald-500/50 transition-colors ${
                  isUrgent ? 'border-red-500/50 bg-red-500/5' : 'border-surface'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Badges */}
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      {sortedByRelevance && typeof grant.score === 'number' && grant.score > 0 && (
                        <span
                          title="How well this grant matches your NAICS, keywords, and target agencies"
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded font-semibold ${
                            grant.score >= 50 ? 'bg-emerald-500/20 text-emerald-300'
                            : grant.score >= 30 ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-input text-muted'
                          }`}
                        >
                          {grant.score >= 50 ? <><Star className="h-3 w-3 shrink-0" strokeWidth={2.5} /> Strong match</> : grant.score >= 30 ? 'Good match' : 'Weak match'}
                        </span>
                      )}
                      {grant.agencyCode && (
                        <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                          {grant.agencyCode}
                        </span>
                      )}
                      {grant.status && (
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          grant.status === 'posted'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-input text-muted'
                        }`}>
                          {grant.status}
                        </span>
                      )}
                      {isUrgent && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded font-medium">
                          <Flame className="h-3 w-3 shrink-0" strokeWidth={2.5} /> {daysLeft} days left
                        </span>
                      )}
                      {isClosingSoon && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">
                          <Zap className="h-3 w-3 shrink-0" strokeWidth={2.5} /> {daysLeft} days left
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h3 className="font-medium text-white mb-1 line-clamp-2">{grant.title}</h3>
                    <p className="text-sm text-muted">{grant.agency}</p>
                    {grant.oppNumber && (
                      <p className="text-xs text-faint mt-1">#{grant.oppNumber}</p>
                    )}
                  </div>

                  {/* Dates */}
                  <div className="text-right shrink-0">
                    {grant.closeDate && (
                      <>
                        <div className="text-sm font-medium text-white">
                          Closes {formatDate(grant.closeDate)}
                        </div>
                        <div className="text-xs text-faint mt-1">
                          Posted {formatDate(grant.postedDate)}
                        </div>
                      </>
                    )}
                    <div className="mt-2">
                      <span className="text-xs text-emerald-400 hover:text-emerald-300">
                        View on Grants.gov →
                      </span>
                    </div>
                  </div>
                </div>
              </a>
            );
          })}

          {/* Load more — pages through the full result set (e.g. all 1,209). */}
          {hasMore && (
            <button
              onClick={() => searchGrants(searchKeyword, selectedAgency, selectedCategory, selectedStatus, sort, grants.length)}
              disabled={loadingMore}
              className="w-full py-3 bg-surface hover:bg-input disabled:opacity-50 text-slate-200 font-medium rounded-lg border border-hairline transition-colors"
            >
              {loadingMore ? 'Loading…' : `Load more (${(totalHits - grants.length).toLocaleString()} more)`}
            </button>
          )}
          {!hasMore && grants.length > 0 && totalHits > 25 && (
            <p className="text-center text-xs text-faint py-2">That&apos;s all {totalHits.toLocaleString()} — end of results.</p>
          )}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && grants.length === 0 && !error && (
        <div className="bg-ground border border-surface rounded-xl p-8 text-center">
          <div className="mb-4 flex justify-center"><Search className="h-9 w-9 text-faint" strokeWidth={1.5} /></div>
          <h3 className="text-lg font-medium text-white mb-2">No Grants Found</h3>
          <p className="text-muted text-sm">
            No grants matched this search. Try a broader keyword, a different agency, or forecasted status.
          </p>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 pt-4 border-t border-surface">
        <button
          onClick={() => {
            setSearchKeyword('SBIR');
            searchGrants('SBIR', '', '', 'posted', sort, 0);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface text-muted text-sm rounded-lg hover:bg-input hover:text-white transition-colors"
        >
          <FlaskConical className="h-4 w-4 shrink-0" strokeWidth={2} /> SBIR/STTR
        </button>
        <button
          onClick={() => {
            setSearchKeyword('cybersecurity');
            searchGrants('cybersecurity', '', '', 'posted', sort, 0);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface text-muted text-sm rounded-lg hover:bg-input hover:text-white transition-colors"
        >
          <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={2} /> Cybersecurity
        </button>
        <button
          onClick={() => {
            setSearchKeyword('research');
            searchGrants('research', '', '', 'posted', sort, 0);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface text-muted text-sm rounded-lg hover:bg-input hover:text-white transition-colors"
        >
          <BarChart3 className="h-4 w-4 shrink-0" strokeWidth={2} /> Research
        </button>
        <button
          onClick={() => {
            setSearchKeyword('');
            setSelectedAgency('DOD');
            searchGrants('', 'DOD', '', 'posted', sort, 0);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface text-muted text-sm rounded-lg hover:bg-input hover:text-white transition-colors"
        >
          <Medal className="h-4 w-4 shrink-0" strokeWidth={2} /> DOD Grants
        </button>
        <button
          onClick={() => {
            setSearchKeyword('');
            setSelectedAgency('HHS');
            searchGrants('', 'HHS', '', 'posted', sort, 0);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface text-muted text-sm rounded-lg hover:bg-input hover:text-white transition-colors"
        >
          <HeartPulse className="h-4 w-4 shrink-0" strokeWidth={2} /> HHS Grants
        </button>
      </div>
    </div>
  );
}
