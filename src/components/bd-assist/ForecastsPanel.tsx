'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { SaveToPipelineButton } from '@/components/briefings/SaveToPipelineButton';

interface Forecast {
  id: string;
  title: string;
  description?: string;
  // API returns these field names (mapped from database)
  agency?: string;
  source_agency?: string; // fallback
  department?: string;
  office?: string;
  naics?: string;
  naics_code?: string; // fallback
  naicsDescription?: string;
  naics_description?: string; // fallback
  psc?: string;
  fiscalYear?: string;
  fiscal_year?: string; // fallback
  quarter?: string;
  awardDate?: string;
  anticipated_award_date?: string; // fallback
  valueMin?: number;
  valueMax?: number;
  valueRange?: string;
  estimated_value_min?: number; // fallback
  estimated_value_max?: number; // fallback
  estimated_value_range?: string; // fallback
  setAside?: string;
  set_aside_type?: string; // fallback
  contractType?: string;
  incumbent?: string;
  state?: string;
  pop_state?: string; // fallback
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
  autoLoadProfile?: boolean; // Auto-load and filter by user's profile
}

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'Washington DC' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

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

export default function ForecastsPanel({ email, autoLoadProfile = true }: ForecastsPanelProps) {
  const [summary, setSummary] = useState<ForecastsSummary | null>(null);
  const [stats, setStats] = useState<ForecastsStats | null>(null);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProfileFiltered, setIsProfileFiltered] = useState(false);
  const [userNaicsCodes, setUserNaicsCodes] = useState<string[]>([]);
  const profileLoadedRef = useRef(false);

  // Search filters
  const [naicsFilter, setNaicsFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [setAsideFilter, setSetAsideFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');

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

  // Load user's NAICS profile and auto-search
  useEffect(() => {
    if (!autoLoadProfile || !email || profileLoadedRef.current) return;

    async function loadProfileAndSearch() {
      try {
        const res = await fetch(`/api/alerts/preferences?email=${encodeURIComponent(email)}`);
        const data = await res.json();

        if (data.success && data.data?.naicsCodes?.length > 0) {
          const codes = data.data.naicsCodes;
          setUserNaicsCodes(codes);
          profileLoadedRef.current = true;

          // Auto-search with first NAICS code (most specific)
          // Use the first code for the search
          setNaicsFilter(codes[0]);
          setIsProfileFiltered(true);

          // Trigger search with profile NAICS codes
          setSearching(true);
          const params = new URLSearchParams();
          // Use OR logic for multiple NAICS - search each and combine
          params.append('naics', codes[0]);
          params.append('limit', '50');

          const response = await fetch(`/api/forecasts?${params.toString()}`, {
            headers: { 'X-User-Email': email },
          });

          if (response.ok) {
            const searchData = await response.json();
            if (searchData.success && searchData.forecasts) {
              setForecasts(searchData.forecasts);
            }
          }
          setSearching(false);
        }
      } catch (err) {
        console.error('Failed to load profile for forecasts:', err);
      }
    }

    loadProfileAndSearch();
  }, [email, autoLoadProfile]);

  // Search forecasts
  const handleSearch = useCallback(async () => {
    if (!naicsFilter && !agencyFilter && !searchQuery && !setAsideFilter && !stateFilter) {
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
      if (stateFilter) params.append('state', stateFilter);
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
  }, [naicsFilter, agencyFilter, searchQuery, setAsideFilter, stateFilter, email]);

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
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Search Forecasts</h3>
          {userNaicsCodes.length > 0 && !isProfileFiltered && (
            <button
              onClick={() => {
                setNaicsFilter(userNaicsCodes[0]);
                setIsProfileFiltered(true);
                // Trigger search
                handleSearch();
              }}
              className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
            >
              🎯 Use My Profile ({userNaicsCodes.length} NAICS)
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
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
            <label className="block text-xs text-gray-500 mb-1">State</label>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none"
            >
              <option value="">All States</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} - {s.name}
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
          disabled={searching || (!naicsFilter && !agencyFilter && !searchQuery && !setAsideFilter && !stateFilter)}
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
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                {forecasts.length} Forecasts Found
              </h3>
              {isProfileFiltered && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  🎯 Your Profile
                </span>
              )}
            </div>
            {isProfileFiltered && (
              <button
                onClick={() => {
                  setIsProfileFiltered(false);
                  setNaicsFilter('');
                  setForecasts([]);
                }}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
              >
                Clear Filter
              </button>
            )}
          </div>
          <div className="divide-y divide-gray-800">
            {forecasts.map((forecast) => {
              // Handle both API field names and fallback field names
              const agencyCode = forecast.agency || forecast.source_agency || 'Unknown';
              const naicsCode = forecast.naics || forecast.naics_code;
              const naicsDesc = forecast.naicsDescription || forecast.naics_description;
              const setAside = forecast.setAside || forecast.set_aside_type;
              const valueMin = forecast.valueMin || forecast.estimated_value_min;
              const valueMax = forecast.valueMax || forecast.estimated_value_max;
              const valueRange = forecast.valueRange || forecast.estimated_value_range;
              const awardDate = forecast.awardDate || forecast.anticipated_award_date;
              const fiscalYear = forecast.fiscalYear || forecast.fiscal_year;
              const state = forecast.state || forecast.pop_state;
              const colors = getAgencyColors(agencyCode);

              return (
                <div key={forecast.id} className="p-5 hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Top badges row */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}>
                          {agencyCode}
                        </span>
                        {setAside && setAside !== 'No set aside used.' && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                            {setAside}
                          </span>
                        )}
                        {forecast.contractType && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                            {forecast.contractType}
                          </span>
                        )}
                        {naicsCode && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300" title={naicsDesc}>
                            NAICS {naicsCode}
                          </span>
                        )}
                        {forecast.psc && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">
                            PSC {forecast.psc}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h4 className="text-white font-medium mb-1 line-clamp-2">{forecast.title}</h4>

                      {/* Department/Office */}
                      {(forecast.department || forecast.office) && (
                        <p className="text-gray-400 text-sm mb-1">
                          {forecast.department}{forecast.office ? ` • ${forecast.office}` : ''}
                        </p>
                      )}

                      {/* Description */}
                      {forecast.description && (
                        <p className="text-gray-500 text-sm line-clamp-2 mb-2">{forecast.description}</p>
                      )}

                      {/* Incumbent info */}
                      {forecast.incumbent && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs text-amber-500">⚠️ Incumbent:</span>
                          <span className="text-xs text-amber-400 font-medium">{forecast.incumbent}</span>
                        </div>
                      )}

                      {/* Details row */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                        {fiscalYear && (
                          <span className="flex items-center gap-1">
                            <span>📅</span> FY: {fiscalYear}{forecast.quarter ? ` ${forecast.quarter}` : ''}
                          </span>
                        )}
                        {awardDate && (
                          <span className="flex items-center gap-1">
                            <span>🎯</span> Award: {formatDate(awardDate)}
                          </span>
                        )}
                        {state && (
                          <span className="flex items-center gap-1">
                            <span>📍</span> {state}
                          </span>
                        )}
                        {naicsDesc && !naicsCode && (
                          <span className="flex items-center gap-1 text-gray-600">
                            {naicsDesc}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Value column + Track button */}
                    <div className="text-right shrink-0 min-w-[100px] flex flex-col items-end gap-2">
                      {(valueMin || valueMax || valueRange) && (
                        <>
                          <div className="text-lg font-bold text-emerald-400">
                            {valueRange ? valueRange : (
                              valueMin === valueMax
                                ? formatCurrency(valueMax)
                                : `${formatCurrency(valueMin)} - ${formatCurrency(valueMax)}`
                            )}
                          </div>
                          <div className="text-xs text-gray-500">Est. Value</div>
                        </>
                      )}
                      {forecast.status && forecast.status !== 'forecast' && (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-400">
                          {forecast.status}
                        </span>
                      )}
                      {/* Save to Pipeline button */}
                      <SaveToPipelineButton
                        opportunity={{
                          title: forecast.title,
                          agency: agencyCode,
                          naicsCode: naicsCode || undefined,
                          setAside: setAside || undefined,
                          deadline: awardDate || undefined,
                        }}
                        email={email}
                        variant="small"
                      />
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
