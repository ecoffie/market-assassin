'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Landmark, DollarSign, Zap, Check, Sparkles, ClipboardList, X, CheckCircle2 } from 'lucide-react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders, authedFetch } from '../authHeaders';
import { NaicsAutocompleteInput } from '../../codes/NaicsAutocompleteInput';
import { useAppTracker } from '../track';
import { SaveToPipelineButton } from '@/components/briefings/SaveToPipelineButton';
import { formatMindyCurrency } from '@/lib/mindy/formatters';

interface ForecastsPanelProps {
  email: string | null;
  tier: AppTier;
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
  signalType?: 'forecast' | 'dod_early_signal';
  noticeType?: string;
  solicitationNumber?: string;
  responseDeadline?: string;
  rfpReleased?: boolean;
  rfpStage?: string | null;
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

interface SavedForecastDefaults {
  naicsCodes: string[];
  agencies: string[];
  states: string[];
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
  return formatMindyCurrency(value, 'TBD');
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values
    .map(value => (value || '').trim())
    .filter(Boolean)));
}

function extractNaicsCode(value?: string | null): string {
  return (value || '').match(/\d{2,6}/)?.[0] || '';
}

export default function ForecastsPanel({ email, tier }: ForecastsPanelProps) {
  void tier;
  const [summary, setSummary] = useState<ForecastsSummary | null>(null);
  const [stats, setStats] = useState<ForecastsStats | null>(null);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [profileDefaults, setProfileDefaults] = useState<SavedForecastDefaults | null>(null);
  const [usingProfileDefaults, setUsingProfileDefaults] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedForecastIds, setExpandedForecastIds] = useState<Set<string>>(new Set());

  // Search filters
  const [naicsFilter, setNaicsFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [setAsideFilter, setSetAsideFilter] = useState('');

  // Forecast request state
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestAgency, setRequestAgency] = useState('');
  const [requestOffice, setRequestOffice] = useState('');
  const [requestNaics, setRequestNaics] = useState('');
  const [requestDescription, setRequestDescription] = useState('');
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState(false);
  const track = useAppTracker(email);
  const getForecastHeaders = useCallback(() => (
    getMIApiHeaders(email)
  ), [email]);

  // Fetch summary on mount
  // page_view once per email-resolution. Separate effect so it
  // doesn't refire when forecast filters change.
  useEffect(() => {
    if (!email) return;
    track('page_view', 'forecasts');
  }, [email, track]);

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

  const handleSearchWithParams = useCallback(async (naics: string, agency: string, query: string, state = '', setAside = '') => {
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
      if (state) params.append('state', state);          // route supports pop_state filter
      if (setAside) params.append('setAside', setAside);  // route supports set_aside_type filter
      params.append('limit', '200');

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

  // Load shared profile and auto-search all saved NAICS/agencies.
  useEffect(() => {
    if (!email) return;

    async function loadProfileAndSearch() {
      try {
        const [prefsResponse, workspaceResponse] = await Promise.all([
          fetch(`/api/alerts/preferences?email=${encodeURIComponent(email as string)}`),
          authedFetch(`/api/app/workspace?email=${encodeURIComponent(email as string)}`, email),
        ]);
        const [prefs, workspace] = await Promise.all([
          prefsResponse.json().catch(() => null),
          workspaceResponse.json().catch(() => null),
        ]);

        const settings = workspace?.settings || {};
        const profile = workspace?.profile || {};
        const defaults: SavedForecastDefaults = {
          naicsCodes: uniqueStrings([
            ...(prefs?.data?.naicsCodes || []),
            ...(settings.naics_codes || []),
            ...(profile.notification?.naics_codes || []),
            ...(profile.briefing?.naics_codes || []),
          ]).map(extractNaicsCode).filter(Boolean),
          agencies: uniqueStrings([
            ...(prefs?.data?.targetAgencies || []),
            ...(settings.target_agencies || []),
            ...(profile.notification?.agencies || []),
            ...(profile.briefing?.agencies || []),
          ]),
          states: uniqueStrings([
            ...(prefs?.data?.locationStates || []),
            prefs?.data?.locationState,
          ]).map(state => state.toUpperCase()),
        };

        setProfileDefaults(defaults);
        const profileNaics = defaults.naicsCodes.join(', ');
        const profileAgencies = defaults.agencies.join(', ');
        // Pre-fill the State field from the saved profile (multi-state supported)
        // so forecasts auto-scope to where the user works — and apply it to the
        // initial search instead of computing it then dropping it (Eric, Jun 23).
        const profileStates = defaults.states.join(', ');
        setNaicsFilter(profileNaics);
        setStateFilter(profileStates);
        setUsingProfileDefaults(defaults.naicsCodes.length > 0 || defaults.agencies.length > 0);
        if (profileNaics || profileAgencies) {
          handleSearchWithParams(profileNaics, profileAgencies, '', profileStates);
        }
      } catch (err) {
        console.error('Failed to load profile for forecasts:', err);
      }
    }

    loadProfileAndSearch();
  }, [email, getForecastHeaders, handleSearchWithParams]);

  const handleSearch = () => {
    setUsingProfileDefaults(false);
    handleSearchWithParams(naicsFilter, agencyFilter, searchQuery, stateFilter, setAsideFilter);
    track('tool_use', 'forecasts', {
      action: 'search',
      // Length signals (vs values) so we capture intent without
      // leaking the user's specific NAICS query.
      has_naics: !!naicsFilter,
      has_agency: !!agencyFilter,
      has_query: !!searchQuery,
    });
  };

  const useSavedProfile = () => {
    const profileNaics = profileDefaults?.naicsCodes.join(', ') || '';
    const profileAgencies = profileDefaults?.agencies.join(', ') || '';
    const profileStates = profileDefaults?.states.join(', ') || '';
    setNaicsFilter(profileNaics);
    setAgencyFilter('');
    setSearchQuery('');
    setStateFilter(profileStates);
    setUsingProfileDefaults(true);
    handleSearchWithParams(profileNaics, profileAgencies, '', profileStates);
    track('tool_use', 'forecasts', {
      action: 'use_saved_profile',
      naics_count: profileDefaults?.naicsCodes.length || 0,
      agency_count: profileDefaults?.agencies.length || 0,
    });
  };

  const getAgencyColors = (agency: string) => {
    return AGENCY_COLORS[agency] || { bg: 'bg-slate-500/20', text: 'text-slate-400' };
  };

  const handleRequestForecast = async () => {
    if (!email || !requestAgency) return;

    setRequestSubmitting(true);
    try {
      const res = await authedFetch('/api/app/forecast-request', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          agency: requestAgency,
          office: requestOffice,
          naicsCode: requestNaics,
          description: requestDescription,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setRequestSuccess(true);
        track('tool_use', 'forecasts', {
          action: 'request_forecast',
          // Which agency the user wants more visibility into — gives
          // BD an "agencies people are asking us about" view.
          agency: requestAgency,
          has_office: !!requestOffice,
          has_naics: !!requestNaics,
          has_description: !!requestDescription,
        });
        setTimeout(() => {
          setShowRequestModal(false);
          setRequestSuccess(false);
          setRequestAgency('');
          setRequestOffice('');
          setRequestNaics('');
          setRequestDescription('');
        }, 2000);
      } else {
        setError(data.error || 'Failed to submit request');
      }
    } catch (err) {
      console.error('Forecast request error:', err);
      setError('Failed to submit request');
    } finally {
      setRequestSubmitting(false);
    }
  };

  const openRequestModal = (prefillAgency?: string, prefillNaics?: string) => {
    setRequestAgency(prefillAgency || agencyFilter || '');
    setRequestNaics(prefillNaics || naicsFilter || '');
    setShowRequestModal(true);
  };

  const toggleForecast = (forecastId: string) => {
    setExpandedForecastIds(prev => {
      const next = new Set(prev);
      if (next.has(forecastId)) {
        next.delete(forecastId);
      } else {
        next.add(forecastId);
      }
      return next;
    });
  };

  const agencyCoverageCount = summary?.activeSources || stats?.byAgency.length || 0;
  const agencyCoverageLabel = `${agencyCoverageCount.toLocaleString()} ${agencyCoverageCount === 1 ? 'Agency' : 'Agencies'}`;

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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Upcoming Buys</h1>
          <p className="text-slate-400 mt-1">
            Planned agency purchases that have not hit SAM.gov yet. Use this to get in early before the solicitation drops.
          </p>
          {profileDefaults && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className={`px-2 py-1 rounded ${usingProfileDefaults ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {usingProfileDefaults ? 'Using saved profile' : 'Custom search'}
              </span>
              {profileDefaults.naicsCodes.length > 0 && (
                <span className="px-2 py-1 rounded bg-slate-800 text-slate-300">
                  NAICS {profileDefaults.naicsCodes.slice(0, 4).join(', ')}
                  {profileDefaults.naicsCodes.length > 4 ? ` +${profileDefaults.naicsCodes.length - 4}` : ''}
                </span>
              )}
              {profileDefaults.agencies.length > 0 && (
                <span className="px-2 py-1 rounded bg-slate-800 text-slate-300">
                  {profileDefaults.agencies.length} target agencies
                </span>
              )}
              {profileDefaults.states.length > 0 && (
                <span className="px-2 py-1 rounded bg-slate-800 text-slate-300">
                  {profileDefaults.states.slice(0, 6).join(', ')}
                  {profileDefaults.states.length > 6 ? ` +${profileDefaults.states.length - 6}` : ''}
                </span>
              )}
            </div>
          )}
        </div>
        {profileDefaults && (
          <button
            onClick={useSavedProfile}
            className="px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-sm rounded-lg transition-colors"
          >
            Use Saved Profile
          </button>
        )}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <BarChart3 className="h-5 w-5 text-amber-300" strokeWidth={2} />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider">Upcoming Buys</p>
                <p className="text-2xl font-bold text-white">{summary.totalForecasts.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Landmark className="h-5 w-5 text-blue-300" strokeWidth={2} />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider">Agencies Covered</p>
                <p className="text-2xl font-bold text-white">{agencyCoverageLabel}</p>
                <p className="text-[11px] text-slate-600 mt-1">Forecast sources with upcoming-buy data</p>
              </div>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-emerald-300" strokeWidth={2} />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider">Estimated Spend Coverage</p>
                <p className="text-2xl font-bold text-white">{summary.estimatedSpendCoverage}</p>
                <p className="text-[11px] text-slate-600 mt-1">Share of forecast records with value data</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Explore Upcoming Buys</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">NAICS Code(s)</label>
            <NaicsAutocompleteInput
              value={naicsFilter}
              onChange={setNaicsFilter}
              placeholder="541512, 236, 238"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Agency Override</label>
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
          <div>
            <label className="block text-xs text-slate-500 mb-1">State</label>
            <input
              type="text"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="FL, GA"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-amber-500 focus:outline-none uppercase"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Set-Aside</label>
            <select
              value={setAsideFilter}
              onChange={(e) => setSetAsideFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none"
            >
              {/* Values match real set_aside_type strings in agency_forecasts. */}
              <option value="">Any Set-Aside</option>
              <option value="Small Business">Small Business</option>
              <option value="8(a)">8(a)</option>
              <option value="HUBZone">HUBZone</option>
              <option value="SDVOSB">SDVOSB</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={handleSearch}
              disabled={searching || (!naicsFilter && !agencyFilter && !searchQuery && !stateFilter && !setAsideFilter)}
              className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-800">
          {(naicsFilter || agencyFilter || searchQuery) && (
            <button
              onClick={() => {
                setNaicsFilter('');
                setAgencyFilter('');
                setSearchQuery('');
                setForecasts([]);
              }}
              className="text-sm text-slate-400 hover:text-white"
            >
              Clear Filters
            </button>
          )}
          <button
            onClick={() => {
              setNaicsFilter('');
              setAgencyFilter('');
              setSearchQuery('');
              handleSearch();
            }}
            disabled={searching}
            className="text-sm text-amber-400 hover:text-amber-300"
          >
            View All Forecasts →
          </button>
          {usingProfileDefaults && (
            <span className="text-xs text-slate-500">Using saved profile NAICS</span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Search Results */}
      {forecasts.some(f => f.signalType === 'dod_early_signal') && (
        <div className="flex items-start gap-2 bg-amber-500/8 border border-amber-500/25 rounded-lg px-4 py-2.5 text-xs text-amber-300/90">
          <Zap className="h-3.5 w-3.5 shrink-0 mt-0.5" strokeWidth={2.5} />
          <span>DoD doesn&apos;t publish a formal forecast feed — its <strong>Early signal</strong> items are SAM Sources Sought / RFIs (6–12 months pre-RFP), the earliest forward signal we can surface for the largest buyer.</span>
        </div>
      )}
      {forecasts.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              {forecasts.length} Upcoming Buys Found
            </h3>
          </div>
          <div className="divide-y divide-slate-800">
            {forecasts.map((forecast) => {
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
              const expanded = expandedForecastIds.has(forecast.id);

              return (
                <div key={forecast.id} className="p-5 hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => toggleForecast(forecast.id)}
                      className="flex-1 min-w-0 text-left"
                      aria-expanded={expanded}
                    >
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
                        {forecast.contractType && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                            {forecast.contractType}
                          </span>
                        )}
                        {naicsCode && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300" title={naicsDesc}>
                            NAICS {naicsCode}
                          </span>
                        )}
                        {forecast.psc && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">
                            PSC {forecast.psc}
                          </span>
                        )}
                        {/* DoD early signal (SAM Sources Sought/RFI) — labeled
                            distinctly from a formal LRAF forecast. */}
                        {forecast.signalType === 'dod_early_signal' ? (
                          <>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300" title="Early signal from SAM (Sources Sought / RFI) — 6-12 months pre-RFP. DoD doesn't publish a formal forecast feed.">
                              <Zap className="h-3 w-3 shrink-0" strokeWidth={2.5} /> Early signal{forecast.noticeType ? ` · ${forecast.noticeType}` : ''}
                            </span>
                            {/* Stage: still pre-RFP (shape it) vs RFP already
                                dropped (go bid) — detected via matching sol #. */}
                            {forecast.rfpReleased ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-rose-500/20 text-rose-300" title="The solicitation/RFP for this has already been released — time to bid, not shape.">
                                <Check className="h-3 w-3 shrink-0" strokeWidth={3} /> RFP released
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/15 text-emerald-300" title="No solicitation released yet — still time to engage the office and shape the requirement.">
                                pre-RFP
                              </span>
                            )}
                          </>
                        ) : forecast.status && forecast.status !== 'forecast' ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-400">
                            {forecast.status}
                          </span>
                        ) : null}
                      </div>

                      {/* Title */}
                      <div className="flex items-start gap-2">
                        <h4 className="text-white font-medium mb-1 line-clamp-2">{forecast.title}</h4>
                        <span className="mt-0.5 text-xs text-slate-500">{expanded ? 'Hide' : 'Details'}</span>
                      </div>

                      {/* Department/Office */}
                      {(forecast.department || forecast.office) && (
                        <p className="text-slate-400 text-sm mb-1">
                          {forecast.department}{forecast.office ? ` • ${forecast.office}` : ''}
                        </p>
                      )}

                      {/* Description */}
                      {forecast.description && (
                        <p className={`text-slate-500 text-sm mb-2 ${expanded ? '' : 'line-clamp-2'}`}>
                          {forecast.description}
                        </p>
                      )}

                      {/* Incumbent */}
                      {forecast.incumbent && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs text-amber-500">Incumbent:</span>
                          <span className="text-xs text-amber-400 font-medium">{forecast.incumbent}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {fiscalYear && (
                          <span>FY {fiscalYear}{forecast.quarter ? ` ${forecast.quarter}` : ''}</span>
                        )}
                        {awardDate && (
                          <span>Planned award {formatDate(awardDate)}</span>
                        )}
                        {state && (
                          <span>{state}</span>
                        )}
                        {naicsDesc && (
                          <span>{naicsDesc}</span>
                        )}
                      </div>

                      {expanded && (
                        <div className="mt-4 grid gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-sm md:grid-cols-2">
                          <DetailItem label="Agency" value={forecast.department || agencyCode} />
                          <DetailItem label="Office" value={forecast.office} />
                          <DetailItem label="NAICS" value={naicsCode ? `${naicsCode}${naicsDesc ? ` - ${naicsDesc}` : ''}` : naicsDesc} />
                          <DetailItem label="PSC" value={forecast.psc} />
                          <DetailItem label="Set-aside" value={setAside} />
                          <DetailItem label="Contract type" value={forecast.contractType} />
                          <DetailItem label="Forecast timing" value={[fiscalYear && `FY ${fiscalYear}`, forecast.quarter].filter(Boolean).join(' ')} />
                          <DetailItem label="Place of performance" value={state} />
                          <DetailItem label="Incumbent" value={forecast.incumbent} />
                          <DetailItem label="Status" value={forecast.status} />
                        </div>
                      )}
                    </button>

                    {/* Value */}
                    <div className="text-right shrink-0 min-w-[120px] flex flex-col items-end gap-2">
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
                      <div className="mt-2 flex flex-col items-end gap-1">
                        <div className="text-[11px] uppercase tracking-wider text-slate-600">Add to My Pursuits</div>
                        <SaveToPipelineButton
                          opportunity={{
                            title: forecast.title,
                            noticeId: forecast.id,
                            solicitationNumber: forecast.id,
                            agency: agencyCode,
                            naicsCode: naicsCode || undefined,
                            setAside: setAside || undefined,
                            deadline: awardDate || undefined,
                          }}
                          email={email || ''}
                          variant="small"
                        />
                      </div>
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
          <div className="mb-4 flex justify-center"><Sparkles className="h-11 w-11 text-amber-300" strokeWidth={1.5} /></div>
          <p className="text-slate-300 mb-2">
            <strong className="text-white">Get ahead of the competition!</strong>
          </p>
          <p className="text-slate-400 text-sm">
            Search forecasts to find upcoming opportunities 6-18 months before they hit SAM.gov.
          </p>
        </div>
      )}

      {/* Request Missing Forecast Card - shown when search returns no/few results */}
      {forecasts.length < 5 && (naicsFilter || agencyFilter) && !loading && !searching && (
        <div className="bg-slate-900 border border-purple-500/30 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
              <ClipboardList className="h-6 w-6 text-purple-300" strokeWidth={1.75} />
            </div>
            <div className="flex-1">
              <h4 className="text-white font-medium mb-1">Missing forecast data?</h4>
              <p className="text-slate-400 text-sm mb-3">
                {forecasts.length === 0
                  ? `We do not have forecast data matching your search yet.`
                  : `Only ${forecasts.length} forecasts found for this search.`
                } Request this data and we will research it for you.
              </p>
              <button
                onClick={() => openRequestModal()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Request This Forecast
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forecast Request Modal */}
      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Request Forecast Data</h3>
              <button
                onClick={() => setShowRequestModal(false)}
                aria-label="Close"
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {requestSuccess ? (
              <div className="text-center py-8">
                <div className="mb-4 flex justify-center"><CheckCircle2 className="h-11 w-11 text-emerald-400" strokeWidth={1.5} /></div>
                <p className="text-emerald-400 font-medium">Request submitted!</p>
                <p className="text-slate-400 text-sm mt-2">We will notify you when this data is available.</p>
              </div>
            ) : (
              <>
                <p className="text-slate-400 text-sm mb-4">
                  Tell us what forecast data you need. Our team will research and add it to the database.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Agency *</label>
                    <input
                      type="text"
                      value={requestAgency}
                      onChange={(e) => setRequestAgency(e.target.value)}
                      placeholder="e.g., Department of Defense, VA, HHS"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Office (optional)</label>
                    <input
                      type="text"
                      value={requestOffice}
                      onChange={(e) => setRequestOffice(e.target.value)}
                      placeholder="e.g., AFMC, VA Office of Acquisition"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">NAICS Code (optional)</label>
                    <input
                      type="text"
                      value={requestNaics}
                      onChange={(e) => setRequestNaics(e.target.value)}
                      placeholder="e.g., 541512"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">What are you looking for?</label>
                    <textarea
                      value={requestDescription}
                      onChange={(e) => setRequestDescription(e.target.value)}
                      placeholder="Describe the type of opportunities you're trying to find..."
                      rows={3}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none resize-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => setShowRequestModal(false)}
                    className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRequestForecast}
                    disabled={!requestAgency || requestSubmitting}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {requestSubmitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-600">{label}</div>
      <div className="mt-0.5 text-slate-300">{value}</div>
    </div>
  );
}
