'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAppTracker } from '@/components/app/track';
import { useToast, ToastHost } from '@/components/app/Toast';
import { getMIApiHeaders } from '@/components/app/authHeaders';
import SamAttachmentLinks from '@/components/app/SamAttachmentLinks';
import CollapsibleOpportunityDescription from '@/components/app/CollapsibleOpportunityDescription';
import OpportunityDetailStrip from '@/components/app/OpportunityDetailStrip';

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

// Loose shapes — SAM returns slightly different keys per notice.
type SamAttachment = {
  url?: string;
  name?: string;
  fileName?: string;
  type?: string;
  postedDate?: string;
} & Record<string, unknown>;

type SamPointOfContact = {
  fullName?: string;
  full_name?: string;
  title?: string;
  type?: string;
  email?: string;
  phone?: string;
} & Record<string, unknown>;

type SamOfficeAddress = {
  city?: string;
  state?: string;
  zipcode?: string;
  zip?: string;
  countryCode?: string;
} & Record<string, unknown>;

interface Opportunity {
  id: string;
  notice_id: string;
  solicitation_number: string | null;
  title: string;
  description: string | null;
  description_url: string | null;
  attachments: SamAttachment[];
  points_of_contact: SamPointOfContact[];
  office_address: SamOfficeAddress | null;
  fair_opportunity: Record<string, unknown> | null;
  additional_info_link: string | null;
  additional_info_text: string | null;
  department: string;
  sub_tier: string | null;
  office: string | null;
  agency_hierarchy: string | null;
  naics_code: string | null;
  psc_code: string | null;
  notice_type: string | null;
  notice_type_code: string | null;
  has_sow_doc?: boolean | null;     // #66 SOW/PWS catalog
  sow_doc_type?: string | null;
  set_aside_code: string | null;
  set_aside_description: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  archive_date: string | null;
  pop_city: string | null;
  pop_state: string | null;
  pop_zip: string | null;
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

function MarketIntelDashboard() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState<string>('');
  // Whether the async email resolution (URL / localStorage) has finished.
  // Distinguishes "still loading email" from "genuinely no email" so we don't
  // fire an ALL-SAM stats fetch while a profile-filtered view is intended —
  // which flashed the full 9,952 counts under the "Your Profile" toggle.
  const [emailResolved, setEmailResolved] = useState(false);

