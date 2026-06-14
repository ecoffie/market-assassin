'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import { useToast } from '../Toast';
import { formatOpportunityLocation } from '@/lib/mindy/opportunity-location';
import { getBuyerAgencyParts } from '@/lib/mindy/agency-display';
import { getNaics, getPsc } from '@/lib/codes/lookup';
import { NaicsBadgeList } from '@/components/codes/NaicsBadge';
import { formatDodaacOffice } from '@/lib/gov-contacts/dodaac';
import { useDodaacNames } from '@/components/app/useDodaacNames';
import { userNeedsMindySetup } from '@/lib/alerts/profile-setup';
import SamAttachmentLinks from '@/components/app/SamAttachmentLinks';
import CollapsibleOpportunityDescription from '@/components/app/CollapsibleOpportunityDescription';
import OpportunityDetailStrip from '@/components/app/OpportunityDetailStrip';

interface AlertsPanelProps {
  email: string | null;
  tier: AppTier;
}

interface Alert {
  id: string;
  title: string;
  solicitationNumber?: string;
  description?: string;
  department?: string;
  subTier?: string;
  office?: string;
  buyerName?: string;
  buyerOffice?: string;
  parentAgency?: string;
  buyerDisplay?: string;
  postedDate?: string;
  responseDeadline?: string;
  noticeType?: string;
  naicsCode?: string;
  pscCode?: string;
  setAside?: string;
  setAsideDescription?: string;
  popState?: string;
  popCity?: string;
  popZip?: string;
  popCountry?: string;
  url: string;
  daysLeft?: number | null;
  isUrgent?: boolean;
  isClosingSoon?: boolean;
  recommendationScore?: number;
  feedbackReasons?: string[];
  descriptionUrl?: string | null;
  ctaTags?: Array<{
    ctaId: string;
    name: string;
    shortName: string;
    confidence: 'high' | 'medium' | 'low';
    matchSource: string;
  }>;
  // Extra SAM record fields populated by the static + per-opp
  // backfill jobs. Used by the Details drawer to render the full
  // opportunity in-app instead of bouncing to sam.gov.
  attachments?: Array<Record<string, unknown> | string>;
  pointsOfContact?: Array<Record<string, unknown>>;
  officeAddress?: Record<string, unknown> | null;
  fairOpportunity?: Record<string, unknown> | null;
  additionalInfoLink?: string | null;
  additionalInfoText?: string | null;
}

interface CtaCodeOption {
  cta_id: string;
  name: string;
  short_name: string;
  description: string;
  priority_order: number;
}

function ctaConfidenceClass(confidence: 'high' | 'medium' | 'low'): string {
  if (confidence === 'high') return 'bg-violet-600/30 text-violet-100 border border-violet-500/50';
  if (confidence === 'medium') return 'bg-violet-500/15 text-violet-200 border border-violet-500/25';
  return 'bg-transparent text-violet-300 border border-violet-500/30 border-dashed';
}

type AlertFilter = 'all' | 'solicitation' | 'sources' | 'setaside' | 'urgent';
type SortMode = 'recommendation' | 'deadline' | 'posted' | 'agency';
type FeedbackType =
  | 'good_match'
  | 'bad_match'
  | 'not_my_industry'
  | 'too_big_small'
  | 'already_knew'
  | 'want_more_like_this';

const FEEDBACK_OPTIONS: Array<{ type: FeedbackType; label: string }> = [
  { type: 'good_match', label: 'Good match' },
  { type: 'bad_match', label: 'Bad match' },
  { type: 'not_my_industry', label: 'Not my industry' },
  { type: 'too_big_small', label: 'Too big/small' },
  { type: 'already_knew', label: 'Already knew' },
  { type: 'want_more_like_this', label: 'More like this' },
];

function getAlertLocation(alert: Alert) {
  return formatOpportunityLocation({
    popCity: alert.popCity,
    popState: alert.popState,
    popZip: alert.popZip,
    popCountry: alert.popCountry,
  });
}

function getAlertBuyer(alert: Alert) {
  return getBuyerAgencyParts({
    agency: alert.buyerName,
    department: alert.department,
    subTier: alert.subTier,
    office: alert.buyerOffice || alert.office,
  });
}

