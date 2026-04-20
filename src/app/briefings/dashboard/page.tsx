'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface NoticeTypeInfo {
  code: string;
  label: string;
  count: number;
  color: string;
}

interface AgencyCount {
  department: string;
  count: number;
}

interface SetAsideCount {
  code: string;
  count: number;
}

interface DashboardStats {
  totalActive: number;
  urgentCount: number;
  byNoticeType: NoticeTypeInfo[];
  topAgencies: AgencyCount[];
  bySetAside: SetAsideCount[];
}

interface Opportunity {
  id: string;
  notice_id: string;
  title: string;
  department: string;
  office: string | null;
  naics_code: string | null;
  notice_type: string | null;
  notice_type_code: string | null;
  set_aside_code: string | null;
  set_aside_description: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  pop_state: string | null;
  ui_link: string | null;
  days_until_deadline: number | null;
  urgency_level: 'critical' | 'urgent' | 'normal' | 'upcoming';
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const NOTICE_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  // Text-based (from SAM.gov)
  'Solicitation': { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30' },
  'Combined Synopsis/Solicitation': { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/30' },
  'Presolicitation': { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30' },
  'Sources Sought': { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30' },
  'Special Notice': { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/30' },
  'Intent to Bundle': { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/30' },
  'Award Notice': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  'Justification': { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
};

const NOTICE_TYPE_LABELS: Record<string, string> = {
  'Solicitation': 'RFP',
  'Combined Synopsis/Solicitation': 'Combined',
  'Presolicitation': 'Pre-Sol',
  'Sources Sought': 'Sources Sought',
  'Special Notice': 'Special',
  'Intent to Bundle': 'Intent to Bundle',
  'Award Notice': 'Award',
  'Justification': 'J&A',
};

const SET_ASIDE_LABELS: Record<string, string> = {
  'SBA': 'Small Business',
  'SBP': 'Small Business',
  '8A': '8(a)',
  '8AN': '8(a) Competitive',
  'HUBZone': 'HUBZone',
  'SDVOSBC': 'SDVOSB',
  'WOSB': 'WOSB',
  'EDWOSB': 'EDWOSB',
  'VSA': 'VOSB',
  'None': 'Full & Open',
};

export default function MIDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOpps, setLoadingOpps] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [noticeType, setNoticeType] = useState('');
  const [urgency, setUrgency] = useState('');
  const [setAside, setSetAside] = useState('');
  const [page, setPage] = useState(1);

  // Expanded rows
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/mi-dashboard?mode=stats');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  const fetchOpportunities = useCallback(async () => {
    setLoadingOpps(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '25');
      if (search) params.set('search', search);
      if (noticeType) params.set('noticeType', noticeType);
      if (urgency) params.set('urgency', urgency);
      if (setAside) params.set('setAside', setAside);

      const res = await fetch(`/api/mi-dashboard?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setOpportunities(data.opportunities);
        setPagination(data.pagination);
      }
    } catch (err) {
      console.error('Failed to fetch opportunities:', err);
    } finally {
      setLoadingOpps(false);
    }
  }, [page, search, noticeType, urgency, setAside]);

  useEffect(() => {
    fetchStats().then(() => setLoading(false));
  }, [fetchStats]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchOpportunities();
  };

  const clearFilters = () => {
    setSearch('');
    setNoticeType('');
    setUrgency('');
    setSetAside('');
    setPage(1);
  };

  const exportToCSV = () => {
    const headers = ['Title', 'Agency', 'NAICS', 'Notice Type', 'Set-Aside', 'Deadline', 'Days Left', 'SAM Link'];
    const rows = opportunities.map(opp => [
      opp.title,
      opp.department,
      opp.naics_code || '',
      NOTICE_TYPE_LABELS[opp.notice_type || ''] || opp.notice_type || '',
      SET_ASIDE_LABELS[opp.set_aside_code || ''] || opp.set_aside_code || 'Full & Open',
      opp.response_deadline ? new Date(opp.response_deadline).toLocaleDateString() : '',
      opp.days_until_deadline ?? '',
      opp.ui_link || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mi-dashboard-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getUrgencyBadge = (level: string, days: number | null) => {
    if (level === 'critical') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded bg-red-500/20 text-red-400 border border-red-500/30">
          🔥 {days}d
        </span>
      );
    }
    if (level === 'urgent') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
          ⚡ {days}d
        </span>
      );
    }
    if (days !== null) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-gray-700/50 text-gray-400">
          📅 {days}d
        </span>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-white font-bold text-xl">MI</span>
          </div>
          <p className="text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/briefings" className="text-gray-400 hover:text-gray-300">
              ← Briefings
            </Link>
            <div className="w-px h-6 bg-gray-700" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center">
                <span className="text-white font-bold text-sm">MI</span>
              </div>
              <span className="font-semibold">Market Intelligence Dashboard</span>
            </div>
          </div>
          <button
            onClick={exportToCSV}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 hover:bg-purple-500 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Overview */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-3xl font-bold text-purple-400">{stats.totalActive.toLocaleString()}</div>
              <div className="text-sm text-gray-500 mt-1">Active Opportunities</div>
            </div>
            <div className="bg-gray-900 border border-red-900/50 rounded-xl p-4">
              <div className="text-3xl font-bold text-red-400">{stats.urgentCount.toLocaleString()}</div>
              <div className="text-sm text-gray-500 mt-1">Due in 7 Days</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-3xl font-bold text-green-400">
                {(stats.byNoticeType.find(t => t.code === 'o' || t.code === 'Solicitation')?.count || 0).toLocaleString()}
              </div>
              <div className="text-sm text-gray-500 mt-1">Solicitations</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-3xl font-bold text-purple-400">
                {(stats.byNoticeType.find(t => t.code === 'r' || t.code === 'Sources Sought')?.count || 0).toLocaleString()}
              </div>
              <div className="text-sm text-gray-500 mt-1">Sources Sought</div>
            </div>
          </div>
        )}

        {/* Charts Row */}
        {stats && (
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Notice Type Chart */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">By Notice Type</h3>
              <div className="space-y-3">
                {stats.byNoticeType
                  .sort((a, b) => b.count - a.count)
                  .map(type => {
                    const maxCount = Math.max(...stats.byNoticeType.map(t => t.count));
                    const percentage = Math.round((type.count / maxCount) * 100);
                    const colors = NOTICE_TYPE_COLORS[type.code] || { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/30' };
                    return (
                      <div key={type.code}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <button
                            onClick={() => { setNoticeType(type.code); setPage(1); }}
                            className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text} hover:opacity-80 transition-opacity`}
                          >
                            {type.label}
                          </button>
                          <span className="text-gray-400">{type.count.toLocaleString()}</span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500`}
                            style={{ width: `${percentage}%`, backgroundColor: type.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Top Agencies Chart */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Top Agencies</h3>
              <div className="space-y-2">
                {stats.topAgencies.slice(0, 8).map((agency, i) => {
                  const maxCount = stats.topAgencies[0]?.count || 1;
                  const percentage = Math.round((agency.count / maxCount) * 100);
                  return (
                    <div key={agency.department} className="flex items-center gap-3">
                      <span className="w-5 text-xs text-gray-500 font-mono">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="h-6 bg-gray-800 rounded overflow-hidden relative">
                          <div
                            className="h-full bg-gradient-to-r from-purple-600/40 to-purple-500/20 transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                          <span className="absolute inset-0 flex items-center px-2 text-xs truncate">
                            {agency.department}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 w-12 text-right">{agency.count.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search titles, agencies..."
                  className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Notice Type */}
            <select
              value={noticeType}
              onChange={(e) => { setNoticeType(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="">All Types</option>
              <option value="Solicitation">Solicitation</option>
              <option value="Combined Synopsis/Solicitation">Combined</option>
              <option value="Sources Sought">Sources Sought</option>
              <option value="Presolicitation">Pre-Solicitation</option>
              <option value="Special Notice">Special Notice</option>
            </select>

            {/* Urgency */}
            <select
              value={urgency}
              onChange={(e) => { setUrgency(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="">All Urgency</option>
              <option value="critical">🔥 Critical (≤3 days)</option>
              <option value="urgent">⚡ Urgent (≤7 days)</option>
            </select>

            {/* Set-Aside */}
            <select
              value={setAside}
              onChange={(e) => { setSetAside(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="">All Set-Asides</option>
              <option value="SBA">Small Business</option>
              <option value="8A">8(a)</option>
              <option value="HUBZone">HUBZone</option>
              <option value="SDVOSBC">SDVOSB</option>
              <option value="WOSB">WOSB</option>
            </select>

            <button
              type="submit"
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Search
            </button>

            {(search || noticeType || urgency || setAside) && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-3 py-2 text-sm text-gray-400 hover:text-gray-300"
              >
                Clear
              </button>
            )}
          </form>
        </div>

        {/* Results count */}
        {pagination && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-400">
              Showing {opportunities.length} of {pagination.total.toLocaleString()} opportunities
              {(search || noticeType || urgency || setAside) && ' (filtered)'}
            </p>
          </div>
        )}

        {/* Opportunities List */}
        <div className="space-y-2">
          {loadingOpps ? (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-3" />
              Loading opportunities...
            </div>
          ) : opportunities.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p>No opportunities found</p>
              <button onClick={clearFilters} className="mt-2 text-purple-400 hover:text-purple-300 text-sm">
                Clear filters
              </button>
            </div>
          ) : (
            opportunities.map(opp => {
              const colors = NOTICE_TYPE_COLORS[opp.notice_type || ''] || { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/30' };
              const isExpanded = expandedId === opp.id;

              return (
                <div
                  key={opp.id}
                  className={`bg-gray-900 border border-gray-800 rounded-lg overflow-hidden transition-colors hover:border-gray-700 ${
                    opp.urgency_level === 'critical' ? 'border-l-4 border-l-red-500' :
                    opp.urgency_level === 'urgent' ? 'border-l-4 border-l-orange-500' :
                    'border-l-4 border-l-purple-500/50'
                  }`}
                >
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : opp.id)}
                    className="w-full text-left p-4"
                  >
                    <div className="flex items-start gap-3">
                      {/* Notice Type Badge */}
                      <span className={`shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded ${colors.bg} ${colors.text} border ${colors.border}`}>
                        {NOTICE_TYPE_LABELS[opp.notice_type || ''] || opp.notice_type || 'Notice'}
                      </span>

                      {/* Main Content */}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm text-white truncate">{opp.title}</h4>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          {opp.department}
                          {opp.naics_code && ` • NAICS ${opp.naics_code}`}
                          {opp.pop_state && ` • ${opp.pop_state}`}
                        </p>
                      </div>

                      {/* Right Side */}
                      <div className="shrink-0 text-right flex items-center gap-3">
                        {opp.set_aside_code && opp.set_aside_code !== 'None' && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                            {SET_ASIDE_LABELS[opp.set_aside_code] || opp.set_aside_code}
                          </span>
                        )}
                        {getUrgencyBadge(opp.urgency_level, opp.days_until_deadline)}
                        <svg
                          className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-2 border-t border-gray-800 bg-gray-900/50">
                      <div className="grid md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500 text-xs">Posted</span>
                          <p className="text-gray-300">{formatDate(opp.posted_date)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Deadline</span>
                          <p className={opp.urgency_level === 'critical' ? 'text-red-400 font-semibold' : 'text-gray-300'}>
                            {formatDate(opp.response_deadline)}
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Office</span>
                          <p className="text-gray-300">{opp.office || '—'}</p>
                        </div>
                      </div>
                      {opp.ui_link && (
                        <div className="mt-4 flex gap-2">
                          <a
                            href={opp.ui_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2"
                          >
                            View on SAM.gov
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={page === pagination.totalPages}
              className="px-3 py-2 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm text-gray-500">
            Data sourced from SAM.gov • Refreshed daily at 6 AM UTC • GovCon Giants AI
          </p>
        </div>
      </footer>
    </div>
  );
}
