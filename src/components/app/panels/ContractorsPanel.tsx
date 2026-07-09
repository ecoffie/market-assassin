'use client';

import { useState, useEffect, useCallback } from 'react';
import { MapPin, Mail, Phone, Landmark, Building2, Lock, BarChart3, HardHat, Laptop, FileText } from 'lucide-react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { AppTier } from '../UnifiedSidebar';
import { NaicsAutocompleteInput } from '../../codes/NaicsAutocompleteInput';
import ContractorProfileView from '../contractors/ContractorProfileView';
import { authedFetch } from '../authHeaders';
import { formatMindyCurrency } from '@/lib/mindy/formatters';

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

interface ContractorsPanelProps {
  email: string | null;
  tier: AppTier;
}

interface Contractor {
  company: string;
  sblo_name: string;
  title: string;
  email: string;
  phone: string;
  address: string;
  naics: string;
  source: string;
  contract_count: string;
  total_contract_value: string;
  agencies: string;
  has_subcontract_plan: string;
  has_email: boolean;
  has_phone: boolean;
  has_contact: boolean;
  contract_value_num: number;
  slug?: string; // BQ-backed rows include this — links to /contractors/[slug]
  uei?: string;
  city?: string;  // BQ rows carry HQ city/state — shown to disambiguate
  state?: string;
  agencies_count?: number;  // distinct federal agencies this firm has sold to
}

interface ContractorStats {
  totalContractors: number;
}

interface SavedContractorDefaults {
  naicsCodes: string[];
  agencies: string[];
}

function formatCurrency(value: number): string {
  return formatMindyCurrency(value);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values
    .map(value => (value || '').trim())
    .filter(Boolean)));
}

function extractNaicsCode(value?: string | null): string {
  return (value || '').match(/\d{2,6}/)?.[0] || '';
}