export default function AlertsPanel({ email, tier }: AlertsPanelProps) {
  const dodaacNames = useDodaacNames();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<AlertFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recommendation');
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  // Lazy-loaded full descriptions per notice_id. SAM stores most
  // descriptions as URL pointers, so the drawer fetches the real
  // text on open and caches it across drawer re-opens.
  const [lazyDescriptions, setLazyDescriptions] = useState<Record<string, string>>({});
  const [loadingDescription, setLoadingDescription] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  // Mindy Analyst (AI bid/no-bid) — Pro feature. Cached per
  // (notice_id, user) server-side; we also cache in-memory so flipping
  // between drawer-open/close doesn't refetch.
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
  const [analystLoading, setAnalystLoading] = useState<string | null>(null);
  const [analystError, setAnalystError] = useState<{ id: string; teaser: boolean; message: string } | null>(null);
  const [savingAlertIds, setSavingAlertIds] = useState<Set<string>>(new Set());
  const [savedAlertIds, setSavedAlertIds] = useState<Set<string>>(new Set());
  // alert.id → pipeline row id, so the toast's Undo action can DELETE
  // the row that was just inserted. Mirrors the DashboardPanel pattern.
  const [pipelineRowByAlert, setPipelineRowByAlert] = useState<Record<string, string>>({});
  const { showToast } = useToast();
  const [feedbackByAlert, setFeedbackByAlert] = useState<Record<string, FeedbackType>>({});
  const [savingFeedbackIds, setSavingFeedbackIds] = useState<Set<string>>(new Set());
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  const [totalCount, setTotalCount] = useState(0);
  const [ctaOptions, setCtaOptions] = useState<CtaCodeOption[]>([]);
  const [selectedCtaIds, setSelectedCtaIds] = useState<string[]>([]);
  const [ctaSectionOpen, setCtaSectionOpen] = useState(false);
  const [ctaNeedsBackfill, setCtaNeedsBackfill] = useState(false);
  const [stateFilter, setStateFilter] = useState<string>('');
  const [searchCriteria, setSearchCriteria] = useState<{
    naicsCodes: string[];
    keywords: string[];
    businessDescription: string | null;
    businessType: string | null;
    setAsidePreferences: string[];
    locationStates: string[];
  }>({
    naicsCodes: [],
    keywords: [],
    businessDescription: null,
    businessType: null,
    setAsidePreferences: [],
    locationStates: [],
  });

  const canUsePipeline = tier !== 'free';
  const isFreeTier = tier === 'free';
  const needsProfileSetup = useMemo(
    () => userNeedsMindySetup({
      naics_codes: searchCriteria.naicsCodes,
      keywords: searchCriteria.keywords,
      business_description: searchCriteria.businessDescription,
    }),
    [searchCriteria],
  );
  const mindySetupHref = '/app/onboarding';
  const mindyProHref = '/market-intelligence';
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  const trackAlertEvent = useCallback((eventType: 'link_click' | 'tool_use', alert: Alert, action: string) => {
    if (!email) return;

    fetch('/api/mindy/engagement', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        email,
        eventType,
        eventSource: isFreeTier ? 'daily_alerts' : 'source_feed',
        metadata: {
          action,
          opportunity_id: alert.id,
          title: alert.title,
          agency: getAlertBuyer(alert).primary,
        },
      }),
      keepalive: true,
    }).catch(() => {});
  }, [email, getAuthHeaders, isFreeTier]);

  const loadAlerts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (email) params.set('email', email);
      // Show every matching opportunity for the user's profile. The
      // marketing promise is "never go to SAM.gov again" — capping the
      // feed contradicts that. The API itself protects against runaway
      // queries via its internal fetchLimit (2000).
      params.set('limit', '1000');
      if (selectedCtaIds.length > 0) {
        params.set('cta', selectedCtaIds.join(','));
      }

      const res = await fetch(`/api/app/opportunities?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();

      if (data.success) {
        setAlerts(data.opportunities || []);
        setTotalCount(data.count || 0);
        setCtaNeedsBackfill(Boolean(data.ctaFilter?.needsBackfill));
        if (data.searchCriteria) {
          setSearchCriteria({
            naicsCodes: data.searchCriteria.naicsCodes || [],
            keywords: data.searchCriteria.keywords || [],
            businessDescription: data.searchCriteria.businessDescription ?? null,
            businessType: data.searchCriteria.businessType ?? null,
            setAsidePreferences: data.searchCriteria.setAsidePreferences || [],
            locationStates: data.searchCriteria.locationStates || [],
          });
        }
      } else {
        setError(data.error || 'Failed to load opportunities');
        setAlerts([]);
      }
    } catch (err) {
      console.error('Failed to load alerts:', err);
      setError('Failed to connect to server');
      setAlerts([]);
    } finally {
      setIsLoading(false);
    }
  }, [email, getAuthHeaders, selectedCtaIds]);

  useEffect(() => {
    fetch('/api/cta/codes')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.ctas)) {
          setCtaOptions(data.ctas);
        }
      })
      .catch(() => {});
  }, []);

  const toggleCtaFilter = (ctaId: string) => {
    setSelectedCtaIds((prev) =>
      prev.includes(ctaId) ? prev.filter((id) => id !== ctaId) : [...prev, ctaId],
    );
  };

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const saveToPipeline = async (alert: Alert) => {
    if (!email) {
      showToast({ message: 'Sign in before saving opportunities', variant: 'error' });
      return;
    }

    if (!canUsePipeline) {
      if (needsProfileSetup) {
        window.location.href = mindySetupHref;
        return;
      }
      showToast({
        message: 'Pipeline tracking is included with Mindy Pro',
        variant: 'info',
        action: { label: 'Unlock Pipeline', onClick: () => { window.location.href = mindyProHref; } },
      });
      return;
    }

    // Optimistic: flip the button to "Saved" before the network call
    // settles. Matches DashboardPanel's Track-in-Pipeline pattern.
    setSavedAlertIds(prev => new Set(prev).add(alert.id));
    setSavingAlertIds(prev => new Set(prev).add(alert.id));

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_email: email,
          notice_id: alert.id,
          source: 'mi_beta_alerts',
          external_url: alert.url,
          title: alert.title,
          agency: getAlertBuyer(alert).primary,
          naics_code: alert.naicsCode,
          set_aside: alert.setAside,
          response_deadline: alert.responseDeadline,
          stage: 'tracking',
          priority: alert.isUrgent ? 'critical' : alert.isClosingSoon ? 'high' : 'medium',
          notes: [
            alert.noticeType ? `Notice type: ${alert.noticeType}` : null,
            alert.solicitationNumber ? `Solicitation: ${alert.solicitationNumber}` : null,
            getAlertBuyer(alert).parent ? `Parent agency: ${getAlertBuyer(alert).parent}` : null,
            getAlertBuyer(alert).secondary ? `Office: ${getAlertBuyer(alert).secondary}` : null,
          ].filter(Boolean).join('\n'),
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const pipelineRowId = data.opportunity?.id as string | undefined;
        if (pipelineRowId) {
          setPipelineRowByAlert(prev => ({ ...prev, [alert.id]: pipelineRowId }));
        }
        trackAlertEvent('tool_use', alert, 'save_to_pipeline');
        showToast({
          message: 'Saved to Pipeline',
          variant: 'success',
          action: pipelineRowId
            ? {
                label: 'Undo',
                onClick: () => {
                  setSavedAlertIds(prev => {
                    const next = new Set(prev);
                    next.delete(alert.id);
                    return next;
                  });
                  setPipelineRowByAlert(prev => {
                    const next = { ...prev };
                    delete next[alert.id];
                    return next;
                  });
                  fetch('/api/pipeline', {
                    method: 'DELETE',
                    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ id: pipelineRowId, user_email: email }),
                  }).catch((err) => console.warn('[AlertsPanel] Undo DELETE failed:', err));
                },
              }
            : undefined,
        });
        return;
      }

      if (res.status === 409) {
        // Already saved — keep optimistic state, but no Undo since we
        // didn't insert anything just now.
        showToast({ message: 'Already in your Pipeline', variant: 'info' });
        return;
      }

      // Server rejected — roll back.
      setSavedAlertIds(prev => {
        const next = new Set(prev);
        next.delete(alert.id);
        return next;
      });
      showToast({
        message: data.error || 'Could not save to Pipeline',
        variant: 'error',
      });
    } catch (err) {
      console.error('Failed to save opportunity:', err);
      setSavedAlertIds(prev => {
        const next = new Set(prev);
        next.delete(alert.id);
        return next;
      });
      showToast({ message: 'Network error — could not save', variant: 'error' });
    } finally {
      setSavingAlertIds(prev => {
        const next = new Set(prev);
        next.delete(alert.id);
        return next;
      });
    }
  };

  const loadFullDescription = useCallback(async (noticeId: string) => {
    if (lazyDescriptions[noticeId]) return; // already cached
    setLoadingDescription(noticeId);
    setDescriptionError(null);
    try {
      const res = await fetch(`/api/sam-description?noticeId=${encodeURIComponent(noticeId)}`);
      const data = await res.json();
      if (!res.ok || !data.success || !data.description) {
        setDescriptionError(data.error || 'Could not load description');
        return;
      }
      setLazyDescriptions((prev) => ({ ...prev, [noticeId]: data.description }));
    } catch (err) {
      console.error('Failed to fetch SAM description:', err);
      setDescriptionError('Network error fetching description');
    } finally {
      setLoadingDescription(null);
    }
  }, [lazyDescriptions]);

  const loadAnalyst = useCallback(async (noticeId: string) => {
    if (!email) return;
    if (analystByOpp[noticeId]) return; // already cached in memory
    setAnalystLoading(noticeId);
    setAnalystError(null);
    try {
      const res = await fetch('/api/analyst/bid-no-bid', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ noticeId, email }),
      });
      const data = await res.json();
      // 402 = pro-gated teaser, render the upgrade card.
      if (res.status === 402 || data.teaser) {
        setAnalystError({ id: noticeId, teaser: true, message: data.error || 'Mindy Pro required' });
        return;
      }
      if (!res.ok || !data.success || !data.analysis) {
        setAnalystError({ id: noticeId, teaser: false, message: data.error || 'Analyst unavailable' });
        return;
      }
      setAnalystByOpp((prev) => ({ ...prev, [noticeId]: data.analysis }));
    } catch (err) {
      console.error('Failed to fetch Analyst:', err);
      setAnalystError({ id: noticeId, teaser: false, message: 'Network error' });
    } finally {
      setAnalystLoading(null);
    }
  }, [email, analystByOpp]);

  // Background-fetch synopsis when drawer opens.
  useEffect(() => {
    if (!selectedAlert) return;
    if (selectedAlert.description || lazyDescriptions[selectedAlert.id]) return;
    if (loadingDescription === selectedAlert.id) return;
    void loadFullDescription(selectedAlert.id);
  }, [selectedAlert, lazyDescriptions, loadingDescription, loadFullDescription]);

  useEffect(() => {
    if (!selectedAlert) return;
    void loadAnalyst(selectedAlert.id);
  }, [selectedAlert, loadAnalyst]);

  const dismissAlert = (alert: Alert) => {
    setDismissedAlertIds(prev => new Set(prev).add(alert.id));
    trackAlertEvent('tool_use', alert, 'dismiss');
    if (selectedAlert?.id === alert.id) setSelectedAlert(null);
    // Dismiss is purely client-side (we just add to a Set), so the
    // Undo just removes the id again. No server call to reverse.
    showToast({
      message: 'Dismissed',
      variant: 'info',
      action: {
        label: 'Undo',
        onClick: () => {
          setDismissedAlertIds(prev => {
            const next = new Set(prev);
            next.delete(alert.id);
            return next;
          });
        },
      },
    });
  };

  const saveFeedback = async (alert: Alert, feedbackType: FeedbackType) => {
    if (!email) {
      showToast({ message: 'Sign in before tuning Mindy matches', variant: 'error' });
      return;
    }

    // Optimistic: stash the selection before the network call so the
    // chip flips immediately.
    const previousFeedback = feedbackByAlert[alert.id];
    setFeedbackByAlert(prev => ({ ...prev, [alert.id]: feedbackType }));
    setSavingFeedbackIds(prev => new Set(prev).add(alert.id));

    try {
      const res = await fetch('/api/mindy/opportunity-feedback', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          email,
          opportunityId: alert.id,
          feedbackType,
          title: alert.title,
          agency: getAlertBuyer(alert).primary,
          url: alert.url,
          source: isFreeTier ? 'daily_alerts' : 'source_feed',
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        showToast({ message: 'Feedback saved — Mindy is learning', variant: 'success' });
        return;
      }

      // Roll back optimistic chip selection.
      setFeedbackByAlert(prev => {
        const next = { ...prev };
        if (previousFeedback) next[alert.id] = previousFeedback;
        else delete next[alert.id];
        return next;
      });
      showToast({
        message: data?.error || 'Could not save feedback',
        variant: 'error',
      });
    } catch (err) {
      console.error('Failed to save feedback:', err);
      setFeedbackByAlert(prev => {
        const next = { ...prev };
        if (previousFeedback) next[alert.id] = previousFeedback;
        else delete next[alert.id];
        return next;
      });
      showToast({ message: 'Network error — feedback not saved', variant: 'error' });
    } finally {
      setSavingFeedbackIds(prev => {
        const next = new Set(prev);
        next.delete(alert.id);
        return next;
      });
    }
  };

  const getNoticeTypeBadge = (type?: string) => {
    if (!type) return 'bg-slate-500/20 text-slate-400';
    const lowerType = type.toLowerCase();
    if (lowerType.includes('solicitation') && !lowerType.includes('presolicitation')) {
      return 'bg-green-500/20 text-green-400';
    }
    if (lowerType.includes('combined')) {
      return 'bg-teal-500/20 text-teal-400';
    }
    if (lowerType.includes('sources sought') || lowerType.includes('request for information')) {
      return 'bg-purple-500/20 text-purple-400';
    }
    if (lowerType.includes('presolicitation')) {
      return 'bg-orange-500/20 text-orange-400';
    }
    if (lowerType.includes('rfq')) {
      return 'bg-blue-500/20 text-blue-400';
    }
    return 'bg-slate-500/20 text-slate-400';
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

  const matchesFilter = (alert: Alert, alertFilter: AlertFilter) => {
    if (alertFilter === 'all') return true;
    if (alertFilter === 'solicitation') return alert.noticeType?.toLowerCase().includes('solicitation');
    if (alertFilter === 'sources') {
      const noticeType = alert.noticeType?.toLowerCase() || '';
      return noticeType.includes('sources') || noticeType.includes('request for information');
    }
    if (alertFilter === 'setaside') return !!alert.setAside;
    if (alertFilter === 'urgent') return alert.isUrgent || alert.isClosingSoon;
    return true;
  };

  const filterCounts = useMemo<Record<AlertFilter, number>>(() => ({
    all: alerts.length,
    solicitation: alerts.filter(alert => matchesFilter(alert, 'solicitation')).length,
    sources: alerts.filter(alert => matchesFilter(alert, 'sources')).length,
    setaside: alerts.filter(alert => matchesFilter(alert, 'setaside')).length,
    urgent: alerts.filter(alert => matchesFilter(alert, 'urgent')).length,
  }), [alerts]);

  const filteredAlerts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return alerts
      .filter(alert => !dismissedAlertIds.has(alert.id))
      .filter(alert => matchesFilter(alert, filter))
      .filter(alert => !stateFilter || alert.popState === stateFilter)
      .filter(alert => {
        if (!normalizedSearch) return true;
        return [
          alert.title,
          alert.department,
          alert.office,
          alert.noticeType,
          alert.naicsCode,
          alert.solicitationNumber,
          alert.popCity,
          alert.popState,
          alert.popZip,
          alert.popCountry,
        ].some(value => value?.toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => {
        if (sortMode === 'recommendation') {
          // Server already sorted by recommendationScore (set-aside fit +
          // agency fit + feedback). Preserve that order so the feed feels
          // like the email which uses the same scoring.
          return 0;
        }
        if (sortMode === 'agency') {
          return (a.department || '').localeCompare(b.department || '');
        }
        if (sortMode === 'posted') {
          return new Date(b.postedDate || 0).getTime() - new Date(a.postedDate || 0).getTime();
        }
        return new Date(a.responseDeadline || 8640000000000000).getTime() - new Date(b.responseDeadline || 8640000000000000).getTime();
      });
  }, [alerts, dismissedAlertIds, filter, searchQuery, sortMode, stateFilter]);

  const availableStates = useMemo(() => {
    const set = new Set<string>();
    for (const alert of alerts) {
      if (alert.popState) set.add(alert.popState);
    }
    return Array.from(set).sort();
  }, [alerts]);

  // Mirror the daily-alert email's visual rhythm by chunking results into
  // sections instead of one flat list. Each alert lands in the FIRST
  // bucket it qualifies for so we don't double-count.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const sectionedAlerts = useMemo(() => {
    const now = Date.now();
    const urgent: Alert[] = [];
    const recentlyPosted: Alert[] = [];
    const allOther: Alert[] = [];

    for (const alert of filteredAlerts) {
      if (alert.isUrgent) {
        urgent.push(alert);
        continue;
      }
      const posted = alert.postedDate ? new Date(alert.postedDate).getTime() : 0;
      if (posted && now - posted <= SEVEN_DAYS_MS) {
        recentlyPosted.push(alert);
        continue;
      }
      allOther.push(alert);
    }

    return { urgent, recentlyPosted, allOther };
  }, [filteredAlerts]);

  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, []);

  const filterOptions: Array<{ key: AlertFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'solicitation', label: 'Solicitations' },
    { key: 'sources', label: 'Sources Sought' },
    { key: 'setaside', label: 'Set-Aside' },
    { key: 'urgent', label: 'Due Soon' },
  ];

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6">
      {/* Branded header card — mirrors the daily-alert email banner so the
          in-app feed has the same visual rhythm as what users see in
          their inbox: title, date, match count, profile filter summary.
          Mobile: stack title above buttons, tighter padding so the
          title doesn't word-wrap to one-word-per-line. */}
      <div className="rounded-xl overflow-hidden border border-slate-800">
        <div className="bg-gradient-to-br from-slate-950 to-slate-900 px-4 md:px-6 py-4 md:py-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 md:gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 md:gap-3">
                <span className="text-2xl shrink-0">🎯</span>
                <h1 className="text-lg md:text-xl font-bold text-white leading-tight">
                  {isFreeTier ? 'Mindy Daily Alerts' : 'Mindy Saved Search Alert'}
                </h1>
                {isFreeTier && (
                  <span className="px-2 py-0.5 text-xs bg-slate-800 text-slate-300 rounded shrink-0">Free</span>
                )}
              </div>
              <p className="text-sm text-slate-400 mt-1">
                {todayFormatted}
                {totalCount > 0 && <span className="text-emerald-400 ml-2">• {totalCount} matches found</span>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={loadAlerts}
                disabled={isLoading}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Refreshing…' : '🔄 Refresh'}
              </button>
              {isFreeTier && needsProfileSetup && (
                <Link
                  href={mindySetupHref}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold rounded-lg transition-colors"
                >
                  Set up your keywords →
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Filter summary — mirrors the dark band under the email header.
            Mobile: stack as wrapping flex rows so NAICS badges don't
            squeeze into a 30px column. */}
        {(searchCriteria.naicsCodes.length > 0 || searchCriteria.businessType || searchCriteria.setAsidePreferences.length > 0 || searchCriteria.locationStates.length > 0) && (
          <div className="bg-slate-900 border-t border-slate-800 px-4 md:px-6 py-3 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-semibold text-slate-300">Filters:</span>
              {searchCriteria.naicsCodes.length > 0 && (
                <span className="inline-flex items-center gap-1.5 align-middle flex-wrap">
                  <span className="text-slate-300">NAICS</span>
                  <NaicsBadgeList codes={searchCriteria.naicsCodes} max={3} size="sm" />
                </span>
              )}
              {searchCriteria.businessType && (
                <span>• {searchCriteria.businessType}</span>
              )}
              {searchCriteria.setAsidePreferences.length > 0 && (
                <span>
                  • Set-asides: {searchCriteria.setAsidePreferences.slice(0, 3).join(', ')}
                </span>
              )}
              {searchCriteria.locationStates.length > 0 && (
                <span>
                  • States: {searchCriteria.locationStates.length <= 4
                    ? searchCriteria.locationStates.join(', ')
                    : `${searchCriteria.locationStates.slice(0, 3).join(', ')} +${searchCriteria.locationStates.length - 3}`}
                </span>
              )}
              {searchCriteria.locationStates.length === 0 && (
                <span className="text-slate-500">• States: all (national)</span>
              )}
            </div>
          </div>
        )}
      </div>

      {!isFreeTier && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-emerald-200">Included raw feed for paid accounts</h2>
          <p className="text-sm text-emerald-100/80 mt-1">
            Use this when you want to search or validate every SAM.gov match. AI Briefings remains the prioritized daily view with summaries and recommendations.
          </p>
        </div>
      )}

      {/* DoD Critical Tech Area filter — collapsed by default (NAPEX / APEX counselors) */}
      {ctaOptions.length > 0 && (
        <div className="rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-950/40 to-slate-950/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setCtaSectionOpen((open) => !open)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-violet-500/5 transition-colors"
          >
            <div>
              <p className="text-sm font-semibold text-violet-100">Critical Tech Areas (DoD 14 CTAs)</p>
              <p className="text-xs text-violet-200/70 mt-0.5">
                Filter to opportunities aligned with the 35% APEX reporting mandate
                {selectedCtaIds.length > 0 && (
                  <span className="text-violet-300"> · {selectedCtaIds.length} selected</span>
                )}
              </p>
            </div>
            <span className="text-violet-300 text-sm shrink-0">{ctaSectionOpen ? '▾' : '▸'}</span>
          </button>
          {ctaSectionOpen && (
            <div className="px-4 pb-4 border-t border-violet-500/15">
              <div className="flex flex-wrap gap-2 pt-3">
                {ctaOptions.map((cta) => {
                  const active = selectedCtaIds.includes(cta.cta_id);
                  return (
                    <button
                      key={cta.cta_id}
                      type="button"
                      title={cta.description}
                      onClick={() => toggleCtaFilter(cta.cta_id)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        active
                          ? 'bg-gradient-to-r from-blue-900 to-violet-700 text-white border-violet-400/50'
                          : 'bg-slate-900/80 text-violet-200/90 border-slate-700 hover:border-violet-500/40'
                      }`}
                    >
                      {cta.short_name}
                    </button>
                  );
                })}
              </div>
              {selectedCtaIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedCtaIds([])}
                  className="mt-3 text-xs text-violet-300 hover:text-violet-100"
                >
                  Clear CTA filters
                </button>
              )}
              {ctaNeedsBackfill && selectedCtaIds.length > 0 && (
                <p className="mt-2 text-xs text-amber-300/90">
                  CTA tags are still indexing — results may be sparse until the nightly tag job completes.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {filterOptions.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              filter === key
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border-transparent hover:bg-slate-700 hover:text-white'
            }`}
          >
            {label} <span className={filter === key ? 'text-emerald-200' : 'text-slate-500'}>({filterCounts[key]})</span>
          </button>
        ))}
      </div>

      {/* Search and Sort */}
      <div className="flex flex-col md:flex-row gap-3">
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search title, agency, NAICS, solicitation..."
          className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
        />
        <select
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value)}
          className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
          aria-label="Filter by state"
        >
          <option value="">All states</option>
          {availableStates.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as SortMode)}
          className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
        >
          <option value="recommendation">Best match (recommended)</option>
          <option value="deadline">Sort by response due</option>
          <option value="posted">Sort by newest posted</option>
          <option value="agency">Sort by agency</option>
        </select>
        {(filter !== 'all' || searchQuery || stateFilter || selectedCtaIds.length > 0) && (
          <button
            onClick={() => {
              setFilter('all');
              setSearchQuery('');
              setStateFilter('');
              setSelectedCtaIds([]);
            }}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
          >
            Clear
          </button>
        )}
      </div>


      {!isLoading && alerts.length > 0 && (
        <div className="text-sm text-slate-500">
          Showing <span className="text-slate-300">{filteredAlerts.length}</span> of <span className="text-slate-300">{alerts.length}</span> opportunities
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-emerald-300 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-200 hover:text-white"
            aria-label="Dismiss notice"
          >
            X
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Alert List — bucketed into Urgent / Recently Posted / All so the
          page reads like the daily-alert email (header, sections, list)
          instead of a flat scroll of cards. */}
      {!isLoading && filteredAlerts.length > 0 && (
        <div className="space-y-8">
          {/* Render each non-empty bucket as its own section. Inline the
              same card markup three times via a fragment-returning IIFE so
              we don't restructure the existing markup. */}
          {([
            { key: 'urgent', label: 'Urgent — Closing this week', items: sectionedAlerts.urgent, accent: 'text-red-300' },
            { key: 'recent', label: 'Recently posted', items: sectionedAlerts.recentlyPosted, accent: 'text-emerald-300' },
            { key: 'all', label: 'All matching opportunities', items: sectionedAlerts.allOther, accent: 'text-slate-300' },
          ] as const).filter(s => s.items.length > 0).map(section => (
            <section key={section.key}>
              <h2 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${section.accent}`}>
                {section.label}
                <span className="text-slate-500 font-normal normal-case ml-2">({section.items.length})</span>
              </h2>
              <div className="space-y-3">
                {section.items.map((alert) => (
            <div
              key={alert.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                trackAlertEvent('tool_use', alert, 'open_details');
                setSelectedAlert(alert);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  trackAlertEvent('tool_use', alert, 'open_details');
                  setSelectedAlert(alert);
                }
              }}
              className={`block text-left bg-slate-900 border rounded-xl p-4 hover:border-emerald-500/50 transition-colors cursor-pointer ${
                alert.isUrgent ? 'border-red-500/50 bg-red-500/5' : 'border-slate-800'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 md:gap-4">
                <div className="flex-1 min-w-0">
                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {alert.noticeType && (
                      <span className={`px-2 py-0.5 text-xs rounded ${getNoticeTypeBadge(alert.noticeType)}`}>
                        {alert.noticeType}
                      </span>
                    )}
                    {(alert.setAsideDescription || alert.setAside) && (
                      <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">
                        {alert.setAsideDescription || alert.setAside}
                      </span>
                    )}
                    {alert.isUrgent && (
                      <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded font-medium">
                        🔥 {alert.daysLeft} days left
                      </span>
                    )}
                    {alert.isClosingSoon && !alert.isUrgent && (
                      <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">
                        ⚡ {alert.daysLeft} days left
                      </span>
                    )}
                    {(alert.ctaTags || []).slice(0, 2).map((tag) => (
                      <button
                        key={`${alert.id}-${tag.ctaId}`}
                        type="button"
                        title={`${tag.name} (${tag.confidence} confidence)`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCtaFilter(tag.ctaId);
                          setCtaSectionOpen(true);
                        }}
                        className={`px-2 py-0.5 text-xs rounded ${ctaConfidenceClass(tag.confidence)}`}
                      >
                        {tag.shortName}
                      </button>
                    ))}
                    {(alert.ctaTags?.length || 0) > 2 && (
                      <span className="px-2 py-0.5 text-xs text-violet-300/80">
                        +{(alert.ctaTags?.length || 0) - 2} CTA
                      </span>
                    )}
                    {/* Match-strength chip: surfaces the server-side
                        recommendationScore (set-aside fit + agency fit +
                        user feedback). Mirrors the percentage badge in
                        the daily-alert email — same scoring, same visual
                        weight, so the in-app feed and inbox agree about
                        which opps are best fits. */}
                    {typeof alert.recommendationScore === 'number' && alert.recommendationScore > 0 && (
                      <span
                        className={`px-2 py-0.5 text-xs rounded font-semibold ${
                          alert.recommendationScore >= 50
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : alert.recommendationScore >= 25
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-slate-700/40 text-slate-300'
                        }`}
                        title={
                          alert.feedbackReasons?.length
                            ? `Match reasons: ${alert.feedbackReasons.join(' • ')}`
                            : 'Match quality based on set-aside fit, agency fit, and your feedback'
                        }
                      >
                        ★ {alert.recommendationScore >= 50 ? 'Top match' : alert.recommendationScore >= 25 ? 'Good fit' : 'Possible'}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="font-medium text-white mb-1 line-clamp-2">{alert.title}</h3>

                  {/* Buyer */}
                  <p className="text-sm text-slate-400">
                    {getAlertBuyer(alert).primary}
                    {getAlertBuyer(alert).secondary && <span className="text-slate-500"> • {getAlertBuyer(alert).secondary}</span>}
                    {getAlertBuyer(alert).parent && <span className="text-slate-600"> • {getAlertBuyer(alert).parent}</span>}
                  </p>

                  {/* Office (more granular than the buyer line) */}
                  {alert.office && alert.office !== getAlertBuyer(alert).secondary && (
                    <p className="text-xs text-slate-500 mt-0.5">{alert.office}</p>
                  )}

                  {/* Description preview */}
                  {alert.description && (
                    <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                      {alert.description.length > 220
                        ? `${alert.description.slice(0, 220).trim()}…`
                        : alert.description}
                    </p>
                  )}

                  {/* Meta — keep tight; tooltip via title attr if user wants the description */}
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
                    {alert.naicsCode && (() => {
                      const naicsEntry = getNaics(alert.naicsCode);
                      return (
                        <span title={naicsEntry?.title || alert.naicsCode}>
                          NAICS: <span className="font-mono">{alert.naicsCode}</span>
                          {naicsEntry?.title && (
                            <span className="text-slate-600"> — {naicsEntry.title}</span>
                          )}
                        </span>
                      );
                    })()}
                    {alert.pscCode && (
                      (() => {
                        const pscEntry = getPsc(alert.pscCode);
                        return (
                          <span title={pscEntry?.title || alert.pscCode}>
                            PSC: <span className="font-mono">{alert.pscCode}</span>
                            {pscEntry?.title && (
                              <span className="text-slate-600"> — {pscEntry.title}</span>
                            )}
                          </span>
                        );
                      })()
                    )}
                    {getAlertLocation(alert) && (
                      <span>📍 {getAlertLocation(alert)}</span>
                    )}
                    {alert.solicitationNumber && (
                      <span>#{alert.solicitationNumber}</span>
                    )}
                    {/* Decoded contracting office from the DoDAAC (DoD only) —
                        office-level intel, not just the broad agency. */}
                    {formatDodaacOffice(alert.solicitationNumber || null, dodaacNames) && (
                      <span className="text-emerald-400/80">🏛 {formatDodaacOffice(alert.solicitationNumber || null, dodaacNames)}</span>
                    )}
                  </div>
                </div>

                {/* Dates + actions. On mobile: full-width footer bar
                    with date left, actions right (44pt tap targets).
                    On md+: right-aligned column as before. */}
                <div className="flex flex-row md:flex-col md:text-right md:shrink-0 items-center md:items-end justify-between gap-3 md:gap-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-800/60 md:border-none">
                  <div className="md:order-1">
                    <div className="text-xs text-slate-500">Response Due</div>
                    <div className={`text-sm font-medium ${
                      alert.isUrgent ? 'text-red-400' : alert.isClosingSoon ? 'text-amber-400' : 'text-white'
                    }`}>
                      {formatDate(alert.responseDeadline)}
                    </div>
                    <div className="hidden md:block text-xs text-slate-500 mt-2">
                      Posted {formatDate(alert.postedDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 md:mt-2 md:order-2">
                    {/* Save button only renders for users who can actually
                        save. Free tier gets nothing here — the upgrade
                        pitch lives in the drawer (Mindy Analyst card),
                        not on every card row. Per-card "Upgrade to Save"
                        was noise. */}
                    {canUsePipeline && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          saveToPipeline(alert);
                        }}
                        disabled={savingAlertIds.has(alert.id) || savedAlertIds.has(alert.id)}
                        className="text-xs text-blue-300 hover:text-blue-200 disabled:text-slate-500 disabled:cursor-default px-3 py-2 md:px-2 md:py-1 hover:bg-blue-500/10 rounded min-h-[44px] md:min-h-0 inline-flex items-center"
                      >
                        {savedAlertIds.has(alert.id)
                          ? 'Saved'
                          : savingAlertIds.has(alert.id)
                            ? 'Saving...'
                            : 'Save'}
                      </button>
                    )}
                    <a
                      href={alert.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={() => trackAlertEvent('link_click', alert, 'open_sam')}
                      className="text-xs text-emerald-400 hover:text-emerald-300 px-3 py-2 md:px-2 md:py-1 hover:bg-emerald-500/10 rounded min-h-[44px] md:min-h-0 inline-flex items-center"
                    >
                      SAM.gov →
                    </a>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        dismissAlert(alert);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-300 px-3 py-2 md:px-2 md:py-1 hover:bg-slate-800 rounded min-h-[44px] md:min-h-0 inline-flex items-center"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredAlerts.length === 0 && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-4">📋</div>
          <h3 className="text-lg font-medium text-white mb-2">No Opportunities Found</h3>
          <p className="text-slate-400 text-sm">
            {selectedCtaIds.length > 0
              ? 'No opportunities match the selected Critical Tech Areas. Try fewer CTAs or expand your NAICS profile.'
              : filter !== 'all'
              ? 'Try a different filter, clear your search, or check back later.'
              : 'Configure your NAICS codes and keywords so Mindy can match opportunities for you.'}
          </p>
          {selectedCtaIds.length === 0 && filter === 'all' && needsProfileSetup && (
            <Link
              href={mindySetupHref}
              className="inline-block mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold rounded-lg transition-colors"
            >
              Set up your profile →
            </Link>
          )}
        </div>
      )}

      {/* Summary Stats */}
      {!isLoading && alerts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-800">
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-white">{alerts.length}</div>
            <div className="text-xs text-slate-500">Total</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-400">
              {alerts.filter(a => a.isUrgent).length}
            </div>
            <div className="text-xs text-slate-500">Urgent</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">
              {alerts.filter(a => a.setAside).length}
            </div>
            <div className="text-xs text-slate-500">Set-Asides</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-400">
              {alerts.filter(a => a.noticeType?.toLowerCase().includes('solicitation')).length}
            </div>
            <div className="text-xs text-slate-500">Solicitations</div>
          </div>
        </div>
      )}

      {/* Opportunity Detail Drawer */}
      {selectedAlert && (
        <>
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={() => setSelectedAlert(null)}
          />
          <aside className="fixed right-0 top-0 h-full w-full max-w-2xl bg-slate-950 border-l border-slate-800 z-50 overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-slate-950/95 backdrop-blur border-b border-slate-800 p-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider">Opportunity Details</p>
                <h2 className="text-lg font-semibold text-white mt-1 line-clamp-2">{selectedAlert.title}</h2>
              </div>
              <button
                onClick={() => setSelectedAlert(null)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                aria-label="Close details"
              >
                X
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="flex flex-wrap gap-2">
                {selectedAlert.noticeType && (
                  <span className={`px-2 py-1 text-xs rounded ${getNoticeTypeBadge(selectedAlert.noticeType)}`}>
                    {selectedAlert.noticeType}
                  </span>
                )}
                {(selectedAlert.setAsideDescription || selectedAlert.setAside) && (
                  <span className="px-2 py-1 text-xs bg-purple-500/20 text-purple-400 rounded">
                    {selectedAlert.setAsideDescription || selectedAlert.setAside}
                  </span>
                )}
                {(selectedAlert.isUrgent || selectedAlert.isClosingSoon) && (
                  <span className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded">
                    {selectedAlert.daysLeft} days left
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                  <div className="text-xs text-slate-500">Response Due</div>
                  <div className="text-white font-medium mt-1">{formatDate(selectedAlert.responseDeadline)}</div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                  <div className="text-xs text-slate-500">Posted</div>
                  <div className="text-white font-medium mt-1">{formatDate(selectedAlert.postedDate)}</div>
                </div>
              </div>

              <OpportunityDetailStrip
                attachmentCount={selectedAlert.attachments?.length || 0}
                contactCount={
                  selectedAlert.pointsOfContact?.filter((poc) => {
                    const fullName = (poc?.fullName || poc?.full_name || poc?.name) as string | undefined;
                    const pocEmail = poc?.email as string | undefined;
                    const phone = (poc?.phone || poc?.phoneNumber) as string | undefined;
                    return !!(fullName || pocEmail || phone);
                  }).length || 0
                }
                deadlineLabel={formatDate(selectedAlert.responseDeadline)}
                deadlineUrgent={selectedAlert.isUrgent || selectedAlert.isClosingSoon}
                placeLabel={formatOpportunityLocation(selectedAlert) || null}
                attachmentsAnchorId={`alert-docs-${selectedAlert.id}`}
                contactsAnchorId={`alert-poc-${selectedAlert.id}`}
              />

              {selectedAlert.pointsOfContact && selectedAlert.pointsOfContact.length > 0 && (
                <div id={`alert-poc-${selectedAlert.id}`} className="bg-slate-900 border border-slate-800 rounded-lg p-4 scroll-mt-4">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">
                    Points of Contact
                  </div>
                  <div className="space-y-3">
                    {selectedAlert.pointsOfContact.map((poc, idx) => {
                      const fullName = (poc?.fullName || poc?.full_name || poc?.name) as string | undefined;
                      const title = (poc?.title || poc?.type) as string | undefined;
                      const pocEmail = poc?.email as string | undefined;
                      const phone = (poc?.phone || poc?.phoneNumber) as string | undefined;
                      if (!fullName && !pocEmail && !phone) return null;
                      return (
                        <div key={idx} className="border border-slate-800 rounded-lg p-3 text-sm">
                          {fullName && <p className="text-slate-200 font-medium line-clamp-2">{fullName}</p>}
                          {title && <p className="text-xs text-slate-500">{title}</p>}
                          {pocEmail && (
                            <a href={`mailto:${pocEmail}`} className="block mt-1 text-purple-300 hover:text-purple-200 text-xs break-all">
                              {pocEmail}
                            </a>
                          )}
                          {phone && (
                            <a href={`tel:${phone}`} className="block text-slate-400 hover:text-slate-200 text-xs">
                              {phone}
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(selectedAlert.description || lazyDescriptions[selectedAlert.id] || selectedAlert.descriptionUrl || selectedAlert.id) && (
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                  <CollapsibleOpportunityDescription
                    text={selectedAlert.description || lazyDescriptions[selectedAlert.id]}
                    loading={loadingDescription === selectedAlert.id}
                    pendingRemote={
                      !(selectedAlert.description || lazyDescriptions[selectedAlert.id])
                      && loadingDescription !== selectedAlert.id
                    }
                    onLoad={() => loadFullDescription(selectedAlert.id)}
                    error={descriptionError}
                    onRetry={() => loadFullDescription(selectedAlert.id)}
                  />
                </div>
              )}

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
                <div>
                  <div className="text-xs text-slate-500">Buyer</div>
                  <div className="text-slate-200">{getAlertBuyer(selectedAlert).primary}</div>
                </div>
                {getAlertBuyer(selectedAlert).secondary && (
                  <div>
                    <div className="text-xs text-slate-500">Office</div>
                    <div className="text-slate-200">{getAlertBuyer(selectedAlert).secondary}</div>
                  </div>
                )}
                {getAlertBuyer(selectedAlert).parent && (
                  <div>
                    <div className="text-xs text-slate-500">Parent Agency</div>
                    <div className="text-slate-200">{getAlertBuyer(selectedAlert).parent}</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">NAICS</div>
                    <div className="text-slate-200">{selectedAlert.naicsCode || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">PSC</div>
                    <div className="text-slate-200">{selectedAlert.pscCode || '-'}</div>
                  </div>
                </div>
                {selectedAlert.solicitationNumber && (
                  <div>
                    <div className="text-xs text-slate-500">Solicitation Number</div>
                    <div className="text-slate-200">{selectedAlert.solicitationNumber}</div>
                  </div>
                )}
                {getAlertLocation(selectedAlert) && (
                  <div>
                    <div className="text-xs text-slate-500">Place of Performance</div>
                    <div className="text-slate-200">{getAlertLocation(selectedAlert)}</div>
                  </div>
                )}
              </div>

              {/* Mindy Analyst — AI bid/no-bid recommendation. Pro
                  feature; free tier gets the upgrade teaser. PRD-ai-bd-
                  department.md Agent #2. */}
              {(() => {
                const analysis = analystByOpp[selectedAlert.id];
                const isLoading = analystLoading === selectedAlert.id;
                const err = analystError?.id === selectedAlert.id ? analystError : null;

                if (analysis) {
                  const recColor =
                    analysis.recommendation === 'pursue'
                      ? { ring: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-300' }
                      : analysis.recommendation === 'watch'
                      ? { ring: 'border-amber-500/40', bg: 'bg-amber-500/10', text: 'text-amber-300' }
                      : { ring: 'border-slate-600/40', bg: 'bg-slate-700/30', text: 'text-slate-400' };
                  const label = analysis.recommendation === 'pursue'
                    ? 'PURSUE'
                    : analysis.recommendation === 'watch'
                    ? 'WATCH'
                    : 'SKIP';
                  return (
                    <div className={`rounded-xl border ${recColor.ring} ${recColor.bg} p-4 space-y-3`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">★</span>
                          <div>
                            <p className="text-xs text-slate-500 uppercase tracking-wider">Mindy Analyst</p>
                            <p className={`text-lg font-bold ${recColor.text}`}>
                              {label}
                              <span className="text-sm font-medium text-slate-400 ml-2">
                                Score: {analysis.score}/100
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>

                      {analysis.why_pursue.length > 0 && (
                        <div>
                          <p className="text-xs text-emerald-400 font-semibold mb-1">WHY PURSUE</p>
                          <ul className="text-sm text-slate-200 space-y-1">
                            {analysis.why_pursue.slice(0, 5).map((reason, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <span className="text-emerald-400 mt-0.5">✓</span>
                                <span>{reason}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {analysis.concerns.length > 0 && (
                        <div>
                          <p className="text-xs text-amber-400 font-semibold mb-1">CONCERNS</p>
                          <ul className="text-sm text-slate-200 space-y-1">
                            {analysis.concerns.slice(0, 4).map((concern, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <span className="text-amber-400 mt-0.5">⚠</span>
                                <span>{concern}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {analysis.competitors_likely.length > 0 && (
                        <div>
                          <p className="text-xs text-slate-400 font-semibold mb-1">COMPETITORS LIKELY</p>
                          <p className="text-sm text-slate-300">{analysis.competitors_likely.join(' • ')}</p>
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-800/50 space-y-1.5">
                        <p className="text-sm text-slate-300">
                          <span className="text-xs text-slate-500 uppercase tracking-wider mr-2">Effort</span>
                          {analysis.effort_estimate}
                        </p>
                        <p className="text-sm text-slate-200 font-medium">
                          <span className="text-xs text-slate-500 uppercase tracking-wider mr-2">Next step</span>
                          {analysis.next_step}
                        </p>
                      </div>
                    </div>
                  );
                }

                if (isLoading) {
                  return (
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-center gap-3 text-sm text-slate-400">
                      <span className="inline-block w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                      Mindy Analyst is reading the RFP…
                    </div>
                  );
                }

                if (err?.teaser) {
                  if (needsProfileSetup) {
                    return (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                        <p className="text-xs text-amber-300 uppercase tracking-wider mb-1">Personalize first</p>
                        <p className="text-sm text-slate-200 mb-3">
                          Add your keywords and NAICS so Mindy can score this opportunity for{' '}
                          <em>your</em> business. Setup is free — takes about 2 minutes.
                        </p>
                        <Link
                          href={mindySetupHref}
                          className="inline-block px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold rounded-lg transition-colors"
                        >
                          Set up Mindy →
                        </Link>
                      </div>
                    );
                  }

                  return (
                    <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
                      <p className="text-xs text-purple-300 uppercase tracking-wider mb-1">Mindy Analyst</p>
                      <p className="text-sm text-slate-200 mb-3">
                        Get an AI bid/no-bid analysis for this opportunity — score, why-pursue reasons,
                        concerns, likely competitors, and the next step. Included with Mindy Pro.
                      </p>
                      <a
                        href={mindyProHref}
                        className="inline-block px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-colors"
                      >
                        Get bid/no-bid analysis
                      </a>
                    </div>
                  );
                }

                if (err) {
                  return (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm">
                      <p className="text-red-300">Analyst unavailable: {err.message}</p>
                      <button
                        type="button"
                        onClick={() => loadAnalyst(selectedAlert.id)}
                        className="mt-2 text-xs text-purple-300 hover:text-purple-200 underline"
                      >
                        Retry
                      </button>
                    </div>
                  );
                }

                // No state yet (component just mounted) — render nothing.
                return null;
              })()}

              {/* Contracting office address */}
              {selectedAlert.officeAddress && Object.values(selectedAlert.officeAddress).some(Boolean) && (
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                    Contracting Office Address
                  </div>
                  <p className="text-sm text-slate-200">
                    {[
                      selectedAlert.officeAddress.streetAddress,
                      selectedAlert.officeAddress.streetAddress2,
                      selectedAlert.officeAddress.city,
                      [selectedAlert.officeAddress.state, (selectedAlert.officeAddress.zipcode || selectedAlert.officeAddress.zip)]
                        .filter(Boolean).join(' '),
                      selectedAlert.officeAddress.countryCode,
                    ].filter(Boolean).join(', ') as string}
                  </p>
                </div>
              )}

              {/* Additional info — inline text or external link */}
              {(selectedAlert.additionalInfoText || selectedAlert.additionalInfoLink) && (
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                    Additional Info
                  </div>
                  {selectedAlert.additionalInfoText && (
                    <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {selectedAlert.additionalInfoText}
                    </p>
                  )}
                  {selectedAlert.additionalInfoLink && (
                    <a
                      href={selectedAlert.additionalInfoLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-2 text-sm text-purple-300 hover:text-purple-200 underline break-all"
                    >
                      {selectedAlert.additionalInfoLink}
                    </a>
                  )}
                </div>
              )}

              {selectedAlert.attachments && selectedAlert.attachments.length > 0 && (
                <div
                  id={`alert-docs-${selectedAlert.id}`}
                  className="bg-purple-500/[0.04] border border-purple-500/30 rounded-lg p-4 scroll-mt-4"
                >
                  <SamAttachmentLinks
                    attachments={selectedAlert.attachments}
                    onDownloadClick={() => trackAlertEvent('link_click', selectedAlert, 'download_attachment')}
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => saveToPipeline(selectedAlert)}
                  disabled={savingAlertIds.has(selectedAlert.id) || savedAlertIds.has(selectedAlert.id)}
                  className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-center font-medium rounded-lg transition-colors"
                >
                  {savedAlertIds.has(selectedAlert.id)
                    ? 'Saved to Pipeline'
                    : savingAlertIds.has(selectedAlert.id)
                      ? 'Saving...'
                      : canUsePipeline
                        ? 'Save to Pipeline'
                        : needsProfileSetup
                          ? 'Set up to save'
                          : 'Unlock Pipeline'}
                </button>
                <a
                  href={selectedAlert.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackAlertEvent('link_click', selectedAlert, 'open_sam')}
                  className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-center font-medium rounded-lg transition-colors"
                >
                  Open on SAM.gov
                </a>
                <button
                  onClick={() => dismissAlert(selectedAlert)}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => setSelectedAlert(null)}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">Tune Mindy</div>
                <div className="flex flex-wrap gap-2">
                  {FEEDBACK_OPTIONS.map(option => {
                    const selected = feedbackByAlert[selectedAlert.id] === option.type;
                    const saving = savingFeedbackIds.has(selectedAlert.id);
                    return (
                      <button
                        key={option.type}
                        type="button"
                        onClick={() => saveFeedback(selectedAlert, option.type)}
                        disabled={saving}
                        className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                          selected
                            ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                            : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {selected ? '✓ ' : ''}{option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