  // Resolve email: ?email= takes precedence, otherwise read from localStorage (set by /app sign-in)
  useEffect(() => {
    const fromUrl = searchParams.get('email');
    if (fromUrl) {
      setEmail(fromUrl);
      setEmailResolved(true);
      return;
    }
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('mi_beta_email');
      if (stored) setEmail(stored);
    }
    // Either way, email resolution is now complete (stored value or none).
    setEmailResolved(true);
  }, [searchParams]);

  const initialScope = searchParams.get('scope');
  const [profileFilterActive, setProfileFilterActive] = useState(initialScope !== 'all');
  const isProfileFiltered = !!email && profileFilterActive;
  // We INTEND a profile-filtered view but the email hasn't resolved yet — hold
  // off fetching so we don't briefly show ALL-SAM counts under the "Your
  // Profile" toggle. Once email resolves, isProfileFiltered drives the fetch.
  const awaitingProfileEmail = profileFilterActive && !emailResolved;

  // Engagement tracker — fires page_view on mount + tool_use on filter
  // changes / attachment downloads / SAM link clicks. All fire-and-
  // forget; failures do not surface to the user.
  const track = useAppTracker(email);
  const { showToast } = useToast();

  // Inline Track button state. Mirrors DashboardPanel's pattern:
  // optimistic state set on click, rolled back on failure. notice_id
  // is the source of truth (server dedupes by notice_id + email).
  const [savedNoticeIds, setSavedNoticeIds] = useState<Set<string>>(new Set());
  const [savingNoticeIds, setSavingNoticeIds] = useState<Set<string>>(new Set());
  const [dismissedNoticeIds, setDismissedNoticeIds] = useState<Set<string>>(new Set());

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOpps, setLoadingOpps] = useState(false);

  const [search, setSearch] = useState('');
  const [noticeType, setNoticeType] = useState('');
  const [urgency, setUrgency] = useState('');
  const [setAside, setSetAside] = useState('');
  const [naicsFilter, setNaicsFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [hasSow, setHasSow] = useState(false);   // #66 "Has SOW/PWS" filter
  // Active (biddable now) | Inactive (the archive — recompete intel, old SOW/PWS) |
  // All. Mirrors SAM.gov's status toggle; the inactive corpus (~59k) is already cached.
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Lazy-loaded full descriptions keyed by notice_id. SAM.gov stores
  // most descriptions as a separate URL pointer; we resolve them on
  // demand via /api/sam-description when the user expands a row.
  const [lazyDescriptions, setLazyDescriptions] = useState<Record<string, string>>({});
  const [loadingDescriptionFor, setLoadingDescriptionFor] = useState<string | null>(null);
  const [descriptionErrorFor, setDescriptionErrorFor] = useState<{ id: string; error: string } | null>(null);

  // Mindy Analyst — AI bid/no-bid per opportunity. Pro feature; free
  // users get a teaser block. PRD-ai-bd-department.md Agent #2.
  interface AnalystAnalysis {
    recommendation: 'pursue' | 'watch' | 'skip';
    score: number;
    why_pursue: string[];
    concerns: string[];
    competitors_likely: string[];
    effort_estimate: string;
    next_step: string;
  }
  const [analystByOpp, setAnalystByOpp] = useState<Record<string, AnalystAnalysis>>({});
  const [analystLoadingFor, setAnalystLoadingFor] = useState<string | null>(null);
  const [analystErrorFor, setAnalystErrorFor] = useState<{ id: string; teaser: boolean; message: string } | null>(null);

  const loadAnalyst = useCallback(async (noticeId: string) => {
    if (!email) return;
    if (analystByOpp[noticeId]) return;
    setAnalystLoadingFor(noticeId);
    setAnalystErrorFor(null);
    try {
      const res = await fetch('/api/analyst/bid-no-bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noticeId, email }),
      });
      const data = await res.json();
      if (res.status === 402 || data.teaser) {
        setAnalystErrorFor({ id: noticeId, teaser: true, message: data.error || 'Mindy Pro required' });
        return;
      }
      if (!res.ok || !data.success || !data.analysis) {
        setAnalystErrorFor({ id: noticeId, teaser: false, message: data.error || 'Analyst unavailable' });
        return;
      }
      setAnalystByOpp((prev) => ({ ...prev, [noticeId]: data.analysis }));
    } catch (err) {
      console.error('Failed to fetch Analyst:', err);
      setAnalystErrorFor({ id: noticeId, teaser: false, message: 'Network error' });
    } finally {
      setAnalystLoadingFor(null);
    }
  }, [email, analystByOpp]);

  const loadFullDescription = useCallback(async (noticeId: string) => {
    setLoadingDescriptionFor(noticeId);
    setDescriptionErrorFor(null);
    try {
      const res = await fetch(`/api/sam-description?noticeId=${encodeURIComponent(noticeId)}`);
      const data = await res.json();
      if (!res.ok || !data.success || !data.description) {
        setDescriptionErrorFor({ id: noticeId, error: data.error || 'Could not load description' });
        return;
      }
      setLazyDescriptions(prev => ({ ...prev, [noticeId]: data.description }));
    } catch (err) {
      console.error('Failed to fetch SAM description:', err);
      setDescriptionErrorFor({ id: noticeId, error: 'Network error fetching description' });
    } finally {
      setLoadingDescriptionFor(null);
    }
  }, []);

  const hasLocalFilters = !!(search || noticeType || urgency || setAside || naicsFilter || stateFilter || agencyFilter);
  const hasAnyFilter = hasLocalFilters || isProfileFiltered;

  const updateDashboardScope = useCallback((useProfile: boolean) => {
    if (!email) return;
    const url = new URL(window.location.href);
    url.searchParams.set('email', email);
    if (useProfile) {
      url.searchParams.delete('scope');
    } else {
      url.searchParams.set('scope', 'all');
    }
    window.history.replaceState({}, '', url.toString());
  }, [email]);

  // Inline Track in Pipeline — same handler shape as DashboardPanel's
  // handleTrackInPipeline. Optimistic state flip + toast + Undo.
  // Schema gotchas (value_estimate vs estimated_value, external_url vs
  // sam_link, ISO date conversion) match the dashboard version.
  const handleTrackOpportunity = useCallback(async (opp: Opportunity) => {
    if (!email) {
      showToast({ message: 'Sign in before saving opportunities', variant: 'error' });
      return;
    }
    if (savedNoticeIds.has(opp.notice_id)) return;

    setSavedNoticeIds(prev => new Set(prev).add(opp.notice_id));
    setSavingNoticeIds(prev => new Set(prev).add(opp.notice_id));

    // SAM response deadline is ISO from the cache, so it can go through
    // directly. Guard with a sanity Date parse anyway.
    const parsedDeadline = (() => {
      if (!opp.response_deadline) return null;
      const d = new Date(opp.response_deadline);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    })();

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_email: email,
          notice_id: opp.notice_id,
          title: opp.title,
          agency: opp.department || '',
          naics_code: opp.naics_code || '',
          set_aside: opp.set_aside_code || '',
          response_deadline: parsedDeadline,
          value_estimate: null, // market-intel rows don't carry a value range
          external_url: `https://sam.gov/opp/${opp.notice_id}/view`,
          stage: 'tracking',
          priority: opp.urgency_level === 'critical' ? 'critical'
            : opp.urgency_level === 'urgent' ? 'high'
            : 'medium',
          source: 'market_intel_dashboard',
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        if (res.status === 409) {
          showToast({ message: 'Already in your Pipeline', variant: 'info' });
        } else {
          setSavedNoticeIds(prev => {
            const next = new Set(prev);
            next.delete(opp.notice_id);
            return next;
          });
          showToast({
            message: data?.error || 'Could not add to Pipeline',
            variant: 'error',
          });
        }
        return;
      }

      const pipelineRowId = data.opportunity?.id as string | undefined;
      track('tool_use', 'market_intel_dashboard', {
        action: 'track_in_pipeline',
        notice_id: opp.notice_id,
      });
      showToast({
        message: 'Added to Pipeline',
        variant: 'success',
        action: pipelineRowId
          ? {
              label: 'Undo',
              onClick: () => {
                setSavedNoticeIds(prev => {
                  const next = new Set(prev);
                  next.delete(opp.notice_id);
                  return next;
                });
                fetch('/api/pipeline', {
                  method: 'DELETE',
                  headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
                  body: JSON.stringify({ id: pipelineRowId, user_email: email }),
                }).catch((err) => console.warn('[MarketIntel] Undo DELETE failed:', err));
              },
            }
          : undefined,
      });
    } catch (err) {
      console.error('Failed to track from market-intel:', err);
      setSavedNoticeIds(prev => {
        const next = new Set(prev);
        next.delete(opp.notice_id);
        return next;
      });
      showToast({ message: 'Network error — could not save', variant: 'error' });
    } finally {
      setSavingNoticeIds(prev => {
        const next = new Set(prev);
        next.delete(opp.notice_id);
        return next;
      });
    }
  }, [email, savedNoticeIds, showToast, track]);

  // Client-side dismiss (hide from view). Pure UI state — server has
  // no opinion on dismissed opps from market-intel.
  const handleDismissOpportunity = useCallback((opp: Opportunity) => {
    setDismissedNoticeIds(prev => new Set(prev).add(opp.notice_id));
    track('tool_use', 'market_intel_dashboard', {
      action: 'dismiss',
      notice_id: opp.notice_id,
    });
    showToast({
      message: 'Dismissed',
      variant: 'info',
      action: {
        label: 'Undo',
        onClick: () => {
          setDismissedNoticeIds(prev => {
            const next = new Set(prev);
            next.delete(opp.notice_id);
            return next;
          });
        },
      },
    });
  }, [showToast, track]);

  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('mode', 'stats');
      if (isProfileFiltered) params.set('email', email);

      const res = await fetch(`/api/mi-dashboard?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, [email, isProfileFiltered]);

  const fetchOpportunities = useCallback(async () => {
    setLoadingOpps(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '25');
      if (isProfileFiltered) params.set('email', email);
      if (search) params.set('search', search);
      if (noticeType) params.set('noticeType', noticeType);
      if (urgency) params.set('urgency', urgency);
      if (setAside) params.set('setAside', setAside);
      if (naicsFilter) params.set('naics', naicsFilter);
      if (stateFilter) params.set('state', stateFilter);
      if (agencyFilter) params.set('agency', agencyFilter);
      if (hasSow) params.set('hasSow', 'true');
      if (status !== 'active') params.set('status', status); // active(default)|inactive|all

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
  }, [page, search, noticeType, urgency, setAside, naicsFilter, stateFilter, agencyFilter, hasSow, status, email, isProfileFiltered]);

  useEffect(() => {
    // Don't fetch while we're still resolving the email for a profile-filtered
    // view — otherwise the first fetch runs unscoped (ALL SAM) and flashes the
    // wrong counts under the "Your Profile" toggle.
    if (awaitingProfileEmail) return;
    fetchStats().then(() => setLoading(false));
  }, [fetchStats, awaitingProfileEmail]);

  useEffect(() => {
    if (awaitingProfileEmail) return;
    fetchOpportunities();
  }, [fetchOpportunities, awaitingProfileEmail]);

  // page_view fires once per email resolution. Profile-filter mode and
  // initial scope are included so we can see how users land on the
  // dashboard (from a "your profile" link vs an "all SAM" link).
  useEffect(() => {
    if (!email) return;
    track('page_view', 'market_intel_dashboard', {
      scope: isProfileFiltered ? 'profile' : 'all',
      initial_scope: initialScope || null,
    });
    // Only the first time email lands — don't refire on every
    // filter change. fetchOpportunities effect handles that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchOpportunities();
    track('tool_use', 'market_intel_dashboard', {
      action: 'search',
      query: search,
      // Capture active filter state so we can see what combinations
      // users actually use.
      filters: {
        notice_type: noticeType || null,
        urgency: urgency || null,
        set_aside: setAside || null,
        naics: naicsFilter || null,
        state: stateFilter || null,
        agency: agencyFilter || null,
      },
    });
  };

  const clearFilters = () => {
    setSearch('');
    setNoticeType('');
    setUrgency('');
    setSetAside('');
    setNaicsFilter('');
    setStateFilter('');
    setAgencyFilter('');
    setPage(1);
  };

  const clearAllFilters = () => {
    clearFilters();
    if (email) {
      setProfileFilterActive(false);
      updateDashboardScope(false);
    }
  };

  const useProfileFilters = () => {
    if (!email) return;
    clearFilters();
    setProfileFilterActive(true);
    updateDashboardScope(true);
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
    link.download = `market-intel-${new Date().toISOString().split('T')[0]}.csv`;
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
            <span className="text-white font-bold text-xl">M</span>
          </div>
          <p className="text-gray-400">Loading Mindy AI…</p>
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
            <Link href="/app" className="text-gray-400 hover:text-gray-300 text-sm">
              ← Mindy
            </Link>
            <div className="w-px h-6 bg-gray-700" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center">
                <span className="text-white font-bold text-sm">M</span>
              </div>
              <span className="font-semibold">Mindy AI</span>
              {isProfileFiltered && (
                <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  🎯 Your Profile
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {email && (
              <div className="flex rounded-lg bg-gray-800 p-1 text-sm">
                <button
                  onClick={useProfileFilters}
                  className={`px-3 py-1.5 rounded-md transition-colors ${isProfileFiltered ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                >
                  Your Profile
                </button>
                <button
                  onClick={() => {
                    setProfileFilterActive(false);
                    updateDashboardScope(false);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-md transition-colors ${!isProfileFiltered ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                >
                  All SAM
                </button>
              </div>
            )}
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
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-gray-500 uppercase tracking-wider">Current view</span>
              {isProfileFiltered ? (
                <span className="px-2 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Your saved profile
                </span>
              ) : (
                <span className="px-2 py-1 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
                  All SAM opportunities
                </span>
              )}
              {search && <span className="px-2 py-1 rounded-full bg-gray-800 text-gray-300">Search: {search}</span>}
              {noticeType && <span className="px-2 py-1 rounded-full bg-gray-800 text-gray-300">{noticeType}</span>}
              {urgency && <span className="px-2 py-1 rounded-full bg-gray-800 text-gray-300">{urgency}</span>}
              {setAside && <span className="px-2 py-1 rounded-full bg-gray-800 text-gray-300">{SET_ASIDE_LABELS[setAside] || setAside}</span>}
              {naicsFilter && <span className="px-2 py-1 rounded-full bg-gray-800 text-gray-300">NAICS {naicsFilter}</span>}
              {stateFilter && <span className="px-2 py-1 rounded-full bg-gray-800 text-gray-300">{stateFilter}</span>}
              {agencyFilter && <span className="px-2 py-1 rounded-full bg-gray-800 text-gray-300">{agencyFilter}</span>}
            </div>
            <div className="flex items-center gap-2">
              {hasLocalFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  Clear search filters
                </button>
              )}
              {hasAnyFilter && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                >
                  View all opportunities
                </button>
              )}
            </div>
          </div>
          {/* Procurement-vehicle quick-search (#60) — the government is shifting
              buying to OTAs / CSOs / BAAs (commercial). These cut across NAICS
              codes (40% have NO naics_code in our cache) so they're invisible to
              code search — keyword is the only way to find them. ALL SAM is the
              right home (Today's Intel already badges the notice type). One click
              sets the search; the fetch effect runs it. */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-xs text-gray-500 mr-0.5">Buying vehicles:</span>
            {/* Terms chosen by REAL result counts in our cache (Eric: "we're
                looking to get users RESULTS"). Use the form that yields clean
                matches: "other transaction" (the "OTA" abbrev is noise — matches
                pOTAble/rOTA/tOTAl); IDIQ/BAA abbrevs are clean. Dropped COTS
                (only ~3-7 active). Set-asides like 8(a)/SDVOSB are a STRUCTURED
                field, not keyword — they live in the Set-Aside filter, not here. */}
            {[
              { kw: 'IDIQ', label: 'IDIQ', hint: 'Indefinite delivery contracts — the big enterprise vehicles (195+ active)' },
              { kw: 'broad agency announcement', label: 'BAA', hint: 'Broad Agency Announcement — R&D / innovation' },
              { kw: 'commercial solutions', label: 'CSO', hint: 'Commercial Solutions Opening — fast commercial buying' },
              { kw: 'other transaction', label: 'OTA', hint: 'Other Transaction Authority — prototypes + follow-on production (Army MICC uses this for construction)' },
              { kw: 'blanket purchase', label: 'BPA', hint: 'Blanket Purchase Agreement — recurring buys off a vehicle (29+ active)' },
            ].map(v => (
              <button
                key={v.label}
                type="button"
                title={v.hint}
                onClick={() => { setSearch(search.toLowerCase() === v.kw ? '' : v.kw); setPage(1); }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${search.toLowerCase() === v.kw ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
              >
                {v.label}
              </button>
            ))}
            {/* "Has SOW/PWS" (#66) — only opps with a real scope document (the
                serious, evaluable ones you can write a proposal against). */}
            <span className="mx-1 text-gray-700">|</span>
            <button
              type="button"
              title="Show only opportunities that include a Statement of Work / Performance Work Statement — the serious ones you can actually evaluate and bid."
              onClick={() => { setHasSow(!hasSow); setPage(1); }}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${hasSow ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              📄 Has SOW/PWS
            </button>
            {/* Active / Inactive / All — search the archive too (recompete intel +
                mining old SOW/PWS), like SAM.gov's status toggle. */}
            <span className="mx-1 text-gray-700">|</span>
            <div className="inline-flex rounded-full bg-gray-800 p-0.5" title="Active = biddable now. Inactive = the archive (closed/expired) — for recompete intel and digging up old solicitation documents. All = everything.">
              {([
                { v: 'active', label: 'Active' },
                { v: 'inactive', label: '🗄 Inactive' },
                { v: 'all', label: 'All' },
              ] as const).map((s) => (
                <button
                  key={s.v}
                  type="button"
                  onClick={() => { setStatus(s.v); setPage(1); }}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${status === s.v ? 'bg-purple-600 text-white' : 'text-gray-300 hover:text-white'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search titles, agencies, keywords (try OTA, CSO, IDIQ)..."
                  className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                />
              </div>
            </div>

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

            <select
              value={urgency}
              onChange={(e) => { setUrgency(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="">All Urgency</option>
              <option value="critical">🔥 Critical (≤3 days)</option>
              <option value="urgent">⚡ Urgent (≤7 days)</option>
            </select>

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

            <input
              type="text"
              value={naicsFilter}
              onChange={(e) => setNaicsFilter(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="NAICS Code"
              className="w-28 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              maxLength={6}
            />

            <select
              value={stateFilter}
              onChange={(e) => { setStateFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="">All States</option>
              {US_STATES.map(state => (
                <option key={state.code} value={state.code}>{state.code} - {state.name}</option>
              ))}
            </select>

            <input
              type="text"
              value={agencyFilter}
              onChange={(e) => setAgencyFilter(e.target.value)}
              placeholder="Agency"
              className="w-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />

            <button
              type="submit"
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Search
            </button>

            {hasLocalFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-3 py-2 text-sm text-gray-400 hover:text-gray-300"
              >
                Clear search
              </button>
            )}
          </form>
        </div>

        {/* Results count */}
        {pagination && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-400">
              Showing {opportunities.length} of {pagination.total.toLocaleString()} opportunities
              {hasAnyFilter && ' (filtered)'}
            </p>
            {!isProfileFiltered && email && (
              <button onClick={useProfileFilters} className="text-sm text-purple-400 hover:text-purple-300">
                Return to your profile matches
              </button>
            )}
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
            opportunities
              .filter(opp => !dismissedNoticeIds.has(opp.notice_id))
              .map(opp => {
              const colors = NOTICE_TYPE_COLORS[opp.notice_type || ''] || { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/30' };
              const isExpanded = expandedId === opp.id;
              const isSaved = savedNoticeIds.has(opp.notice_id);
              const isSaving = savingNoticeIds.has(opp.notice_id);

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
                    onClick={() => {
                      const opening = !isExpanded;
                      setExpandedId(opening ? opp.id : null);
                      if (opening) {
                        track('tool_use', 'market_intel_dashboard', {
                          action: 'expand_opportunity',
                          notice_id: opp.notice_id,
                        });
                      }
                      // Auto-fetch description only on demand — not on expand.
                      // Keeps documents & contacts visible without a wall of SAM text.
                      if (opening) {
                        void loadAnalyst(opp.notice_id);
                      }
                    }}
                    className="w-full text-left p-3 md:p-4"
                  >
                    {/* Mobile: title gets its own row + badge row underneath
                        (title was truncating to ~15 chars on phones with
                        the inline badges fighting for space). Desktop:
                        original 3-column row stays as-is. */}
                    <div className="flex flex-col md:flex-row md:items-start gap-2 md:gap-3">
                      {/* Top row on mobile: badges only (title moves below
                          on its own line). Desktop: notice-type badge left. */}
                      <div className="flex items-center gap-2 md:gap-3 md:contents">
                        <span className={`shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded ${colors.bg} ${colors.text} border ${colors.border}`}>
                          {NOTICE_TYPE_LABELS[opp.notice_type || ''] || opp.notice_type || 'Notice'}
                        </span>
                        {/* SOW/PWS badge (#66) — signals a real scope doc to evaluate. */}
                        {opp.sow_doc_type && (
                          <span title={`Includes a ${opp.sow_doc_type.toUpperCase()} — a real scope document you can evaluate and bid against`} className="shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            📄 {opp.sow_doc_type.toUpperCase()}
                          </span>
                        )}
                        {/* Mobile-only inline: set-aside + urgency next to notice type */}
                        <div className="flex items-center gap-2 md:hidden ml-auto">
                          {opp.set_aside_code && opp.set_aside_code !== 'None' && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                              {SET_ASIDE_LABELS[opp.set_aside_code] || opp.set_aside_code}
                            </span>
                          )}
                          {getUrgencyBadge(opp.urgency_level, opp.days_until_deadline)}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm md:text-sm text-white md:truncate line-clamp-2 md:line-clamp-1 leading-snug">{opp.title}</h4>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          {opp.department}
                          {opp.naics_code && ` • NAICS ${opp.naics_code}`}
                          {opp.pop_state && ` • ${opp.pop_state}`}
                        </p>
                      </div>

                      {/* Desktop-only: same badges on the right (mobile already
                          showed them in the top row above) */}
                      <div className="hidden md:flex shrink-0 text-right items-center gap-3">
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

                  {/* Inline action row — always visible regardless of
                      expand state. Matches DashboardPanel's Track/SAM/
                      Dismiss treatment so the muscle memory is the
                      same across surfaces. Wrapped in stopPropagation
                      so clicking a button doesn't toggle the parent
                      card's expand. */}
                  <div
                    className="flex items-center gap-2 px-4 pb-3 -mt-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => handleTrackOpportunity(opp)}
                      disabled={isSaving || isSaved}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        isSaved
                          ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
                          : isSaving
                            ? 'bg-gray-800 text-gray-400 cursor-wait'
                            : 'bg-purple-600 text-white hover:bg-purple-500'
                      }`}
                    >
                      {isSaved ? '✓ Tracking' : isSaving ? 'Adding…' : '+ Track'}
                    </button>
                    <a
                      href={`https://sam.gov/opp/${opp.notice_id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => track('link_click', 'market_intel_dashboard', {
                        action: 'open_sam',
                        notice_id: opp.notice_id,
                      })}
                      className="px-3 py-1.5 rounded text-xs font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 transition-colors"
                    >
                      SAM.gov →
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDismissOpportunity(opp)}
                      className="ml-auto px-3 py-1.5 rounded text-xs font-medium text-gray-400 bg-gray-800/60 hover:bg-gray-700 hover:text-gray-200 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-3 border-t border-gray-800 bg-gray-900/50 space-y-4">
                      {/* Mindy Analyst — AI bid/no-bid. Same logic as the
                          Source Feed drawer. Pro gated; free shows
                          teaser. PRD-ai-bd-department.md Agent #2. */}
                      {(() => {
                        const a = analystByOpp[opp.notice_id];
                        const loading = analystLoadingFor === opp.notice_id;
                        const err = analystErrorFor?.id === opp.notice_id ? analystErrorFor : null;
                        if (a) {
                          const tone = a.recommendation === 'pursue'
                            ? { ring: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-300' }
                            : a.recommendation === 'watch'
                            ? { ring: 'border-amber-500/40', bg: 'bg-amber-500/10', text: 'text-amber-300' }
                            : { ring: 'border-gray-600/40', bg: 'bg-gray-700/30', text: 'text-gray-400' };
                          const label = a.recommendation === 'pursue' ? 'PURSUE' : a.recommendation === 'watch' ? 'WATCH' : 'SKIP';
                          return (
                            <div className={`rounded-lg border ${tone.ring} ${tone.bg} p-3 space-y-2`}>
                              <div className="flex items-center justify-between">
                                <p className={`text-sm font-bold ${tone.text}`}>
                                  ★ Mindy Analyst: {label}
                                  <span className="text-xs font-medium text-gray-400 ml-2">{a.score}/100</span>
                                </p>
                              </div>
                              {a.why_pursue.length > 0 && (
                                <div className="text-xs">
                                  <span className="text-emerald-400 font-semibold">Why:</span>
                                  <span className="text-gray-200 ml-1">{a.why_pursue.slice(0, 3).join(' • ')}</span>
                                </div>
                              )}
                              {a.concerns.length > 0 && (
                                <div className="text-xs">
                                  <span className="text-amber-400 font-semibold">Concerns:</span>
                                  <span className="text-gray-200 ml-1">{a.concerns.slice(0, 3).join(' • ')}</span>
                                </div>
                              )}
                              <div className="text-xs text-gray-300 pt-1 border-t border-gray-800/50">
                                <span className="text-gray-500 font-semibold uppercase tracking-wider mr-1">Next:</span>
                                {a.next_step}
                              </div>
                            </div>
                          );
                        }
                        if (loading) {
                          return (
                            <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 flex items-center gap-2 text-xs text-gray-400">
                              <span className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                              Mindy Analyst is reading the RFP…
                            </div>
                          );
                        }
                        if (err?.teaser) {
                          return (
                            <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3 flex items-center justify-between gap-3">
                              <p className="text-xs text-gray-200">
                                <span className="text-purple-300 font-semibold">Mindy Analyst</span> — AI
                                bid/no-bid analysis for this opportunity. Included with Mindy Pro.
                              </p>
                              <a
                                href="/market-intelligence"
                                className="shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors"
                              >
                                Upgrade
                              </a>
                            </div>
                          );
                        }
                        return null;
                      })()}

                      <OpportunityDetailStrip
                        attachmentCount={opp.attachments?.length || 0}
                        contactCount={
                          opp.points_of_contact?.filter((poc) => {
                            const fullName = (poc?.fullName || poc?.full_name || poc?.name) as string | undefined;
                            const pocEmail = poc?.email as string | undefined;
                            const phone = (poc?.phone || poc?.phoneNumber) as string | undefined;
                            return !!(fullName || pocEmail || phone);
                          }).length || 0
                        }
                        deadlineLabel={formatDate(opp.response_deadline)}
                        deadlineUrgent={opp.urgency_level === 'critical' || opp.urgency_level === 'urgent'}
                        placeLabel={[opp.pop_city, opp.pop_state].filter(Boolean).join(', ') || null}
                        attachmentsAnchorId={`opp-docs-${opp.notice_id}`}
                        contactsAnchorId={`opp-poc-${opp.notice_id}`}
                      />

                      {opp.attachments && opp.attachments.length > 0 && (
                        <div
                          id={`opp-docs-${opp.notice_id}`}
                          className="rounded-lg border border-purple-500/30 bg-purple-500/[0.04] p-3 scroll-mt-4"
                        >
                          <SamAttachmentLinks
                            attachments={opp.attachments}
                            onDownloadClick={(idx) => track('link_click', 'market_intel_dashboard', {
                              action: 'download_attachment',
                              notice_id: opp.notice_id,
                              attachment_index: idx,
                            })}
                          />
                        </div>
                      )}

                      {opp.points_of_contact && opp.points_of_contact.length > 0 && (
                        <div id={`opp-poc-${opp.notice_id}`} className="scroll-mt-4">
                          <span className="text-gray-500 text-xs uppercase tracking-wide">
                            Points of Contact
                          </span>
                          <div className="mt-2 grid md:grid-cols-2 gap-3">
                            {opp.points_of_contact.map((poc, idx) => {
                              const fullName = (poc?.fullName || poc?.full_name || poc?.name) as string | undefined;
                              const title = (poc?.title || poc?.type) as string | undefined;
                              const email = poc?.email as string | undefined;
                              const phone = (poc?.phone || poc?.phoneNumber) as string | undefined;
                              if (!fullName && !email && !phone) return null;
                              return (
                                <div key={idx} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 text-sm">
                                  {fullName && <p className="text-gray-200 font-medium">{fullName}</p>}
                                  {title && <p className="text-xs text-gray-500">{title}</p>}
                                  {email && (
                                    <a href={`mailto:${email}`} className="block mt-1 text-purple-300 hover:text-purple-200 text-xs break-all">
                                      {email}
                                    </a>
                                  )}
                                  {phone && (
                                    <a href={`tel:${phone}`} className="block text-gray-400 hover:text-gray-200 text-xs">
                                      {phone}
                                    </a>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="grid md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500 text-xs">Solicitation #</span>
                          <p className="text-gray-300 font-mono text-xs mt-0.5">{opp.solicitation_number || '—'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Notice ID</span>
                          <p className="text-gray-300 font-mono text-xs mt-0.5 break-all">{opp.notice_id}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Notice Type</span>
                          <p className="text-gray-300 mt-0.5">{opp.notice_type || '—'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">NAICS</span>
                          <p className="text-gray-300 mt-0.5">{opp.naics_code || '—'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">PSC</span>
                          <p className="text-gray-300 mt-0.5">{opp.psc_code || '—'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Set-Aside</span>
                          <p className="text-gray-300 mt-0.5">{opp.set_aside_description || opp.set_aside_code || '—'}</p>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500 text-xs">Posted</span>
                          <p className="text-gray-300 mt-0.5">{formatDate(opp.posted_date)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Deadline</span>
                          <p className={opp.urgency_level === 'critical' ? 'text-red-400 font-semibold mt-0.5' : 'text-gray-300 mt-0.5'}>
                            {formatDate(opp.response_deadline)}
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Archive</span>
                          <p className="text-gray-300 mt-0.5">{formatDate(opp.archive_date)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Sub-Agency</span>
                          <p className="text-gray-300 mt-0.5">
                            {opp.sub_tier
                              || (opp.agency_hierarchy && opp.agency_hierarchy.split('.').slice(1, 2).join('') )
                              || '—'}
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Office</span>
                          <p className="text-gray-300 mt-0.5">
                            {opp.office
                              || (opp.agency_hierarchy && opp.agency_hierarchy.split('.').slice(2).join(' · ') )
                              || '—'}
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Place of Performance</span>
                          <p className="text-gray-300 mt-0.5">
                            {[opp.pop_city, opp.pop_state, opp.pop_zip].filter(Boolean).join(', ') || '—'}
                          </p>
                        </div>
                      </div>

                      {/* Contracting office address */}
                      {opp.office_address && Object.values(opp.office_address).some(Boolean) && (
                        <div>
                          <span className="text-gray-500 text-xs uppercase tracking-wide">
                            Contracting Office Address
                          </span>
                          <p className="text-gray-300 text-sm mt-1">
                            {[
                              opp.office_address.streetAddress,
                              opp.office_address.streetAddress2,
                              opp.office_address.city,
                              [opp.office_address.state, (opp.office_address.zipcode || opp.office_address.zip)]
                                .filter(Boolean).join(' '),
                              opp.office_address.countryCode,
                            ].filter(Boolean).join(', ') as string}
                          </p>
                        </div>
                      )}

                      {/* Fair opportunity / J&A — sole-source justification
                          info, when present. SAM only populates this for
                          sole-source / brand-name / 8(a) follow-on notices. */}
                      {opp.fair_opportunity && Object.keys(opp.fair_opportunity).length > 0 && (
                        <div>
                          <span className="text-gray-500 text-xs uppercase tracking-wide">
                            Fair Opportunity / J&amp;A
                          </span>
                          <pre className="mt-1 text-xs text-gray-400 whitespace-pre-wrap font-mono bg-gray-950/50 border border-gray-800 rounded p-3">
                            {JSON.stringify(opp.fair_opportunity, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Additional info — inline text or external link */}
                      {(opp.additional_info_text || opp.additional_info_link) && (
                        <div>
                          <span className="text-gray-500 text-xs uppercase tracking-wide">
                            Additional Info
                          </span>
                          {opp.additional_info_text && (
                            <p className="text-gray-300 text-sm mt-1 whitespace-pre-wrap">
                              {opp.additional_info_text}
                            </p>
                          )}
                          {opp.additional_info_link && (
                            <a
                              href={opp.additional_info_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block mt-1 text-sm text-purple-300 hover:text-purple-200 underline"
                            >
                              {opp.additional_info_link}
                            </a>
                          )}
                        </div>
                      )}

                      {(opp.description || lazyDescriptions[opp.notice_id] || opp.description_url) && (
                        <CollapsibleOpportunityDescription
                          text={opp.description || lazyDescriptions[opp.notice_id]}
                          loading={loadingDescriptionFor === opp.notice_id}
                          pendingRemote={
                            !!(opp.description_url && !opp.description && !lazyDescriptions[opp.notice_id])
                          }
                          onLoad={() => loadFullDescription(opp.notice_id)}
                          error={
                            descriptionErrorFor?.id === opp.notice_id
                              ? descriptionErrorFor.error
                              : null
                          }
                          onRetry={() => loadFullDescription(opp.notice_id)}
                        />
                      )}

                      {opp.ui_link && (
                        <div className="flex gap-2 pt-1">
                          <a
                            href={opp.ui_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onMouseDown={() => track('link_click', 'market_intel_dashboard', {
                              action: 'open_sam',
                              notice_id: opp.notice_id,
                            })}
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

      <footer className="border-t border-gray-800 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm text-gray-500">
            Data sourced from SAM.gov • Refreshed daily at 6 AM UTC • Mindy
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function MarketIntelPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-white font-bold text-xl">M</span>
          </div>
          <p className="text-gray-400">Loading Mindy AI…</p>
        </div>
      </div>
    }>
      {/* /app/market-intel is a standalone route (not under /app's
          ToastHost). Mount our own so the new Track / Dismiss action
          buttons inside row cards can showToast() like every other
          panel. Same pattern as src/app/app/page.tsx wrap. */}
      <ToastHost>
        <MarketIntelDashboard />
      </ToastHost>
    </Suspense>
  );
}
