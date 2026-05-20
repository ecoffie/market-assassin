'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProfileStatsBar from '@/components/briefings/ProfileStatsBar';
import { formatOpportunityLocation } from '@/lib/mindy/opportunity-location';
import { getBuyerAgencyParts } from '@/lib/mindy/agency-display';
import type { AppPanel, AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';

interface DashboardPanelProps {
  email: string | null;
  tier: AppTier;
  onPanelChange?: (panel: AppPanel) => void;
}

interface BriefingEntry {
  id?: string;
  briefing_date: string;
  briefing_type?: string;
  generated_at: string;
  items_count?: number;
  content?: unknown;
}

interface BriefingItem {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  detailLine?: string;
  category: string;
  buyerName?: string;
  buyerOffice?: string;
  parentAgency?: string;
  amount?: string;
  deadline?: string;
  location?: string;
  actionUrl?: string;
  actionLabel?: string;
  signals: string[];
}

type BriefingFilter = 'all' | 'urgent' | 'opportunity' | 'teaming';
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeLookupKey(value?: string | null) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getLocationFromRecord(item: Record<string, unknown>) {
  const placeOfPerformance = asRecord(item.placeOfPerformance);
  return formatOpportunityLocation({
    location: text(item.location),
    popCity: text(item.popCity, text(item.pop_city, text(placeOfPerformance.city))),
    popState: text(item.popState, text(item.pop_state, text(placeOfPerformance.state))),
    popZip: text(item.popZip, text(item.pop_zip, text(placeOfPerformance.zip))),
    popCountry: text(item.popCountry, text(item.pop_country, text(placeOfPerformance.country))),
  });
}

function getBuyerFromRecord(item: Record<string, unknown>) {
  return getBuyerAgencyParts({
    agency: text(item.buyerName, text(item.agency)),
    department: text(item.parentAgency, text(item.department)),
    subTier: text(item.subTier, text(item.sub_tier, text(item.subAgency))),
    office: text(item.buyerOffice, text(item.office)),
  });
}

function getSolicitationFromSignals(signals: string[]) {
  const signal = signals.find(item => item.toLowerCase().startsWith('sol#'));
  return signal ? signal.replace(/^Sol#\s*/i, '').trim() : '';
}

function getBriefingItemLocation(item: BriefingItem, liveLocations: Record<string, string>) {
  if (item.location) return item.location;

  const solicitation = getSolicitationFromSignals(item.signals);
  const lookupKeys = [
    item.id,
    solicitation,
    normalizeLookupKey(item.title),
  ].filter(Boolean);

  for (const key of lookupKeys) {
    const location = liveLocations[key] || liveLocations[normalizeLookupKey(key)];
    if (location) return location;
  }

  return '';
}

function getBriefingItemBuyer(item: BriefingItem, liveBuyers: Record<string, ReturnType<typeof getBuyerAgencyParts>>) {
  if (item.buyerName) {
    return getBuyerAgencyParts({
      agency: item.buyerName,
      department: item.parentAgency,
      office: item.buyerOffice,
    });
  }

  const solicitation = getSolicitationFromSignals(item.signals);
  const lookupKeys = [
    item.id,
    solicitation,
    normalizeLookupKey(item.title),
  ].filter(Boolean);

  for (const key of lookupKeys) {
    const buyer = liveBuyers[key] || liveBuyers[normalizeLookupKey(key)];
    if (buyer) return buyer;
  }

  return getBuyerAgencyParts({ agency: item.subtitle?.split(' • ')[0] || '' });
}

function getBriefingMetaLine(item: BriefingItem, buyer: ReturnType<typeof getBuyerAgencyParts>) {
  if (!item.subtitle) return '';
  const parts = item.subtitle.split(' • ').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return '';

  const first = normalizeLookupKey(parts[0]);
  const buyerKeys = [
    buyer.primary,
    buyer.secondary,
    buyer.parent,
  ].map(normalizeLookupKey).filter(Boolean);

  if (!buyerKeys.includes(first)) return parts.join(' • ');

  const nonBuyerParts = parts.filter(part => !buyerKeys.includes(normalizeLookupKey(part)));
  return nonBuyerParts.join(' • ');
}

function buildOpportunityNarrative(item: Record<string, unknown>) {
  const quickWinAssessment = text(item.quickWinAssessment, 'Active opportunity matching your profile.');
  const noticeType = text(item.noticeType);
  const agency = text(item.agency);
  const naicsCode = text(item.naicsCode);
  const setAside = text(item.setAside);
  const daysRemaining = numberValue(item.daysRemaining);
  const postedDate = text(item.postedDate);
  const solicitationNumber = text(item.solicitationNumber);

  const detailParts: string[] = [];
  if (naicsCode) detailParts.push(`Industry: NAICS ${naicsCode}`);
  if (setAside) detailParts.push(`Set-Aside: ${setAside}`);
  if (daysRemaining !== null) {
    if (daysRemaining <= 3) {
      detailParts.push(`Only ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining to respond.`);
    } else if (daysRemaining <= 7) {
      detailParts.push(`Response due in ${daysRemaining} days.`);
    }
  }

  const narrativeParts = [
    quickWinAssessment,
    noticeType
      ? `${noticeType} notice from ${agency || 'a federal agency'}`
      : agency
        ? `Opportunity from ${agency}`
        : null,
    naicsCode ? `aligned to NAICS ${naicsCode}` : null,
    setAside ? `with ${setAside} terms` : 'open for review under the current solicitation terms',
    daysRemaining !== null
      ? daysRemaining <= 3
        ? `Response is due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}, so this is an immediate action item.`
        : `Response is due in ${daysRemaining} days, which still leaves time to review scope, teaming, and bid fit.`
      : null,
    postedDate ? `Notice was posted ${postedDate}.` : null,
    solicitationNumber ? `Solicitation reference: ${solicitationNumber}.` : null,
  ].filter(Boolean);

  return {
    description: narrativeParts.join(' '),
    detailLine: detailParts.length > 0
      ? detailParts.join(' • ')
      : 'Active opportunity matching your profile. Click to view full details on SAM.gov.',
    quickWinAssessment,
  };
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatDateLong(dateStr?: string) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatBriefingType(type?: string) {
  if (type === 'pursuit') return 'Pursuit';
  if (type === 'weekly') return 'Weekly';
  if (type === 'daily') return 'Daily';
  return type || 'Daily';
}

function getBriefingKey(entry: BriefingEntry) {
  return entry.id || `${entry.briefing_date}:${entry.briefing_type || 'briefing'}:${entry.generated_at}`;
}

function collectGeneratedItems(content: Record<string, unknown>): BriefingItem[] {
  const sections = [
    ...asArray(content.topItems),
    ...Object.values(asRecord(content.categorizedItems)),
  ];

  return sections.flatMap(section => {
    const sectionRecord = asRecord(section);
    return asArray(sectionRecord.items).map((raw, index) => {
      const item = asRecord(raw);
      const buyer = getBuyerFromRecord(item);
      return {
        id: text(item.id, `${text(sectionRecord.title, 'section')}-${index}`),
        title: text(item.title, 'Untitled opportunity'),
        subtitle: text(item.subtitle),
        description: text(item.description, text(item.detailLine, text(item.amount))),
        detailLine: text(item.detailLine),
        category: text(item.category, text(sectionRecord.title, 'Opportunity')),
        buyerName: buyer.primary,
        buyerOffice: buyer.secondary,
        parentAgency: buyer.parent,
        amount: text(item.amount),
        deadline: text(item.deadline),
        location: getLocationFromRecord(item),
        actionUrl: text(item.actionUrl),
        actionLabel: text(item.actionLabel, 'View details'),
        signals: asArray(item.signals).map(signal => text(signal)).filter(Boolean),
      };
    });
  });
}

function collectGreenItems(content: Record<string, unknown>): BriefingItem[] {
  const opportunities = asArray(content.opportunities).map((raw, index) => {
    const item = asRecord(raw);
    const narrative = buildOpportunityNarrative(item);
    const buyer = getBuyerFromRecord(item);
    return {
      id: `opp-${text(item.solicitationNumber, String(index))}`,
      title: text(item.title, 'Untitled opportunity'),
      subtitle: buyer.full,
      description: narrative.description,
      detailLine: narrative.detailLine,
      category: 'Opportunity',
      buyerName: buyer.primary,
      buyerOffice: buyer.secondary,
      parentAgency: buyer.parent,
      amount: narrative.quickWinAssessment,
      deadline: text(item.responseDeadline),
      location: getLocationFromRecord(item),
      actionUrl: text(item.samLink),
      actionLabel: 'View on SAM.gov',
      signals: [
        text(item.noticeType),
        text(item.setAside),
        text(item.naicsCode) ? `NAICS ${text(item.naicsCode)}` : '',
        text(item.solicitationNumber) ? `Sol# ${text(item.solicitationNumber)}` : '',
        text(item.postedDate) ? `Posted ${text(item.postedDate)}` : '',
        text(item.daysRemaining) ? `${text(item.daysRemaining)} days left` : '',
      ].filter(Boolean),
    };
  });

  const deadlines = asArray(content.deadlinesThisWeek).map((raw, index) => {
    const item = asRecord(raw);
    const daysRemaining = numberValue(item.daysRemaining);
    const buyer = getBuyerFromRecord(item);
    return {
      id: `deadline-${text(item.noticeId, String(index))}`,
      title: text(item.title, text(item.fullTitle, 'Upcoming deadline')),
      subtitle: buyer.full,
      description: [
        buyer.full,
        text(item.noticeType),
        text(item.setAside),
        getLocationFromRecord(item) ? `Place of performance: ${getLocationFromRecord(item)}` : '',
        daysRemaining !== null
          ? `Response due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`
          : 'Upcoming response deadline.',
      ].filter(Boolean).join(' • '),
      category: 'Urgent',
      buyerName: buyer.primary,
      buyerOffice: buyer.secondary,
      parentAgency: buyer.parent,
      amount: daysRemaining !== null
        ? `Due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`
        : 'Upcoming deadline',
      deadline: text(item.deadline),
      location: getLocationFromRecord(item),
      actionUrl: text(item.samLink),
      actionLabel: 'View on SAM.gov',
      signals: [text(item.noticeType), text(item.daysRemaining) ? `${text(item.daysRemaining)} days left` : 'Urgent'].filter(Boolean),
    };
  });

  return [...opportunities, ...deadlines];
}

function collectLegacyItems(content: Record<string, unknown>): BriefingItem[] {
  const opportunities = asArray(content.opportunities).map((raw, index) => {
    const item = asRecord(raw);
    const buyer = getBuyerFromRecord(item);
    return {
      id: `legacy-${index}`,
      title: text(item.contractName, text(item.title, 'Briefing item')),
      subtitle: [buyer.full, text(item.incumbent) ? `Incumbent: ${text(item.incumbent)}` : ''].filter(Boolean).join(' • '),
      description: text(item.displacementAngle, text(item.quickWinAssessment, 'Market intelligence item from your briefing.')),
      category: 'Opportunity',
      buyerName: buyer.primary,
      buyerOffice: buyer.secondary,
      parentAgency: buyer.parent,
      amount: text(item.value),
      deadline: text(item.window),
      location: getLocationFromRecord(item),
      actionUrl: text(item.samLink),
      actionLabel: text(item.samLink) ? 'View on SAM.gov' : 'View details',
      signals: [text(item.noticeType), text(item.setAside)].filter(Boolean),
    };
  });

  const teaming = asArray(content.teamingPlays).map((raw, index) => {
    const item = asRecord(raw);
    return {
      id: `teaming-${index}`,
      title: text(item.strategyName, 'Teaming play'),
      subtitle: asArray(item.targetPrimes).map(prime => text(prime)).filter(Boolean).join(' • '),
      description: text(item.rationale, text(item.suggestedOpener, 'Recommended teaming action.')),
      category: 'Teaming',
      signals: ['Teaming'],
    };
  });

  return [...opportunities, ...teaming];
}

function getBriefingItems(entry: BriefingEntry | null): BriefingItem[] {
  if (!entry?.content) return [];
  const content = asRecord(entry.content);
  const generatedItems = collectGeneratedItems(content);
  if (generatedItems.length > 0) return generatedItems;

  const greenItems = collectGreenItems(content);
  if (greenItems.length > 0) return greenItems;

  return collectLegacyItems(content);
}

function getBriefingSummary(entry: BriefingEntry | null) {
  const content = asRecord(entry?.content);
  const summary = asRecord(content.summary);
  const noticeSummary = asRecord(content.noticeSummary);
  return {
    headline: text(summary.headline, text(content.headline, `${getBriefingItems(entry).length} opportunities identified`)),
    subheadline: text(summary.subheadline, text(content.summary, 'Profile-matched market intelligence from your briefing feed.')),
    totalMatched: text(noticeSummary.totalMatched, text(summary.totalMatched)),
    urgentAlerts: Number(text(summary.urgentAlerts, '0')) || getBriefingItems(entry).filter(item => item.category.toLowerCase().includes('urgent')).length,
  };
}

export default function DashboardPanel({ email, tier }: DashboardPanelProps) {
  const router = useRouter();
  const marketIntelHref = email
    ? `/app/market-intel?email=${encodeURIComponent(email)}`
    : '/app/market-intel';
  const [briefings, setBriefings] = useState<BriefingEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<BriefingFilter>('all');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingPipeline, setSavingPipeline] = useState<Set<string>>(new Set());
  const [pipelineSaved, setPipelineSaved] = useState<Set<string>>(new Set());
  const [feedbackByItem, setFeedbackByItem] = useState<Record<string, FeedbackType>>({});
  const [savingFeedback, setSavingFeedback] = useState<Set<string>>(new Set());
  const [dismissedItems, setDismissedItems] = useState<Set<string>>(new Set());
  const [liveLocations, setLiveLocations] = useState<Record<string, string>>({});
  const [liveBuyers, setLiveBuyers] = useState<Record<string, ReturnType<typeof getBuyerAgencyParts>>>({});

  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  const trackItemEvent = useCallback((eventType: 'link_click' | 'tool_use', item: BriefingItem, action: string) => {
    if (!email) return;

    fetch('/api/mindy/engagement', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        email,
        eventType,
        eventSource: 'todays_intel',
        metadata: {
          action,
          opportunity_id: item.id,
          title: item.title,
          agency: item.buyerName || item.subtitle?.split(' • ')[0] || '',
        },
      }),
      keepalive: true,
    }).catch(() => {});
  }, [email, getAuthHeaders]);

  const loadBriefings = useCallback(async () => {
    if (!email) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/briefings/latest?email=${encodeURIComponent(email)}&days=30`);
      const data = await res.json();

      if (!data.success) {
        setBriefings([]);
        setError(data.message || data.error || 'No briefings available yet.');
        return;
      }

      const entries: BriefingEntry[] = data.briefings || (data.briefing ? [{
        id: data.id,
        briefing_date: data.briefing_date,
        briefing_type: data.briefing_type,
        generated_at: data.generated_at,
        items_count: data.briefing?.totalItems || data.briefing?.opportunities?.length || 0,
        content: data.briefing,
      }] : []);

      setBriefings(entries);
      setSelectedKey(current => current && entries.some(entry => getBriefingKey(entry) === current)
        ? current
        : entries[0] ? getBriefingKey(entries[0]) : null);
      setExpandedItems(new Set());
    } catch (err) {
      console.error('Failed to load beta briefings:', err);
      setError('Failed to load briefings.');
    } finally {
      setIsLoading(false);
    }
  }, [email]);

  useEffect(() => {
    if (email && tier !== 'free') {
      void loadBriefings();
    } else {
      setIsLoading(false);
    }
  }, [email, tier, loadBriefings]);

  useEffect(() => {
    if (!email || tier === 'free') return;

    let cancelled = false;
    const userEmail = email;

    async function loadLiveLocations() {
      try {
        const params = new URLSearchParams({ email: userEmail, limit: '100' });
        const res = await fetch(`/api/app/opportunities?${params.toString()}`, {
          headers: getAuthHeaders(),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || cancelled) return;

        const next: Record<string, string> = {};
        const nextBuyers: Record<string, ReturnType<typeof getBuyerAgencyParts>> = {};
        for (const raw of asArray(data.opportunities)) {
          const opportunity = asRecord(raw);
          const location = formatOpportunityLocation({
            popCity: text(opportunity.popCity),
            popState: text(opportunity.popState),
            popZip: text(opportunity.popZip),
            popCountry: text(opportunity.popCountry),
          });
          const buyer = getBuyerAgencyParts({
            agency: text(opportunity.buyerName),
            department: text(opportunity.parentAgency, text(opportunity.department)),
            subTier: text(opportunity.subTier),
            office: text(opportunity.buyerOffice, text(opportunity.office)),
          });

          [
            text(opportunity.id),
            text(opportunity.solicitationNumber),
            normalizeLookupKey(text(opportunity.title)),
          ].filter(Boolean).forEach(key => {
            if (location) next[key] = location;
            if (buyer.primary && buyer.primary !== 'Unknown agency') nextBuyers[key] = buyer;
          });
        }

        setLiveLocations(next);
        setLiveBuyers(nextBuyers);
      } catch (err) {
        console.warn('Failed to load live opportunity locations:', err);
      }
    }

    void loadLiveLocations();

    return () => {
      cancelled = true;
    };
  }, [email, getAuthHeaders, tier]);

  const selectedBriefing = useMemo(() => (
    briefings.find(entry => getBriefingKey(entry) === selectedKey) || briefings[0] || null
  ), [briefings, selectedKey]);

  const briefingItems = useMemo(() => getBriefingItems(selectedBriefing), [selectedBriefing]);
  const summary = useMemo(() => getBriefingSummary(selectedBriefing), [selectedBriefing]);

  const filteredItems = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    return briefingItems.filter(item => {
      if (dismissedItems.has(item.id)) return false;
      const matchesSearch = !query || [
        item.title,
        item.subtitle,
        getBriefingItemBuyer(item, liveBuyers).full,
        item.description,
        item.category,
        item.location,
        getBriefingItemLocation(item, liveLocations),
        ...item.signals,
      ].join(' ').toLowerCase().includes(query);

      const category = item.category.toLowerCase();
      const signals = item.signals.join(' ').toLowerCase();
      const matchesFilter = activeFilter === 'all'
        || (activeFilter === 'urgent' && (category.includes('urgent') || signals.includes('urgent') || signals.includes('days left')))
        || (activeFilter === 'opportunity' && category.includes('opportunity'))
        || (activeFilter === 'teaming' && (category.includes('teaming') || signals.includes('teaming')));

      return matchesSearch && matchesFilter;
    });
  }, [activeFilter, briefingItems, dismissedItems, liveBuyers, liveLocations, searchTerm]);

  const counts = useMemo(() => ({
    all: briefingItems.length,
    urgent: briefingItems.filter(item => item.category.toLowerCase().includes('urgent') || item.signals.join(' ').toLowerCase().includes('days left')).length,
    opportunity: briefingItems.filter(item => item.category.toLowerCase().includes('opportunity')).length,
    teaming: briefingItems.filter(item => item.category.toLowerCase().includes('teaming') || item.signals.join(' ').toLowerCase().includes('teaming')).length,
  }), [briefingItems]);

  const toggleItem = useCallback((itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const handleTrackInPipeline = useCallback(async (item: BriefingItem) => {
    if (!email) return;

    setSavingPipeline(prev => new Set(prev).add(item.id));

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: email,
          notice_id: item.id,
          title: item.title,
          agency: item.buyerName || item.subtitle?.split(' • ')[0] || '',
          naics_code: item.signals.find(s => s.startsWith('NAICS'))?.replace('NAICS ', '') || '',
          set_aside: item.signals.find(s => ['8(a)', 'WOSB', 'SDVOSB', 'HUBZone', 'SBA', 'Small Business'].some(sa => s.includes(sa))) || '',
          response_deadline: item.deadline || null,
          estimated_value: item.amount || null,
          sam_link: item.actionUrl || '',
          stage: 'tracking',
          priority: 'medium',
          source: 'briefing',
        }),
      });

      if (res.ok) {
        setPipelineSaved(prev => new Set(prev).add(item.id));
        trackItemEvent('tool_use', item, 'track_in_pipeline');
      }
    } catch (err) {
      console.error('Failed to add to pipeline:', err);
    } finally {
      setSavingPipeline(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, [email, trackItemEvent]);

  const handleOpportunityFeedback = useCallback(async (item: BriefingItem, feedbackType: FeedbackType) => {
    if (!email) return;

    setSavingFeedback(prev => new Set(prev).add(item.id));

    try {
      const res = await fetch('/api/mindy/opportunity-feedback', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          email,
          opportunityId: item.id,
          feedbackType,
          title: item.title,
          agency: item.buyerName || item.subtitle?.split(' • ')[0] || '',
          url: item.actionUrl || '',
          source: 'todays_intel',
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        setFeedbackByItem(prev => ({ ...prev, [item.id]: feedbackType }));
      }
    } catch (err) {
      console.error('Failed to save opportunity feedback:', err);
    } finally {
      setSavingFeedback(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, [email, getAuthHeaders]);

  const dismissItem = useCallback((item: BriefingItem) => {
    setDismissedItems(prev => new Set(prev).add(item.id));
    trackItemEvent('tool_use', item, 'dismiss');
  }, [trackItemEvent]);

  if (tier === 'free') {
    return (
      <div className="p-6">
        <div className="border border-purple-500/30 bg-purple-950/20 p-8 text-center">
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-2xl font-bold text-white mb-3">Today&apos;s Intel</h2>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            Upgrade to unlock AI-prioritized opportunities, weekly deep dives, pursuit briefs, and full intelligence.
          </p>
          <a
            href="/market-intelligence"
            className="inline-block px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors"
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    );
  }

  if (!email) return null;

  return (
    <div className="min-h-[calc(100vh-73px)] text-white">
      <ProfileStatsBar
        email={email}
        onOpenOpportunities={() => router.push(marketIntelHref)}
      />

      <div className="px-6 py-5 border-b border-slate-800 bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Today&apos;s Intel</h1>
            <p className="text-sm text-slate-400 mt-1">Best-fit opportunities, summaries, and next actions from your saved profile.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={marketIntelHref}
              className="px-4 py-2 bg-purple-600/20 text-purple-200 border border-purple-500/30 rounded-lg hover:bg-purple-600/30 transition-colors"
            >
              Open SAM Dashboard
            </Link>
            <button
              onClick={loadBriefings}
              className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8">
          <div className="animate-pulse grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
            <div className="h-96 bg-slate-900 border border-slate-800" />
            <div className="space-y-4">
              <div className="h-10 bg-slate-900 border border-slate-800" />
              <div className="h-48 bg-slate-900 border border-slate-800" />
              <div className="h-48 bg-slate-900 border border-slate-800" />
            </div>
          </div>
        </div>
      ) : briefings.length === 0 ? (
        <div className="p-8">
          <div className="border border-slate-800 bg-slate-900 p-8 text-center">
            <h2 className="text-xl font-semibold mb-2">No briefings yet</h2>
            <p className="text-slate-400">{error || 'Your first briefing will appear after the next delivery.'}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr]">
          <aside className="border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-950/80 lg:min-h-[calc(100vh-202px)]">
            <div className="p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Past Briefings</p>
              <div className="flex lg:block gap-2 overflow-x-auto">
                {briefings.map(entry => {
                  const key = getBriefingKey(entry);
                  const isSelected = key === getBriefingKey(selectedBriefing || entry);
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setSelectedKey(key);
                        setExpandedItems(new Set());
                      }}
                      className={`w-full min-w-48 lg:min-w-0 text-left px-3 py-2.5 mb-1 rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-purple-500/15 text-purple-300'
                          : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                      }`}
                    >
                      <span className="font-medium text-sm">{formatDate(entry.briefing_date)}</span>
                      <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-70">
                        {formatBriefingType(entry.briefing_type)}
                      </span>
                      <span className="float-right text-xs opacity-60">{entry.items_count || getBriefingItems(entry).length} items</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          <main className="p-4 lg:p-8 max-w-6xl">
            <div className="mb-5">
              <p className="text-slate-500 text-sm">
                {formatDateLong(selectedBriefing?.briefing_date)}
                <span className="ml-2 rounded bg-purple-500/15 px-2 py-0.5 text-xs uppercase tracking-wide text-purple-300">
                  {formatBriefingType(selectedBriefing?.briefing_type)}
                </span>
              </p>
              <h2 className="text-3xl font-bold mt-4">{summary.headline}</h2>
              <p className="text-slate-400 mt-2">{summary.subheadline}</p>
            </div>

            <div className="mb-6 space-y-3">
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search opportunities, agencies, keywords..."
                className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <FilterButton label="All" count={counts.all} active={activeFilter === 'all'} onClick={() => setActiveFilter('all')} />
                  <FilterButton label="Urgent" count={counts.urgent} active={activeFilter === 'urgent'} onClick={() => setActiveFilter('urgent')} />
                  <FilterButton label="Opportunities" count={counts.opportunity} active={activeFilter === 'opportunity'} onClick={() => setActiveFilter('opportunity')} />
                  <FilterButton label="Teaming" count={counts.teaming} active={activeFilter === 'teaming'} onClick={() => setActiveFilter('teaming')} />
                </div>
                <div className="text-sm text-slate-500">{filteredItems.length} shown</div>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
              <SummaryStat label="Opportunities" value={counts.opportunity} />
              <SummaryStat label="Urgent Alerts" value={summary.urgentAlerts} urgent />
              <SummaryStat label="Total Matched" value={summary.totalMatched || counts.all} />
              <SummaryStat label="Briefings" value={briefings.length} />
            </div>

            <section>
              <h3 className="text-xl font-semibold mb-4">Top Opportunities to Review</h3>
              <div className="space-y-3">
                {filteredItems.map(item => {
                  const isExpanded = expandedItems.has(item.id);
                  const itemLocation = getBriefingItemLocation(item, liveLocations);
                  const itemBuyer = getBriefingItemBuyer(item, liveBuyers);
                  const itemMetaLine = getBriefingMetaLine(item, itemBuyer);

                  return (
                    <article
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={() => toggleItem(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleItem(item.id);
                        }
                      }}
                      className="cursor-pointer overflow-hidden border-l-4 border-purple-500 bg-slate-900 border-y border-r border-slate-800 p-4 transition-colors hover:border-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-semibold text-white">{item.title}</h4>
                          {itemBuyer.primary && itemBuyer.primary !== 'Unknown agency' && (
                            <p className="text-sm text-slate-400 mt-1">
                              {itemBuyer.primary}
                              {itemBuyer.secondary && <span className="text-slate-500"> • {itemBuyer.secondary}</span>}
                              {itemBuyer.parent && <span className="text-slate-600"> • {itemBuyer.parent}</span>}
                            </p>
                          )}
                          {itemMetaLine && <p className="text-sm text-slate-500 mt-1">{itemMetaLine}</p>}
                          {itemLocation && (
                            <p className="mt-2 inline-flex items-center rounded bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300">
                              📍 Place of performance: {itemLocation}
                            </p>
                          )}
                          {item.detailLine && <p className="text-sm text-slate-400 mt-2">{item.detailLine}</p>}
                        </div>
                        <div className="max-w-md text-right">
                          {item.amount && <p className="text-sm font-semibold text-emerald-400">{item.amount}</p>}
                          {item.deadline && <p className="text-sm text-slate-500 mt-1">{item.deadline}</p>}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleItem(item.id);
                            }}
                            className="mt-3 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                          >
                            {isExpanded ? 'Hide Fit' : 'Review Fit'}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              dismissItem(item);
                            }}
                            className="ml-2 mt-3 rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>

                      <div className={`transition-all duration-200 overflow-hidden ${
                        isExpanded ? 'max-h-96 opacity-100 mt-4' : 'max-h-0 opacity-0'
                      }`}>
                        {item.description && <p className="text-sm leading-relaxed text-slate-300">{item.description}</p>}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{item.category}</span>
                          {itemBuyer.primary && itemBuyer.primary !== 'Unknown agency' && (
                            <span className="rounded bg-slate-800/80 px-2 py-1 text-xs text-slate-300">
                              Buyer: {itemBuyer.primary}
                            </span>
                          )}
                          {itemLocation && (
                            <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">📍 {itemLocation}</span>
                          )}
                          {item.signals.slice(0, 4).map(signal => (
                            <span key={signal} className="rounded bg-slate-800/80 px-2 py-1 text-xs text-slate-400">{signal}</span>
                          ))}
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-4">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleTrackInPipeline(item);
                            }}
                            disabled={savingPipeline.has(item.id) || pipelineSaved.has(item.id)}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                              pipelineSaved.has(item.id)
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-default'
                                : savingPipeline.has(item.id)
                                  ? 'bg-slate-800 text-slate-400 cursor-wait'
                                  : 'bg-purple-600 text-white hover:bg-purple-500'
                            }`}
                          >
                            {pipelineSaved.has(item.id) ? '✓ Tracking' : savingPipeline.has(item.id) ? 'Adding...' : '📈 Track in Pipeline'}
                          </button>
                          {item.actionUrl && (
                            <a
                              href={item.actionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => {
                                event.stopPropagation();
                                trackItemEvent('link_click', item, 'open_source');
                              }}
                              className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                            >
                              {item.actionLabel || 'View on SAM.gov'} →
                            </a>
                          )}
                        </div>
                        <div className="mt-4 border-t border-slate-800 pt-4">
                          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Tune Mindy</p>
                          <div className="flex flex-wrap gap-2">
                            {FEEDBACK_OPTIONS.map(option => {
                              const selected = feedbackByItem[item.id] === option.type;
                              const saving = savingFeedback.has(item.id);
                              return (
                                <button
                                  key={option.type}
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleOpportunityFeedback(item, option.type);
                                  }}
                                  disabled={saving}
                                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                    selected
                                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                                      : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                                  }`}
                                >
                                  {selected ? '✓ ' : ''}{option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}

                {filteredItems.length === 0 && (
                  <div className="border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
                    No briefing items match this filter.
                  </div>
                )}
              </div>
            </section>
          </main>
        </div>
      )}
    </div>
  );
}

function FilterButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
          : 'bg-slate-900 text-slate-400 border border-slate-800 hover:border-slate-700'
      }`}
    >
      {label} <span className="ml-1 opacity-60">{count}</span>
    </button>
  );
}

function SummaryStat({ label, value, urgent = false }: { label: string; value: string | number; urgent?: boolean }) {
  return (
    <div className={`border p-5 text-center ${urgent ? 'bg-red-950/30 border-red-500/30' : 'bg-slate-900 border-slate-800'}`}>
      <div className={urgent ? 'text-2xl font-bold text-red-300' : 'text-2xl font-bold text-purple-300'}>{value}</div>
      <div className={urgent ? 'text-xs uppercase tracking-wider text-red-300 mt-2' : 'text-xs uppercase tracking-wider text-slate-500 mt-2'}>{label}</div>
    </div>
  );
}