export default function ContractorsPanel({ email, tier }: ContractorsPanelProps) {
  void tier;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const deepLinkSearch = searchParams.get('search')?.trim() || '';
  // Profile view sub-state. When the URL carries
  //   /app?panel=contractors&view=profile&slug=<x>&company=<y>
  // we hand off to <ContractorProfileView /> instead of the list. Same
  // panel mount, just a different render branch — keeps everything
  // inside the dashboard shell (sidebar/auth/global-lookup) without
  // needing a separate /app/contractors/[slug] route.
  const profileView = searchParams.get('view') === 'profile';
  const profileSlug = searchParams.get('slug')?.trim() || '';
  const profileCompany = searchParams.get('company')?.trim() || '';
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [stats, setStats] = useState<ContractorStats | null>(null);
  const [profileDefaults, setProfileDefaults] = useState<SavedContractorDefaults | null>(null);
  const [usingProfileDefaults, setUsingProfileDefaults] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);

  // Push profile-view URL state. Using router.push (not window.location)
  // so the list's scroll position, search query, and pagination survive
  // the round-trip back. Preserves any other panel-level params
  // (search/naics/state) the user had set.
  const openProfile = useCallback((contractor: Contractor) => {
    if (!contractor.slug) return; // legacy static rows have no slug
    const params = new URLSearchParams(searchParams.toString());
    params.set('panel', 'contractors');
    params.set('view', 'profile');
    params.set('slug', contractor.slug);
    params.set('company', contractor.company);
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  const closeProfile = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('view');
    params.delete('slug');
    params.delete('company');
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  // Search filters
  const [searchQuery, setSearchQuery] = useState('');
  const [naicsFilter, setNaicsFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [profileAgencyFilter, setProfileAgencyFilter] = useState('');
  const [contactFilter, setContactFilter] = useState<'all' | 'withContact' | 'withEmail'>('all');
  const [sortBy, setSortBy] = useState<'contract_value' | 'company' | 'contract_count'>('contract_value');

  // Pagination
  const [page, setPage] = useState(0);
  const limit = 25;

  const loadStats = async () => {
    try {
      // BQ-backed: get the full recipient count from a 0-row probe (cheap).
      const res = await fetch('/api/contractors/search-bq?limit=1');
      const data = await res.json();
      if (typeof data.totalCount === 'number') {
        setStats({ totalContractors: data.totalCount });
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const searchContractors = useCallback(async (
    search: string,
    naics: string,
    agency: string,
    contact: 'all' | 'withContact' | 'withEmail',
    sort: 'contract_value' | 'company' | 'contract_count',
    pageNum: number,
    stateArg?: string
  ) => {
    setSearching(true);
    setError(null);

    try {
      // BQ-backed: 317K award-winning contractors (recipients table + the
      // top-contractors-by-NAICS rollup). Quota-aware — see searchRecipients.
      // The `contact`/agency filters from the old static JSON aren't supported
      // by BQ (no contact data), so they're ignored here. State filter applies
      // to NAME search only (the NAICS rollup has no location).
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (naics) params.set('naics', naics);
      const stateVal = stateArg !== undefined ? stateArg : stateFilter;
      if (stateVal && !naics) params.set('state', stateVal);
      params.set('sortBy', sort);
      params.set('limit', limit.toString());
      params.set('offset', (pageNum * limit).toString());

      const res = await fetch(`/api/contractors/search-bq?${params.toString()}`);
      const data = await res.json();

      if (data.contractors) {
        setContractors(data.contractors);
        setTotalCount(data.totalCount || 0);
        setFilteredCount(data.filteredCount || 0);
      } else if (data.error) {
        setError(data.error);
        setContractors([]);
      }
    } catch (err) {
      console.error('Contractor search error:', err);
      setError('Failed to search contractors');
      setContractors([]);
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }, [stateFilter]);

  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    // Deep-link from global lookup: /app?panel=contractors&search=Excel
    if (deepLinkSearch) {
      setSearchQuery(deepLinkSearch);
      setUsingProfileDefaults(false);
      searchContractors(deepLinkSearch, '', '', 'all', 'contract_value', 0);
      return;
    }

    if (!email) {
      searchContractors('', '', '', 'all', 'contract_value', 0);
      return;
    }

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
        const defaults: SavedContractorDefaults = {
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
        };

        const profileNaics = defaults.naicsCodes.join(', ');
        const profileAgencies = defaults.agencies.join(', ');
        setProfileDefaults(defaults);
        setNaicsFilter(profileNaics);
        setProfileAgencyFilter(profileAgencies);
        setUsingProfileDefaults(defaults.naicsCodes.length > 0 || defaults.agencies.length > 0);
        searchContractors('', profileNaics, profileAgencies, 'all', 'contract_value', 0);
      } catch (err) {
        console.error('Failed to load contractor profile defaults:', err);
        searchContractors('', '', '', 'all', 'contract_value', 0);
      }
    }

    loadProfileAndSearch();
  }, [email, searchContractors, deepLinkSearch]);

  const handleSearch = () => {
    setPage(0);
    setUsingProfileDefaults(false);
    setProfileAgencyFilter('');
    searchContractors(searchQuery, naicsFilter, '', contactFilter, sortBy, 0, stateFilter);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    searchContractors(searchQuery, naicsFilter, profileAgencyFilter, contactFilter, sortBy, newPage);
  };

  const useSavedProfile = () => {
    const profileNaics = profileDefaults?.naicsCodes.join(', ') || '';
    const profileAgencies = profileDefaults?.agencies.join(', ') || '';
    setSearchQuery('');
    setNaicsFilter(profileNaics);
    setProfileAgencyFilter(profileAgencies);
    setUsingProfileDefaults(true);
    setPage(0);
    searchContractors('', profileNaics, profileAgencies, contactFilter, sortBy, 0);
  };

  const totalPages = Math.ceil(filteredCount / limit);

  // Profile sub-view — full-page contractor profile inside the panel
  // shell. Branches BEFORE the loading skeleton because the profile
  // view has its own data fetch and skeleton; we don't want the list
  // skeleton to flash while we navigate into a profile.
  if (profileView && profileSlug && profileCompany) {
    return (
      <ContractorProfileView
        slug={profileSlug}
        company={profileCompany}
        email={email}
        onBack={closeProfile}
      />
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-slate-800 rounded-xl" />
            ))}
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-28 bg-slate-800 rounded-xl" />
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
          <h1 className="text-2xl font-bold text-white">Contractors</h1>
          <p className="text-slate-400 mt-1">
            {stats
              ? `${stats.totalContractors.toLocaleString()} award-winning federal contractors`
              : 'Federal contractor database'}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Real award history from USASpending — search by name, or filter by NAICS for the top contractors in a code.
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

      {/* Search & Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        {/* items-end so every field bottom-aligns regardless of label height —
            fixes the misaligned row Eric flagged. 12-col grid for clean spans. */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          {/* Search — widest */}
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Company name</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search by company…"
              className="w-full h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* NAICS Filter */}
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-400 mb-1.5">NAICS code(s)</label>
            <NaicsAutocompleteInput
              value={naicsFilter}
              onChange={setNaicsFilter}
              placeholder="541512, 236…"
              className="w-full h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* State filter — name-search only (NAICS rollup has no location). */}
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-400 mb-1.5">State</label>
            <select
              value={stateFilter}
              onChange={(e) => { setStateFilter(e.target.value); setPage(0); searchContractors(searchQuery, naicsFilter, profileAgencyFilter, contactFilter, sortBy, 0, e.target.value); }}
              disabled={!!naicsFilter.trim()}
              title={naicsFilter.trim() ? 'State filter applies to name search only — the NAICS path has no location data' : ''}
              className="w-full h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">{naicsFilter.trim() ? 'All states (n/a with NAICS)' : 'All states'}</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Search Button */}
          <div className="md:col-span-2">
            <button
              onClick={handleSearch}
              disabled={searching}
              className="w-full h-10 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium text-sm rounded-lg transition-colors"
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>

        {/* Sort Options */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-800">
          <span className="text-xs text-slate-500 mr-1">Sort by:</span>
          {[
            { key: 'contract_value', label: 'Contract Value' },
            { key: 'contract_count', label: 'Contract Count' },
            { key: 'company', label: 'Company Name' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setSortBy(key as typeof sortBy);
                setPage(0);
                searchContractors(searchQuery, naicsFilter, profileAgencyFilter, contactFilter, key as typeof sortBy, 0);
              }}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                sortBy === key
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Results Count */}
      {!searching && contractors.length > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Showing {page * limit + 1}-{Math.min((page + 1) * limit, filteredCount)} of {filteredCount.toLocaleString()} contractors
          </span>
          {filteredCount !== totalCount && (
            <span className="text-slate-500">(filtered from {totalCount.toLocaleString()})</span>
          )}
        </div>
      )}

      {/* Contractor List */}
      {contractors.length > 0 && (
        <div className="space-y-3">
          {contractors.map((contractor, idx) => (
            <div
              key={`${contractor.company}-${idx}`}
              role="button"
              tabIndex={0}
              onClick={() => openProfile(contractor)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openProfile(contractor);
                }
              }}
              className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-emerald-500/50 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/40 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Company Info */}
                <div className="flex-1 min-w-0">
                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {contractor.has_contact && (
                      <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded">
                        SBLO Contact
                      </span>
                    )}
                    {contractor.has_email && (
                      <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                        Email
                      </span>
                    )}
                    {contractor.has_phone && (
                      <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">
                        Phone
                      </span>
                    )}
                    {contractor.has_subcontract_plan === 'Yes' && (
                      <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">
                        Subcontract Plan
                      </span>
                    )}
                  </div>

                  {/* Company name — opens the in-app full profile view
                      (`?view=profile&slug=…&company=…`). Stays inside the
                      app shell. Previously this was an `<a>` to
                      /contractors/[slug] which dumped the user out to the
                      public SEO page. The drawer that briefly replaced it
                      is kept alive for inline contexts (Source Feed,
                      Today's Intel) but row-click in the panel now goes
                      to the proper full profile. */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openProfile(contractor);
                    }}
                    className="text-white hover:text-emerald-400 font-semibold text-lg mb-1 text-left transition-colors"
                  >
                    {contractor.company}
                  </button>

                  {/* HQ location — disambiguates same-named firms (which Excell?) */}
                  {(contractor.city || contractor.state) && (
                    <div className="inline-flex items-center gap-1 text-xs text-slate-400 -mt-0.5 mb-1">
                      <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} /> {[contractor.city, contractor.state].filter(Boolean).join(', ')}
                    </div>
                  )}

                  {/* SBLO Contact */}
                  {contractor.sblo_name && contractor.sblo_name !== 'N/A' && (
                    <div className="mb-2">
                      <span className="text-emerald-400 font-medium">{contractor.sblo_name}</span>
                      {contractor.title && contractor.title !== 'N/A' && (
                        <span className="text-slate-500 text-sm"> — {contractor.title}</span>
                      )}
                    </div>
                  )}

                  {/* Contact Info */}
                  <div className="flex flex-wrap gap-4 text-sm">
                    {contractor.email && contractor.email !== 'N/A' && (
                      <a
                        href={`mailto:${contractor.email}`}
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300"
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> {contractor.email}
                      </a>
                    )}
                    {contractor.phone && contractor.phone !== 'N/A' && (
                      <a
                        href={`tel:${contractor.phone}`}
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-300"
                      >
                        <Phone className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> {contractor.phone}
                      </a>
                    )}
                  </div>

                  {/* Detail badges — at-a-glance signals from the numbers we
                      already have (Eric: add valuable detail to the card). */}
                  {(() => {
                    const count = Number(contractor.contract_count) || 0;
                    const avg = count > 0 ? contractor.contract_value_num / count : 0;
                    const scale = contractor.contract_value_num >= 1e9 ? 'Mega prime ($1B+)'
                      : contractor.contract_value_num >= 1e8 ? 'Large ($100M+)'
                      : contractor.contract_value_num >= 1e7 ? 'Mid ($10M+)' : 'Emerging';
                    const agencies = Number(contractor.agencies_count) || 0;
                    return (
                      <div className="flex flex-wrap gap-2 mt-3 text-[11px]">
                        {avg > 0 && (
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300" title="Average obligated per contract">
                            ~{formatCurrency(avg)}/contract avg
                          </span>
                        )}
                        {agencies > 0 && (
                          <span
                            className={`rounded px-2 py-0.5 ${agencies >= 5 ? 'bg-blue-500/15 text-blue-300' : 'bg-slate-800 text-slate-300'}`}
                            title={agencies >= 5 ? 'Diversified — sells to many federal buyers' : 'Sells to few federal buyers'}
                          >
                            <span className="inline-flex items-center gap-1"><Landmark className="h-3 w-3 shrink-0" strokeWidth={2} /> {agencies} {agencies === 1 ? 'agency' : 'agencies'}</span>
                          </span>
                        )}
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">{scale}</span>
                        {count >= 50 && <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-300" title="High volume of federal awards">Active performer</span>}
                      </div>
                    );
                  })()}
                  {/* NAICS & Agencies */}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
                    {contractor.naics && contractor.naics !== 'N/A' && (
                      <span>NAICS: {contractor.naics.slice(0, 50)}{contractor.naics.length > 50 ? '...' : ''}</span>
                    )}
                    {contractor.agencies && contractor.agencies !== 'N/A' && (
                      <span>Agencies: {contractor.agencies.slice(0, 60)}{contractor.agencies.length > 60 ? '...' : ''}</span>
                    )}
                  </div>
                </div>

                {/* Contract Stats */}
                <div className="text-right shrink-0 min-w-[140px]">
                  <div className="text-xl font-bold text-emerald-400">
                    {formatCurrency(contractor.contract_value_num)}
                  </div>
                  <div className="text-xs text-slate-500">Total Contract Value</div>
                  <div className="text-lg font-semibold text-white mt-2">
                    {contractor.contract_count}
                  </div>
                  <div className="text-xs text-slate-500">Contracts</div>
                  <div className="mt-3 text-xs font-medium text-emerald-400">
                    View award history →
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 0 || searching}
            className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i;
              } else if (page < 3) {
                pageNum = i;
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 5 + i;
              } else {
                pageNum = page - 2 + i;
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                  disabled={searching}
                  className={`w-8 h-8 text-sm rounded-lg transition-colors ${
                    page === pageNum
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {pageNum + 1}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages - 1 || searching}
            className="px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}

      {/* Empty State */}
      {!searching && contractors.length === 0 && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <div className="mb-4 flex justify-center"><Building2 className="h-11 w-11 text-faint" strokeWidth={1.5} /></div>
          <h3 className="text-xl font-semibold text-white mb-2">No Contractors Found</h3>
          <p className="text-slate-400 mb-4">
            Try adjusting your search criteria or filters.
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setNaicsFilter('');
              setProfileAgencyFilter('');
              setUsingProfileDefaults(false);
              setContactFilter('all');
              setPage(0);
              searchContractors('', '', '', 'all', 'contract_value', 0);
            }}
            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* Quick Filters */}
      <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-800">
        <span className="text-xs text-slate-500 self-center mr-2">Quick searches:</span>
        {[
          { label: 'Cybersecurity', naics: '541512', Icon: Lock },
          { label: 'Management Consulting', naics: '541611', Icon: BarChart3 },
          { label: 'Engineering', naics: '541330', Icon: HardHat },
          { label: 'IT Services', naics: '541519', Icon: Laptop },
          { label: 'Professional Services', naics: '541990', Icon: FileText },
        ].map(({ label, naics, Icon }) => (
          <button
            key={naics}
            onClick={() => {
              setNaicsFilter(naics);
              setProfileAgencyFilter('');
              setUsingProfileDefaults(false);
              setPage(0);
              searchContractors(searchQuery, naics, '', contactFilter, sortBy, 0);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-slate-400 text-sm rounded-lg hover:bg-slate-700 hover:text-white transition-colors"
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={2} /> {label}
          </button>
        ))}
      </div>

    </div>
  );
}
