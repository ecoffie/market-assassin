'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import { SaveToPipelineButton } from '@/components/briefings/SaveToPipelineButton';
import { formatMindyCurrency } from '@/lib/mindy/formatters';
import ContractorLink from '../contractors/ContractorLink';
import { classifyLocation, MATCH_META, type LocationMatch } from '@/lib/geo/location-match';
import { formatDodaacOffice } from '@/lib/gov-contacts/dodaac';
import { useDodaacNames } from '@/components/app/useDodaacNames';

interface RecompetesPanelProps {
  email: string | null;
  tier: AppTier;
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
  locationMatch?: LocationMatch; // computed vs. the user's service area
}

// IDV/IDIQ + task-order row from /api/app/idv-contracts (USASpending). Eric: the
// vehicles + task orders behind the recompetes, same data different award type.
interface IDVRow {
  awardId: string;
  recipientName: string;
  recipientUei: string;
  awardAmount: number;
  description: string;
  startDate: string;
  endDate: string;
  agency: string;
  subAgency?: string;
  naicsCode: string;
  pscCode: string;
  popState: string;
  usaSpendingUrl: string;
  locationMatch?: LocationMatch; // vs. user's service area (the "in your area" signal)
}

interface ContractSummary {
  totalContracts: number;
  totalValue: number;
  avgBidsPerContract: number;
  soleSourceContracts: number;
  lowCompetitionContracts: number;
  urgentContracts: number;
  inAreaContracts: number; // hq + service + neighboring
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

interface StaticRecompeteContract {
  'Award ID'?: string;
  Agency?: string;
  Office?: string;
  Recipient?: string;
  NAICS?: string;
  'Total Value'?: string;
  'Start Date'?: string;
  Expiration?: string;
  State?: string;
}

interface SavedProfileDefaults {
  naicsCodes: string[];
  agencies: string[];
  states: string[];
  hqState?: string;
  source: string;
}

function formatCurrency(value: number): string {
  return formatMindyCurrency(value);
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

function parseCurrency(value?: string): number {
  if (!value) return 0;
  return parseFloat(value.replace(/[$,\s]/g, '')) || 0;
}

function parseStaticDate(dateStr?: string): string {
  if (!dateStr) return '';
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toISOString().split('T')[0];
}

function extractNaicsCode(value?: string | null): string {
  return (value || '').match(/\d{2,6}/)?.[0] || '';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values
    .map(value => (value || '').trim())
    .filter(Boolean)));
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

function getRecompeteOverview(contract: ExpiringContract): string {
  const agency = contract.agency || 'this agency';
  const incumbent = contract.incumbent?.name || 'the incumbent';
  const daysText = contract.daysUntilExpiration <= 0
    ? 'the current award has reached its listed end date'
    : `the current award ends in ${contract.daysUntilExpiration} days`;
  const competitionText = contract.competitionLevel === 'sole_source'
    ? 'It appears to have a sole-source or single-offer competition signal, so validate whether the next requirement may open up or remain limited.'
    : contract.competitionLevel === 'low'
      ? `It shows a lower-competition signal with ${contract.bidsReceived} recorded offers, so this may be worth early capture work.`
      : 'Use this as an early warning to research the incumbent, agency buyer, and likely recompete path.';

  return `${agency} has an expiring award held by ${incumbent}; ${daysText}. ${competitionText}`;
}

function mapStaticContract(contract: StaticRecompeteContract): ExpiringContract {
  const expirationDate = parseStaticDate(contract.Expiration);
  const naics = extractNaicsCode(contract.NAICS);
  const value = parseCurrency(contract['Total Value']);

  return {
    piid: contract['Award ID'] || `${contract.Recipient || 'contract'}-${contract.Expiration || ''}`,
    title: contract.NAICS || `${contract.Recipient || 'Incumbent'} recompete`,
    incumbent: {
      name: contract.Recipient || 'Unknown incumbent',
      uei: '',
    },
    agency: contract.Agency || 'Unknown agency',
    subAgency: contract.Office || undefined,
    naics,
    value,
    potentialValue: value,
    expirationDate,
    daysUntilExpiration: getDaysUntil(expirationDate),
    bidsReceived: 0,
    competitionLevel: 'full',
    competitionType: 'Expiring contract',
    location: {
      state: contract.State || undefined,
    },
  };
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
  const dodaacNames = useDodaacNames();
  void tier;
  const [contracts, setContracts] = useState<ExpiringContract[]>([]);
  const [allContracts, setAllContracts] = useState<ExpiringContract[]>([]);
  const [summary, setSummary] = useState<ContractSummary | null>(null);
  const [profileDefaults, setProfileDefaults] = useState<SavedProfileDefaults | null>(null);
  const [usingProfileDefaults, setUsingProfileDefaults] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedContracts, setExpandedContracts] = useState<Set<string>>(new Set());

