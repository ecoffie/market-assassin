'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProfileStatsBar from '@/components/briefings/ProfileStatsBar';
import { formatOpportunityLocation } from '@/lib/mindy/opportunity-location';
import { getBuyerAgencyParts } from '@/lib/mindy/agency-display';
import type { AppPanel, AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import IncumbentIntel from '../awards/IncumbentIntel';
import { useToast } from '../Toast';
import ContractorLink from '../contractors/ContractorLink';
import { MindyInsightCard } from '../MindyInsightCard';
import { getNaics } from '@/lib/codes/lookup';
import ShareButton from '@/components/briefings/ShareButton';

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
  // Contractor / prime names. When present, rendered as clickable
  // ContractorLink to open the YoY award-history drawer. Separate
  // from `subtitle` so the wrapper can target just the name.
  incumbent?: string;
  targetPrimes?: string[];
  // SAM attachment file links (resourceLinks). Rendered in the expanded
  // card, same as the Market Dashboard. Only present for items sourced
  // from the live opportunities feed.
  attachments?: unknown[];
  // SAM notice type ("Solicitation", "Sources Sought", "Combined
  // Synopsis/Solicitation", "Presolicitation", etc.) — rendered as a
  // color-coded badge on the card.
  noticeType?: string;
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

function getBriefingLookupKeys(item: BriefingItem): string[] {
  const renderId = item.id || '';
  const localId = renderId.includes('::') ? renderId.split('::').pop() || renderId : renderId;
  const normalizedTitle = normalizeLookupKey(item.title);
  const keys = [
    renderId,
    localId,
    localId.replace(/^(opp|deadline)-/i, ''),
    getSolicitationFromSignals(item.signals),
    normalizedTitle,
  ].filter(Boolean);

  return [...new Set(keys.flatMap(key => [key, normalizeLookupKey(key)]).filter(Boolean))];
}

// A STABLE identifier for an opportunity, used to dedup pipeline saves.
// The render id (item.id) is a synthetic per-list index (`legacy-N`,
// `opp-N`) that differs between briefings for the SAME opportunity — so
// using it as notice_id let the same opp be added repeatedly. Prefer the
// solicitation number (real, stable across briefings); fall back to a
// normalized title so at least same-title items collapse.
// Color-coded badge style per SAM notice type. Mirrors the canonical
// scheme (RFP/Solicitation=green, RFQ=blue, Sources Sought=purple,
// Pre-Sol=orange, Combined=teal). Unknown types get a neutral slate.
function noticeTypeBadge(noticeType?: string): { label: string; cls: string } | null {
  if (!noticeType) return null;
  const t = noticeType.toLowerCase();
  if (t.includes('sources sought')) return { label: 'Sources Sought', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30' };
  if (t.includes('combined')) return { label: 'Combined', cls: 'bg-teal-500/15 text-teal-300 border-teal-500/30' };
  if (t.includes('presol') || t.includes('pre-sol') || t.includes('pre sol')) return { label: 'Pre-Solicitation', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' };
  if (t.includes('rfq') || t.includes('quot')) return { label: 'RFQ', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' };
  if (t.includes('rfi') || t.includes('information')) return { label: 'RFI', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' };
  if (t.includes('award')) return { label: 'Award', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
  if (t.includes('special')) return { label: 'Special Notice', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
  if (t.includes('solicitation') || t.includes('rfp')) return { label: 'Solicitation', cls: 'bg-green-500/15 text-green-300 border-green-500/30' };
  // Fall back to the raw type, trimmed.
  return { label: noticeType.length > 24 ? noticeType.slice(0, 24) + '…' : noticeType, cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' };
}

function getStableNoticeId(item: BriefingItem): string {
  const sol = getSolicitationFromSignals(item.signals);
  if (sol) return sol;
  const title = normalizeLookupKey(item.title);
  return title ? `title:${title}` : item.id;
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

// Resolve a value (NAICS / set-aside) for a briefing item from a live SAM
// lookup map, keyed by id / solicitation# / normalized title — same scheme as
// getBriefingItemLocation. Used to backfill the Industry/Set-Aside detail line
// on items stored without those fields.
function resolveFromLive(item: BriefingItem, map: Record<string, string>): string {
  for (const key of getBriefingLookupKeys(item)) {
    const v = map[key];
    if (v) return v;
  }
  return '';
}

function getBriefingItemNoticeType(item: BriefingItem, liveNoticeTypes: Record<string, string>) {
  return item.noticeType || resolveFromLive(item, liveNoticeTypes);
}

function getBriefingItemDescription(item: BriefingItem, liveDescriptions: Record<string, string>) {
  const existing = (item.description || '').trim();
  const isGeneric = !existing
    || /^upcoming response deadline\.?$/i.test(existing)
    || /^market intelligence item from your briefing\.?$/i.test(existing);
  if (!isGeneric) return existing;

  const liveDescription = resolveFromLive(item, liveDescriptions);
  if (!liveDescription) return existing;
  return liveDescription.length > 700 ? `${liveDescription.slice(0, 700).trim()}...` : liveDescription;
}

// Build the Industry/Set-Aside detail line, falling back to live SAM data when
// the briefing item lacks it. Returns '' if nothing is available so the caller
// can hide the line rather than show a generic placeholder.
function buildItemDetailLine(
  item: BriefingItem,
  liveNaics: Record<string, string>,
  liveSetAside: Record<string, string>,
): string {
  // If the item already has a real (non-placeholder) detail line, keep it.
  const existing = (item.detailLine || '').trim();
  const isPlaceholder = /click to view full details/i.test(existing) || /active opportunity matching your profile\.?$/i.test(existing);
  if (existing && !isPlaceholder) return existing;

  const naics = resolveFromLive(item, liveNaics);
  const setAside = resolveFromLive(item, liveSetAside);
  const parts: string[] = [];
  if (naics) {
    const title = getNaics(naics)?.title;
    parts.push(`Industry: NAICS ${naics}${title ? ` (${title})` : ''}`);
  }
  if (setAside) parts.push(`Set-Aside: ${setAside}`);
  if (parts.length > 0) return parts.join(' • ');
  return existing; // keep placeholder only if we found nothing better
}

// Look up the SAM attachment list for an item — first from the item
// itself, then matched against the live opportunities feed by id /
// solicitation / title (same keying as locations/buyers).
function getBriefingItemAttachments(item: BriefingItem, liveAttachments: Record<string, unknown[]>): unknown[] {
  if (Array.isArray(item.attachments) && item.attachments.length > 0) return item.attachments;

  for (const key of getBriefingLookupKeys(item)) {
    const att = liveAttachments[key];
    if (att && att.length > 0) return att;
  }
  return [];
}

function getBriefingItemBuyer(item: BriefingItem, liveBuyers: Record<string, ReturnType<typeof getBuyerAgencyParts>>) {
  if (item.buyerName) {
    return getBuyerAgencyParts({
      agency: item.buyerName,
      department: item.parentAgency,
      office: item.buyerOffice,
    });
  }

  for (const key of getBriefingLookupKeys(item)) {
    const buyer = liveBuyers[key];
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
  if (naicsCode) {
    const naicsTitle = getNaics(naicsCode)?.title;
    detailParts.push(`Industry: NAICS ${naicsCode}${naicsTitle ? ` (${naicsTitle})` : ''}`);
  }
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
    naicsCode ? (() => {
      const naicsTitle = getNaics(naicsCode)?.title;
      return naicsTitle ? `aligned to NAICS ${naicsCode} (${naicsTitle})` : `aligned to NAICS ${naicsCode}`;
    })() : null,
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

// Normalize a deadline value to the "Jun 10, 2026 4:00 PM ET" display style.
// Briefing items are inconsistent: some already carry a human-formatted string,
// others a raw ISO timestamp (2026-06-05T21:00:00+00:00). Detect the raw ISO
// form and format it; pass already-formatted strings through unchanged.
function formatDeadline(value?: string): string {
  const v = (value || '').trim();
  if (!v) return '';
  // Raw ISO timestamp? (starts YYYY-MM-DD, has a T or +offset)
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
      return `${date} ${time} ET`;
    }
  }
  return v; // already human-formatted
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
      const noticeType = text(item.noticeType, text(item.notice_type));
      const signals = asArray(item.signals).map(signal => text(signal)).filter(Boolean);
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
        deadline: formatDeadline(text(item.deadline)),
        location: getLocationFromRecord(item),
        actionUrl: text(item.actionUrl),
        actionLabel: text(item.actionLabel, 'View details'),
        noticeType: noticeType || undefined,
        signals: signals.length > 0 ? signals : [noticeType].filter(Boolean),
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
      deadline: formatDeadline(text(item.responseDeadline)),
      location: getLocationFromRecord(item),
      actionUrl: text(item.samLink),
      actionLabel: 'View on SAM.gov',
      noticeType: text(item.noticeType) || undefined,
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
    const naicsCode = text(item.naicsCode);
    const setAside = text(item.setAside);
    const noticeType = text(item.noticeType);
    const solicitationNumber = text(item.solicitationNumber, text(item.noticeId));
    const detailParts: string[] = [];
    if (naicsCode) {
      const title = getNaics(naicsCode)?.title;
      detailParts.push(`Industry: NAICS ${naicsCode}${title ? ` (${title})` : ''}`);
    }
    if (setAside) detailParts.push(`Set-Aside: ${setAside}`);
    if (daysRemaining !== null) {
      detailParts.push(`Response due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`);
    }

    return {
      id: `deadline-${text(item.noticeId, String(index))}`,
      title: text(item.title, text(item.fullTitle, 'Upcoming deadline')),
      subtitle: buyer.full,
      description: [
        buyer.full,
        noticeType,
        setAside,
        getLocationFromRecord(item) ? `Place of performance: ${getLocationFromRecord(item)}` : '',
        daysRemaining !== null
          ? `Response due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`
          : 'Upcoming response deadline.',
      ].filter(Boolean).join(' • '),
      detailLine: detailParts.join(' • '),
      category: 'Urgent',
      buyerName: buyer.primary,
      buyerOffice: buyer.secondary,
      parentAgency: buyer.parent,
      amount: daysRemaining !== null
        ? `Due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`
        : 'Upcoming deadline',
      deadline: formatDeadline(text(item.deadline)),
      location: getLocationFromRecord(item),
      actionUrl: text(item.samLink),
      actionLabel: 'View on SAM.gov',
      noticeType: noticeType || undefined,
      signals: [
        noticeType,
        setAside,
        naicsCode ? `NAICS ${naicsCode}` : '',
        solicitationNumber ? `Sol# ${solicitationNumber}` : '',
        text(item.daysRemaining) ? `${text(item.daysRemaining)} days left` : 'Urgent',
      ].filter(Boolean),
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
      deadline: formatDeadline(text(item.window)),
      location: getLocationFromRecord(item),
      actionUrl: text(item.samLink),
      actionLabel: text(item.samLink) ? 'View on SAM.gov' : 'View details',
      noticeType: text(item.noticeType) || undefined,
      signals: [text(item.noticeType), text(item.setAside)].filter(Boolean),
      // Surface incumbent as a structured field too so the renderer
      // can wrap it with ContractorLink. The subtitle still includes
      // it as a fallback for non-Pro rendering paths.
      incumbent: text(item.incumbent) || undefined,
    };
  });

  const teaming = asArray(content.teamingPlays).map((raw, index) => {
    const item = asRecord(raw);
    const primes = asArray(item.targetPrimes).map(prime => text(prime)).filter(Boolean);
    return {
      id: `teaming-${index}`,
      title: text(item.strategyName, 'Teaming play'),
      subtitle: primes.join(' • '),
      description: text(item.rationale, text(item.suggestedOpener, 'Recommended teaming action.')),
      category: 'Teaming',
      signals: ['Teaming'],
      // Each prime in this teaming play is a candidate contractor.
      // The renderer iterates over targetPrimes to make each one
      // individually clickable.
      targetPrimes: primes,
    };
  });

  return [...opportunities, ...teaming];
}

function getBriefingItems(entry: BriefingEntry | null): BriefingItem[] {
  if (!entry?.content) return [];
  const content = asRecord(entry.content);

  let items: BriefingItem[];
  const generatedItems = collectGeneratedItems(content);
  if (generatedItems.length > 0) {
    items = generatedItems;
  } else {
    const greenItems = collectGreenItems(content);
    items = greenItems.length > 0 ? greenItems : collectLegacyItems(content);
  }

  // Namespace each item id with the briefing key. The collectors
  // generate ids like `legacy-0` / `opp-{sol}` that REPEAT across
  // briefings for the same opportunity — so dismissing an item in one
  // briefing wrongly hid the same-id item in every other briefing, and
  // toggling between briefings looked like "nothing changed". A
  // per-briefing prefix isolates dismissal + gives React stable,
  // distinct keys per briefing.
  const prefix = getBriefingKey(entry);
  return items.map((it) => ({ ...it, id: `${prefix}::${it.id}` }));
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
  // The stat cards / filter chips DO filter the list, but the list lives below
  // the fold — so a click looked like nothing happened (Eric 2026-06-05).
  // filterTo() sets the filter AND scrolls the results into view.
  const resultsRef = useRef<HTMLElement>(null);
  const filterTo = useCallback((f: BriefingFilter) => {
    setActiveFilter(prev => (prev === f && f !== 'all' ? 'all' : f));
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingPipeline, setSavingPipeline] = useState<Set<string>>(new Set());
  const [pipelineSaved, setPipelineSaved] = useState<Set<string>>(new Set());
  // Collapse the Past Briefings rail to give the briefing content full width.
  const [briefingsCollapsed, setBriefingsCollapsed] = useState(false);
  // briefing item id -> pipeline row id, so the toast's Undo action
  // can DELETE the row that was just inserted. Populated only after
  // the API returns success.
  const [, setPipelineRowByItem] = useState<Record<string, string>>({});
  const { showToast } = useToast();
  const [feedbackByItem, setFeedbackByItem] = useState<Record<string, FeedbackType>>({});
  const [savingFeedback, setSavingFeedback] = useState<Set<string>>(new Set());
  const [dismissedItems, setDismissedItems] = useState<Set<string>>(new Set());
  const [liveLocations, setLiveLocations] = useState<Record<string, string>>({});
  const [liveBuyers, setLiveBuyers] = useState<Record<string, ReturnType<typeof getBuyerAgencyParts>>>({});
  // SAM attachment links per opportunity, keyed the same way as
  // liveLocations, so the expanded card can list the document files
  // (same as the Market Dashboard does).
  const [liveAttachments, setLiveAttachments] = useState<Record<string, unknown[]>>({});
  // NAICS + set-aside per opportunity from the live SAM feed, keyed the same
  // way. Lets us backfill the Industry/Set-Aside line on briefing items that
  // were stored without those fields (e.g. older deadlinesThisWeek entries).
  const [liveNaics, setLiveNaics] = useState<Record<string, string>>({});
  const [liveSetAside, setLiveSetAside] = useState<Record<string, string>>({});
  const [liveNoticeTypes, setLiveNoticeTypes] = useState<Record<string, string>>({});
  const [liveDescriptions, setLiveDescriptions] = useState<Record<string, string>>({});

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
        // Use /api/mi-dashboard (the same source the Market Dashboard
        // uses) instead of /api/app/opportunities. The latter is
        // 2FA-gated and was returning 0 rows in this context, so the
        // location/buyer/attachment enrichment silently never matched.
        // mi-dashboard returns snake_case fields + attachments reliably.
        const params = new URLSearchParams({ email: userEmail, limit: '100' });
        const res = await fetch(`/api/mi-dashboard?${params.toString()}`, {
          headers: getAuthHeaders(),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || cancelled || !Array.isArray(data?.opportunities)) return;

        const next: Record<string, string> = {};
        const nextBuyers: Record<string, ReturnType<typeof getBuyerAgencyParts>> = {};
        const nextAttachments: Record<string, unknown[]> = {};
        const nextNaics: Record<string, string> = {};
        const nextSetAside: Record<string, string> = {};
        const nextNoticeTypes: Record<string, string> = {};
        const nextDescriptions: Record<string, string> = {};
        for (const raw of asArray(data.opportunities)) {
          const opportunity = asRecord(raw);
          const oppAttachments = Array.isArray(opportunity.attachments) ? opportunity.attachments : [];
          const oppNaics = text(opportunity.naics_code, text(opportunity.naicsCode));
          const oppSetAside = text(opportunity.set_aside_description, text(opportunity.setAsideDescription, text(opportunity.set_aside, text(opportunity.setAside))));
          const oppNoticeType = text(opportunity.notice_type, text(opportunity.noticeType));
          const oppDescription = text(opportunity.description);
          // Fields come back snake_case from mi-dashboard; fall back to
          // camelCase so this still works if the source ever changes.
          const location = formatOpportunityLocation({
            popCity: text(opportunity.pop_city, text(opportunity.popCity)),
            popState: text(opportunity.pop_state, text(opportunity.popState)),
            popZip: text(opportunity.pop_zip, text(opportunity.popZip)),
            popCountry: text(opportunity.pop_country, text(opportunity.popCountry)),
          });
          const buyer = getBuyerAgencyParts({
            agency: text(opportunity.buyerName, text(opportunity.department)),
            department: text(opportunity.department, text(opportunity.parentAgency)),
            subTier: text(opportunity.sub_tier, text(opportunity.subTier)),
            office: text(opportunity.office, text(opportunity.buyerOffice)),
          });

          [
            text(opportunity.notice_id, text(opportunity.id)),
            text(opportunity.solicitation_number, text(opportunity.solicitationNumber)),
            normalizeLookupKey(text(opportunity.title)),
          ].filter(Boolean).forEach(key => {
            if (location) next[key] = location;
            if (buyer.primary && buyer.primary !== 'Unknown agency') nextBuyers[key] = buyer;
            if (oppAttachments.length > 0) nextAttachments[key] = oppAttachments;
            if (oppNaics) nextNaics[key] = oppNaics;
            if (oppSetAside) nextSetAside[key] = oppSetAside;
            if (oppNoticeType) nextNoticeTypes[key] = oppNoticeType;
            if (oppDescription) nextDescriptions[key] = oppDescription;
          });
        }

        setLiveLocations(next);
        setLiveBuyers(nextBuyers);
        setLiveAttachments(nextAttachments);
        setLiveNaics(nextNaics);
        setLiveSetAside(nextSetAside);
        setLiveNoticeTypes(nextNoticeTypes);
        setLiveDescriptions(nextDescriptions);
      } catch (err) {
        console.warn('Failed to load live opportunity enrichment:', err);
      }
    }

    void loadLiveLocations();

    // Pre-seed pipelineSaved with what's ALREADY in the user's pipeline,
    // keyed by the same stable id, so "+ Track" shows "✓ Tracking" for
    // opportunities saved in a previous session (and can't be re-added).
    async function loadExistingPipeline() {
      try {
        const res = await fetch(`/api/pipeline?email=${encodeURIComponent(userEmail)}`, {
          headers: getAuthHeaders(),
        });
        const data = await res.json().catch(() => null);
        if (cancelled || !data) return;
        const rows = asArray(data.opportunities ?? data.pipeline ?? data.data);
        const ids = new Set<string>();
        for (const raw of rows) {
          const row = asRecord(raw);
          const nid = text(row.notice_id);
          if (nid) ids.add(nid);
          const t = normalizeLookupKey(text(row.title));
          if (t) ids.add(`title:${t}`);
        }
        if (ids.size > 0) setPipelineSaved(prev => new Set([...prev, ...ids]));
      } catch { /* non-fatal — button just won't pre-mark */ }
    }
    void loadExistingPipeline();

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
        getBriefingItemDescription(item, liveDescriptions),
        getBriefingItemNoticeType(item, liveNoticeTypes),
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
  }, [activeFilter, briefingItems, dismissedItems, liveBuyers, liveDescriptions, liveLocations, liveNoticeTypes, searchTerm]);

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
    // Dedup by a STABLE id (solicitation/title), not the synthetic
    // render id — the same opportunity appears across briefings with
    // different render ids, which previously let it be added twice.
    const stableId = getStableNoticeId(item);
    if (pipelineSaved.has(stableId)) return; // already tracked

    // Optimistic: flip button to "✓ Tracking" BEFORE the network call
    // settles. Linear / Notion pattern — the user sees the action took
    // immediately. If the server rejects, we roll back below.
    setPipelineSaved(prev => new Set(prev).add(stableId));

    try {
      // Schema gotchas that caused the original "Failed to add to
      // pipeline" 500:
      //   - column is `value_estimate` NOT `estimated_value`
      //   - column is `external_url` NOT `sam_link`
      //   - `response_deadline` is TIMESTAMPTZ — item.deadline is a
      //     human-formatted string ("May 21, 2026 9:00 PM ET") which
      //     Postgres can't cast. Set to null when not parseable.
      const parsedDeadline = (() => {
        if (!item.deadline) return null;
        const d = new Date(item.deadline);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      })();
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        // /api/pipeline POST requires requireMIAuthSession — without
        // the MI 2FA auth header in getAuthHeaders, every request
        // returns "Failed to add to pipeline" with no auth context.
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_email: email,
          notice_id: stableId,
          title: item.title,
          agency: item.buyerName || item.subtitle?.split(' • ')[0] || '',
          naics_code: item.signals.find(s => s.startsWith('NAICS'))?.replace('NAICS ', '') || '',
          set_aside: item.signals.find(s => ['8(a)', 'WOSB', 'SDVOSB', 'HUBZone', 'SBA', 'Small Business'].some(sa => s.includes(sa))) || '',
          response_deadline: parsedDeadline,
          // item.amount is a DISPLAY LABEL ("Due in 6 days", "Open
          // market research window..."), NOT a dollar value. Writing
          // it here polluted user_pipeline.value_estimate for months.
          // Send null so the column stays clean — UI shows "—".
          value_estimate: null,
          external_url: item.actionUrl || '',
          stage: 'tracking',
          priority: 'medium',
          source: 'briefing',
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        // Roll back optimistic state and show error toast. 409 means
        // the opp was already in the pipeline — keep optimistic state
        // since the outcome the user wanted is true.
        if (res.status === 409) {
          showToast({ message: 'Already in your Pipeline', variant: 'info' });
        } else {
          setPipelineSaved(prev => {
            const next = new Set(prev);
            next.delete(stableId);
            return next;
          });
          // Log full error payload to the console so we can debug
          // schema/RLS issues without the user having to forward a
          // screenshot. Toast still keeps it short.
          if (data) {
            console.error('[DashboardPanel] /api/pipeline rejected:', data);
          }
          const detail = data?.details ? ` — ${data.details}` : '';
          showToast({
            message: (data?.error || 'Could not add to Pipeline') + detail,
            variant: 'error',
            durationMs: 10000, // sticky-ish since the user may want to copy/read the message
          });
        }
        return;
      }

      // Success. Remember the row id so Undo can delete it. Then show
      // the toast with an Undo action.
      const pipelineRowId = data.opportunity?.id as string | undefined;
      if (pipelineRowId) {
        setPipelineRowByItem(prev => ({ ...prev, [item.id]: pipelineRowId }));
      }
      trackItemEvent('tool_use', item, 'track_in_pipeline');
      showToast({
        message: 'Added to Pipeline',
        variant: 'success',
        action: pipelineRowId
          ? {
              label: 'Undo',
              onClick: () => {
                // Roll back UI first (optimistic undo).
                setPipelineSaved(prev => {
                  const next = new Set(prev);
                  next.delete(stableId);
                  return next;
                });
                setPipelineRowByItem(prev => {
                  const next = { ...prev };
                  delete next[item.id];
                  return next;
                });
                // Fire DELETE without awaiting — if it fails the row
                // stays in Pipeline; the user can clean it up there.
                // Logging error is enough for our debugging. Auth
                // headers required by /api/pipeline DELETE same as POST.
                fetch('/api/pipeline', {
                  method: 'DELETE',
                  headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
                  body: JSON.stringify({ id: pipelineRowId, user_email: email }),
                }).catch((err) => console.warn('[DashboardPanel] Undo DELETE failed:', err));
              },
            }
          : undefined,
      });
    } catch (err) {
      console.error('Failed to add to pipeline:', err);
      // Network error — roll back and tell the user.
      setPipelineSaved(prev => {
        const next = new Set(prev);
        next.delete(stableId);
        return next;
      });
      showToast({
        message: 'Network error — could not add to Pipeline',
        variant: 'error',
      });
    } finally {
      setSavingPipeline(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, [email, getAuthHeaders, trackItemEvent, pipelineSaved, showToast]);

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

      <div className="px-4 md:px-6 py-4 md:py-5 border-b border-slate-800 bg-slate-950">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">Today&apos;s Intel</h1>
            <p className="text-xs md:text-sm text-slate-400 mt-1">Best-fit opportunities, summaries, and next actions from your saved profile.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={marketIntelHref}
              className="flex-1 md:flex-none text-center px-3 md:px-4 py-2 bg-purple-600/20 text-purple-200 border border-purple-500/30 rounded-lg hover:bg-purple-600/30 transition-colors text-sm md:text-base"
            >
              Open SAM Dashboard
            </Link>
            <button
              onClick={loadBriefings}
              className="px-3 md:px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors text-sm md:text-base"
              aria-label="Refresh briefings"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Mindy Insight hero card — daily quote, theme rotates by day */}
      <div className="px-3 md:px-6 pt-4 md:pt-5">
        <MindyInsightCard email={email} />
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
        <div className={`grid grid-cols-1 ${briefingsCollapsed ? 'lg:grid-cols-[44px_1fr]' : 'lg:grid-cols-[280px_1fr]'}`}>
          {briefingsCollapsed ? (
            // Collapsed: a slim rail with a button to bring the list back.
            <aside className="hidden lg:flex flex-col items-center border-r border-slate-800 bg-slate-950/80 lg:min-h-[calc(100vh-202px)] py-4">
              <button
                onClick={() => setBriefingsCollapsed(false)}
                title="Show past briefings"
                aria-label="Show past briefings"
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <span className="block text-lg leading-none">»</span>
              </button>
            </aside>
          ) : (
          <aside className="border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-950/80 lg:min-h-[calc(100vh-202px)]">
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-slate-500 uppercase tracking-wider">Past Briefings</p>
                <button
                  onClick={() => setBriefingsCollapsed(true)}
                  title="Collapse past briefings"
                  aria-label="Collapse past briefings"
                  className="hidden lg:block p-1 rounded text-slate-500 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <span className="block text-sm leading-none">«</span>
                </button>
              </div>
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
          )}

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
                  <FilterButton label="All" count={counts.all} active={activeFilter === 'all'} onClick={() => filterTo('all')} />
                  <FilterButton label="Urgent" count={counts.urgent} active={activeFilter === 'urgent'} onClick={() => filterTo('urgent')} />
                  <FilterButton label="Opportunities" count={counts.opportunity} active={activeFilter === 'opportunity'} onClick={() => filterTo('opportunity')} />
                  <FilterButton label="Teaming" count={counts.teaming} active={activeFilter === 'teaming'} onClick={() => filterTo('teaming')} />
                </div>
                <div className="text-sm text-slate-500">{filteredItems.length} shown</div>
              </div>
            </div>

            {/* Stat cards double as filter shortcuts — click to jump straight
                to those items (Eric: they should sort/filter/take you there). */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
              <SummaryStat
                label="Opportunities" value={counts.opportunity}
                active={activeFilter === 'opportunity'}
                onClick={() => filterTo('opportunity')}
              />
              <SummaryStat
                label="Urgent Alerts" value={summary.urgentAlerts} urgent
                active={activeFilter === 'urgent'}
                onClick={() => filterTo('urgent')}
              />
              <SummaryStat
                label="Total Matched" value={summary.totalMatched || counts.all}
                active={activeFilter === 'all'}
                onClick={() => filterTo('all')}
              />
              {/* Briefings → reveal/scroll the Past Briefings rail. */}
              <SummaryStat
                label="Briefings" value={briefings.length}
                onClick={() => setBriefingsCollapsed(false)}
              />
            </div>

            <section ref={resultsRef} className="scroll-mt-4">
              <h3 className="text-xl font-semibold mb-4">
                Top Opportunities to Review
                {activeFilter !== 'all' && <span className="ml-2 text-sm font-normal text-slate-400">· filtered: {activeFilter} ({filteredItems.length})</span>}
              </h3>
              <div className="space-y-3">
                {filteredItems.map(item => {
                  const isExpanded = expandedItems.has(item.id);
                  const itemLocation = getBriefingItemLocation(item, liveLocations);
                  const itemBuyer = getBriefingItemBuyer(item, liveBuyers);
                  const itemNoticeType = getBriefingItemNoticeType(item, liveNoticeTypes);
                  const itemDescription = getBriefingItemDescription(item, liveDescriptions);
                  const itemAttachments = getBriefingItemAttachments(item, liveAttachments)
                    .filter((a) => a && !(a as Record<string, unknown>)._no_attachments);
                  const itemMetaLine = getBriefingMetaLine(item, itemBuyer);
                  const itemDetailLine = buildItemDetailLine(item, liveNaics, liveSetAside);

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
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                        <div className="min-w-0 flex-1">
                          {(() => {
                            const badge = noticeTypeBadge(itemNoticeType);
                            return badge ? (
                              <span className={`inline-block mb-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.cls}`}>
                                {badge.label}
                              </span>
                            ) : null;
                          })()}
                          <h4 className="font-semibold text-white leading-snug break-words">{item.title}</h4>
                          {itemBuyer.primary && itemBuyer.primary !== 'Unknown agency' && (
                            <p className="text-sm text-slate-400 mt-1 leading-relaxed break-words">
                              {itemBuyer.primary}
                              {itemBuyer.secondary && <span className="text-slate-500"> • {itemBuyer.secondary}</span>}
                              {itemBuyer.parent && <span className="text-slate-600"> • {itemBuyer.parent}</span>}
                            </p>
                          )}
                          {item.incumbent && (
                            <p className="text-xs text-slate-500 mt-1">
                              Incumbent:{' '}
                              <ContractorLink name={item.incumbent} email={email} variant="inline">
                                {item.incumbent}
                              </ContractorLink>
                            </p>
                          )}
                          {item.targetPrimes && item.targetPrimes.length > 0 && (
                            <p className="text-xs text-slate-500 mt-1">
                              Suggested primes:{' '}
                              {item.targetPrimes.map((prime, idx) => (
                                <span key={`${prime}-${idx}`}>
                                  {idx > 0 && ' · '}
                                  <ContractorLink name={prime} email={email} variant="inline">
                                    {prime}
                                  </ContractorLink>
                                </span>
                              ))}
                            </p>
                          )}
                          {itemMetaLine && <p className="text-sm text-slate-500 mt-1">{itemMetaLine}</p>}
                          {itemLocation && (
                            <p className="mt-2 inline-flex items-center rounded bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300">
                              📍 Place of performance: {itemLocation}
                            </p>
                          )}
                          {itemDetailLine && <p className="text-sm text-slate-400 mt-2 leading-relaxed break-words">{itemDetailLine}</p>}
                        </div>
                        <div className="w-full min-w-0 md:w-auto md:max-w-md md:text-right">
                          <div className="text-right">
                            {item.amount && <p className="text-sm font-semibold text-emerald-400 break-words">{item.amount}</p>}
                            {item.deadline && <p className="text-sm text-slate-500 mt-1 break-words">{item.deadline}</p>}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 sm:justify-end">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleItem(item.id);
                              }}
                              className="inline-flex min-h-[44px] items-center justify-center rounded bg-emerald-600 px-2.5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 sm:px-3 md:min-h-0 md:py-1.5"
                            >
                              {isExpanded ? 'Hide Fit' : 'Review Fit'}
                            </button>
                          {/* Track in Pipeline — promoted from inside the
                              expanded Review Fit section to the always-
                              visible action row. Legacy /briefings showed
                              "+ Track" inline on the card; hiding it
                              behind a Review Fit click was a regression. */}
                          {(() => {
                            // Track-state keyed by the STABLE id so the
                            // button shows "✓ Tracking" on EVERY card for
                            // the same opportunity, and a duplicate can't
                            // be added once one instance is saved.
                            const stableId = getStableNoticeId(item);
                            const isSaved = pipelineSaved.has(stableId);
                            const isSaving = savingPipeline.has(item.id);
                            return (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleTrackInPipeline(item);
                                }}
                                disabled={isSaving || isSaved}
                                className={`inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded px-2.5 py-2 text-sm font-medium transition-colors sm:px-3 md:min-h-0 md:py-1.5 ${
                                  isSaved
                                    ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
                                    : isSaving
                                      ? 'bg-slate-800 text-slate-400 cursor-wait'
                                      : 'bg-purple-600 text-white hover:bg-purple-500'
                                }`}
                              >
                                {isSaved ? '✓ Tracking' : isSaving ? 'Adding…' : '+ Track'}
                              </button>
                            );
                          })()}
                            {/* Share — the viral loop (lost in the beta→new
                                migration). Users send opps to partners/
                                teammates/friends; the public /shared/opp page
                                pulls them in. Eric 2026-06-05. */}
                            {email && (
                              <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
                                <ShareButton
                                  variant="small"
                                  email={email}
                                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded bg-slate-800 px-2.5 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white sm:px-3 md:min-h-0 md:py-1.5"
                                  opportunity={{
                                    id: getStableNoticeId(item),
                                    title: item.title,
                                    agency: item.subtitle,
                                    notice_type: item.noticeType,
                                    deadline: item.deadline,
                                    description: item.description,
                                    link: item.actionUrl,
                                  }}
                                />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                dismissItem(item);
                              }}
                              className="inline-flex min-h-[44px] items-center justify-center rounded bg-slate-800 px-2.5 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200 sm:px-3 md:min-h-0 md:py-1.5"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className={`transition-all duration-200 overflow-hidden ${
                        isExpanded
                          ? `${itemAttachments.length > 0 ? 'max-h-[40rem] overflow-y-auto' : 'max-h-96'} opacity-100 mt-4`
                          : 'max-h-0 opacity-0'
                      }`}>
                        {itemDescription && <p className="text-sm leading-relaxed text-slate-300">{itemDescription}</p>}
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
                        {/* Action row inside Review Fit: was the only home
                            for Track in Pipeline, now duplicated. Track
                            promoted to the always-visible row above, so
                            only "View on SAM.gov" remains here. */}
                        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-4">
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

                        {/* Incumbent intel (#57 follow-on) — for an OPEN opp, who
                            holds this work NOW (real ceiling/expiry/vehicle),
                            fetched on click. Grounds "is this worth pursuing?" the
                            moment the user reviews fit. */}
                        <div className="mt-3 border-t border-slate-800 pt-3" onClick={(e) => e.stopPropagation()}>
                          <IncumbentIntel
                            agency={text(item.parentAgency, text(item.buyerName)) || undefined}
                            title={text(item.title) || undefined}
                            email={email}
                          />
                        </div>

                        {/* Attachments — the actual SAM document files, same
                            as the Market Dashboard. Downloads route through
                            the /api/sam-attachment proxy (raw SAM URLs need
                            our API key). Only shows when the item has them. */}
                        {itemAttachments.length > 0 && (
                          <div className="mt-4 border-t border-slate-800 pt-4">
                            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">
                              Attachments ({itemAttachments.length})
                            </p>
                            <ul className="space-y-1.5">
                              {itemAttachments.map((raw, idx) => {
                                const att = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
                                const url = typeof raw === 'string'
                                  ? raw
                                  : (att.url || att.link || att.resourceLink) as string | undefined;
                                if (!url) return null;
                                const givenName = (att.name || att.fileName || att.title) as string | undefined;
                                let name = givenName && givenName.toLowerCase() !== 'download' ? givenName : undefined;
                                if (!name) {
                                  try {
                                    const parts = new URL(url).pathname.split('/').filter(Boolean);
                                    const last = parts[parts.length - 1];
                                    const fileId = last && last.toLowerCase() !== 'download'
                                      ? last
                                      : (parts.length >= 2 ? parts[parts.length - 2] : undefined);
                                    name = fileId && fileId.length <= 24 ? `Document ${idx + 1} (${fileId})` : `Document ${idx + 1}`;
                                  } catch { name = `Document ${idx + 1}`; }
                                }
                                const downloadHref = /(^|\.)sam\.gov\//i.test(url)
                                  ? `/api/sam-attachment?url=${encodeURIComponent(url)}`
                                  : url;
                                return (
                                  <li key={idx}>
                                    <a
                                      href={downloadHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(event) => event.stopPropagation()}
                                      className="inline-flex items-center gap-2 text-sm text-purple-300 hover:text-purple-200 underline"
                                    >
                                      <span className="shrink-0">📄</span>
                                      <span className="truncate">{name}</span>
                                    </a>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}

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

function SummaryStat({ label, value, urgent = false, onClick, active = false }: { label: string; value: string | number; urgent?: boolean; onClick?: () => void; active?: boolean }) {
  // Clickable stats act as filter shortcuts (Eric: the stat cards looked
  // interactive but weren't). A ring marks the active filter; hover affords it.
  const base = `rounded-lg border p-5 text-center transition-colors ${urgent ? 'bg-red-950/30 border-red-500/30' : 'bg-slate-900 border-slate-800'}`;
  const interactive = onClick ? 'cursor-pointer hover:border-purple-500/50' : '';
  const ring = active ? (urgent ? 'ring-2 ring-red-500/60' : 'ring-2 ring-purple-500/60') : '';
  const content = (
    <>
      <div className={urgent ? 'text-2xl font-bold text-red-300' : 'text-2xl font-bold text-purple-300'}>{value}</div>
      <div className={urgent ? 'text-xs uppercase tracking-wider text-red-300 mt-2' : 'text-xs uppercase tracking-wider text-slate-500 mt-2'}>{label}</div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} ${interactive} ${ring} w-full`} aria-pressed={active}>
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
}
