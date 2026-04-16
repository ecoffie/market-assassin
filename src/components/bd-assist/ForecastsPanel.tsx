'use client';

import { useState, useEffect, useCallback } from 'react';

interface Forecast {
  id: string;
  source_agency: string;
  title: string;
  description?: string;
  naics_code?: string;
  naics_description?: string;
  fiscal_year?: string;
  anticipated_award_date?: string;
  estimated_value_min?: number;
  estimated_value_max?: number;
  set_aside_type?: string;
  contracting_office?: string;
  pop_state?: string;
  status?: string;
}

interface ForecastsSummary {
  totalForecasts: number;
  activeSources: number;
  estimatedSpendCoverage: string;
}

interface ForecastsStats {
  byAgency: { agency: string; count: number }[];
  topNaics: { naics_code: string; naics_title?: string; record_count: number }[];
}

interface ForecastsPanelProps {
  email: string;
}

const AGENCY_COLORS: Record<string, { bg: string; text: string }> = {
  DOE: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  DOD: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  NASA: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  DOJ: { bg: 'bg-red-500/20', text: 'text-red-400' },
  VA: { bg: 'bg-green-500/20', text: 'text-green-400' },
  GSA: { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  DHS: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  HHS: { bg: 'bg-pink-500/20', text: 'text-pink-400' },
  DOI: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  DOT: { bg: 'bg-indigo-500/20', text: 'text-indigo-400' },
  NRC: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  NSF: { bg: 'bg-violet-500/20', text: 'text-violet-400' },
  SSA: { bg: 'bg-teal-500/20', text: 'text-teal-400' },
  DOL: { bg: 'bg-lime-500/20', text: 'text-lime-400' },
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
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function ForecastsPanel({ email }: ForecastsPanelProps) {
  const [summary, setSummary] = useState<ForecastsSummary | null>(null);
  const [stats, setStats] = useState<ForecastsStats | null>(null);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search filters
  const [naicsFilter, setNaicsFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [setAsideFilter, setSetAsideFilter] = useState('');

  // Fetch summary and stats on mount
  useEffect(() => {
    async function fetchSummary() {
      try {
        const response = await fetch('/api/forecasts');
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setSummary(data.summary);
            setStats({ byAgency: data.byAgency, topNaics: data.topNaics });
          }
        }
      } catch (err) {
        console.error('Failed to fetch forecast summary:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchSummary();
  }, []);

  // Search forecasts
  const handleSearch = useCallback(async () => {
    if (!naicsFilter && !agencyFilter && !searchQuery && !setAsideFilter) {
      setForecasts([]);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (naicsFilter) params.append('naics', naicsFilter);
      if (agencyFilter) params.append('agency', agencyFilter);
      if (searchQuery) params.append('search', searchQuery);
      if (setAsideFilter) params.append('setAside', setAsideFilter);
      params.append('limit', '50');

      const response = await fetch(`/api/forecasts?${params.toString()}`, {
        headers: {
          'X-User-Email': email,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.forecasts) {
          setForecasts(data.forecasts);
        } else if (data.error) {
          setError(data.error);
        }
      } else if (response.status === 401) {
        setError('Forecast search requires BD Assist subscription');
      } else {
        setError('Failed to search forecasts');
      }
    } catch (err) {
      console.error('Forecast search error:', err);
      setError('Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  }, [naicsFilter, agencyFilter, searchQuery, setAsideFilter, email]);

  const getAgencyColors = (agency: string) => {
    return AGENCY_COLORS[agency] || { bg: 'bg-gray-500/20', text: 'text-gray-400' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading forecast intelligence...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                <span className="text-xl">📊</span>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Total Forecasts</p>
                <p className="text-2xl font-bold text-white">{summary.totalForecasts.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <span className="text-xl">🏛️</span>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Active Sources</p>
                <p className="text-2xl font-bold text-white">{summary.activeSources} Agencies</p>
              </div>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <span className="text-xl">💰</span>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Spend Coverage</p>
                <p className="text-2xl font-bold text-white">{summary.estimatedSpendCoverage}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search Form */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Search Forecasts</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">NAICS Code</label>
            <input
              type="text"
              value={naicsFilter}
              onChange={(e) => setNaicsFilter(e.target.value)}
              placeholder="541512"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Agency</label>
            <select
              value={agencyFilter}
              onChange={(e) => setAgencyFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none"
            >
              <option value="">All Agencies</option>
              {stats?.byAgency.map((a) => (
                <option key={a.agency} value={a.agency}>
                  {a.agency} ({a.count})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Set-Aside</label>
            <select
              value={setAsideFilter}
              onChange={(e) => setSetAsideFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none"
            >
              <option value="">All Types</option>
              <option value="8(a)">8(a)</option>
              <option value="SDVOSB">SDVOSB</option>
              <option value="WOSB">WOSB</option>
              <option value="HUBZone">HUBZone</option>
              <option value="Small Business">Small Business</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Keyword</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="cybersecurity"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:border-violet-500 focus:outline-none"
            />
          </div>
        </div>
        <button
          onClick={handleSearch}
          disabled={searching || (!naicsFilter && !agencyFilter && !searchQuery && !setAsideFilter)}
          className="px-6 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {searching ? 'Searching...' : 'Search Forecasts'}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Search Results */}
      {forecasts.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex justify-between items-center">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              {forecasts.length} Forecasts Found
            </h3>
          </div>
          <div className="divide-y divide-gray-800">
            {forecasts.map((forecast) => {
              const colors = getAgencyColors(forecast.source_agency);
              return (
                <div key={forecast.id} className="p-5 hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}>
                          {forecast.source_agency}
                        </span>
                        {forecast.set_aside_type && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                            {forecast.set_aside_type}
                          </span>
                        )}
                        {forecast.naics_code && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">
                            NAICS {forecast.naics_code}
                          </span>
                        )}
                      </div>
                      <h4 className="text-white font-medium mb-1 line-clamp-2">{forecast.title}</h4>
                      {forecast.description && (
                        <p className="text-gray-400 text-sm line-clamp-2 mb-2">{forecast.description}</p>
                      )}
                      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                        {forecast.fiscal_year && (
                          <span>FY: {forecast.fiscal_year}</span>
                        )}
                        {forecast.anticipated_award_date && (
                          <span>Award: {formatDate(forecast.anticipated_award_date)}</span>
                        )}
                        {forecast.contracting_office && (
                          <span>Office: {forecast.contracting_office}</span>
                        )}
                        {forecast.pop_state && (
                          <span>Location: {forecast.pop_state}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {(forecast.estimated_value_min || forecast.estimated_value_max) && (
                        <div className="text-lg font-bold text-white">
                          {forecast.estimated_value_min === forecast.estimated_value_max
                            ? formatCurrency(forecast.estimated_value_max)
                            : `${formatCurrency(forecast.estimated_value_min)} - ${formatCurrency(forecast.estimated_value_max)}`}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Agency Breakdown */}
      {stats && stats.byAgency.length > 0 && forecasts.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Forecasts by Agency</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats.byAgency.slice(0, 8).map((item) => {
              const colors = getAgencyColors(item.agency);
              return (
                <button
                  key={item.agency}
                  onClick={() => {
                    setAgencyFilter(item.agency);
                    handleSearch();
                  }}
                  className={`p-3 rounded-lg border border-gray-700 hover:border-violet-500/50 transition-colors text-left ${colors.bg}`}
                >
                  <div className={`text-lg font-bold ${colors.text}`}>{item.count.toLocaleString()}</div>
                  <div className="text-xs text-gray-400">{item.agency}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Top NAICS */}
      {stats && stats.topNaics.length > 0 && forecasts.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Top NAICS Codes</h3>
          <div className="space-y-2">
            {stats.topNaics.slice(0, 6).map((item) => (
              <button
                key={item.naics_code}
                onClick={() => {
                  setNaicsFilter(item.naics_code);
                  handleSearch();
                }}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                <div>
                  <span className="text-white font-medium">{item.naics_code}</span>
                  {item.naics_title && (
                    <span className="text-gray-400 text-sm ml-2">{item.naics_title}</span>
                  )}
                </div>
                <span className="text-violet-400 font-medium">{item.record_count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Call to Action - for users without results */}
      {forecasts.length === 0 && !error && (
        <div className="bg-gradient-to-br from-violet-900/30 to-purple-900/30 border border-violet-500/30 rounded-xl p-6 text-center">
          <p className="text-gray-300 mb-2">
            <strong className="text-white">Get ahead of the competition!</strong>
          </p>
          <p className="text-gray-400 text-sm">
            Search forecasts to find upcoming opportunities 6-18 months before they hit SAM.gov.
            Position yourself early with the intel that matters.
          </p>
        </div>
      )}
    </div>
  );
}