  // Search filters
  const [naicsFilter, setNaicsFilter] = useState('');
  const [monthsFilter, setMonthsFilter] = useState('24');
  const [competitionFilter, setCompetitionFilter] = useState('');

  // Award-type view (Eric: IDV is the same USASpending data, a different slice —
  // a toggle here, not a separate panel). 'definitive' = current recompete view.
  const [awardType, setAwardType] = useState<'definitive' | 'task'>('definitive');
  const [idvContracts, setIdvContracts] = useState<IDVRow[]>([]);
  const [idvLoading, setIdvLoading] = useState(false);

  const toggleExpandedContract = (contractId: string) => {
    setExpandedContracts(prev => {
      const next = new Set(prev);
      if (next.has(contractId)) {
        next.delete(contractId);
      } else {
        next.add(contractId);
      }
      return next;
    });
  };

  const applyFilters = useCallback((
    sourceContracts: ExpiringContract[],
    naics: string,
    months: string,
    competition: string,
    defaults?: SavedProfileDefaults | null
  ) => {
    const naicsTerms = uniqueStrings(naics.split(/[, ]+/)).map(extractNaicsCode).filter(Boolean);
    const agencyTerms = defaults?.agencies || [];
    const stateTerms = defaults?.states || [];
    const monthsNumber = months === 'all' ? null : parseInt(months, 10);
    const now = new Date();

    let mappedContracts = sourceContracts.filter(contract => {
      if (naicsTerms.length > 0 && !naicsTerms.some(term => contract.naics.startsWith(term))) {
        return false;
      }

      if (agencyTerms.length > 0) {
        const agencyText = `${contract.agency} ${contract.subAgency || ''}`.toLowerCase();
        if (!agencyTerms.some(agency => agencyText.includes(agency.toLowerCase()))) {
          return false;
        }
      }

      // Geography is NO LONGER a silent filter. We show all contracts and
      // surface a visible location-match badge instead (Eric 2026-06-04 —
      // "I don't see how it measures against the places I work"). The badge
      // is computed below; out-of-area contracts stay visible, labeled.

      if (monthsNumber) {
        const expiration = new Date(`${contract.expirationDate}T00:00:00`);
        if (Number.isNaN(expiration.getTime())) return false;
        const monthsAway = (expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        if (monthsAway < 0 || monthsAway > monthsNumber) return false;
      }

      return true;
    });

    if (competition === 'sole_source') {
      mappedContracts = mappedContracts.filter(contract => contract.competitionLevel === 'sole_source');
    } else if (competition === 'low') {
      mappedContracts = mappedContracts.filter(contract =>
        contract.competitionLevel === 'low' || contract.competitionLevel === 'sole_source'
      );
    }

    // Tag every contract with its location match vs. the user's service area.
    const geo = { hqState: defaults?.hqState, serviceStates: stateTerms };
    mappedContracts = mappedContracts.map(contract => ({
      ...contract,
      locationMatch: classifyLocation(contract.location.state, geo),
    }));

    // Sort: in-area first (hq > service > neighbor > outside > unknown), then
    // by value within each tier. So the places you work surface to the top,
    // but nothing is hidden.
    mappedContracts = mappedContracts.sort((a, b) => {
      const ra = MATCH_META[a.locationMatch || 'unknown'].rank;
      const rb = MATCH_META[b.locationMatch || 'unknown'].rank;
      if (ra !== rb) return ra - rb;
      return b.value - a.value;
    });

    const totalValue = mappedContracts.reduce((sum, contract) => sum + contract.value, 0);
    const offersWithValues = mappedContracts.filter(contract => contract.bidsReceived > 0);
    const avgBids = offersWithValues.length > 0
      ? offersWithValues.reduce((sum, contract) => sum + contract.bidsReceived, 0) / offersWithValues.length
      : 0;

    setContracts(mappedContracts);
    setSummary({
      totalContracts: mappedContracts.length,
      totalValue,
      avgBidsPerContract: Math.round(avgBids * 10) / 10,
      soleSourceContracts: mappedContracts.filter(contract => contract.competitionLevel === 'sole_source').length,
      lowCompetitionContracts: mappedContracts.filter(contract => contract.competitionLevel === 'low').length,
      urgentContracts: mappedContracts.filter(contract =>
        contract.daysUntilExpiration > 0 && contract.daysUntilExpiration <= 90
      ).length,
      inAreaContracts: mappedContracts.filter(contract =>
        contract.locationMatch === 'hq' || contract.locationMatch === 'service' || contract.locationMatch === 'neighbor'
      ).length,
    });
  }, []);

  const searchContracts = useCallback(async (naics: string, months: string, competition: string) => {
    setSearching(true);
    setError(null);

    try {
      if (allContracts.length > 0) {
        applyFilters(allContracts, naics, months, competition, usingProfileDefaults ? profileDefaults : null);
        return;
      }

      const params = new URLSearchParams();
      if (naics) params.set('naics', naics.split(/[, ]+/)[0]);
      params.set('months', months === 'all' ? '60' : months);
      params.set('limit', '200');
      params.set('sort', 'value');
      params.set('order', 'desc');

      const res = await fetch(`/api/recompete?${params.toString()}`, {
        headers: getMIApiHeaders(email),
      });
      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Failed to search contracts');

      const mappedContracts = ((data.contracts || []) as RecompeteApiContract[]).map(mapRecompeteContract);
      applyFilters(mappedContracts, naics, months, competition, usingProfileDefaults ? profileDefaults : null);
    } catch (err) {
      console.error('Contract search error:', err);
      setError('Failed to connect to server');
      setContracts([]);
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }, [allContracts, applyFilters, email, profileDefaults, usingProfileDefaults]);

  // Fetch task orders (subcontracting targets) on demand. limit=100 + the API
  // reports the TRUE total (Eric: "50 looks like a sample not the whole").
  const fetchIdv = useCallback(async (naics: string) => {
    setIdvLoading(true);
    try {
      const params = new URLSearchParams({ mode: 'task', limit: '100' });
      if (naics) params.set('naics', naics.split(/[, ]+/)[0]);
      const res = await fetch(`/api/app/idv-contracts?${params.toString()}`, { headers: getMIApiHeaders(email) });
      const data = await res.json();
      // Tag each with "in your area" vs the saved profile (Eric's tribe story:
      // a firm winning a task order IN YOUR AREA is the BD trigger), then sort
      // area-matches first.
      const geo = { hqState: profileDefaults?.hqState, serviceStates: profileDefaults?.states || [] };
      const rows = ((data?.contracts || []) as IDVRow[]).map(r => ({
        ...r, locationMatch: classifyLocation(r.popState, geo),
      }));
      rows.sort((a, b) => MATCH_META[a.locationMatch || 'unknown'].rank - MATCH_META[b.locationMatch || 'unknown'].rank);
      setIdvContracts(rows);
    } catch {
      setIdvContracts([]);
    } finally {
      setIdvLoading(false);
    }
  }, [email, profileDefaults]);

  // Switch view; load task-order data on demand.
  const switchAwardType = useCallback((type: 'definitive' | 'task') => {
    setAwardType(type);
    if (type === 'task') fetchIdv(naicsFilter);
  }, [fetchIdv, naicsFilter]);

  // Load the shared profile defaults once, then apply them to the full recompete dataset.
  useEffect(() => {
    if (!email) return;

    async function loadProfileAndContracts() {
      setLoading(true);
      setError(null);

      try {
        const [prefsResponse, workspaceResponse, contractsResponse] = await Promise.all([
          fetch(`/api/alerts/preferences?email=${encodeURIComponent(email as string)}`),
          fetch(`/api/app/workspace?email=${encodeURIComponent(email as string)}`, {
            headers: getMIApiHeaders(email),
          }),
          fetch('/contracts-data.js'),
        ]);

        const [prefs, workspace, contractsText] = await Promise.all([
          prefsResponse.json().catch(() => null),
          workspaceResponse.json().catch(() => null),
          contractsResponse.text(),
        ]);

        const parsedStaticContracts = JSON.parse(
          contractsText
            .replace(/^var\s+expiringContractsData\s*=\s*/, '')
            .replace(/;\s*$/, '')
        ) as StaticRecompeteContract[];
        const mappedContracts = parsedStaticContracts.map(mapStaticContract);
        setAllContracts(mappedContracts);

        const workspaceSettings = workspace?.settings || {};
        const workspaceProfile = workspace?.profile || {};
        const profileDefaultsNext: SavedProfileDefaults = {
          naicsCodes: uniqueStrings([
            ...(prefs?.data?.naicsCodes || []),
            ...(workspaceSettings.naics_codes || []),
            ...(workspaceProfile.notification?.naics_codes || []),
            ...(workspaceProfile.briefing?.naics_codes || []),
          ]).map(extractNaicsCode).filter(Boolean),
          agencies: uniqueStrings([
            ...(prefs?.data?.targetAgencies || []),
            ...(workspaceSettings.target_agencies || []),
            ...(workspaceProfile.notification?.agencies || []),
            ...(workspaceProfile.briefing?.agencies || []),
          ]),
          states: uniqueStrings([
            ...(prefs?.data?.locationStates || []),
            prefs?.data?.locationState,
          ]).map(state => state.toUpperCase()),
          // HQ state for the location-match badge: prefer an explicit HQ from
          // the identity profile/workspace, else the singular locationState
          // (typically the user's primary state), else the first service state.
          hqState: (
            workspaceProfile.identity?.hq_state ||
            workspaceProfile.profile?.hq_state ||
            prefs?.data?.locationState ||
            prefs?.data?.locationStates?.[0] ||
            ''
          ).toString().toUpperCase() || undefined,
          source: prefs?.data ? 'saved settings profile' : 'workspace profile',
        };

        setProfileDefaults(profileDefaultsNext);
        const profileNaics = profileDefaultsNext.naicsCodes.join(', ');
        setNaicsFilter(profileNaics);
        setUsingProfileDefaults(profileDefaultsNext.naicsCodes.length > 0 || profileDefaultsNext.agencies.length > 0 || profileDefaultsNext.states.length > 0);
        applyFilters(mappedContracts, profileNaics, '24', '', profileDefaultsNext);
      } catch (err) {
        console.error('Failed to load recompete defaults:', err);
        setError('Failed to load recompete dataset.');
      } finally {
        setLoading(false);
      }
    }

    loadProfileAndContracts();
  }, [applyFilters, email]);

  const handleSearch = () => {
    if (awardType === 'task') { fetchIdv(naicsFilter); return; }
    setUsingProfileDefaults(false);
    searchContracts(naicsFilter, monthsFilter, competitionFilter);
  };

  const useSavedProfile = () => {
    const profileNaics = profileDefaults?.naicsCodes.join(', ') || '';
    setNaicsFilter(profileNaics);
    setUsingProfileDefaults(true);
    applyFilters(allContracts, profileNaics, monthsFilter, competitionFilter, profileDefaults);
  };

  const viewAllContracts = () => {
    setNaicsFilter('');
    setMonthsFilter('all');
    setCompetitionFilter('');
    setUsingProfileDefaults(false);
    applyFilters(allContracts, '', 'all', '', null);
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
  const shownContractsCount = summary?.totalContracts || 0;

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
          <h1 className="text-2xl font-bold text-white">Expiring Contracts</h1>
          <p className="text-slate-400 mt-1">
            Existing awards ending soon that may be rebid. Use this to spot recompete targets before the next solicitation.
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
                  {profileDefaults.states.join(', ')}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={viewAllContracts}
            disabled={allContracts.length === 0}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm rounded-lg transition-colors"
          >
            View all {allContracts.length.toLocaleString()}
          </button>
        </div>
      </div>

      {/* Summary Cards — reflect the ACTIVE view (Eric: was stuck on the 804
          expiring numbers when switched to Subcontracting). */}
      {awardType === 'definitive' && summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-white">{summary.totalContracts}</div>
            <div className="text-xs text-slate-500">{usingProfileDefaults ? 'Profile Matches' : 'Expiring Awards Shown'}</div>
            {(profileDefaults?.states?.length || profileDefaults?.hqState) ? (
              <div className="text-[11px] text-blue-400 mt-1">
                📍 {summary.inAreaContracts} in or near your service area
              </div>
            ) : (
              <div className="text-[11px] text-slate-600 mt-1">{allContracts.length.toLocaleString()} total in database</div>
            )}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-emerald-400">{formatCurrency(summary.totalValue)}</div>
            <div className="text-xs text-slate-500">Potential Rebid Value</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-green-400">{summary.soleSourceContracts}</div>
            <div className="text-xs text-slate-500">Sole Source</div>
            <div className="text-[11px] text-slate-600 mt-1">Likely fewer competitors if rebid</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-red-400">{summary.urgentContracts}</div>
            <div className="text-xs text-slate-500">Ending Soon</div>
            <div className="text-[11px] text-slate-600 mt-1">Within 90 days</div>
          </div>
        </div>
      )}
      {/* Subcontracting view gets its OWN summary so the count reflects reality. */}
      {awardType === 'task' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-white">{idvLoading ? '…' : idvContracts.length.toLocaleString()}</div>
            <div className="text-xs text-slate-500">Subcontracting Targets</div>
            <div className="text-[11px] text-slate-600 mt-1">Primes winning task orders</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-emerald-400">{formatCurrency(idvContracts.reduce((s, c) => s + (c.awardAmount || 0), 0))}</div>
            <div className="text-xs text-slate-500">Combined Task-Order $</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-blue-400">{idvContracts.filter(c => c.locationMatch === 'hq' || c.locationMatch === 'service' || c.locationMatch === 'neighbor').length}</div>
            <div className="text-xs text-slate-500">In or near your area</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-amber-400">{new Set(idvContracts.map(c => c.recipientName)).size}</div>
            <div className="text-xs text-slate-500">Distinct primes</div>
          </div>
        </div>
      )}

      {/* Search Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Profile-Aware Search</h3>
            <p className="text-xs text-slate-500 mt-1">
              Defaults come from settings. Change fields here only to explore a different slice.
            </p>
          </div>
          {profileDefaults && (
            <button
              onClick={useSavedProfile}
              disabled={allContracts.length === 0}
              className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 text-emerald-300 text-sm rounded-lg transition-colors"
            >
              Use Saved Profile
            </button>
          )}
        </div>

        {/* Two views (Eric: IDVs already show in Expiring tagged "IDIQ" — drop
            that toggle as redundant. Keep Task Orders = who's winning the work →
            who to chase for SUBCONTRACTING). */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {([
            { id: 'definitive', label: 'Expiring contracts', hint: 'Awards ending soon — recompete targets (incumbents, expiry, track)' },
            { id: 'task', label: 'Subcontracting (task orders)', hint: 'Who is winning task orders now — your subcontracting targets' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => switchAwardType(t.id)}
              title={t.hint}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                awardType === t.id ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
          <span className="self-center ml-1 text-[11px] text-slate-500">
            {awardType === 'definitive' ? 'Definitive contracts ending soon' : 'Primes winning task orders — approach them to sub'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">NAICS Code(s)</label>
            <input
              type="text"
              value={naicsFilter}
              onChange={(e) => setNaicsFilter(e.target.value)}
              placeholder="541512, 236, 238"
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
              <option value="all">All Dates</option>
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
              disabled={searching}
              className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
        {awardType === 'definitive' && usingProfileDefaults && allContracts.length > shownContractsCount && (
          <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">
            Showing {shownContractsCount.toLocaleString()} matches from your saved profile. The full database has {allContracts.length.toLocaleString()} expiring awards.
            <button
              type="button"
              onClick={viewAllContracts}
              className="ml-2 font-medium text-emerald-300 hover:text-emerald-200"
            >
              View all
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Task orders = subcontracting targets (USASpending). Stays in-app per
          Eric: no external links; show $ with formatMindyCurrency (B/M/commas). */}
      {awardType === 'task' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              {idvLoading ? 'Loading…' : `${idvContracts.length.toLocaleString()} Subcontracting Targets`}
            </h3>
            <span className="text-[11px] text-slate-500">Primes winning task orders — approach to sub</span>
          </div>
          {/* Mirrors the Expiring row format (Eric: copy that — it's distinct +
              useful). Project + location prominent, prime clickable, area badge. */}
          <div className="divide-y divide-slate-800">
            {idvContracts.map((c) => {
              const inArea = c.locationMatch === 'hq' || c.locationMatch === 'service' || c.locationMatch === 'neighbor';
              return (
                <div key={c.awardId} className={`p-5 hover:bg-slate-800/50 transition-colors ${inArea ? 'bg-emerald-500/5' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Badges */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300">Task order</span>
                        {c.naicsCode && <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">NAICS {c.naicsCode}</span>}
                        {c.pscCode && <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">PSC {c.pscCode}</span>}
                      </div>

                      {/* PROJECT (description) — the "what project" Eric wanted up front */}
                      <h4 className="text-white font-medium line-clamp-2 mb-1">
                        {c.description || `${c.recipientName} — task order`}
                      </h4>

                      {/* Agency */}
                      <p className="text-slate-400 text-sm mb-1">
                        {c.agency}{c.subAgency && c.subAgency !== c.agency && <span className="text-slate-500"> • {c.subAgency}</span>}
                      </p>

                      {/* Prime = the subcontracting contact. These task-order
                          winners often AREN'T in the cached contractor DB (Eric:
                          ContractorLink → "Contractor not found"). We have the
                          REAL award though — link the name to its USASpending
                          award page, which has the full company detail. Same
                          resolution as the #19 teaming fix: don't open the empty
                          cached drawer for entities not in the DB. */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-xs text-emerald-500">Prime (sub to them):</span>
                        {c.usaSpendingUrl ? (
                          <a href={c.usaSpendingUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-amber-300 hover:text-amber-200 underline decoration-dotted">
                            {c.recipientName} ↗
                          </a>
                        ) : (
                          <span className="text-xs font-medium text-slate-200">{c.recipientName}</span>
                        )}
                      </div>

                      {/* WHERE — project location + "in your area" badge (the tribe-story trigger) */}
                      <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 mt-0.5">
                        <span>📍 {c.popState || 'Location not specified'}</span>
                        {inArea && (
                          <span title={MATCH_META[c.locationMatch!].hint} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            c.locationMatch === 'hq' ? 'bg-emerald-500/20 text-emerald-300'
                            : c.locationMatch === 'service' ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-amber-500/20 text-amber-300'}`}>
                            {MATCH_META[c.locationMatch!].label}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Value & period */}
                    <div className="text-right shrink-0 min-w-[150px] flex flex-col items-end">
                      <div className="text-lg font-bold text-emerald-400">{formatCurrency(c.awardAmount)}</div>
                      <div className="text-xs text-slate-500">Task-order value</div>
                      {c.endDate && <div className="text-sm font-medium text-white mt-2">Ends {formatDate(c.endDate)}</div>}
                      <div className="text-[10px] text-slate-600 mt-1">UEI {c.recipientUei || '—'}</div>
                      <div className="mt-3 flex flex-col items-end gap-1">
                        <div className="text-[11px] uppercase tracking-wider text-slate-600">Add to My Pursuits</div>
                        <SaveToPipelineButton
                          opportunity={{
                            title: c.description || `${c.recipientName} — subcontracting target`,
                            noticeId: c.awardId,
                            solicitationNumber: c.awardId,
                            agency: c.agency,
                            naicsCode: c.naicsCode || undefined,
                            valueEstimate: formatCurrency(c.awardAmount),
                            source: 'mi_beta_subcontracting',
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
            {!idvLoading && idvContracts.length === 0 && (
              <div className="px-5 py-6 text-center text-sm text-slate-500">No task orders for this NAICS. Try a NAICS in the search above.</div>
            )}
          </div>
        </div>
      )}

      {/* Contract List */}
      {awardType === 'definitive' && contracts.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              {contracts.length.toLocaleString()} Expiring Awards
            </h3>
          </div>
          <div className="divide-y divide-slate-800">
            {contracts.slice(0, 1000).map((contract) => {
              const urgency = getUrgencyBadge(contract.daysUntilExpiration);
              const isExpanded = expandedContracts.has(contract.piid);

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
                      <button
                        type="button"
                        onClick={() => toggleExpandedContract(contract.piid)}
                        className="group mb-1 flex w-full items-start gap-2 text-left"
                        aria-expanded={isExpanded}
                      >
                        <h4 className="text-white font-medium line-clamp-2 group-hover:text-amber-200">
                          {contract.title || 'Contract'}
                        </h4>
                        <span className="mt-0.5 shrink-0 text-xs font-medium text-amber-300 group-hover:text-amber-200">
                          {isExpanded ? 'Hide details' : 'Details'}
                        </span>
                      </button>

                      {/* Agency + decoded contracting office (DoDAAC, DoD only) */}
                      <p className="text-slate-400 text-sm mb-1">
                        {contract.agency}
                        {contract.subAgency && <span className="text-slate-500"> • {contract.subAgency}</span>}
                        {formatDodaacOffice(contract.piid || null, dodaacNames) && (
                          <span className="text-emerald-400/80"> • 🏛 {formatDodaacOffice(contract.piid || null, dodaacNames)}</span>
                        )}
                      </p>

                      {/* Incumbent — clickable to open YoY award history */}
                      {contract.incumbent?.name && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs text-amber-500">Incumbent:</span>
                          <ContractorLink
                            name={contract.incumbent.name}
                            email={email}
                            variant="inline"
                            className="text-xs font-medium"
                          >
                            {contract.incumbent.name}
                          </ContractorLink>
                        </div>
                      )}

                      {/* Location — always shown, with a match badge vs. the
                          user's service area so geography is visible, not a
                          silent filter. */}
                      <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 mt-0.5">
                        <span>
                          📍 {contract.location?.state
                            ? `${contract.location.city ? `${contract.location.city}, ` : ''}${contract.location.state}${contract.location.zip ? ` ${contract.location.zip}` : ''}`
                            : 'Location not specified'}
                        </span>
                        {contract.locationMatch && contract.locationMatch !== 'unknown' && (
                          <span
                            title={MATCH_META[contract.locationMatch].hint}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              contract.locationMatch === 'hq' ? 'bg-emerald-500/20 text-emerald-300'
                              : contract.locationMatch === 'service' ? 'bg-blue-500/20 text-blue-300'
                              : contract.locationMatch === 'neighbor' ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-slate-600/40 text-slate-400'
                            }`}
                          >
                            {MATCH_META[contract.locationMatch].label}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Value & Dates */}
                    <div className="text-right shrink-0 min-w-[150px] flex flex-col items-end">
                      <div className="text-lg font-bold text-emerald-400">{formatCurrency(contract.value)}</div>
                      <div className="text-xs text-slate-500">Contract Value</div>
                      <div className="text-sm font-medium text-white mt-2">
                        Expires {formatDate(contract.expirationDate)}
                      </div>
                      <div className={`text-xs mt-1 ${urgency.text}`}>
                        {contract.daysUntilExpiration} days left
                      </div>
                      <div className="mt-3 flex flex-col items-end gap-1">
                        <div className="text-[11px] uppercase tracking-wider text-slate-600">Add to My Pursuits</div>
                        <SaveToPipelineButton
                          opportunity={{
                            title: contract.title || `${contract.incumbent?.name || 'Incumbent'} recompete`,
                            noticeId: contract.piid,
                            solicitationNumber: contract.piid,
                            agency: contract.agency,
                            naicsCode: contract.naics || undefined,
                            deadline: contract.expirationDate || undefined,
                            valueEstimate: formatCurrency(contract.potentialValue || contract.value),
                            source: 'mi_beta_expiring_contracts',
                          }}
                          email={email || ''}
                          variant="small"
                        />
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                        <div>
                          <h5 className="text-sm font-semibold text-white">Overview</h5>
                          <p className="mt-2 text-sm leading-6 text-slate-300">
                            {getRecompeteOverview(contract)}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {contract.piid && (
                              <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                                Award {contract.piid}
                              </span>
                            )}
                            {contract.incumbent?.uei && (
                              <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                                UEI {contract.incumbent.uei}
                              </span>
                            )}
                            {contract.naics && (
                              <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                                NAICS {contract.naics}
                              </span>
                            )}
                            {contract.location?.state && (
                              <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                                {contract.location.city ? `${contract.location.city}, ` : ''}{contract.location.state}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                          <h5 className="text-sm font-semibold text-white">Capture Notes</h5>
                          <dl className="mt-3 space-y-3 text-sm">
                            <div className="flex justify-between gap-3">
                              <dt className="text-slate-500">Incumbent</dt>
                              <dd className="text-right">
                                {contract.incumbent?.name ? (
                                  <ContractorLink
                                    name={contract.incumbent.name}
                                    email={email}
                                    variant="inline"
                                    className="text-slate-200"
                                  >
                                    {contract.incumbent.name}
                                  </ContractorLink>
                                ) : (
                                  <span className="text-slate-200">Unknown</span>
                                )}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt className="text-slate-500">Potential value</dt>
                              <dd className="text-right text-emerald-300">{formatCurrency(contract.potentialValue || contract.value)}</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt className="text-slate-500">Competition</dt>
                              <dd className="text-right text-slate-200">{contract.competitionType || 'Unknown'}</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt className="text-slate-500">Offers</dt>
                              <dd className="text-right text-slate-200">{contract.bidsReceived || 'Unknown'}</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt className="text-slate-500">Expires</dt>
                              <dd className="text-right text-slate-200">{formatDate(contract.expirationDate)}</dd>
                            </div>
                          </dl>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-4">
                        <SaveToPipelineButton
                          opportunity={{
                            title: contract.title || `${contract.incumbent?.name || 'Incumbent'} recompete`,
                            noticeId: contract.piid,
                            solicitationNumber: contract.piid,
                            agency: contract.agency,
                            naicsCode: contract.naics || undefined,
                            deadline: contract.expirationDate || undefined,
                            valueEstimate: formatCurrency(contract.potentialValue || contract.value),
                            source: 'mi_beta_expiring_contracts',
                          }}
                          email={email || ''}
                        />
                        <span className="text-xs text-slate-500">
                          After tracking, open My Pursuits to move it from Tracking to Pursuing, Bidding, Submitted, Won, or Lost.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {contracts.length > 1000 && (
              <div className="p-5 text-center text-sm text-slate-400">
                Showing first 1,000 by value. Narrow the filters or open the full tool for export.
              </div>
            )}
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
          <button
            type="button"
            onClick={viewAllContracts}
            className="inline-block px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            View all {allContracts.length.toLocaleString()} expiring awards
          </button>
        </div>
      )}
    </div>
  );
}
