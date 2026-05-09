'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';
import { getMIApiHeaders } from '../authHeaders';

interface ForecastsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface Forecast {
  id: string;
  title: string;
  description?: string;
  agency?: string;
  source_agency?: string;
  department?: string;
  office?: string;
  naics?: string;
  naics_code?: string;
  naicsDescription?: string;
  naics_description?: string;
  psc?: string;
  fiscalYear?: string;
  fiscal_year?: string;
  quarter?: string;
  awardDate?: string;
  anticipated_award_date?: string;
  valueMin?: number;
  valueMax?: number;
  valueRange?: string;
  estimated_value_min?: number;
  estimated_value_max?: number;
  estimated_value_range?: string;
  setAside?: string;
  set_aside_type?: string;
  contractType?: string;
  incumbent?: string;
  state?: string;
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

export default function ForecastsPanel({ email, tier }: ForecastsPanelProps) {
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
  const getForecastHeaders = useCallback(() => (
    getMIApiHeaders(email)
  ), [email]);

  // Fetch summary on mount
  useEffect(() => {
    async function fetchSummary() {
      try {
        const response = await fetch('/api/forecasts', { headers: getForecastHeaders() });
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setSummary(data.summary);
            setStats({ byAgency: data.byAgency || [], topNaics: data.topNaics || [] });
          }
        }
      } catch (err) {
        console.error('Failed to fetch forecast summary:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchSummary();
  }, [getForecastHeaders]);

  // Load user profile and auto-search
  useEffect(() => {
    if (!email) return;

    async function loadProfileAndSearch() {
      try {
        const res = await fetch(`/api/alerts/preferences?email=${encodeURIComponent(email as string)}`);
        const data = await res.json();

        if (data.success && data.data?.naicsCodes?.length > 0) {
          const codes = data.data.naicsCodes;
          setNaicsFilter(codes[0]);
          handleSearchWithParams(codes[0], '', '');
        }
      } catch (err) {
        console.error('Failed to load profile for forecasts:', err);
      }
    }

    loadProfileAndSearch();
  }, [email]);

  const handleSearchWithParams = useCallback(async (naics: string, agency: string, query: string) => {
    if (!naics && !agency && !query) {
      setForecasts([]);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (naics) params.append('naics', naics);
      if (agency) params.append('agency', agency);
      if (query) params.append('search', query);
      params.append('limit', '50');

      const response = await fetch(`/api/forecasts?${params.toString()}`, {
        headers: getForecastHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.forecasts) {
          setForecasts(data.forecasts);
        } else if (data.error) {
          setError(data.error);
        }
      } else {
        setError('Failed to search forecasts');
      }
    } catch (err) {
      console.error('Forecast search error:', err);
      setError('Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  }, [getForecastHeaders]);

  const handleSearch = () => {
    handleSearchWithParams(naicsFilter, agencyFilter, searchQuery);
  };

  const getAgencyColors = (agency: string) => {
    return AGENCY_COLORS[agency] || { bg: 'bg-slate-500/20', text: 'text-slate-400' };
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-48" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-slate-800 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Procurement Forecasts</h1>
        <p className="text-slate-400 mt-1">
          Plan ahead with {summary?.totalForecasts.toLocaleString() || '7,700+'} upcoming agency procurements
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <span className="text-xl">📊</span>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider">Total Forecasts</p>
                <p className="text-2xl font-bold text-white">{summary.totalForecasts.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <span className="text-xl">🏛️</span>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider">Active Sources</p>
                <p className="text-2xl font-bold text-white">{summary.activeSources} Agencies</p>
              </div>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <span className="text-xl">💰</span>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider">Spend Coverage</p>
                <p className="text-2xl font-bold text-white">{summary.estimatedSpendCoverage}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Search Forecasts</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">NAICS Code</label>
            <input
              type="text"
              value={naicsFilter}
              onChange={(e) => setNaicsFilter(e.target.value)}
              placeholder="541512"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Agency</label>
            <select
              value={agencyFilter}
              onChange={(e) => setAgencyFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none"
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
            <label className="block text-xs text-slate-500 mb-1">Keyword</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="cybersecurity"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={searching || (!naicsFilter && !agencyFilter && !searchQuery)}
              className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Search Results */}
      {forecasts.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              {forecasts.length} Forecasts Found
            </h3>
          </div>
          <div className="divide-y divide-slate-800">
            {forecasts.map((forecast) => {
              const agencyCode = forecast.agency || forecast.source_agency || 'Unknown';
              const naicsCode = forecast.naics || forecast.naics_code;
              const setAside = forecast.setAside || forecast.set_aside_type;
              const valueMin = forecast.valueMin || forecast.estimated_value_min;
              const valueMax = forecast.valueMax || forecast.estimated_value_max;
              const valueRange = forecast.valueRange || forecast.estimated_value_range;
              const awardDate = forecast.awardDate || forecast.anticipated_award_date;
              const colors = getAgencyColors(agencyCode);

              return (
                <div key={forecast.id} className="p-5 hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Badges */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}>
                          {agencyCode}
                        </span>
                        {setAside && setAside !== 'No set aside used.' && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                            {setAside}
                          </span>
                        )}
                        {naicsCode && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">
                            NAICS {naicsCode}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h4 className="text-white font-medium mb-1 line-clamp-2">{forecast.title}</h4>

                      {/* Department/Office */}
                      {(forecast.department || forecast.office) && (
                        <p className="text-slate-400 text-sm mb-1">
                          {forecast.department}{forecast.office ? ` • ${forecast.office}` : ''}
                        </p>
                      )}

                      {/* Description */}
                      {forecast.description && (
                        <p className="text-slate-500 text-sm line-clamp-2 mb-2">{forecast.description}</p>
                      )}

                      {/* Incumbent */}
                      {forecast.incumbent && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs text-amber-500">Incumbent:</span>
                          <span className="text-xs text-amber-400 font-medium">{forecast.incumbent}</span>
                        </div>
                      )}
                    </div>

                    {/* Value */}
                    <div className="text-right shrink-0 min-w-[100px]">
                      {(valueMin || valueMax || valueRange) && (
                        <>
                          <div className="text-lg font-bold text-emerald-400">
                            {valueRange || (valueMin === valueMax
                              ? formatCurrency(valueMax)
                              : `${formatCurrency(valueMin)} - ${formatCurrency(valueMax)}`
                            )}
                          </div>
                          <div className="text-xs text-slate-500">Est. Value</div>
                        </>
                      )}
                      {awardDate && (
                        <div className="text-xs text-slate-500 mt-2">
                          Award: {formatDate(awardDate)}
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

      {/* Agency Breakdown - shown when no search results */}
      {stats && stats.byAgency.length > 0 && forecasts.length === 0 && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Browse by Agency</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats.byAgency.slice(0, 8).map((item) => {
              const colors = getAgencyColors(item.agency);
              return (
                <button
                  key={item.agency}
                  onClick={() => {
                    setAgencyFilter(item.agency);
                    handleSearchWithParams('', item.agency, '');
                  }}
                  className={`p-3 rounded-lg border border-slate-700 hover:border-amber-500/50 transition-colors text-left ${colors.bg}`}
                >
                  <div className={`text-lg font-bold ${colors.text}`}>{item.count.toLocaleString()}</div>
                  <div className="text-xs text-slate-400">{item.agency}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Top NAICS */}
      {stats && stats.topNaics.length > 0 && forecasts.length === 0 && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Top NAICS Codes</h3>
          <div className="space-y-2">
            {stats.topNaics.slice(0, 6).map((item) => (
              <button
                key={item.naics_code}
                onClick={() => {
                  setNaicsFilter(item.naics_code);
                  handleSearchWithParams(item.naics_code, '', '');
                }}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                <div>
                  <span className="text-white font-medium">{item.naics_code}</span>
                  {item.naics_title && (
                    <span className="text-slate-400 text-sm ml-2">{item.naics_title}</span>
                  )}
                </div>
                <span className="text-amber-400 font-medium">{item.record_count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty State CTA */}
      {forecasts.length === 0 && !error && !stats?.byAgency.length && (
        <div className="bg-gradient-to-br from-amber-900/30 to-slate-900 border border-amber-500/30 rounded-xl p-6 text-center">
          <div className="text-5xl mb-4">🔮</div>
          <p className="text-slate-300 mb-2">
            <strong className="text-white">Get ahead of the competition!</strong>
          </p>
          <p className="text-slate-400 text-sm">
            Search forecasts to find upcoming opportunities 6-18 months before they hit SAM.gov.
          </p>
        </div>
      )}
    </div>
  );
}
