'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';
import { getMIApiHeaders } from '../authHeaders';

interface RecompetesPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface ExpiringContract {
  piid: string;
  title: string;
  incumbent: { name: string; uei: string };
  agency: string;
  subAgency?: string;
  naics: string;
  value: number;
  potentialValue: number;
  expirationDate: string;
  daysUntilExpiration: number;
  bidsReceived: number;
  competitionLevel: string;
  competitionType: string;
  location: { city?: string; state?: string; zip?: string };
}

interface ContractSummary {
  totalContracts: number;
  totalValue: number;
  avgBidsPerContract: number;
  soleSourceContracts: number;
  lowCompetitionContracts: number;
  urgentContracts: number;
}

interface RecompeteApiContract {
  contract_id?: string | null;
  award_id?: string | null;
  piid?: string | null;
  incumbent_name?: string | null;
  incumbent_uei?: string | null;
  awarding_agency?: string | null;
  awarding_sub_agency?: string | null;
  awarding_office?: string | null;
  naics_code?: string | null;
  naics_description?: string | null;
  description?: string | null;
  total_obligation?: number | null;
  potential_total_value?: number | null;
  period_of_performance_current_end?: string | null;
  place_of_performance_city?: string | null;
  place_of_performance_state?: string | null;
  place_of_performance_zip?: string | null;
  competition_type?: string | null;
  number_of_offers?: number | null;
  recompete_likelihood?: string | null;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getDaysUntil(dateStr?: string | null): number {
  if (!dateStr) return 0;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getCompetitionLevel(contract: RecompeteApiContract): string {
  const competitionType = (contract.competition_type || '').toLowerCase();
  const offers = contract.number_of_offers || 0;

  if (competitionType.includes('not competed') || competitionType.includes('sole source') || offers === 1) {
    return 'sole_source';
  }

  if (offers > 1 && offers <= 3) {
    return 'low';
  }

  return 'full';
}

function mapRecompeteContract(contract: RecompeteApiContract): ExpiringContract {
  const expirationDate = contract.period_of_performance_current_end || '';
  const piid = contract.piid || contract.award_id || contract.contract_id || '';
  const incumbentName = contract.incumbent_name || 'Unknown incumbent';

  return {
    piid,
    title: contract.description || contract.naics_description || `${incumbentName} recompete`,
    incumbent: {
      name: incumbentName,
      uei: contract.incumbent_uei || '',
    },
    agency: contract.awarding_agency || 'Unknown agency',
    subAgency: contract.awarding_sub_agency || contract.awarding_office || undefined,
    naics: contract.naics_code || '',
    value: contract.total_obligation || 0,
    potentialValue: contract.potential_total_value || contract.total_obligation || 0,
    expirationDate,
    daysUntilExpiration: getDaysUntil(expirationDate),
    bidsReceived: contract.number_of_offers || 0,
    competitionLevel: getCompetitionLevel(contract),
    competitionType: contract.competition_type || contract.recompete_likelihood || 'Recompete candidate',
    location: {
      city: contract.place_of_performance_city || undefined,
      state: contract.place_of_performance_state || undefined,
      zip: contract.place_of_performance_zip || undefined,
    },
  };
}

export default function RecompetesPanel({ email, tier }: RecompetesPanelProps) {
  const [contracts, setContracts] = useState<ExpiringContract[]>([]);
  const [summary, setSummary] = useState<ContractSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search filters
  const [naicsFilter, setNaicsFilter] = useState('');
  const [monthsFilter, setMonthsFilter] = useState('12');
  const [competitionFilter, setCompetitionFilter] = useState('');

  // Load user profile on mount
  useEffect(() => {
    if (!email) return;

    async function loadProfile() {
      try {
        const res = await fetch(`/api/alerts/preferences?email=${encodeURIComponent(email as string)}`);
        const data = await res.json();

        if (data.success && data.data?.naicsCodes?.length > 0) {
          const firstNaics = data.data.naicsCodes[0];
          setNaicsFilter(firstNaics);
          searchContracts(firstNaics, '12', '');
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load profile:', err);
        setLoading(false);
      }
    }

    loadProfile();
  }, [email]);

  const searchContracts = useCallback(async (naics: string, months: string, competition: string) => {
    if (!naics) {
      setContracts([]);
      setSummary(null);
      setLoading(false);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('naics', naics);
      params.set('months', months);
      params.set('limit', '200');
      params.set('sort', 'value');
      params.set('order', 'desc');

      const res = await fetch(`/api/recompete?${params.toString()}`, {
        headers: getMIApiHeaders(email),
      });
      const data = await res.json();

      if (data.success) {
        let mappedContracts: ExpiringContract[] = ((data.contracts || []) as RecompeteApiContract[])
          .map(mapRecompeteContract);

        if (competition === 'sole_source') {
          mappedContracts = mappedContracts.filter(contract => contract.competitionLevel === 'sole_source');
        } else if (competition === 'low') {
          mappedContracts = mappedContracts.filter(contract =>
            contract.competitionLevel === 'low' || contract.competitionLevel === 'sole_source'
          );
        }

        const totalValue = mappedContracts.reduce((sum, contract) => sum + contract.value, 0);
        const offersWithValues = mappedContracts.filter(contract => contract.bidsReceived > 0);
        const avgBids = offersWithValues.length > 0
          ? offersWithValues.reduce((sum, contract) => sum + contract.bidsReceived, 0) / offersWithValues.length
          : 0;

        setContracts(mappedContracts);
        setSummary({
          totalContracts: competition ? mappedContracts.length : (data.pagination?.total || mappedContracts.length),
          totalValue,
          avgBidsPerContract: Math.round(avgBids * 10) / 10,
          soleSourceContracts: mappedContracts.filter(contract => contract.competitionLevel === 'sole_source').length,
          lowCompetitionContracts: mappedContracts.filter(contract => contract.competitionLevel === 'low').length,
          urgentContracts: mappedContracts.filter(contract =>
            contract.daysUntilExpiration > 0 && contract.daysUntilExpiration <= 90
          ).length,
        });
      } else {
        setError(data.error || 'Failed to search contracts');
        setContracts([]);
      }
    } catch (err) {
      console.error('Contract search error:', err);
      setError('Failed to connect to server');
      setContracts([]);
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }, [email]);

  const handleSearch = () => {
    searchContracts(naicsFilter, monthsFilter, competitionFilter);
  };

  const getCompetitionBadge = (level: string) => {
    switch (level) {
      case 'sole_source':
        return 'bg-green-500/20 text-green-400';
      case 'low':
        return 'bg-amber-500/20 text-amber-400';
      default:
        return 'bg-slate-500/20 text-slate-400';
    }
  };

  const getUrgencyBadge = (days: number) => {
    if (days <= 30) return { bg: 'bg-red-500/20 border-red-500/30', text: 'text-red-400', label: '🔥 Urgent' };
    if (days <= 90) return { bg: 'bg-amber-500/20', text: 'text-amber-400', label: '⚡ Soon' };
    if (days <= 180) return { bg: 'bg-blue-500/20', text: 'text-blue-400', label: '📅 6 mo' };
    return { bg: 'bg-slate-500/20', text: 'text-slate-400', label: `${Math.round(days / 30)} mo` };
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
        <h1 className="text-2xl font-bold text-white">Recompete Tracker</h1>
        <p className="text-slate-400 mt-1">Search the live recompete database for expiring federal awards</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-white">{summary.totalContracts}</div>
            <div className="text-xs text-slate-500">Matching Awards</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-emerald-400">{formatCurrency(summary.totalValue)}</div>
            <div className="text-xs text-slate-500">Visible Value</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-green-400">{summary.soleSourceContracts}</div>
            <div className="text-xs text-slate-500">Sole Source</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-red-400">{summary.urgentContracts}</div>
            <div className="text-xs text-slate-500">Urgent (&lt;90 days)</div>
          </div>
        </div>
      )}

      {/* Search Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Search Expiring Contracts</h3>
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
            <label className="block text-xs text-slate-500 mb-1">Expiring Within</label>
            <select
              value={monthsFilter}
              onChange={(e) => setMonthsFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none"
            >
              <option value="6">6 Months</option>
              <option value="12">12 Months</option>
              <option value="18">18 Months</option>
              <option value="24">24 Months</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Competition</label>
            <select
              value={competitionFilter}
              onChange={(e) => setCompetitionFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none"
            >
              <option value="">All</option>
              <option value="low">Low Competition</option>
              <option value="sole_source">Sole Source</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={searching || !naicsFilter}
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

      {/* Contract List */}
      {contracts.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              {contracts.length} Expiring Awards
            </h3>
          </div>
          <div className="divide-y divide-slate-800">
            {contracts.map((contract) => {
              const urgency = getUrgencyBadge(contract.daysUntilExpiration);

              return (
                <div key={contract.piid} className={`p-5 hover:bg-slate-800/50 transition-colors ${contract.daysUntilExpiration <= 90 ? 'bg-red-500/5' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Badges */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${urgency.bg} ${urgency.text}`}>
                          {urgency.label}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getCompetitionBadge(contract.competitionLevel)}`}>
                          {contract.competitionLevel === 'sole_source' ? 'Sole Source' :
                           contract.competitionLevel === 'low' ? `${contract.bidsReceived} bids` : contract.competitionType}
                        </span>
                        {contract.naics && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">
                            NAICS {contract.naics}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h4 className="text-white font-medium mb-1 line-clamp-2">{contract.title || 'Contract'}</h4>

                      {/* Agency */}
                      <p className="text-slate-400 text-sm mb-1">
                        {contract.agency}
                        {contract.subAgency && <span className="text-slate-500"> • {contract.subAgency}</span>}
                      </p>

                      {/* Incumbent */}
                      {contract.incumbent?.name && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs text-amber-500">Incumbent:</span>
                          <span className="text-xs text-amber-400 font-medium">{contract.incumbent.name}</span>
                        </div>
                      )}

                      {/* Location */}
                      {contract.location?.state && (
                        <div className="text-xs text-slate-500">
                          📍 {contract.location.city ? `${contract.location.city}, ` : ''}{contract.location.state}
                        </div>
                      )}
                    </div>

                    {/* Value & Dates */}
                    <div className="text-right shrink-0 min-w-[120px]">
                      <div className="text-lg font-bold text-emerald-400">{formatCurrency(contract.value)}</div>
                      <div className="text-xs text-slate-500">Contract Value</div>
                      <div className="text-sm font-medium text-white mt-2">
                        Expires {formatDate(contract.expirationDate)}
                      </div>
                      <div className={`text-xs mt-1 ${urgency.text}`}>
                        {contract.daysUntilExpiration} days left
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && contracts.length === 0 && !error && (
        <div className="bg-gradient-to-br from-amber-900/30 to-slate-900 border border-amber-500/30 rounded-xl p-6 text-center">
          <div className="text-5xl mb-4">⏰</div>
          <p className="text-slate-300 mb-2">
            <strong className="text-white">No recompetes found for these filters</strong>
          </p>
          <p className="text-slate-400 text-sm mb-4">
            Try a broader NAICS prefix, a longer expiration window, or all competition types.
          </p>
          <a
            href="/recompete"
            target="_blank"
            className="inline-block px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            View Full Recompete Tool →
          </a>
        </div>
      )}
    </div>
  );
}
