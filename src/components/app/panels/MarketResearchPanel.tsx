'use client';

import { useState, useCallback, useEffect, useRef, useMemo, Fragment } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Zap, Gauge, Loader2 } from 'lucide-react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import MarketCoverageBanner, { type MarketCoverage } from '../market/MarketCoverageBanner';
import { useAppTracker } from '../track';
import { useToast } from '../Toast';
import ContractorLink from '../contractors/ContractorLink';
import { NaicsAutocompleteInput } from '../../codes/NaicsAutocompleteInput';
import StartTrackingModal, { type TriageAgencyCard } from './triage/StartTrackingModal';
import { EntryAccessibilityCard } from './EntryAccessibilityCard';
import type { Agency, SimplifiedAcquisitionReport } from '@/types/federal-market-assassin';
import { formatMindyCurrency } from '@/lib/mindy/formatters';
import { getProductVendorHint } from '@/lib/lookup-intent';
import { formatDodaacOffice } from '@/lib/gov-contacts/dodaac';

interface MarketResearchPanelProps {
  email: string | null;
  tier: AppTier;
  onNavigate?: (panel: string, context?: Record<string, unknown>) => void;
}

type BusinessType = 'SDVOSB' | 'VOSB' | 'Women Owned' | 'HUBZone' | '8(a) Certified' | 'Small Business' | 'Native American/Tribal' | '';
type VeteranStatus = 'Not Applicable' | 'Veteran Owned' | 'Service Disabled Veteran';

interface FormData {
  businessType: BusinessType;
  naicsCode: string;
  pscCode: string;
  zipCode: string;
  locationStates: string[];   // States filter — scopes Market Research spend by place of performance
  veteranStatus: VeteranStatus;
  companyName: string;
  excludeDOD: boolean;
}

interface WorkspaceProfileRow {
  naics_codes?: string[] | null;
  agencies?: string[] | null;
  target_agencies?: string[] | null;
  keywords?: string[] | null;
  business_type?: string | null;
  company_name?: string | null;
  zip_code?: string | null;
  zip_codes?: string[] | null;
  location_states?: string[] | null;
  certifications?: string[] | null;
  set_aside_preferences?: string[] | null;
  aggregated_profile?: {
    naics_codes?: string[] | null;
    agencies?: string[] | null;
    keywords?: string[] | null;
    zip_codes?: string[] | null;
    location_states?: string[] | null;
    psc_codes?: string[] | null;
    business_type?: string | null;
    company_name?: string | null;
    certifications?: string[] | null;
    set_aside_preferences?: string[] | null;
  } | null;
}

interface WorkspaceData {
  settings?: WorkspaceProfileRow | null;
  profile?: {
    notification?: WorkspaceProfileRow | null;
    briefing?: WorkspaceProfileRow | null;
  };
}

interface AlertPreferencesData {
  naicsCodes?: string[];
  pscCodes?: string[];
  targetAgencies?: string[];
  agencies?: string[];
  locationState?: string;
  locationStates?: string[];
  businessType?: string;
  setAsides?: string[];
  companyName?: string;
}

interface SavedResearchProfile {
  businessType: BusinessType;
  naicsCodes: string[];
  pscCodes: string[];
  agencies: string[];
  keywords: string[];
  setAsides: string[];
  locationStates: string[];
  zipCode: string;
  companyName: string;
  source: string;
}

type FeedbackType = 'good_match' | 'bad_match' | 'not_my_industry' | 'too_big_small' | 'already_knew' | 'want_more_like_this';

interface RecommendedOpportunity {
  id: string;
  title: string;
  department?: string | null;
  subTier?: string | null;
  office?: string | null;
  solicitationNumber?: string | null;
  naicsCode?: string | null;
  pscCode?: string | null;
  responseDeadline?: string | null;
  noticeType?: string | null;
  description?: string | null;
  descriptionUrl?: string | null;
  setAsideDescription?: string | null;
  popCity?: string | null;
  popState?: string | null;
  popZip?: string | null;
  popCountry?: string | null;
  buyerName?: string | null;
  buyerOffice?: string | null;
  parentAgency?: string | null;
  buyerDisplay?: string | null;
  daysLeft?: number | null;
  isUrgent?: boolean;
  url?: string | null;
  feedbackScoreAdjustment?: number;
  recommendationScore?: number;
  feedbackReasons?: string[];
  setAsideEligible?: boolean;
  setAsideMismatchReason?: string | null;
  eligibilityScoreAdjustment?: number;
  agencyScoreAdjustment?: number;
  agencyMismatchReason?: string | null;
}

interface MarketFocus {
  id: string;
  name: string;
  description?: string | null;
  filters: {
    businessType?: BusinessType | string;
    naicsCodes?: string[];
    pscCodes?: string[];
    agencies?: string[];
    zipCode?: string;
    locationStates?: string[];
    companyName?: string;
    excludeDOD?: boolean;
  };
}

interface Report {
  id: string;
  title: string;
  description: string;
  icon: string;
  tier: 'free' | 'pro';
  reportKey: keyof ReportData;
}

interface ReportData {
  governmentBuyers?: {
    agencies?: Array<{
      contractingOffice: string;
      subAgency?: string;
      parentAgency?: string;
      spending?: number;
      contractCount?: number;
      contactStrategy?: string;
      osbp?: { director?: string; email?: string; phone?: string } | null;
    }>;
    summary?: { totalAgencies: number; totalSpending: number; totalContracts: number };
  };
  agencyPainPoints?: {
    painPoints?: Array<{ agency: string; painPoint: string; opportunityMatch?: string }>;
    spendingPriorities?: Array<{ agency: string; priority: string; fundingStatus?: string }>;
    highOpportunityMatches?: Array<{ agency: string; painPoint: string; matchingPriority: string; area: string }>;
    summary?: { totalPainPoints: number; highOpportunityMatches: number };
  };
  primeContractor?: {
    suggestedPrimes?: Array<{
      name: string;
      reason?: string;
      sbloName?: string;
      email?: string;
      phone?: string;
      naicsCategories?: string[];
      agencies?: string[];  // Used by TopPrimesChart to filter primes
                            // against the user's saved target agencies.
    }>;
    otherAgencies?: Array<{ name: string; reason?: string }>;
    summary?: { totalPrimes: number };
  };
  tier2Subcontracting?: {
    suggestedPrimes?: Array<{
      name: string;
      reason?: string;
      email?: string;
      phone?: string;
      certifications?: string[];
    }>;
    summary?: { totalPrimes: number };
  };
  forecastList?: {
    forecasts?: Array<{
      agency: string;
      quarter?: string;
      estimatedValue?: string;
      solicitationDate?: string;
      description?: string;
      naicsCode?: string;
    }>;
    summary?: { totalForecasts: number; totalValue?: number };
  };
  tribalContracting?: {
    suggestedTribes?: Array<{
      name: string;
      region?: string;
      capabilities?: string[];
      certifications?: string[];
    }>;
    summary?: { totalOpportunities: number };
  };
  budgetCheckup?: {
    agencyBudgets?: Array<{
      agency: string;
      fy2025?: { budgetAuthority?: number };
      fy2026?: { budgetAuthority?: number };
      change?: { amount?: number; percent?: number; trend?: string };
    }>;
    winners?: Array<{
      agency: string;
      fy2025?: { budgetAuthority?: number };
      fy2026?: { budgetAuthority?: number };
      change?: { amount?: number; percent?: number; trend?: string };
    }>;
    losers?: Array<{
      agency: string;
      fy2025?: { budgetAuthority?: number };
      fy2026?: { budgetAuthority?: number };
      change?: { amount?: number; percent?: number; trend?: string };
    }>;
    agencies?: Array<{
      name: string;
      fy2025?: number;
      fy2026?: number;
      change?: { absolute: number; percent: number };
    }>;
    summary?: {
      averageChange?: number;
      totalFY2025?: number;
      totalFY2026?: number;
      overallChange?: number;
      agenciesGrowing?: number;
      agenciesDeclining?: number;
      biggestWinner?: string;
      biggestLoser?: string;
    };
  };
  idvContracts?: {
    contracts?: Array<{
      recipientName: string;
      awardAmount: number;
      awardingAgencyName?: string;
      naicsCode?: string;
    }>;
    summary?: { totalContracts: number; totalValue: number };
  };
  simplifiedAcquisition?: {
    agencies?: Array<{
      agency: string;
      satSpending: number;
      satContractCount: number;
      accessibilityLevel: string;
    }>;
    summary?: { totalSATSpending: number; totalSATContracts: number };
  };
  agencyNeeds?: {
    needs?: Array<{
      agency: string;
      need: string;
      capabilityMatch?: string;
    }>;
    summary?: { totalNeeds: number; matchRate: number };
  };
}

// Reorganized to the 3-theme structure per Phase 1 plan (May 2026).
//
// REMOVED from this panel (they live elsewhere now):
//   - 'teaming' / Teaming Partners → Contractor DB (with teaming-ready chip
//     — currently a data gap, see tasks/should-cost-builder-v2.md)
//   - 'vehicles' / IDV Contracts → covered by Recompete Tracker
//   - Tribal as a separate report → will become a Contractor DB filter
//
// Pricing Intel was never in this list (lives in its own
// PricingIntelPanel under the new Estimating sidebar section).
const REPORTS: Report[] = [
  // Market Map theme — "where do I focus?"
  { id: 'analytics', title: 'Market Analytics', description: 'Spending patterns and trends', icon: '📊', tier: 'free', reportKey: 'simplifiedAcquisition' },
  { id: 'budget', title: 'Budget Authority', description: 'Agency budget analysis', icon: '💰', tier: 'free', reportKey: 'budgetCheckup' },
  { id: 'forecast', title: 'Market Forecast', description: 'Future opportunity pipeline', icon: '🔮', tier: 'pro', reportKey: 'forecastList' },

  // Agency Intel theme — "who is the buyer?"
  { id: 'buyers', title: 'Gov Buyers', description: 'Decision maker identification', icon: '👤', tier: 'free', reportKey: 'governmentBuyers' },
  { id: 'osbp', title: 'OSBP Contacts', description: 'Small business office contacts', icon: '🤝', tier: 'free', reportKey: 'governmentBuyers' },
  { id: 'pain', title: 'Pain Points', description: 'Agency challenges and needs', icon: '🎯', tier: 'pro', reportKey: 'agencyPainPoints' },
  { id: 'positioning', title: 'Agency Needs', description: 'Strategic positioning intel', icon: '📈', tier: 'pro', reportKey: 'agencyNeeds' },

  // Competitor Intel theme — "who am I up against?"
  { id: 'primes', title: 'Prime Analysis', description: 'Incumbent contractor intel', icon: '🏢', tier: 'pro', reportKey: 'primeContractor' },
];

const RESEARCH_LENSES = [
  // 3-theme collapse. Each theme answers ONE question:
  //   Map        → where in the market should I play?
  //   Agency     → who is the buyer and what do they want?
  //   Competitor → who am I competing against?
  { id: 'map', label: 'Market Map', description: 'Where to focus first', reports: ['budget', 'analytics', 'forecast'] },
  { id: 'agency', label: 'Agency Intel', description: 'Buyers, pain points, OSBP contacts', reports: ['buyers', 'osbp', 'pain', 'positioning'] },
  { id: 'competition', label: 'Competitor Intel', description: 'Incumbent primes, similar awards', reports: ['primes'] },
] as const;

type ResearchLensId = typeof RESEARCH_LENSES[number]['id'];

const BUSINESS_TYPES: BusinessType[] = ['SDVOSB', 'VOSB', 'Women Owned', 'HUBZone', '8(a) Certified', 'Small Business', 'Native American/Tribal'];

function firstArray(...values: Array<string[] | null | undefined>): string[] {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return value.map(String).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values
    .map(value => (value || '').trim())
    .filter(Boolean)));
}

function extractNaicsCode(value?: string | null): string {
  return (value || '').match(/\d{2,6}/)?.[0] || '';
}

function splitCodeList(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function opportunityAgencyName(opportunity: RecommendedOpportunity): string {
  return (opportunity.department || opportunity.subTier || opportunity.office || '').trim();
}

function isVeteranProfileForm(formData: FormData): boolean {
  const value = `${formData.businessType || ''} ${formData.veteranStatus || ''}`.toLowerCase();
  return value.includes('sdvosb')
    || value.includes('vosb')
    || value.includes('veteran')
    || value.includes('service disabled')
    || value.includes('service-disabled');
}

function isVeteransAffairsName(value?: string | null): boolean {
  const text = normalizeMatchText(value);
  return text.includes('veterans affairs')
    || text.includes('department of veterans')
    || text.includes('veterans health administration')
    || text === 'vha';
}

function defaultBuyerAgenciesForProfile(formData: FormData): string[] {
  const broadAgencies = [
    'Department of Defense',
    'General Services Administration',
    'Department of Homeland Security',
    'Department of Health and Human Services',
    'Department of the Interior',
  ];

  return isVeteranProfileForm(formData)
    ? ['Department of Defense', 'Department of Veterans Affairs', 'General Services Administration']
    : broadAgencies;
}

function filterAgenciesForProfile(agencies: string[], formData: FormData): string[] {
  if (isVeteranProfileForm(formData)) return agencies;
  return agencies.filter((agency) => !isVeteransAffairsName(agency));
}

function normalizeMatchText(value?: string | null): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isHttpUrl(value?: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanOpportunitySummary(value?: string | null): string | null {
  const text = value?.trim();
  if (!text || isHttpUrl(text)) return null;
  return text;
}

function agencyMatchesTarget(agency: Agency, target: string): boolean {
  const targetText = normalizeMatchText(target);
  if (!targetText) return false;

  return [
    agency.name,
    agency.contractingOffice,
    agency.subAgency,
    agency.parentAgency,
    agency.command,
  ].some((value) => {
    const agencyText = normalizeMatchText(value);
    return agencyText.includes(targetText) || targetText.includes(agencyText);
  });
}

function agencyDataAllowedForProfile(agency: Agency, formData: FormData): boolean {
  if (isVeteranProfileForm(formData)) return true;
  return ![
    agency.name,
    agency.contractingOffice,
    agency.subAgency,
    agency.parentAgency,
    agency.command,
  ].some(isVeteransAffairsName);
}

async function lookupAgencyData(formData: FormData, selectedAgencies: string[]): Promise<Agency[]> {
  const naicsCodes = splitCodeList(formData.naicsCode);
  const pscCodes = splitCodeList(formData.pscCode);
  if (naicsCodes.length === 0 && pscCodes.length === 0) return [];

  try {
    const res = await fetch('/api/agencies/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        naicsCodes,
        pscCodes,
        businessFormation: formData.businessType || 'Small Business',
      }),
    });
    const data = await res.json();
    if (!data.success || !Array.isArray(data.agencies)) return [];

    const agencies = data.agencies as Agency[];

    // Previously this filtered by `selectedAgencies` (a hardcoded
    // 5-agency fallback) AND capped at .slice(0, 25). The filter
    // alone dropped 50-60 real agencies down to ~7 because the broad
    // targets ("Department of Defense") rarely match fuzzy against
    // sub-agency names ("DOD Air Force Materiel Command"). That's
    // why Mindy showed "7 agencies" while MA's full view showed 66.
    //
    // Mental model: the agencies endpoint ALREADY filters by NAICS
    // upstream, so what comes back IS the user's market. Showing
    // less of it is a regression, not a feature. Use the full list,
    // sorted by spend, no cap. Agency table handles its own
    // pagination if N grows past ~100.
    return [...agencies].sort((a, b) => (b.setAsideSpending || 0) - (a.setAsideSpending || 0));
  } catch (err) {
    console.error('Failed to lookup agency data for market research:', err);
    return [];
  }
}

async function fetchRecommendedAgencyNames(
  email: string,
  getAuthHeaders: (headers?: HeadersInit) => HeadersInit,
  formData: FormData,
  limit = 50
): Promise<string[]> {
  try {
    const res = await fetch(`/api/app/opportunities?email=${encodeURIComponent(email)}&limit=${limit}`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!data.success || !Array.isArray(data.opportunities)) return [];

    return uniqueStrings(
      (data.opportunities as RecommendedOpportunity[])
        .map(opportunityAgencyName)
    )
      .filter((agency) => isVeteranProfileForm(formData) || !isVeteransAffairsName(agency))
      .slice(0, 25);
  } catch (err) {
    console.error('Failed to load recommended agency names:', err);
    return [];
  }
}

function normalizeBusinessType(value?: string | null, certifications: string[] = []): BusinessType {
  const combined = [value || '', ...certifications].join(' ').toLowerCase();
  if (combined.includes('sdvosb') || combined.includes('service-disabled') || combined.includes('service disabled')) return 'SDVOSB';
  if (combined.includes('vosb') || combined.includes('veteran')) return 'VOSB';
  if (combined.includes('women') || combined.includes('wosb') || combined.includes('edwosb')) return 'Women Owned';
  if (combined.includes('hubzone')) return 'HUBZone';
  if (combined.includes('8(a)') || combined.includes('8a')) return '8(a) Certified';
  if (combined.includes('tribal') || combined.includes('native')) return 'Native American/Tribal';
  if (combined.includes('small')) return 'Small Business';
  return '';
}

function buildSavedResearchProfile(data: WorkspaceData | null): SavedResearchProfile | null {
  if (!data) return null;

  const settings = data.settings || {};
  const notification = data.profile?.notification || {};
  const briefing = data.profile?.briefing || {};
  const notificationAggregated = notification.aggregated_profile || {};
  const briefingAggregated = briefing.aggregated_profile || {};

  const naicsCodes = firstArray(
    settings.naics_codes,
    notificationAggregated.naics_codes,
    notification.naics_codes,
    briefingAggregated.naics_codes,
    briefing.naics_codes
  );
  const pscCodes = firstArray(notificationAggregated.psc_codes, briefingAggregated.psc_codes);
  const agencies = firstArray(
    settings.target_agencies,
    notificationAggregated.agencies,
    notification.agencies,
    briefingAggregated.agencies,
    briefing.agencies
  );
  const certifications = firstArray(
    settings.set_aside_preferences,
    settings.certifications,
    notification.set_aside_preferences,
    notification.certifications,
    notificationAggregated.set_aside_preferences,
    notificationAggregated.certifications,
    briefing.set_aside_preferences,
    briefing.certifications,
    briefingAggregated.set_aside_preferences,
    briefingAggregated.certifications
  );
  const keywords = firstArray(
    settings.keywords,
    notification.keywords,
    notificationAggregated.keywords,
    briefing.keywords,
    briefingAggregated.keywords
  );
  const businessType = normalizeBusinessType(
    notification.business_type || notificationAggregated.business_type || briefingAggregated.business_type,
    certifications
  );
  const zipCodes = firstArray(notificationAggregated.zip_codes, notification.zip_codes, briefingAggregated.zip_codes);
  const locationStates = firstArray(
    settings.location_states,
    notification.location_states,
    notificationAggregated.location_states,
    briefing.location_states,
    briefingAggregated.location_states
  );
  const companyName = String(
    settings.company_name ||
    notification.company_name ||
    notificationAggregated.company_name ||
    briefing.company_name ||
    briefingAggregated.company_name ||
    ''
  ).trim();

  if (naicsCodes.length === 0 && pscCodes.length === 0 && agencies.length === 0 && !businessType && !companyName) {
    return null;
  }

  return {
    businessType,
    naicsCodes,
    pscCodes,
    agencies,
    keywords,
    setAsides: certifications,
    locationStates,
    zipCode: briefing.zip_code || zipCodes[0] || '',
    companyName,
    source: data.settings ? 'MI workspace settings' : notification.naics_codes || notificationAggregated.naics_codes ? 'briefing settings' : 'saved profile',
  };
}

function rollupChartBuyers(rows: AgencyTableRow[]): BuyerLike[] {
  const byAgency = new Map<string, BuyerLike>();
  for (const row of rows) {
    const spend = row.metric_top_total || row.totalSpending || row.setAsideSpending || 0;
    if (spend <= 0) continue;
    const label = row.subAgency || row.parentAgency || row.name;
    const prev = byAgency.get(label);
    if (!prev || spend > (prev.spending || 0)) {
      byAgency.set(label, {
        contractingOffice: label,
        parentAgency: row.parentAgency,
        subAgency: row.subAgency,
        spending: spend,
        contractCount: row.contractCount,
      });
    }
  }
  return [...byAgency.values()];
}

export default function MarketResearchPanel({ email, tier, onNavigate }: MarketResearchPanelProps) {
  const [formData, setFormData] = useState<FormData>({
    businessType: '',
    naicsCode: '',
    pscCode: '',
    zipCode: '',
    locationStates: [],
    veteranStatus: 'Not Applicable',
    companyName: '',
    excludeDOD: false,
  });
  const [selectedAgency, setSelectedAgency] = useState('');
  // Auto vs Sport mode (Eric): Auto uses your saved profile; Sport lets you
  // research ANY industry (manual NAICS/PSC/set-aside) without touching your
  // saved settings — for exploring expansion lanes / a report for someone else.
  // Default to SPORT (Eric, Jun 2026): a fresh research session should start
  // CLEAN — no auto-populating the fields from the saved/old profile. Auto remains
  // one click away for users who want their profile codes pre-filled.
  const [researchMode, setResearchMode] = useState<'auto' | 'sport'>('sport');
  const searchParams = useSearchParams();
  const deepLinkKeywordRef = useRef(false);
  // Sport-mode keyword→code lookup (Eric's "drone problem": don't make users
  // know the NAICS for "medical supplies" — type plain English, get codes).
  const [sportKeyword, setSportKeyword] = useState('');
  const [sportSuggesting, setSportSuggesting] = useState(false);
  const [sportSuggestions, setSportSuggestions] = useState<{ naics: Array<{ code: string; name: string }>; psc: Array<{ code: string; name: string }> } | null>(null);
  // "Save to my profile" — persist the researched NAICS + keyword to the user's
  // alert profile (replaces their current codes). The fix for "I researched my
  // market but it never reached my alerts."
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  // Has a report been explicitly run since entering Sport? Gates the whole
  // results area so the saved-profile report never shows in Sport (Eric).
  const [sportReportRan, setSportReportRan] = useState(false);
  /** True from Sport Build/deep-link until complete — starts TMR in parallel with generate-all. */
  const [sportBuildActive, setSportBuildActive] = useState(false);
  // True when results should render: always in Auto; in Sport only after a run.
  const showResults = researchMode === 'auto' || sportReportRan;
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [generatedReports, setGeneratedReports] = useState<Set<string>>(new Set());
  const [savedProfile, setSavedProfile] = useState<SavedResearchProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileApplied, setProfileApplied] = useState(false);
  const [showAdvancedProfile, setShowAdvancedProfile] = useState(false);
  const [activeLens, setActiveLens] = useState<ResearchLensId>('map');
  // Phase 2 — Market Map flagship view. When 'map' (default), render
  // the new MarketMapView with charts + AI narrative. When 'reports',
  // show the legacy 7-report surface for power users. Toggle lives
  // in the page header so the new presentation-grade view is the
  // first impression but the raw data is always one click away.
  const [viewMode, setViewMode] = useState<'map' | 'reports'>('map');
  // tmrRows — the full row set from /api/app/target-market-research.
  //
  // Powers the upstream charts (Spending by Agency, Set-Aside Mix,
  // Market Total, Mindy Says) so they render from the same 96-row
  // data the AgencyTable uses, not the legacy 7-row reportData.
  // governmentBuyers path.
  //
  // CRITICAL — this fetch is fired AT THE PARENT LEVEL (not from
  // AgencyTable's mount) because AgencyTable only renders inside
  // the {reportData && (...)} gate, meaning the table doesn't mount
  // until after the user clicks Refresh + the reports finish
  // generating. If we only fetched TMR from AgencyTable, the charts
  // would always see tmrRows=[] on first paint (and fall back to
  // the legacy 7-agency view). Lifting the fetch up to the parent
  // breaks the mount-order race.
  //
  // The TMR endpoint is independently cacheable (24h) and idempotent
  // so firing it eagerly costs nothing.
  const [tmrRows, setTmrRows] = useState<AgencyTableRow[]>([]);
  // True while the AgencyTable's slow find-agencies fetch is in flight — drives
  // the moving "Loading agency data" indicator next to the panel title so users
  // know the page isn't fully rendered yet (Eric, Jun 23 2026).
  const [agencyLoading, setAgencyLoading] = useState(false);
  const [marketCoverage, setMarketCoverage] = useState<MarketCoverage | null>(null);  // #59
  // Authoritative "Relevant spending" from spending_by_category (department total)
  // + the window label, so the headline figure reconciles with the table/leaderboards.
  const [tmrRelevantSpending, setTmrRelevantSpending] = useState<number | null>(null);
  const [spendWindowLabel, setSpendWindowLabel] = useState<string | null>(null);
  // Agencies the user STARRED in the agency table. When non-empty, the
  // reports (pain points / OSBP / buyers / needs) generate for THESE
  // instead of the typed/recommended set — so report content matches
  // the user's Market Map selection.
  const [starredAgencies, setStarredAgencies] = useState<string[]>([]);
  // Charts-ready signal — gates the MarketMapLoadingBanner so it stays
  // visible past isGenerating=false, until child charts (AgencyTable
  // rows + FPDS leaderboards + SBA goaling lookups) have settled.
  // Per Eric (2026-05-25): "between the time where the first graph
  // loads to the final we still need to show image one working" —
  // banner was disappearing while half-rendered charts were still
  // settling, looked broken. Flips true ~2.5s after tmrRows arrive.
  const [chartsReady, setChartsReady] = useState(true);
  useEffect(() => {
    if (tmrRows.length === 0) return;
    setChartsReady(false);
    const t = setTimeout(() => setChartsReady(true), 2500);
    return () => clearTimeout(t);
  }, [tmrRows]);
  // Parent-agency filter for AgencyTable. Wired from FpdsLeaderboards
  // so clicking 'Department of the Army' in a leaderboard scrolls down
  // and narrows the table to Army offices only. Null = no filter.
  const [parentAgencyFilter, setParentAgencyFilter] = useState<string | null>(null);
  const agencyTableRef = useRef<HTMLDivElement>(null);
  // parentSbShareMap — SBA Goaling small-business share keyed by
  // agency name (parent / subAgency / name, whichever was passed
  // to the bulk endpoint). Populated by a parent-level effect once
  // tmrRows arrives. Lets the donut + Mindy Says narrative compute
  // weighted SB% across all 96 agencies, not just the 7 that the
  // legacy reportData path returned.
  const [parentSbShareMap, setParentSbShareMap] = useState<Record<string, number>>({});
  // SBA Goaling lookup is async and can take 5-10s for 50+ agencies.
  // Tracked separately from chartsReady so the loading banner stays up
  // until the SB Mix donut actually has its data, not just until tmrRows
  // arrive. Per Eric (2026-05-27): the moving bar should still be showing
  // when the donut is still 'Calculating small-business share...'.
  const [parentSbShareLoading, setParentSbShareLoading] = useState(false);
  const [marketFocuses, setMarketFocuses] = useState<MarketFocus[]>([]);
  const [activeFocusId, setActiveFocusId] = useState<string>('saved-profile');
  const [showSaveFocus, setShowSaveFocus] = useState(false);
  const [newFocusName, setNewFocusName] = useState('');
  const [focusSaving, setFocusSaving] = useState(false);
  const [recommendedOpportunities, setRecommendedOpportunities] = useState<RecommendedOpportunity[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [feedbackByOpportunity, setFeedbackByOpportunity] = useState<Record<string, FeedbackType>>({});
  const [savingFeedback, setSavingFeedback] = useState<Set<string>>(new Set());
  const [selectedOpportunity, setSelectedOpportunity] = useState<RecommendedOpportunity | null>(null);
  const autoGeneratedRef = useRef(false);
  const generateInFlightRef = useRef(false);
  const sportAutoBuildRef = useRef(false);
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  // Cache the Auto report per profile so landing on Market Research shows the
  // LAST report instantly instead of re-running the expensive build every visit
  // (Eric: the on-load rebuild leaked into Sport + wasted calls). SaaS-standard:
  // serve cached, Refresh to update. Keyed by email + profile inputs; sessionStorage.
  const reportCacheKey = useCallback(() => {
    const profileSig = `${formData.naicsCode}|${formData.pscCode}|${selectedAgency}|${formData.businessType}`;
    return `mr:report:${email}:${profileSig}`;
  }, [email, formData.naicsCode, formData.pscCode, formData.businessType, selectedAgency]);

  // Sport-mode keyword → NAICS/PSC suggestion (defined here so getAuthHeaders
  // is in scope).
  const suggestSportCodes = useCallback(async () => {
    if (!sportKeyword.trim()) return;
    setSportSuggesting(true); setSportSuggestions(null);
    try {
      const res = await fetch('/api/suggest-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ description: sportKeyword.trim(), maxResults: 5 }),
      });
      const d = await res.json();
      setSportSuggestions({
        naics: (d.naicsSuggestions || []).map((s: { code: string; name: string }) => ({ code: s.code, name: s.name })),
        psc: (d.pscSuggestions || []).map((s: { code: string; name: string }) => ({ code: s.code, name: s.name })),
      });
    } catch { /* */ } finally { setSportSuggesting(false); }
  }, [sportKeyword, getAuthHeaders]);
  const track = useAppTracker(email);
  const { showToast } = useToast();

  const canAccessReport = useCallback((reportTier: 'free' | 'pro') => {
    if (reportTier === 'free') return true;
    return tier !== 'free';
  }, [tier]);

  const validateForm = useCallback((data: FormData = formData, agencyValue: string = selectedAgency): boolean => {
    setValidationError(null);

    const hasBusinessType = data.businessType && data.businessType.trim();

    const hasNaics = data.naicsCode && data.naicsCode.trim();
    const hasPsc = data.pscCode && data.pscCode.trim();
    const hasAgency = agencyValue && agencyValue.trim();

    if (!hasBusinessType && !hasNaics && !hasPsc && !hasAgency) {
      setValidationError('Your saved profile needs at least an industry, service code, or target agency.');
      return false;
    }

    return true;
  }, [formData, selectedAgency]);

  const loadMarketFocuses = useCallback(async () => {
    if (!email || tier === 'free') return;

    try {
      const res = await fetch(`/api/app/market-focus?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) setMarketFocuses(data.focuses || []);
    } catch (err) {
      console.error('Failed to load market focuses:', err);
    }
  }, [email, getAuthHeaders, tier]);

  const loadRecommendedOpportunities = useCallback(async () => {
    if (!email) return;

    setRecommendationsLoading(true);
    try {
      const res = await fetch(`/api/app/opportunities?email=${encodeURIComponent(email)}&limit=6`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        const seen = new Set<string>();
        const uniqueOpportunities = (data.opportunities || []).filter((opportunity: RecommendedOpportunity) => {
          const key = [
            String(opportunity.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
            String(opportunity.department || opportunity.subTier || '').toLowerCase().trim(),
          ].join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setRecommendedOpportunities(uniqueOpportunities);
      }
    } catch (err) {
      console.error('Failed to load recommended opportunities:', err);
    } finally {
      setRecommendationsLoading(false);
    }
  }, [email, getAuthHeaders]);

  const getCurrentFocusFilters = useCallback(() => ({
    businessType: formData.businessType,
    naicsCodes: formData.naicsCode.split(',').map((item) => item.trim()).filter(Boolean),
    pscCodes: formData.pscCode.split(',').map((item) => item.trim()).filter(Boolean),
    agencies: selectedAgency.split(',').map((item) => item.trim()).filter(Boolean),
    zipCode: formData.zipCode,
    companyName: formData.companyName,
    excludeDOD: formData.excludeDOD,
  }), [formData, selectedAgency]);

  const handleGenerateAll = useCallback(async (
    override?: { nextFormData?: FormData; nextSelectedAgency?: string },
    options?: { notifySuccess?: boolean },
  ) => {
    if (!email) return;
    if (generateInFlightRef.current) return;
    const activeFormData = override?.nextFormData || formData;
    const activeSelectedAgency = override?.nextSelectedAgency ?? selectedAgency;
    if (!validateForm(activeFormData, activeSelectedAgency)) return;

    generateInFlightRef.current = true;
    setIsGenerating(true);
    setError(null);

    try {
      const selectedAgencies = activeSelectedAgency
        .split(',')
        .map(agency => agency.trim())
        .filter(Boolean);
      const selectedAgencyData = (await lookupAgencyData(activeFormData, selectedAgencies))
        .filter((agency) => agencyDataAllowedForProfile(agency, activeFormData));
      const recommendedAgencyNames = selectedAgencyData.length === 0
        ? await fetchRecommendedAgencyNames(email, getAuthHeaders, activeFormData)
        : [];
      // Build the agency name list passed to generate-all.
      //
      // Cap was 10 — too small. The "Spending by Agency" chart, the
      // SAT mix chart, and the AgencyTable all want the full market
      // view. Bumped to 100 so we don't artificially truncate large
      // NAICS markets (DOD IT services has 60-80 distinct
      // contracting offices). Generate-all already caps per-report
      // work internally; the chart limits handle slicing for visuals.
      // Priority order for which agencies the reports cover:
      //   1. STARRED agencies (the user's explicit Market Map selection)
      //   2. typed "Target agency" field
      //   3. agencies resolved from the profile lookup
      //   4. recommended, then profile defaults
      // Starred wins so reports (pain points / OSBP / buyers / needs)
      // match exactly what the user selected.
      const rawReportAgencyNames = starredAgencies.length > 0
        ? starredAgencies.slice(0, 100)
        : selectedAgencies.length > 0 && selectedAgencyData.length > 0
        ? selectedAgencies
        : selectedAgencyData.length > 0
          ? uniqueStrings(selectedAgencyData.map((agency) => agency.parentAgency || agency.subAgency || agency.name)).slice(0, 100)
          : recommendedAgencyNames.length > 0
            ? recommendedAgencyNames
          : defaultBuyerAgenciesForProfile(activeFormData);
      const reportAgencyNames = filterAgenciesForProfile(rawReportAgencyNames, activeFormData);
      const finalReportAgencyNames = reportAgencyNames.length > 0
        ? reportAgencyNames
        : defaultBuyerAgenciesForProfile(activeFormData);

      const res = await fetch('/api/reports/generate-all', {
        method: 'POST',
        // Include MI auth headers so the endpoint passes the gate
        // when it does verifyMIAccess() server-side. Without this,
        // the request silently 401s and the Refresh button looks
        // like it "doesn't work" with no visible error.
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          inputs: {
            naicsCode: activeFormData.naicsCode,
            pscCode: activeFormData.pscCode,
            businessType: activeFormData.businessType || 'Small Business',
            veteranStatus: activeFormData.veteranStatus,
            zipCode: activeFormData.zipCode,
            companyName: activeFormData.companyName,
            excludeDOD: activeFormData.excludeDOD,
            goodsOrServices: 'services',
          },
          selectedAgencies: finalReportAgencyNames,
          selectedAgencyData,
          userEmail: email,
        }),
      });

      // Always parse — even on non-2xx the body usually carries the
      // real reason. Wrap in try/catch since some 5xx pages return
      // HTML instead of JSON.
      const data = await res.json().catch(() => ({
        success: false,
        error: `HTTP ${res.status} ${res.statusText} — server returned non-JSON`,
      }));

      // Log HTTP non-2xx separately so devtools shows the status even
      // when the response body is empty / malformed. The setError
      // banner picks up data.error which now carries the status.
      if (!res.ok) {
        console.error(`[generate-all] HTTP ${res.status}`, data);
      }

      if (data.success && data.report) {
        setReportData(data.report);
        setSportReportRan(true);
        // Cache for instant reload (Auto only — Sport is one-off). 24h TTL.
        if (researchMode === 'auto') {
          try { sessionStorage.setItem(reportCacheKey(), JSON.stringify({ report: data.report, ts: Date.now() })); } catch { /* quota */ }
        }
        loadRecommendedOpportunities();
        // Mark all free reports as generated, and pro reports if user has access
        const generated = new Set<string>();
        REPORTS.forEach(r => {
          if (canAccessReport(r.tier)) {
            generated.add(r.id);
          }
        });
        setGeneratedReports(generated);
        // Activation signal: a Market Research generate is one of the
        // highest-intent actions a free user takes. Feed it into the
        // Launch Command Center activation queues.
        track('report_generate', 'market_research', {
          status: 'success',
          naics: activeFormData.naicsCode,
          agencies: finalReportAgencyNames,
          tier,
        });
        if (options?.notifySuccess) {
          showToast({ message: 'Market map ready', variant: 'success' });
        }
      } else {
        // Show error with hint if available
        const errorMsg = data.error || 'Failed to generate reports';
        const hint = data.hint ? ` (${data.hint})` : '';
        setError(errorMsg + hint);
        track('report_generate', 'market_research', {
          status: 'failure',
          error: errorMsg,
        });
        showToast({ message: `${errorMsg}${hint}`, variant: 'error' });
      }
    } catch (err) {
      console.error('Failed to generate reports:', err);
      setError('Failed to connect to server. Please check your connection and try again.');
      track('report_generate', 'market_research', {
        status: 'failure',
        error: err instanceof Error ? err.message : 'network error',
      });
      showToast({
        message: 'Network error — could not generate report',
        variant: 'error',
      });
    } finally {
      generateInFlightRef.current = false;
      setIsGenerating(false);
    }
  }, [canAccessReport, email, formData, getAuthHeaders, loadRecommendedOpportunities, selectedAgency, starredAgencies, validateForm, showToast, tier, track]);

  // Smart Build for Sport (Eric: typed "staffing", hit Build → "naicsCode
  // required"). If there's a keyword but no codes yet, resolve the keyword to
  // real USASpending codes and build with them — no dead-end error.
  const handleSportBuild = useCallback(async (options?: { notifySuccess?: boolean }) => {
    setSportBuildActive(true);
    const hasCodes = formData.naicsCode.trim() || formData.pscCode.trim();
    // If the user pinned codes, build with those. Otherwise build from the
    // KEYWORD — we leave naicsCode EMPTY so the target-market-research effect
    // (#59) sends the keyword and the backend auto-derives the FULL 90%-coverage
    // set (not the top-3), and returns the coverage lesson banner. We still fetch
    // the suggestion chips for display so the user sees the codes Mindy is using.
    if (hasCodes || !sportKeyword.trim()) { handleGenerateAll(undefined, options); return; }
    setSportSuggesting(true);
    try {
      const res = await fetch('/api/suggest-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ description: sportKeyword.trim(), maxResults: 8 }),
      });
      const d = await res.json();
      if (!(d.naicsSuggestions || []).length && !(d.pscSuggestions || []).length) {
        showToast({ message: 'No federal codes found for that — try different words.', variant: 'error' });
        setSportBuildActive(false);
        return;
      }
      const naicsList = (d.naicsSuggestions || []).map((s: { code: string; name: string }) => ({ code: s.code, name: s.name }));
      const pscList = (d.pscSuggestions || []).map((s: { code: string; name: string }) => ({ code: s.code, name: s.name }));
      setSportSuggestions({ naics: naicsList, psc: pscList });
      // Apply the derived codes to formData so the strategic-reports build
      // (/api/reports/generate-all) has codes — it HARD-requires naicsCode|pscCode
      // and threw "Either inputs.naicsCode or inputs.pscCode is required" when we
      // left them empty. The coverage LESSON banner is still keyword-driven
      // (target-market-research computes total market / 90%-coverage set from the
      // keyword regardless of the codes), so filling them no longer narrows it.
      // Replace any prefilled profile NAICS (e.g. 236,237,238) with the keyword's
      // real codes so reports + agencies match what the user actually searched.
      const derivedNaics = naicsList.map((n: { code: string }) => n.code).join(', ');
      const derivedPsc = pscList.map((p: { code: string }) => p.code).join(', ');
      const nextFormData = {
        ...formData,
        naicsCode: derivedNaics,
        pscCode: derivedNaics ? '' : derivedPsc,
        businessType: formData.businessType || 'Small Business',
      };
      setFormData(nextFormData);
      handleGenerateAll({ nextFormData }, options);
      // Persist the user's own words into their profile keywords (additive, never
      // clobbers). Their language is the strongest search signal — used to be
      // discarded after a single Sport report, leaving keyword-empty profiles.
      if (email) {
        fetch('/api/app/keywords/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ email, keywords: [sportKeyword.trim()] }),
        }).catch(() => { /* non-fatal */ });
      }
    } catch {
      showToast({ message: 'Could not look up codes — try the Suggest codes button.', variant: 'error' });
      setSportBuildActive(false);
    } finally { setSportSuggesting(false); }
  }, [sportKeyword, formData, getAuthHeaders, handleGenerateAll, showToast, email]);

  // Save the researched market to the user's alert profile — REPLACES their
  // current NAICS with the coverage codes + adds the keyword. This is how "I
  // researched demolition" actually starts matching their daily alerts.
  const saveResearchToProfile = useCallback(async (
    naics: Array<{ code: string }>,
    psc: Array<{ code: string }>,
    keyword: string,
  ) => {
    if (!email) { showToast({ message: 'Sign in to save to your profile.', variant: 'error' }); return; }
    setSavingProfile(true);
    try {
      const naicsCodes = naics.map((n) => n.code);
      const pscCodes = psc.map((p) => p.code);
      const keywords = keyword.trim() ? [keyword.trim()] : [];
      const res = await fetch('/api/app/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          email,
          naicsCodes,        // REPLACES the profile's NAICS (the route sets, not appends)
          pscCodes,          // PSC = what was bought (most precise signal); OR'd into alert matching
          keywords,
          businessType: formData.businessType || 'Small Business',
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && !data.error) {
        setProfileSaved(true);
        showToast({ message: '✅ Saved to your profile — your alerts now track this market.', variant: 'success' });
      } else {
        showToast({ message: data?.error || 'Could not save to your profile.', variant: 'error' });
      }
    } catch {
      showToast({ message: 'Could not save to your profile — try again.', variant: 'error' });
    } finally { setSavingProfile(false); }
  }, [email, getAuthHeaders, formData.businessType, showToast]);

  // Deep-link: ?keyword=drones (from the global lookup bar) → open Sport mode,
  // pre-fill the keyword, and auto-build the market map. Runs once.
  useEffect(() => {
    if (deepLinkKeywordRef.current) return;
    const kw = searchParams.get('keyword');
    if (!kw || !kw.trim()) return;
    deepLinkKeywordRef.current = true;
    setResearchMode('sport');
    setSportKeyword(kw.trim());
  }, [searchParams]);

  // Once Sport mode + the deep-link keyword are set, build automatically (once).
  useEffect(() => {
    if (!deepLinkKeywordRef.current) return;
    if (sportAutoBuildRef.current || sportReportRan) return;
    if (researchMode === 'sport' && sportKeyword) {
      sportAutoBuildRef.current = true;
      void handleSportBuild();
    }
    // handleSportBuild intentionally omitted to avoid re-firing on its identity change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchMode, sportKeyword, sportReportRan]);

  const applySavedProfile = useCallback((profile: SavedResearchProfile) => {
    setFormData((current) => ({
      ...current,
      businessType: profile.businessType || current.businessType || 'Small Business',
      naicsCode: profile.naicsCodes.length > 0 ? profile.naicsCodes.slice(0, 8).join(', ') : current.naicsCode,
      pscCode: profile.pscCodes[0] || current.pscCode,
      zipCode: profile.zipCode || current.zipCode,
      locationStates: profile.locationStates?.length ? profile.locationStates : current.locationStates,
      companyName: profile.companyName || current.companyName,
    }));

    if (profile.agencies.length > 0) {
      setSelectedAgency(profile.agencies.slice(0, 3).join(', '));
    }

    setProfileApplied(true);
    setActiveFocusId('saved-profile');
    setValidationError(null);
  }, []);

  const applyMarketFocus = useCallback((focus: MarketFocus) => {
    const filters = focus.filters || {};
    const nextFormData: FormData = {
      businessType: (filters.businessType as BusinessType) || 'Small Business',
      naicsCode: (filters.naicsCodes || []).join(', '),
      pscCode: (filters.pscCodes || []).join(', '),
      zipCode: filters.zipCode || '',
      locationStates: Array.isArray(filters.locationStates) ? filters.locationStates : [],
      veteranStatus: 'Not Applicable',
      companyName: filters.companyName || '',
      excludeDOD: Boolean(filters.excludeDOD),
    };
    const nextSelectedAgency = (filters.agencies || []).join(', ');

    setFormData(nextFormData);
    setSelectedAgency(nextSelectedAgency);
    setActiveFocusId(focus.id);
    setProfileApplied(false);
    setShowAdvancedProfile(false);
    setValidationError(null);
    handleGenerateAll({ nextFormData, nextSelectedAgency });
  }, [handleGenerateAll]);

  const handleSaveMarketFocus = useCallback(async () => {
    if (!email || tier === 'free') return;
    const name = newFocusName.trim();
    if (!name) {
      setValidationError('Name this market focus before saving it.');
      return;
    }

    setFocusSaving(true);
    setValidationError(null);

    try {
      const res = await fetch('/api/app/market-focus', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          email,
          name,
          filters: getCurrentFocusFilters(),
        }),
      });
      const data = await res.json();

      if (!data.success) {
        setValidationError(data.error || 'Could not save market focus.');
        return;
      }

      setMarketFocuses((current) => [data.focus, ...current.filter((focus) => focus.id !== data.focus.id)]);
      setActiveFocusId(data.focus.id);
      setNewFocusName('');
      setShowSaveFocus(false);
    } catch (err) {
      console.error('Failed to save market focus:', err);
      setValidationError('Could not save market focus.');
    } finally {
      setFocusSaving(false);
    }
  }, [email, getAuthHeaders, getCurrentFocusFilters, newFocusName, tier]);

  const handleDeleteMarketFocus = useCallback(async (focusId: string) => {
    if (!email) return;

    try {
      const res = await fetch('/api/app/market-focus', {
        method: 'DELETE',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email, id: focusId }),
      });
      const data = await res.json();
      if (!data.success) {
        setValidationError(data.error || 'Could not delete market focus.');
        return;
      }

      setMarketFocuses((current) => current.filter((focus) => focus.id !== focusId));
      if (activeFocusId === focusId) setActiveFocusId('saved-profile');
    } catch (err) {
      console.error('Failed to delete market focus:', err);
      setValidationError('Could not delete market focus.');
    }
  }, [activeFocusId, email, getAuthHeaders]);

  useEffect(() => {
    if (!email) return;

    let cancelled = false;
    setProfileLoading(true);

    Promise.all([
      fetch(`/api/app/workspace?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      }).then((res) => res.ok ? res.json() : null).catch(() => null),
      // Send the MI 2FA token here too — otherwise OAuth users on /app
      // get a 401 (no ma_access_email cookie) and the saved profile
      // loads as empty.
      fetch(`/api/alerts/preferences?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      })
        .then((res) => res.ok ? res.json() : null)
        .catch(() => null),
    ])
      .then(([workspace, prefs]) => {
        if (cancelled) return;

        const workspaceProfile = workspace?.success ? buildSavedResearchProfile(workspace as WorkspaceData) : null;
        const prefsData = (prefs?.data || {}) as AlertPreferencesData;
        const naicsCodes = uniqueStrings([
          ...(workspaceProfile?.naicsCodes || []),
          ...(prefsData.naicsCodes || []),
        ]).map(extractNaicsCode).filter(Boolean);
        const pscCodes = uniqueStrings([
          ...(workspaceProfile?.pscCodes || []),
          ...(prefsData.pscCodes || []),
        ]);
        const agencies = uniqueStrings([
          ...(workspaceProfile?.agencies || []),
          ...(prefsData.targetAgencies || []),
          ...(prefsData.agencies || []),
        ]);
        const setAsides = uniqueStrings([
          ...(workspaceProfile?.setAsides || []),
          ...(prefsData.setAsides || []),
        ]);
        const locationStates = uniqueStrings([
          ...(workspaceProfile?.locationStates || []),
          ...(prefsData.locationStates || []),
          ...(prefsData.locationState ? [prefsData.locationState] : []),
        ]);
        const keywords = uniqueStrings([
          ...(workspaceProfile?.keywords || []),
        ]);

        const profile: SavedResearchProfile | null = (
          workspaceProfile || naicsCodes.length > 0 || pscCodes.length > 0 || agencies.length > 0 || prefsData.businessType || prefsData.companyName
        ) ? {
          businessType: workspaceProfile?.businessType || normalizeBusinessType(prefsData.businessType, prefsData.setAsides || []),
          naicsCodes,
          pscCodes,
          agencies,
          keywords,
          setAsides,
          locationStates,
          zipCode: workspaceProfile?.zipCode || '',
          companyName: workspaceProfile?.companyName || prefsData.companyName || '',
          source: workspaceProfile?.source || 'alert settings',
        } : null;

        setSavedProfile(profile);

        // Don't clobber Sport-mode manual inputs with the saved profile.
        if (profile && researchMode === 'auto') {
          applySavedProfile(profile);
        }
      })
      .catch((err) => {
        console.error('Failed to load saved MI profile for market research:', err);
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [email, applySavedProfile, getAuthHeaders, researchMode]);

  useEffect(() => {
    loadMarketFocuses();
  }, [loadMarketFocuses]);

  useEffect(() => {
    loadRecommendedOpportunities();
  }, [loadRecommendedOpportunities]);

  // Parent-level TMR fetch — runs independently of reportData so
  // the Market Map charts can show the full 96-agency view BEFORE
  // (and during) the slower generate-all reports flow. Mirrors the
  // fetch AgencyTable does internally; the table can read from this
  // state via props in a future refactor, or keep its own copy for
  // now (the TMR endpoint's 24h cache makes the duplicate call
  // free). See `tmrRows` declaration comment for the full
  // motivation.
  //
  // Skipped when: no email, no NAICS yet (profile incomplete).
  useEffect(() => {
    // Fire when we have EITHER explicit codes OR a Sport keyword (#59 — keyword
    // lets the backend auto-derive the full 90%-coverage NAICS set instead of the
    // top-3, so the user doesn't silently miss 72% of their market). Only use the
    // keyword once a Sport build has started (parallel with generate-all) — not
    // only after sportReportRan (that waited ~60s and left charts on stale data).
    const sportKw = (researchMode === 'sport' && (sportReportRan || sportBuildActive))
      ? sportKeyword.trim()
      : '';
    // Only fire when the NAICS field holds at least one PLAUSIBLE code (2-6 digits)
    // or we have a Sport keyword. Guards against the mid-edit window: when a user
    // clears+retypes a NAICS, the field transiently holds a partial fragment (e.g.
    // "5", "99x") — firing on that gets invalid_naics back → a spurious "No matching
    // agencies" flash. PSC-only or agency-only research still flows via handleGenerateAll.
    const hasPlausibleNaics = splitCodeList(formData.naicsCode).some((c) => /^\d{2,6}$/.test(c));
    if (!email || (!hasPlausibleNaics && !sportKw)) return;
    // Debounce so a fast edit (clear → retype) doesn't fire one fetch per keystroke.
    let cancelled = false;
    const debounce = setTimeout(() => {
    fetch('/api/app/target-market-research', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        email,
        // Pass the keyword whenever the user researched by keyword (#59) — the
        // backend uses explicit codes for the search but still computes the
        // coverage LESSON (total market, NAICS/PSC count, top code %) from the
        // keyword so the banner renders. Codes take precedence for the search.
        keyword: sportKw || undefined,
        profileKeywords: savedProfile?.keywords?.length ? savedProfile.keywords : undefined,
        naicsCode: formData.naicsCode,
        pscCode: formData.pscCode,
        businessType: formData.businessType,
        veteranStatus: formData.veteranStatus,
        zipCode: formData.zipCode,
        locationStates: formData.locationStates || [],   // States filter → scopes spend
        excludeDOD: formData.excludeDOD,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.success) {
          setTmrRows((data.agencies || []) as AgencyTableRow[]);
          setMarketCoverage(data.keyword_coverage || null);   // #59 — the coverage lesson
          setTmrRelevantSpending(typeof data.relevant_spending === 'number' ? data.relevant_spending : null);
          setSpendWindowLabel(data.spend_window_label || null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[MarketResearch parent] TMR fetch failed:', err);
      });
    }, 400);
    return () => { cancelled = true; clearTimeout(debounce); };
  }, [
    email,
    formData.naicsCode,
    formData.pscCode,
    formData.businessType,
    formData.veteranStatus,
    formData.zipCode,
    formData.locationStates.join(','),
    formData.excludeDOD,
    researchMode,
    sportKeyword,
    sportReportRan,
    sportBuildActive,
    savedProfile?.keywords,
  ]);

  // SBA Goaling bulk fetch — fires after tmrRows arrives. Looks up
  // small-business share per parent agency. One network call covers
  // all 96 agencies. Feeds the donut, the table column, and the
  // Mindy Says narrative. Failures are silent: charts fall back to
  // legacy SAT-based math.
  useEffect(() => {
    if (tmrRows.length === 0) return;

    const uniqueAgencies = Array.from(new Set(
      tmrRows
        .flatMap((r) => [r.parentAgency, r.subAgency, r.name])
        .filter(Boolean)
    ));
    if (uniqueAgencies.length === 0) return;

    let cancelled = false;
    setParentSbShareLoading(true);
    fetch('/api/sba-goaling/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agencies: uniqueAgencies }),
    })
      .then((r) => r.json())
      .then((sbaData) => {
        if (cancelled || !sbaData?.success) return;
        const map: Record<string, number> = {};
        for (const [name, info] of Object.entries(sbaData.matches || {})) {
          const share = (info as { small_business_share: number }).small_business_share;
          if (typeof share === 'number') map[name] = share;
        }
        setParentSbShareMap(map);
      })
      .catch((sbaErr) => {
        if (cancelled) return;
        console.warn('[MarketResearch parent] SBA bulk fetch failed (non-fatal):', sbaErr);
      })
      .finally(() => {
        if (!cancelled) setParentSbShareLoading(false);
      });
    return () => { cancelled = true; };
  }, [tmrRows]);

  useEffect(() => {
    // NEVER auto-generate in Sport mode (Eric: Sport is user-driven, must stay
    // blank until they Build). Auto-generate is for Auto mode's zero-click report.
    if (researchMode === 'sport') return;
    if (autoGeneratedRef.current || profileLoading || !profileApplied || !email) return;
    // Auto-generate if user has NAICS, PSC, or target agencies - businessType is optional
    const hasInputs = Boolean(
      formData.naicsCode.trim() ||
      formData.pscCode.trim() ||
      selectedAgency.trim()
    );
    if (!hasInputs) return;

    autoGeneratedRef.current = true;

    // Serve the cached report instantly if we have a fresh one for this profile
    // (Eric: don't re-run the expensive build on every page visit). Only build
    // if there's no cache or it's stale (>24h).
    try {
      const cached = sessionStorage.getItem(reportCacheKey());
      if (cached) {
        const { report, ts } = JSON.parse(cached);
        if (report && Date.now() - ts < 24 * 60 * 60 * 1000) {
          setReportData(report);
          setSportReportRan(true);
          loadRecommendedOpportunities();
          return; // cache hit — no rebuild
        }
      }
    } catch { /* fall through to build */ }

    handleGenerateAll();
  }, [email, formData.businessType, formData.naicsCode, formData.pscCode, handleGenerateAll, profileApplied, profileLoading, selectedAgency, researchMode, reportCacheKey, loadRecommendedOpportunities]);

  const handleReportClick = (report: Report) => {
    if (!canAccessReport(report.tier)) return;

    if (!generatedReports.has(report.id)) {
      // Generate reports first
      handleGenerateAll();
    }
    setActiveReportId(report.id);
  };

  const handleLensClick = (lens: typeof RESEARCH_LENSES[number]) => {
    setActiveLens(lens.id);
    track('tool_use', 'market_research', { action: 'lens_click', lens: lens.id });
    const lensReports: readonly string[] = lens.reports;
    const firstReport = REPORTS.find(report => lensReports.includes(report.id) && canAccessReport(report.tier));

    if (!firstReport) {
      setActiveReportId(null);
      return;
    }

    if (!generatedReports.has(firstReport.id)) {
      handleGenerateAll();
    }
    setActiveReportId(firstReport.id);
  };

  const getReportContent = (reportId: string): ReportData[keyof ReportData] | null => {
    if (!reportData) return null;
    const report = REPORTS.find(r => r.id === reportId);
    if (!report) return null;
    return reportData[report.reportKey];
  };

  const formatCurrency = formatMindyCurrency;

  // === SAVE ACTIONS ===
  const [savingContact, setSavingContact] = useState<string | null>(null);
  const [savedContacts, setSavedContacts] = useState<Set<string>>(new Set());
  const [savingOpportunity, setSavingOpportunity] = useState<string | null>(null);
  const [savedOpportunities, setSavedOpportunities] = useState<Set<string>>(new Set());

  const handleSaveBuyer = useCallback(async (buyer: {
    contractingOffice: string;
    parentAgency?: string;
    subAgency?: string;
    osbp?: { director?: string; email?: string; phone?: string } | null;
  }) => {
    if (!email || tier === 'free') return;
    const contactKey = `buyer:${buyer.contractingOffice}`;
    if (savedContacts.has(contactKey)) return;

    setSavingContact(contactKey);
    try {
      const res = await fetch('/api/app/relationships', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_email: email,
          contact_type: 'government_buyer',
          full_name: buyer.osbp?.director || buyer.contractingOffice,
          title: buyer.osbp?.director ? 'Small Business Liaison' : 'Contracting Office',
          email: buyer.osbp?.email || '',
          phone: buyer.osbp?.phone || '',
          organization: buyer.contractingOffice,
          agency: buyer.parentAgency || buyer.subAgency || '',
          office: buyer.contractingOffice,
          source: 'market_research',
          source_record_id: `market-research:${buyer.contractingOffice}`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedContacts((prev) => new Set(prev).add(contactKey));
      }
    } catch (err) {
      console.error('Failed to save buyer:', err);
    } finally {
      setSavingContact(null);
    }
  }, [email, getAuthHeaders, savedContacts, tier]);

  const handleSavePartner = useCallback(async (partner: {
    name: string;
    reason?: string;
    email?: string;
    phone?: string;
    sbloName?: string;
    certifications?: string[];
    naicsCategories?: string[];
  }) => {
    if (!email || tier === 'free') return;
    const contactKey = `partner:${partner.name}`;
    if (savedContacts.has(contactKey)) return;

    setSavingContact(contactKey);
    try {
      const res = await fetch('/api/app/relationships', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_email: email,
          contact_type: 'prime',
          full_name: partner.sbloName || partner.name,
          title: partner.sbloName ? 'Small Business Liaison' : 'Teaming Partner',
          email: partner.email || '',
          phone: partner.phone || '',
          organization: partner.name,
          notes: partner.reason || '',
          source: 'market_research',
          source_record_id: `market-research:${partner.name}`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedContacts((prev) => new Set(prev).add(contactKey));
      }
    } catch (err) {
      console.error('Failed to save partner:', err);
    } finally {
      setSavingContact(null);
    }
  }, [email, getAuthHeaders, savedContacts, tier]);

  const handleTrackOpportunity = useCallback(async (forecast: {
    agency: string;
    description?: string;
    estimatedValue?: string;
    solicitationDate?: string;
    naicsCode?: string;
  }) => {
    if (!email || tier === 'free') return;
    const oppKey = `forecast:${forecast.agency}:${forecast.description?.slice(0, 50)}`;
    if (savedOpportunities.has(oppKey)) return;

    setSavingOpportunity(oppKey);
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_email: email,
          title: forecast.description?.slice(0, 100) || `${forecast.agency} Forecast`,
          agency: forecast.agency,
          stage: 'tracking',
          value_estimate: forecast.estimatedValue,
          naics_code: forecast.naicsCode,
          source: 'market_research_forecast',
          notes: `Forecasted solicitation: ${forecast.solicitationDate || 'TBD'}`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedOpportunities((prev) => new Set(prev).add(oppKey));
      }
    } catch (err) {
      console.error('Failed to track opportunity:', err);
    } finally {
      setSavingOpportunity(null);
    }
  }, [email, getAuthHeaders, savedOpportunities, tier]);

  const handleNavigateToRelationships = useCallback(() => {
    if (onNavigate) {
      onNavigate('relationships', { tab: 'network' });
    }
  }, [onNavigate]);

  const handleNavigateToPipeline = useCallback(() => {
    if (onNavigate) {
      onNavigate('pipeline');
    }
  }, [onNavigate]);

  const handleRecommendedFeedback = useCallback(async (opportunity: RecommendedOpportunity, feedbackType: FeedbackType) => {
    if (!email) return;

    setSavingFeedback((current) => new Set(current).add(opportunity.id));
    try {
      const res = await fetch('/api/mindy/opportunity-feedback', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          email,
          opportunityId: opportunity.id,
          feedbackType,
          title: opportunity.title,
          agency: opportunity.department || opportunity.subTier || opportunity.office || '',
          url: opportunity.url || '',
          source: 'market_research',
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setFeedbackByOpportunity((current) => ({ ...current, [opportunity.id]: feedbackType }));
        loadRecommendedOpportunities();
      }
    } catch (err) {
      console.error('Failed to save opportunity feedback:', err);
    } finally {
      setSavingFeedback((current) => {
        const next = new Set(current);
        next.delete(opportunity.id);
        return next;
      });
    }
  }, [email, getAuthHeaders, loadRecommendedOpportunities]);

  const buyers = reportData?.governmentBuyers?.agencies || [];
  const buyerSummary = reportData?.governmentBuyers?.summary;

  // chartBuyers — prefer the full TMR row set when it's loaded; fall
  // back to the legacy 7-row governmentBuyers ONLY in Auto mode (Sport
  // keyword searches must not show generate-all buyers — wrong market).
  const sportKeywordActive = researchMode === 'sport' && !!(sportReportRan || sportBuildActive) && !!sportKeyword.trim();
  const chartBuyers: BuyerLike[] = tmrRows.length > 0
    ? rollupChartBuyers(tmrRows)
    : sportKeywordActive ? [] : buyers;

  // Prefer the AUTHORITATIVE market total from spending_by_category (department
  // level) — it reconciles with the table + FPDS leaderboards. Summing the sampled
  // award rows (the old behavior) double-counts and overshoots, which is why the
  // "$97.2B" card didn't match "$1.5B" elsewhere. Fall back to the row sum only
  // when the authoritative figure isn't available (e.g. Sport keyword pre-TMR).
  const chartTotalSpending = (tmrRelevantSpending && tmrRelevantSpending > 0)
    ? tmrRelevantSpending
    : chartBuyers.length > 0
      ? chartBuyers.reduce((sum, row) => sum + (row.spending || 0), 0)
      : sportKeywordActive ? 0 : (buyerSummary?.totalSpending || 0);

  // chartSatTotal — repurposed May 23, 2026 to represent SMALL
  // BUSINESS spend (not SAT-threshold spend). The donut's "satTotal"
  // parameter is now misnamed in its internal API but the math is
  // identical: numerator over total. The relabeling happens at the
  // donut copy layer (subtitle + footer).
  //
  // Math: for each row, multiply the agency's spend in this NAICS
  // by the parent agency's overall small-business share from the
  // SBA Goaling Report. Sum across rows. That's the small-business
  // dollar volume in this NAICS market.
  //
  // Falls back to legacy SAT spend (always 0 for NAICS without SAT
  // data) when the SBA bulk fetch hasn't loaded yet.
  const chartSatTotal = tmrRows.length > 0 && Object.keys(parentSbShareMap).length > 0
    ? tmrRows.reduce((sum, row) => {
        const sbShare =
          parentSbShareMap[row.parentAgency] ??
          parentSbShareMap[row.subAgency] ??
          parentSbShareMap[row.name] ??
          0;
        return sum + (row.setAsideSpending || 0) * sbShare;
      }, 0)
    : tmrRows.length > 0
      ? tmrRows.reduce((sum, row) => sum + (row.satSpending || 0), 0)
      : 0;
  const painSummary = reportData?.agencyPainPoints?.summary;
  const primeSummary = reportData?.primeContractor?.summary;
  const vehicleSummary = reportData?.idvContracts?.summary;
  const forecastSummary = reportData?.forecastList?.summary;
  const recommendedReports: readonly string[] = RESEARCH_LENSES.find(lens => lens.id === activeLens)?.reports || [];
  const readyReports = REPORTS.filter(report => recommendedReports.includes(report.id) && canAccessReport(report.tier));

  return (
    <div className="p-6 space-y-6">
      {/* Header: title + actions on top, full filter strip below (matches Source Feed) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Market Research</h1>
          {/* Moving indicator while the slow agency fetch finishes after the
              leaderboards already rendered — signals "more is still loading". */}
          {agencyLoading && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2.5} />
              Loading agency data…
            </span>
          )}
          {/* Auto / Sport mode toggle — Mindy colors (purple/emerald). */}
          <div className="inline-flex rounded-lg bg-slate-800/60 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setResearchMode('auto');
                setSportBuildActive(false);
                // Restore the saved profile into the inputs.
                if (savedProfile) applySavedProfile(savedProfile);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${researchMode === 'auto' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
              title="Use your saved profile"
            >
              <Zap className="w-3.5 h-3.5" strokeWidth={2} /> Auto
            </button>
            <button
              type="button"
              onClick={() => {
                setResearchMode('sport');
                // Fully on-demand (Eric): blank the inputs AND clear the saved-
                // profile report so nothing shows until the user runs their own.
                // Default set-aside to Small Business (Eric) — most users are SBs
                // exploring lanes; they can change it.
                setFormData({ businessType: 'Small Business', naicsCode: '', pscCode: '', zipCode: '', locationStates: [], veteranStatus: 'Not Applicable', companyName: '', excludeDOD: false });
                setSelectedAgency('');
                setReportData(null);
                setActiveReportId(null);
                setSportReportRan(false);
                sportAutoBuildRef.current = false;
                setSportBuildActive(false);
                setSportKeyword('');
                setSportSuggestions(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${researchMode === 'sport' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
              title="Research any industry — manual inputs, doesn't change your saved settings"
            >
              <Gauge className="w-3.5 h-3.5" strokeWidth={2} /> Sport
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Market Focus Pills (Pro only, inline) */}
          {tier !== 'free' && marketFocuses.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {marketFocuses.slice(0, 3).map((focus) => (
                <button
                  key={focus.id}
                  type="button"
                  onClick={() => applyMarketFocus(focus)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    activeFocusId === focus.id
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {focus.name}
                </button>
              ))}
            </div>
          )}
          {/* View mode toggle — Map (visual flagship) vs Reports
              (legacy raw data). Only meaningful once reports have
              been generated. */}
          {reportData && (
            <div className="inline-flex rounded-lg bg-slate-800/60 p-0.5 mr-2 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('map')}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  viewMode === 'map'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Market Map
              </button>
              <button
                type="button"
                onClick={() => setViewMode('reports')}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  viewMode === 'reports'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Reports →
              </button>
            </div>
          )}
          <button
            onClick={() => {
              if (researchMode === 'sport') { handleSportBuild({ notifySuccess: true }); }
              else { handleGenerateAll(undefined, { notifySuccess: true }); loadRecommendedOpportunities(); }
            }}
            disabled={isGenerating || profileLoading || sportSuggesting}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {isGenerating || sportSuggesting ? 'Building...' : reportData ? 'Refresh' : 'Build Market Map'}
          </button>
        </div>
      </div>

      {/* SPORT MODE — manual inputs to research ANY industry (Eric: old-MA flow,
          Mindy colors). Doesn't touch saved settings; runs a one-off report. */}
      {researchMode === 'sport' && (
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/[0.04] p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-1.5"><Gauge className="w-4 h-4" strokeWidth={2} /> Research any industry</h3>
              <p className="text-xs text-slate-400 mt-0.5">Explore a new lane, cross industries, or run a report for someone else. This won&apos;t change your saved profile.</p>
            </div>
          </div>

          {/* Keyword → code lookup (Eric: "if I want medical supplies, which
              codes?"). Type plain English, get NAICS/PSC to click into the
              fields. No need to memorize codes. */}
          <div className="mb-3 rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
            <label className="text-xs text-slate-300 font-medium">Not sure of the codes? Describe what you want to research</label>
            <div className="flex gap-2 mt-1.5">
              <input
                value={sportKeyword}
                onChange={(e) => setSportKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') suggestSportCodes(); }}
                placeholder="e.g. medical supplies, drone services, IT cybersecurity, janitorial…"
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm outline-none focus:border-purple-500"
              />
              <button
                type="button"
                onClick={suggestSportCodes}
                disabled={sportSuggesting || !sportKeyword.trim()}
                className="px-4 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg"
              >
                {sportSuggesting ? 'Finding…' : 'Suggest codes'}
              </button>
            </div>
            {sportKeyword.trim() && getProductVendorHint(sportKeyword) && (
              <p className="mt-2 text-[11px] text-amber-200/90 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2">
                <b className="text-amber-100">Company lookup?</b> &ldquo;{sportKeyword.trim()}&rdquo; is often a product name — use the{' '}
                <b>search bar at the top</b> to find{' '}
                {getProductVendorHint(sportKeyword)!.label}. This field researches the <em>federal market</em> for that word in award titles.
              </p>
            )}
            {sportSuggestions && (
              <div className="mt-2.5 space-y-2">
                {sportSuggestions.naics.length > 0 && (
                  <div>
                    <span className="text-[11px] text-slate-500 uppercase tracking-wider">NAICS — click to add</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {sportSuggestions.naics.map(s => (
                        <button key={s.code} type="button"
                          onClick={() => setFormData(f => ({ ...f, naicsCode: f.naicsCode ? `${f.naicsCode}, ${s.code}` : s.code }))}
                          className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20"
                          title={s.name}>
                          {s.code} · {s.name.slice(0, 28)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {sportSuggestions.psc.length > 0 && (
                  <div>
                    <span className="text-[11px] text-slate-500 uppercase tracking-wider">PSC — click to add</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {sportSuggestions.psc.map(s => (
                        <button key={s.code} type="button"
                          onClick={() => setFormData(f => ({ ...f, pscCode: f.pscCode ? `${f.pscCode}, ${s.code}` : s.code }))}
                          className="rounded border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs text-purple-300 hover:bg-purple-500/20"
                          title={s.name}>
                          {s.code} · {s.name.slice(0, 28)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* One click: apply the suggested codes + default Small Business.
                    SHOW the codes it'll apply so the user can verify (Eric: "I
                    can't see the codes it's suggesting — how do I check?"). */}
                {(() => {
                  const naicsToApply = sportSuggestions.naics.slice(0, 3);
                  const pscToApply = sportSuggestions.psc.slice(0, 2);
                  return (
                    <div className="mt-1 rounded-lg border border-emerald-600/30 bg-emerald-500/[0.06] p-2.5">
                      <div className="text-[11px] text-slate-400 mb-1.5">These codes will be applied — verify they fit:</div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {naicsToApply.map(s => (
                          <span key={s.code} className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300" title={s.name}>
                            {s.code} · {s.name.slice(0, 24)}
                          </span>
                        ))}
                        {pscToApply.map(s => (
                          <span key={s.code} className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300" title={s.name}>
                            PSC {s.code}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormData(f => ({
                          ...f,
                          naicsCode: naicsToApply.map(s => s.code).join(', '),
                          pscCode: pscToApply.map(s => s.code).join(', '),
                          businessType: f.businessType || 'Small Business',
                        }))}
                        className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-semibold text-white"
                      >
                        ✓ Use these codes (Small Business) — then Build Market Map
                      </button>

                      {/* SAVE TO PROFILE — persist the full coverage set + keyword to
                          the user's alert profile (replaces current codes). The fix
                          for "I researched my market but my alerts never changed." */}
                      {profileSaved ? (
                        <div className="mt-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 text-center">
                          ✅ Saved — your daily alerts now track &ldquo;{sportKeyword || 'this market'}&rdquo;
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={savingProfile}
                          onClick={() => saveResearchToProfile(sportSuggestions.naics, sportSuggestions.psc, sportKeyword)}
                          className="mt-2 w-full rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs font-semibold text-purple-200 hover:bg-purple-500/20 disabled:opacity-60"
                          title="Replaces your current NAICS with this market's codes and adds the keyword to your alerts"
                        >
                          {savingProfile ? 'Saving…' : '★ Save this market to my profile (updates my alerts)'}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Coverage lesson lives with code suggestions in Sport — not below the
              manual filter row where keywords felt like a divider (Eric). */}
          {marketCoverage?.total_market ? (
            <div className="mb-3">
              <MarketCoverageBanner coverage={marketCoverage} email={email} />
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-xs text-slate-400">
              NAICS code(s)
              <input
                value={formData.naicsCode}
                onChange={(e) => setFormData({ ...formData, naicsCode: e.target.value })}
                placeholder="e.g. 236220, 541512"
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm outline-none focus:border-purple-500"
              />
            </label>
            <label className="text-xs text-slate-400">
              PSC code (optional)
              <input
                value={formData.pscCode}
                onChange={(e) => setFormData({ ...formData, pscCode: e.target.value })}
                placeholder="e.g. D310, 7030"
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm outline-none focus:border-purple-500"
              />
            </label>
            <label className="text-xs text-slate-400">
              Set-aside / business type
              <select
                value={formData.businessType}
                onChange={(e) => setFormData({ ...formData, businessType: e.target.value as BusinessType })}
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm outline-none focus:border-purple-500"
              >
                <option value="Small Business">Small Business (default)</option>
                <option value="">Any business type</option>
                <option value="8(a)">8(a)</option>
                <option value="WOSB">WOSB / EDWOSB</option>
                <option value="SDVOSB">SDVOSB / VOSB</option>
                <option value="HUBZone">HUBZone</option>
                <option value="Full and Open">Full & Open</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Zip (optional)
              <input
                value={formData.zipCode}
                onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                placeholder="e.g. 20001"
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm outline-none focus:border-purple-500"
              />
            </label>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Enter a NAICS/PSC, or just type what you research above and hit <span className="text-purple-300">Build Market Map</span> — Mindy finds the codes for you.</p>
        </div>
      )}

      {/* Filter context strip — mirrors Source Feed so free users see their
          scope. Hidden in Sport mode (Eric: fully on-demand, no saved profile). */}
      {researchMode === 'sport' ? null : profileLoading ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-500">
          Loading profile...
        </div>
      ) : savedProfile ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-400">
          <span className="font-semibold text-slate-300">Filters:</span>
          {savedProfile.naicsCodes.length > 0 && (
            <span>
              NAICS {savedProfile.naicsCodes.slice(0, 3).join(', ')}
              {savedProfile.naicsCodes.length > 3 && ` +${savedProfile.naicsCodes.length - 3}`}
            </span>
          )}
          {savedProfile.businessType && <span>• {savedProfile.businessType}</span>}
          {savedProfile.setAsides.length > 0 && (
            <span>• Set-asides: {savedProfile.setAsides.slice(0, 3).join(', ')}
              {savedProfile.setAsides.length > 3 && ` +${savedProfile.setAsides.length - 3}`}
            </span>
          )}
          {savedProfile.locationStates.length > 0 ? (
            <span>
              • States: {savedProfile.locationStates.length <= 4
                ? savedProfile.locationStates.join(', ')
                : `${savedProfile.locationStates.slice(0, 3).join(', ')} +${savedProfile.locationStates.length - 3}`}
            </span>
          ) : (
            <span className="text-slate-500">• States: all (national)</span>
          )}
          <button
            type="button"
            onClick={() => setShowAdvancedProfile((v) => !v)}
            className="ml-auto text-xs text-slate-500 hover:text-slate-300"
          >
            {showAdvancedProfile ? '✕ Close' : 'Edit'}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-300">
          <span>No profile set — Mindy will use defaults until you tell her your NAICS, set-asides, and states.</span>
          <button
            type="button"
            onClick={() => setShowAdvancedProfile(true)}
            className="text-amber-400 hover:text-amber-200"
          >
            + Set profile
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-red-200">✕</button>
        </div>
      )}

      {/* Validation Error */}
      {validationError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm flex items-center">
          <span className="mr-2">⚠️</span>
          {validationError}
        </div>
      )}

      {/* Collapsible Profile Editor */}
      {showAdvancedProfile && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-white">Explore a Different Market</h3>
            <button
              type="button"
              onClick={() => setShowAdvancedProfile(false)}
              className="text-slate-500 hover:text-slate-300"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-sm text-slate-400">Business type</span>
              <select
                value={formData.businessType}
                onChange={(e) => setFormData({ ...formData, businessType: e.target.value as BusinessType })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-emerald-500"
              >
                <option value="">Use saved/default</option>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-slate-400">NAICS codes</span>
              <NaicsAutocompleteInput
                value={formData.naicsCode}
                onChange={(v) => setFormData({ ...formData, naicsCode: v })}
                placeholder="236, 541512"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 outline-none focus:border-emerald-500"
              />
            </label>
            <label className="block">
              <span className="text-sm text-slate-400">
                PSC codes
                <span className="ml-1 text-[11px] text-slate-500">(more precise)</span>
              </span>
              <input
                type="text"
                value={formData.pscCode}
                onChange={(e) => setFormData({ ...formData, pscCode: e.target.value })}
                placeholder="D316, R425"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 outline-none focus:border-emerald-500"
              />
            </label>
            <label className="block">
              <span className="text-sm text-slate-400">Target agency</span>
              <input
                type="text"
                value={selectedAgency}
                onChange={(e) => setSelectedAgency(e.target.value)}
                placeholder="VA, GSA, DOD"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 outline-none focus:border-emerald-500"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {savedProfile && (
              <button
                type="button"
                onClick={() => {
                  applySavedProfile(savedProfile);
                  setShowAdvancedProfile(false);
                }}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Reset to profile
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                handleGenerateAll(undefined, { notifySuccess: true });
                setShowAdvancedProfile(false);
              }}
              disabled={isGenerating}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-slate-700"
            >
              Apply & Refresh
            </button>
            {tier !== 'free' && (
              <>
                <div className="h-5 w-px bg-slate-700" />
                {showSaveFocus ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={newFocusName}
                      onChange={(event) => setNewFocusName(event.target.value)}
                      placeholder="Name this focus..."
                      className="w-40 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={handleSaveMarketFocus}
                      disabled={focusSaving}
                      className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:bg-slate-700"
                    >
                      {focusSaving ? '...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSaveFocus(false)}
                      className="text-slate-500 hover:text-slate-300"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowSaveFocus(true)}
                    className="text-sm text-emerald-400 hover:text-emerald-300"
                  >
                    Save as focus
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {(isGenerating || !chartsReady || parentSbShareLoading) && <MarketMapLoadingBanner />}

      {/* Phase 2 Slice 1 — Market Map flagship view. Shows when
          viewMode === 'map' AND reports have been generated. Slice 1
          renders the 4 headline stat cards + 4 chart placeholder
          tiles + Mindy Says placeholder. Slices 2-5 fill in the
          real charts, AI narrative, and export. */}
      {showResults && viewMode === 'map' && reportData && (
        <div className="space-y-6">
          {/* Market coverage lesson (#59) — Auto mode only; Sport renders this
              inside the research box above the manual filter row. */}
          {researchMode !== 'sport' && (
            <MarketCoverageBanner coverage={marketCoverage} email={email} />
          )}
          {/* Headline stats — same 4 numbers as the reports view's
              MetricCards but with stronger visual hierarchy here. */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard label="Agencies to review" value={(chartBuyers.length || buyerSummary?.totalAgencies || buyers.length).toLocaleString()} />
            <MetricCard label="Relevant spending" value={formatCurrency(chartTotalSpending || buyerSummary?.totalSpending)} tone="green" hint={spendWindowLabel ? `Total federal contract obligations in this market, ${spendWindowLabel}` : undefined} />
            <MetricCard label="Competitors in your space" value={(primeSummary?.totalPrimes || vehicleSummary?.totalContracts || 0).toLocaleString()} hint="Incumbent primes already winning this work — who you'd compete against or could team with" />
            <MetricCard label="Upcoming opportunities" value={(forecastSummary?.totalForecasts || painSummary?.highOpportunityMatches || 0).toLocaleString()} tone="amber" hint="Forecasted procurements + agency needs coming 6–18 months out" />
          </section>

          {/* Chart placeholders — Slice 2 fills these with Recharts
              (Spending by Agency bar + Set-Aside donut), Slice 3
              adds Trend line + Top 5 Primes. The slots are here
              so the layout is visible/scannable from Slice 1. */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SpendingByAgencyChart
              buyers={chartBuyers}
              loading={sportKeywordActive && tmrRows.length === 0}
            />
            {/* Small Business Mix is about YOUR profile's SBA goaling — not a
                one-off industry exploration. Remove it in Sport (Eric: "serves a
                different function"). */}
            {researchMode === 'auto' && (
              <SetAsideMixChart
                buyers={chartBuyers}
                satTotal={chartSatTotal || (reportData?.simplifiedAcquisition?.summary?.totalSATSpending) || 0}
                totalSpend={chartTotalSpending || buyerSummary?.totalSpending || 0}
              />
            )}
            <TrendPlaceholderChart
              totalSpend={chartTotalSpending || buyerSummary?.totalSpending || 0}
              agencyCount={chartBuyers.length}
            />
            <TopPrimesChart
              primes={reportData?.primeContractor?.suggestedPrimes || []}
              tier2={(reportData?.tier2Subcontracting?.suggestedPrimes || []).map(p => ({
                name: p.name, reason: p.reason, email: p.email, phone: p.phone,
              }))}
              tribal={(reportData?.tribalContracting?.suggestedTribes || []).map(t => ({
                name: t.name,
                reason: t.region || (t.capabilities && t.capabilities.length > 0 ? t.capabilities[0] : undefined),
                region: t.region,
              }))}
              email={email}
            />
          </section>

          {/* FPDS-style top-10 leaderboards (Departments / Contracting
              Agencies / Vendors / Funding Agencies). Real award-
              derived data via USAspending category aggregations —
              the same view a BD person used to get from the FPDS-NG
              search sidebar before FPDS retired in Feb 2026. */}
          <FpdsLeaderboards
            naicsCode={marketCoverage ? '' : formData.naicsCode}
            keyword={marketCoverage?.keyword}
            pscCode={marketCoverage?.uses_psc_ranking ? marketCoverage?.top_psc?.code : undefined}
            rankingLabel={marketCoverage?.ranking_label}
            excludeDOD={formData.excludeDOD}
            email={email}
            onAgencyClick={(agencyName) => {
              setParentAgencyFilter(agencyName);
              // Scroll the All Agencies table into view so the user
              // sees the filter was applied. setTimeout pushes the
              // scroll to the next frame so React has rendered the
              // filter state first.
              setTimeout(() => {
                agencyTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 50);
            }}
          />

          {/* Slice 1.5C — Agency table with sort lenses. Replaces the
              old "Start Here" 3-card black box with full transparency:
              all N offices, 4 sortable metrics, methodology you can
              swap. Drives off /api/app/target-market-research which
              merges USAspending + SAM + pain points + events. */}
          <div ref={agencyTableRef}>
            <AgencyTable
              email={email}
              naicsCode={formData.naicsCode}
              pscCode={formData.pscCode}
              businessType={formData.businessType}
              veteranStatus={formData.veteranStatus}
              zipCode={formData.zipCode}
              excludeDOD={formData.excludeDOD}
              keyword={researchMode === 'sport' && (sportReportRan || sportBuildActive) ? sportKeyword.trim() : undefined}
              profileKeywords={savedProfile?.keywords}
              onRowsChange={setTmrRows}
              onSelectedAgenciesChange={setStarredAgencies}
              parentAgencyFilter={parentAgencyFilter}
              onClearParentFilter={() => setParentAgencyFilter(null)}
              onLoadingChange={setAgencyLoading}
            />
          </div>

          {/* Mindy Says — Groq-generated market narrative + 3
              recommended next actions. Pro-gated (free users see
              a teaser). Cached 7d server-side per (naics, btype,
              email). See /api/app/market-narrative. */}
          <MindyNarrative
            email={email}
            naicsCode={formData.naicsCode}
            businessType={formData.businessType}
            totalSpending={chartTotalSpending || buyerSummary?.totalSpending || 0}
            satTotal={chartSatTotal || reportData?.simplifiedAcquisition?.summary?.totalSATSpending || 0}
            agencyCount={chartBuyers.length}
            topAgencies={chartBuyers}
            topPrimes={reportData?.primeContractor?.suggestedPrimes || []}
          />

          <p className="text-xs text-slate-500 text-center">
            Want the raw report data? <button onClick={() => setViewMode('reports')} className="text-emerald-400 hover:text-emerald-300 underline">View Reports →</button>
          </p>
        </div>
      )}

      {showResults && viewMode === 'reports' && reportData && (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard label="Agencies to review" value={(chartBuyers.length || buyerSummary?.totalAgencies || buyers.length).toLocaleString()} />
            <MetricCard label="Relevant spending" value={formatCurrency(chartTotalSpending || buyerSummary?.totalSpending)} tone="green" hint={spendWindowLabel ? `Total federal contract obligations in this market, ${spendWindowLabel}` : undefined} />
            <MetricCard label="Competitors in your space" value={(primeSummary?.totalPrimes || vehicleSummary?.totalContracts || 0).toLocaleString()} hint="Incumbent primes already winning this work — who you'd compete against or could team with" />
            <MetricCard label="Upcoming opportunities" value={(forecastSummary?.totalForecasts || painSummary?.highOpportunityMatches || 0).toLocaleString()} tone="amber" hint="Forecasted procurements + agency needs coming 6–18 months out" />
          </section>

          {/* 'Start Here' 3-card row removed 2026-05-25 per Eric.
              The picker was unreliable: 'Best first agency' would pick
              Homeland Security with $0 tracked spend, 'Strongest need
              signal' surfaced GSA cybersecurity when the user searched
              construction NAICS, 'Competition angle' showed contradictory
              counts. Cards didn't earn their slot. The All Agencies
              table below already lets users pick winners by their own
              criteria.

              2026-05-27: Replaced with Entry Accessibility surface
              (task #41). Ports the SAT/Micro-Purchase scoring from
              MA's EntryPointsTab. Honest empty-state for NAICS that
              skew to mega-contracts (construction, large IT). */}
          <EntryAccessibilityCard
            data={reportData?.simplifiedAcquisition as SimplifiedAcquisitionReport | undefined}
          />

          {/* Recommended Opportunities section removed May 22, 2026.
              It duplicated Today's Intel and Source Feed (3 surfaces
              showing opps competed for the same user attention).
              Research's job is "where do I play strategically" not
              "what do I bid on today." Opportunity actions now live
              only in Today's Intel / Source Feed / Market Dashboard.
              See tasks/target-accounts-crm-roadmap.md for the v2
              vision (TAL builder) this carves space for. */}

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-4 text-xl font-semibold text-white">Choose What You Need</h2>
            <div className="grid gap-3 md:grid-cols-5">
              {RESEARCH_LENSES.map((lens) => (
                <button
                  key={lens.id}
                  type="button"
                  onClick={() => handleLensClick(lens)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    activeLens === lens.id
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                  }`}
                >
                  <div className="font-medium text-white">{lens.label}</div>
                  <div className="mt-1 text-sm text-slate-500">{lens.description}</div>
                </button>
              ))}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {readyReports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => handleReportClick(report)}
                  className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-left hover:border-emerald-500/50"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{report.icon}</span>
                    <div>
                      <div className="font-medium text-white">{report.title}</div>
                      <div className="text-sm text-slate-500">{report.description}</div>
                    </div>
                  </div>
                </button>
              ))}
              {readyReports.length === 0 && (
                <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-4 text-sm text-purple-200">
                  This section is available on Pro.
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {!reportData && !isGenerating && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
          <h2 className="text-xl font-semibold text-white">Your market map is ready to build</h2>
          <p className="mx-auto mt-2 max-w-xl text-slate-400">
            Mindy will use your saved profile to find target agencies, buyers, budgets, competition, vehicles, and partner signals.
          </p>
          <button
            type="button"
            onClick={() => researchMode === 'sport' ? handleSportBuild({ notifySuccess: true }) : handleGenerateAll(undefined, { notifySuccess: true })}
            disabled={sportSuggesting}
            className="mt-5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:bg-slate-700"
          >
            {sportSuggesting ? 'Looking up codes…' : 'Build My Market Map'}
          </button>
        </section>
      )}

      {/* Report Viewer */}
      {activeReportId && reportData && (
        <ReportViewer
          reportId={activeReportId}
          reportData={getReportContent(activeReportId)}
          isGenerating={isGenerating}
          email={email}
          naicsCode={formData.naicsCode}
          recommendedOpportunities={recommendedOpportunities}
          onClose={() => setActiveReportId(null)}
          formatCurrency={formatCurrency}
          onSaveBuyer={handleSaveBuyer}
          onSavePartner={handleSavePartner}
          onTrackOpportunity={handleTrackOpportunity}
          savingContact={savingContact}
          savedContacts={savedContacts}
          savingOpportunity={savingOpportunity}
          savedOpportunities={savedOpportunities}
          tier={tier}
        />
      )}

      {selectedOpportunity && (
        <RecommendedOpportunityDrawer
          opportunity={selectedOpportunity}
          selectedFeedback={feedbackByOpportunity[selectedOpportunity.id]}
          savingFeedback={savingFeedback.has(selectedOpportunity.id)}
          onFeedback={handleRecommendedFeedback}
          onClose={() => setSelectedOpportunity(null)}
        />
      )}

      {/* Upgrade CTA for Free Users */}
      {tier === 'free' && (
        <div className="bg-gradient-to-r from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-xl p-6 text-center">
          <h3 className="font-semibold text-white mb-2">Unlock deeper market research</h3>
          <p className="text-slate-400 text-sm mb-4">
            Upgrade to see pain points, prime targets, teaming partners, and forecast detail.
          </p>
          <a
            href="/market-intelligence"
            className="inline-block px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Upgrade to Pro
          </a>
        </div>
      )}
    </div>
  );
}

function RecommendedOpportunityCard({
  opportunity,
  selectedFeedback,
  savingFeedback,
  onFeedback,
  onOpen,
}: {
  opportunity: RecommendedOpportunity;
  selectedFeedback?: FeedbackType;
  savingFeedback: boolean;
  onFeedback: (opportunity: RecommendedOpportunity, feedbackType: FeedbackType) => void;
  onOpen: (opportunity: RecommendedOpportunity) => void;
}) {
  const agency = opportunity.department || opportunity.subTier || opportunity.office || 'Agency not listed';
  const deadline = opportunity.responseDeadline
    ? new Date(opportunity.responseDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'No deadline';
  const reasons = opportunity.feedbackReasons || [];
  const mindyScore = opportunity.recommendationScore ?? opportunity.feedbackScoreAdjustment ?? 0;

  return (
    <article className="flex min-h-[260px] flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className={`rounded px-2 py-1 text-xs font-medium ${
          opportunity.isUrgent ? 'bg-red-500/15 text-red-200' : 'bg-emerald-500/15 text-emerald-200'
        }`}>
          {opportunity.daysLeft != null ? `${Math.max(opportunity.daysLeft, 0)} days left` : deadline}
        </span>
        {mindyScore !== 0 && (
          <span className="rounded bg-purple-500/15 px-2 py-1 text-xs text-purple-200">
            Mindy {mindyScore > 0 ? '+' : ''}{mindyScore}
          </span>
        )}
      </div>

      <button type="button" onClick={() => onOpen(opportunity)} className="text-left">
        <h3 className="line-clamp-3 text-base font-semibold text-white hover:text-emerald-200">{opportunity.title}</h3>
      </button>
      <p className="mt-2 line-clamp-2 text-sm text-slate-400">{agency}</p>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
        {opportunity.naicsCode && <span className="rounded bg-slate-900 px-2 py-1">NAICS {opportunity.naicsCode}</span>}
        {opportunity.noticeType && <span className="rounded bg-slate-900 px-2 py-1">{opportunity.noticeType}</span>}
        <span className="rounded bg-slate-900 px-2 py-1">Due {deadline}</span>
      </div>

      {reasons.length > 0 && (
        <div className="mt-3 rounded border border-purple-500/20 bg-purple-500/10 px-3 py-2 text-xs text-purple-100">
          {reasons[0]}
        </div>
      )}

      {opportunity.setAsideEligible === false && opportunity.setAsideMismatchReason && (
        <div className="mt-3 rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {opportunity.setAsideMismatchReason}
        </div>
      )}

      <div className="mt-auto pt-4">
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={() => onFeedback(opportunity, 'want_more_like_this')}
            disabled={savingFeedback}
            className={`rounded border px-3 py-1.5 text-xs ${
              selectedFeedback === 'want_more_like_this'
                ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                : 'border-slate-700 text-slate-300 hover:border-emerald-500/60'
            }`}
          >
            More like this
          </button>
          <button
            type="button"
            onClick={() => onFeedback(opportunity, 'bad_match')}
            disabled={savingFeedback}
            className={`rounded border px-3 py-1.5 text-xs ${
              selectedFeedback === 'bad_match'
                ? 'border-red-400 bg-red-500/20 text-red-100'
                : 'border-slate-700 text-slate-300 hover:border-red-500/60'
            }`}
          >
            Bad match
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onOpen(opportunity)}
            className="flex-1 rounded bg-slate-800 px-3 py-2 text-center text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Details
          </button>
          {opportunity.url && (
            <a
              href={opportunity.url}
              target="_blank"
              rel="noreferrer"
              className="flex-1 rounded bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-500"
            >
              Open SAM.gov
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function RecommendedOpportunityDrawer({
  opportunity,
  selectedFeedback,
  savingFeedback,
  onFeedback,
  onClose,
}: {
  opportunity: RecommendedOpportunity;
  selectedFeedback?: FeedbackType;
  savingFeedback: boolean;
  onFeedback: (opportunity: RecommendedOpportunity, feedbackType: FeedbackType) => void;
  onClose: () => void;
}) {
  const agency = opportunity.buyerDisplay || opportunity.buyerName || opportunity.office || opportunity.subTier || opportunity.department || 'Agency not listed';
  const parentAgency = opportunity.parentAgency || opportunity.department || null;
  const deadline = opportunity.responseDeadline
    ? new Date(opportunity.responseDeadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'No deadline listed';
  const location = [opportunity.popCity, opportunity.popState].filter(Boolean).join(', ');
  const locationDetail = [location, opportunity.popZip, opportunity.popCountry].filter(Boolean).join(' ');
  const summary = cleanOpportunitySummary(opportunity.description);
  const sourceLinks = [
    opportunity.url ? { label: 'SAM.gov record', href: opportunity.url } : null,
    opportunity.descriptionUrl ? { label: 'SAM notice description', href: opportunity.descriptionUrl } : null,
  ].filter((link): link is { label: string; href: string } => Boolean(link && isHttpUrl(link.href)));

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-950 shadow-2xl">
        <div className="border-b border-slate-800 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-purple-300">Recommended opportunity</div>
              <h2 className="mt-2 text-xl font-semibold text-white">{opportunity.title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-800 px-3 py-2 text-slate-300 hover:bg-slate-900"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <section className="grid grid-cols-2 gap-3">
            <DetailTile label="Buyer / Office" value={formatDodaacOffice(opportunity.solicitationNumber || null) || agency} />
            <DetailTile label="Parent Agency" value={parentAgency || '-'} />
            <DetailTile label="Due" value={deadline} />
            <DetailTile label="Solicitation" value={opportunity.solicitationNumber || '-'} />
            <DetailTile label="Notice Type" value={opportunity.noticeType || '-'} />
            <DetailTile label="NAICS" value={opportunity.naicsCode || '-'} />
            <DetailTile label="Place" value={locationDetail || '-'} />
          </section>

          {(opportunity.feedbackReasons || []).length > 0 && (
            <section className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-4">
              <h3 className="text-sm font-semibold text-purple-100">Why Mindy ranked this</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {(opportunity.feedbackReasons || []).map((reason) => (
                  <span key={reason} className="rounded bg-purple-500/15 px-2 py-1 text-xs text-purple-100">
                    {reason}
                  </span>
                ))}
              </div>
            </section>
          )}

          {summary && (
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h3 className="text-sm font-semibold text-white">Summary</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-300">{summary}</p>
            </section>
          )}

          {sourceLinks.length > 0 && (
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h3 className="text-sm font-semibold text-white">Links</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {sourceLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-100 hover:border-emerald-400 hover:bg-emerald-500/20"
                  >
                    {link.label} →
                  </a>
                ))}
              </div>
            </section>
          )}

          {opportunity.setAsideDescription && (
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h3 className="text-sm font-semibold text-white">Set-aside</h3>
              <p className="mt-2 text-sm text-slate-300">{opportunity.setAsideDescription}</p>
              {opportunity.setAsideEligible === false && opportunity.setAsideMismatchReason && (
                <p className="mt-3 rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  Mindy down-ranked this because it {opportunity.setAsideMismatchReason}.
                </p>
              )}
            </section>
          )}

          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h3 className="text-sm font-semibold text-white">Tune Mindy</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ['want_more_like_this', 'More like this'],
                ['good_match', 'Good match'],
                ['bad_match', 'Bad match'],
                ['not_my_industry', 'Not my industry'],
                ['too_big_small', 'Too big/small'],
                ['already_knew', 'Already knew'],
              ].map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onFeedback(opportunity, type as FeedbackType)}
                  disabled={savingFeedback}
                  className={`rounded-full border px-3 py-1.5 text-xs ${
                    selectedFeedback === type
                      ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                      : 'border-slate-700 text-slate-300 hover:border-emerald-500/60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="border-t border-slate-800 p-5">
          {opportunity.url && (
            <a
              href={opportunity.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Open on SAM.gov
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-100">{value}</div>
    </div>
  );
}

function MetricCard({ label, value, tone = 'default', hint }: { label: string; value: string; tone?: 'default' | 'green' | 'amber'; hint?: string }) {
  const color = tone === 'green' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5" title={hint || undefined}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
      {hint && <div className="mt-1 text-xs text-slate-600 leading-snug">{hint}</div>}
    </div>
  );
}

// Loading banner shown while Build Market Map is fetching. Visible
// motion (shimmer bar + cycling status messages) so users don't think
// the page is broken during the ~10-30s generation window.
function MarketMapLoadingBanner() {
  const messages = useMemo(() => [
    'Pulling agency spending from USAspending…',
    'Cross-referencing SAM.gov opportunities…',
    'Matching agency pain points to your NAICS…',
    'Scoring buyers by set-aside fit…',
    'Identifying prime partners and recompetes…',
    'Building forecast pipeline…',
    'Almost ready — assembling your map…',
  ], []);
  const [messageIdx, setMessageIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setMessageIdx((i) => (i + 1) % messages.length);
    }, 2200);
    return () => clearInterval(id);
  }, [messages.length]);

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-blue-500/10 to-emerald-500/10 p-5">
      <div className="flex items-center gap-3">
        <span className="relative inline-flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-emerald-200">Building your market map</div>
          <div key={messageIdx} className="mt-0.5 animate-fadeIn text-xs text-slate-300">
            {messages[messageIdx]}
          </div>
        </div>
      </div>
      {/* Indeterminate progress bar — pure CSS, slides left-to-right */}
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full w-1/3 animate-[marketMapProgress_1.8s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-emerald-500 via-blue-400 to-emerald-500" />
      </div>
      <style jsx>{`
        @keyframes marketMapProgress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(2px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
      `}</style>
    </div>
  );
}

// Slice 1 placeholder for chart slots. Kept around for the 3-Year
// Trend tile that we can't honestly populate yet (we don't have
// USAspending FY-broken data in reportData).
function ChartPlaceholder({ title, subtitle, slice }: { title: string; subtitle: string; slice: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 min-h-[280px] flex flex-col">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-2 opacity-30">📊</div>
          <p className="text-xs text-slate-600 uppercase tracking-wider">Chart ships in Slice {slice}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Slice 2 — Recharts visualizations
// ---------------------------------------------------------------------
//
// 4 chart tiles wired to the existing reportData. Each is its own
// component so we can swap in better data sources (USASpending FY
// breakdown, BLS labor stats, etc.) without re-architecting the layout.
//
// Color palette pulled from the dark-mode brand tokens to match the
// rest of Mindy. Recharts colors are passed via `fill` / `stroke` so
// Tailwind doesn't need to know about them.

const CHART_PALETTE = {
  emerald: '#10b981',  // primary money signal
  emeraldDim: '#065f46',
  blue: '#3b82f6',     // SAT spend
  amber: '#f59e0b',    // SAT competitor band
  purple: '#a855f7',   // primes / events
  slate: '#64748b',    // axis labels
  slateDim: '#334155', // grid
};

// Money formatter — short form for chart labels where space is tight.
function chartMoney(n: number): string {
  if (!n || !Number.isFinite(n)) return '$0';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// Shared chart-card shell — keeps the header consistent across all 4
// tiles + sets the same min-height so the grid doesn't jump.
function ChartShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 min-h-[280px] flex flex-col">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className="flex-1 min-h-[200px]">
        {children}
      </div>
      {footer && <div className="mt-2 pt-2 border-t border-slate-800/60">{footer}</div>}
    </div>
  );
}

// 1) Spending by Agency — horizontal bar, top 10 by spending.
interface BuyerLike {
  contractingOffice?: string;
  parentAgency?: string;
  subAgency?: string;
  spending?: number;
  contractCount?: number;
}
function SpendingByAgencyChart({ buyers, loading }: { buyers: BuyerLike[]; loading?: boolean }) {
  // Map to chart-friendly shape, sort, slice. Truncate the office
  // name for the Y axis so the chart bars don't get squeezed.
  //
  // IMPORTANT — earlier version filtered .spending > 0 which hid
  // every row where the buyers report populated the name but not
  // the spend (happens when the partial-data path of generate-all
  // runs). Result was a single-bar chart that misrepresented the
  // market. Now we keep ALL rows and sort spend desc; rows with
  // 0 spend render as a thin "—" rather than disappearing. The
  // chart trust-score depends on honesty about data gaps.
  const data = useMemo(() => {
    return [...(buyers || [])]
      .filter(b => (b.contractingOffice || b.parentAgency || b.subAgency))
      .sort((a, b) => (b.spending || 0) - (a.spending || 0))
      .slice(0, 10)
      .map(b => ({
        name: ((b.contractingOffice || b.subAgency || b.parentAgency || '').slice(0, 28) || 'Unknown'),
        spending: b.spending || 0,
      }))
      .reverse();
  }, [buyers]);

  if (loading) {
    return (
      <ChartShell title="Spending by Agency" subtitle="Top 10 by total spend (loading…)">
        <div className="flex items-center justify-center h-full text-xs text-slate-500">
          Loading agency spend…
        </div>
      </ChartShell>
    );
  }

  if (data.length === 0) {
    return (
      <ChartShell title="Spending by Agency" subtitle="Top 10 by tracked spend">
        <div className="flex items-center justify-center h-full text-xs text-slate-500">
          No agency spending data yet. Build the report to populate.
        </div>
      </ChartShell>
    );
  }

  // Honesty footer — when most rows have $0 spend it's a data
  // gap signal, not a market signal. Tell the user instead of
  // letting them assume the market only has one buyer.
  const withSpend = data.filter(d => d.spending > 0).length;
  const footer = withSpend < data.length
    ? `${withSpend} of ${data.length} agencies have tracked spend. Refresh to pull more.`
    : undefined;

  return (
    <ChartShell
      title="Spending by Agency"
      subtitle={`Top ${data.length} by total spend in your market`}
      footer={footer ? <p className="text-[11px] text-amber-300/80">{footer}</p> : undefined}
    >
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 22)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
          <XAxis
            type="number"
            tick={{ fill: CHART_PALETTE.slate, fontSize: 10 }}
            tickFormatter={chartMoney}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: CHART_PALETTE.slate, fontSize: 10 }}
            width={120}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(16, 185, 129, 0.08)' }}
            contentStyle={{
              backgroundColor: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '6px',
              fontSize: '11px',
            }}
            labelStyle={{ color: '#cbd5e1' }}
            formatter={(value) => [chartMoney(Number(value) || 0), 'Spend'] as [string, string]}
          />
          <Bar dataKey="spending" fill={CHART_PALETTE.emerald} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

// 2) Small Business Mix — donut. Splits this NAICS market into the
// portion that goes to small businesses (per SBA Goaling Report
// share applied to each agency's NAICS spend) vs. the portion that
// goes to large/non-small contractors. Reframed May 23, 2026 from
// "Set-Aside Mix" (SAT threshold) which always returned zero for
// construction NAICS. SB share is a real signal for SMB targeting.
//
// Math reminder: the `satTotal` param here is now the WEIGHTED
// small-business dollar volume (sum across agencies of
// agency_spend × agency_sb_share). Variable name kept for prop
// API stability — relabeling happens at copy.
function SetAsideMixChart({
  buyers,
  satTotal,
  totalSpend,
}: {
  buyers: BuyerLike[];
  satTotal: number;  // now: small-business dollars (weighted)
  totalSpend: number;
}) {
  const fallbackTotal = useMemo(
    () => (buyers || []).reduce((sum, b) => sum + (b.spending || 0), 0),
    [buyers]
  );
  const total = totalSpend || fallbackTotal;
  const nonSb = Math.max(0, total - satTotal);

  if (total === 0) {
    return (
      <ChartShell title="Small Business Mix" subtitle="% of NAICS spend going to small businesses">
        <div className="flex items-center justify-center h-full text-xs text-slate-500">
          No spending data yet to chart.
        </div>
      </ChartShell>
    );
  }

  const data = [
    { name: 'Small Business', value: satTotal, color: CHART_PALETTE.emerald },
    { name: 'Non-Small Business', value: nonSb, color: CHART_PALETTE.slateDim },
  ];
  const sbPct = total > 0 ? (satTotal / total) * 100 : 0;

  // Three honest footer states:
  //
  //   - satTotal === 0 → SBA Goaling data hasn't loaded yet (or
  //     this NAICS hits agencies not in the Goaling slice). Show
  //     loading-style copy rather than misleading 0%.
  //
  //   - sbPct < 5  → SB share is genuinely thin in this market.
  //     Point users at teaming as an alternative entry path.
  //
  //   - sbPct >= 5 → normal copy with the addressable $ amount.
  let footerMessage;
  if (satTotal === 0 && total > 0) {
    footerMessage = (
      <p className="text-[11px] text-slate-500">
        Calculating small-business share from SBA Goaling Report...
        If this stays empty, the agencies in this NAICS aren&apos;t in the
        FY23 SBA dataset (small/independent agencies often aren&apos;t).
      </p>
    );
  } else if (sbPct < 5 && sbPct > 0) {
    footerMessage = (
      <p className="text-[11px] text-amber-300/80">
        Only <span className="font-semibold">{sbPct.toFixed(1)}%</span> of
        {' '}{chartMoney(total)} goes to small businesses in this NAICS
        ({chartMoney(satTotal)} addressable). Consider teaming with a
        prime as your entry path.
      </p>
    );
  } else {
    footerMessage = (
      <p className="text-[11px] text-slate-400">
        <span className="text-emerald-400 font-semibold">{sbPct.toFixed(1)}%</span> of
        {' '}{chartMoney(total)} goes to small businesses
        ({chartMoney(satTotal)} addressable). Source: SBA Goaling Report FY23.
      </p>
    );
  }

  return (
    <ChartShell
      title="Small Business Mix"
      subtitle="% of NAICS spend going to small businesses (SBA Goaling FY23)"
      footer={footerMessage}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry, idx) => (
              <Cell key={idx} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '6px',
              fontSize: '11px',
            }}
            labelStyle={{ color: '#cbd5e1' }}
            formatter={(value, name) => [chartMoney(Number(value) || 0), String(name)] as [string, string]}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

// 3) 3-Year Spending Trend — kept as an honest placeholder because
// we don't carry USASpending FY-broken data in reportData yet. Shows
// the total spend as a single anchor + explains what's missing so
// reviewers know it's not a bug.
function TrendPlaceholderChart({ totalSpend, agencyCount }: { totalSpend: number; agencyCount: number }) {
  return (
    <ChartShell
      title="Market Total"
      subtitle="Combined tracked spend in your NAICS profile"
    >
      <div className="h-full flex flex-col items-center justify-center text-center px-4">
        <div className="text-3xl font-bold text-emerald-400 mb-1">{chartMoney(totalSpend)}</div>
        <div className="text-xs text-slate-500 mb-3">across {agencyCount.toLocaleString()} {agencyCount === 1 ? 'agency' : 'agencies'}</div>
        <p className="text-[11px] text-slate-500 italic max-w-sm">
          Year-over-year trend line (FY 2022 → 2024 etc.) ships when
          we wire USASpending&apos;s annual breakdown. Today this tile
          shows the market&apos;s current total — a snapshot, not a delta.
        </p>
      </div>
    </ChartShell>
  );
}

// 4) Top Primes — horizontal bar list of suggested primes. We don't
// have per-prime spending or win count, so the chart is rank-only:
// the bar length is uniform (signals "these are the top 5"), and the
// row is labeled with the prime name + their stated reason for being
// a suggestion. Future iteration adds win-count from USASpending.
interface PrimeLike {
  name: string;
  reason?: string;
  agencies?: string[];  // Optional agency footprint, used by TopPrimesChart
                        // to filter against the user's saved target list.
  tier?: 'tier1' | 'tier2' | 'tribal';  // Source tier for badge + priority
  email?: string | null;   // POC contact (Eric: show POC, skip award history)
  phone?: string | null;
  region?: string | null;  // for tribal (region/state)
}

interface TopPrimesChartProps {
  primes: PrimeLike[];      // Tier 1 primes (default)
  tier2?: PrimeLike[];      // Tier 2 subcontractors — prioritized FIRST
  tribal?: PrimeLike[];     // Tribal contractors — prioritized FIRST alongside tier 2
  email: string | null;
}

function TopPrimesChart({ primes, tier2 = [], tribal = [], email }: TopPrimesChartProps) {
  // Reframed May 22 → rebuilt for user context May 25, 2026 per Eric:
  // "the teaming candidates are the same names over and over again,
  // this is not helpful once I've called all 9." Old behavior: top 5
  // primes by NAICS prefix from prime-contractors-database.json —
  // identical results for every user with the same NAICS. New
  // behavior: fetch the user's saved target agencies from
  // user_target_list, then filter primes whose agencies[] field
  // overlaps the user's targets. Empty target list → fall back to
  // top NAICS primes + nudge to save targets.
  const [savedAgencies, setSavedAgencies] = useState<Set<string>>(new Set());
  const [targetsLoaded, setTargetsLoaded] = useState(false);

  useEffect(() => {
    if (!email) {
      setTargetsLoaded(true);
      return;
    }
    let cancelled = false;
    fetch(`/api/app/target-list?email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        const names = new Set<string>();
        for (const t of (data?.targets || [])) {
          // Match on agency_name AND sub_agency_name so we catch
          // both 'Department of the Navy' and 'NAVFAC' style saves.
          if (t.agency_name) names.add(String(t.agency_name).toLowerCase().trim());
          if (t.sub_agency_name) names.add(String(t.sub_agency_name).toLowerCase().trim());
        }
        setSavedAgencies(names);
      })
      .catch(() => { /* graceful degrade to no-filter fallback */ })
      .finally(() => { if (!cancelled) setTargetsLoaded(true); });
    return () => { cancelled = true; };
  }, [email]);

  // Filter primes against the user's saved target agencies. A prime
  // qualifies if ANY of its known agency strings substring-matches
  // ANY of the user's saved agency names (in either direction).
  // Loose match because the data is messy: 'DEPT OF THE AIR FORCE'
  // vs 'Department of the Air Force' vs 'Air Force'.
  const contextualTier1 = useMemo(() => {
    if (savedAgencies.size === 0) return [];
    return primes.filter(p => {
      if (!p.agencies || p.agencies.length === 0) return false;
      return p.agencies.some(pa => {
        const haystack = pa.toLowerCase();
        for (const saved of savedAgencies) {
          if (haystack.includes(saved) || saved.includes(haystack)) return true;
        }
        return false;
      });
    });
  }, [primes, savedAgencies]);

  // Merge: Tier 2 + Tribal FIRST, Tier 1 fills the rest. Per Eric
  // (2026-05-27): "I want to choose tier 2 or tribal companies first
  // not tier 1 primes." Emerging small businesses can rarely win a
  // sub spot under Lockheed; Tier 2 + tribal are the realistic
  // teaming partners. Dedup by name to handle overlap.
  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: PrimeLike[] = [];

    // 1. Tribal first (most-likely-to-team partner for small biz)
    for (const t of tribal) {
      const key = t.name.toLowerCase().trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push({ ...t, tier: 'tribal' });
      }
    }
    // 2. Tier 2 subs
    for (const t of tier2) {
      const key = t.name.toLowerCase().trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push({ ...t, tier: 'tier2' });
      }
    }
    // 3. Contextual Tier 1 (those actually working on user's saved agencies)
    for (const t of contextualTier1) {
      const key = t.name.toLowerCase().trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push({ ...t, tier: 'tier1' });
      }
    }
    // 4. Generic Tier 1 fallback if we still don't have enough
    if (out.length < 10) {
      for (const t of primes) {
        const key = t.name.toLowerCase().trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push({ ...t, tier: 'tier1' });
          if (out.length >= 10) break;
        }
      }
    }
    return out;
  }, [tribal, tier2, contextualTier1, primes]);

  const hasContextualTier1 = contextualTier1.length > 0;
  const tribalCount = tribal.length;
  const tier2Count = tier2.length;
  // SEPARATE lists per tier (Eric: "make a list for each so the distinction is
  // clear" — was one blurred tribal-dominated list). Cap each so the card stays
  // scannable.
  const tribalList = merged.filter(p => p.tier === 'tribal').slice(0, 6);
  const tier2List = merged.filter(p => p.tier === 'tier2').slice(0, 6);
  const tier1List = merged.filter(p => p.tier === 'tier1').slice(0, 5);

  if (!targetsLoaded || merged.length === 0) {
    return (
      <ChartShell title="Teaming Candidates" subtitle="Tribal + Tier 2 partners you can pursue first">
        <div className="flex items-center justify-center h-full text-xs text-slate-500">
          {!targetsLoaded ? 'Loading…' : 'No teaming data yet. Build the report to populate.'}
        </div>
      </ChartShell>
    );
  }

  const subtitle = `${tribalCount > 0 || tier2Count > 0 ? `${tribalCount} tribal · ${tier2Count} Tier 2 · ` : ''}${hasContextualTier1 ? `${contextualTier1.length} contextual Tier 1` : 'plus Tier 1 backup'} — click for sales history`;

  const footer = (
    <p className="text-[11px] text-slate-400">
      <span className="text-emerald-400">Tribal + Tier 2 first</span> — realistic teaming partners for emerging small businesses. Tier 1 primes shown below as backup.
    </p>
  );

  // Tier badge colors — tribal emerald, tier2 amber, tier1 purple
  const tierStyle = (tier: PrimeLike['tier']) => {
    if (tier === 'tribal') return { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-300', label: 'TRIBAL' };
    if (tier === 'tier2') return { bg: 'bg-amber-500/20', border: 'border-amber-500/40', text: 'text-amber-300', label: 'T2' };
    return { bg: 'bg-purple-500/20', border: 'border-purple-500/40', text: 'text-purple-300', label: 'T1' };
  };

  const renderRow = (p: PrimeLike, i: number) => {
    const style = tierStyle(p.tier);
    // Eric: for teaming candidates, show the POC (how to reach them) — not award
    // history (many aren't in the awards DB → "Contractor not found"). Tier 1
    // primes keep the award-history link (they ARE in the data).
    const hasPoc = !!(p.email || p.phone);
    const samUrl = `https://sam.gov/search/?index=ei&q=${encodeURIComponent(p.name)}`;
    return (
      <li key={`${p.name}-${i}`} className="flex items-start gap-2.5">
        <div className={`shrink-0 w-5 h-5 rounded-full ${style.bg} border ${style.border} flex items-center justify-center text-[8px] font-semibold ${style.text}`}>
          {style.label}
        </div>
        <div className="min-w-0 flex-1">
          {p.tier === 'tier1' ? (
            <ContractorLink name={p.name} email={email} variant="plain" className="text-xs font-medium block truncate">
              {p.name}
            </ContractorLink>
          ) : (
            <span className="text-xs font-medium text-slate-200 block truncate">{p.name}</span>
          )}
          {p.reason && <div className="text-[10px] text-slate-500 truncate">{p.reason}</div>}
          {/* POC contact (Eric: POC is sufficient, skip history). */}
          {hasPoc ? (
            <div className="text-[10px] text-slate-500">
              {p.email && <span className="text-purple-300/80 select-all break-all">{p.email}</span>}
              {p.email && p.phone && <span className="text-slate-700"> · </span>}
              {p.phone && <span className="text-emerald-300/80 select-all">{p.phone}</span>}
            </div>
          ) : p.tier !== 'tier1' && (
            <a href={samUrl} target="_blank" rel="noreferrer" className="text-[10px] text-purple-400/80 hover:text-purple-300">↗ Look up on SAM.gov</a>
          )}
        </div>
      </li>
    );
  };

  // Each tier as its OWN FPDS-Top-10-style card (Eric: "good idea poor design —
  // put them in the FPDS top 10 format, separate each, not a run-on list").
  const tierCard = (title: string, hint: string, items: PrimeLike[]) => items.length === 0 ? null : (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="mb-2">
        <h4 className="text-xs font-bold text-white uppercase tracking-wider">{title}</h4>
        <p className="text-[10px] text-slate-500">{hint}</p>
      </div>
      <ul className="space-y-1.5">{items.map(renderRow)}</ul>
    </div>
  );

  return (
    <div className="lg:col-span-2">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-white">Teaming Candidates</h3>
        <p className="text-[11px] text-slate-500">{subtitle}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {tierCard('🪶 Tribal / Native-owned', 'Sole-source eligible — fastest teaming path for small business.', tribalList)}
        {tierCard('🥈 Tier 2 Subcontractors', 'Mid-size firms that sub on this work — realistic partners.', tier2List)}
        {tierCard('🏢 Tier 1 Primes', 'The incumbents — sub under them or size up the competition.', tier1List)}
      </div>
      <div className="mt-2">{footer}</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// FpdsLeaderboards — FPDS-NG style top-10 sidebar
// ---------------------------------------------------------------------
//
// Replicates the 4 "Top 10" lists that FPDS-NG used to show in its
// search sidebar before SAM.gov absorbed FPDS in Feb 2026:
//
//   - Top 10 Departments        (awarding_agency)
//   - Top 10 Contracting Agencies (awarding_subagency)
//   - Top 10 Vendors            (recipient)
//   - Top 10 Funding Agencies   (funding_agency — Treasury Acct Symbol replacement)
//
// Data comes from /api/usaspending/fpds-top-n which calls the
// USAspending spending_by_category endpoint. Cached 24h server-side.
//
// Each row links to relevant deep pages where possible: vendors →
// ContractorLink (sales history drawer), agencies → AgencyDrawer
// in the AgencyTable below.

interface FpdsRow {
  name: string;
  amount: number;
  count?: number;
  rank: number;
}

interface FpdsResponse {
  success: boolean;
  cached?: boolean;
  spend_window_label?: string;
  top_departments?: FpdsRow[];
  top_contracting?: FpdsRow[];
  top_vendors?: FpdsRow[];
  top_funding_agencies?: FpdsRow[];
  total_obligation?: number;
}

function FpdsLeaderboards({
  naicsCode,
  keyword,
  pscCode,
  rankingLabel,
  excludeDOD,
  email,
  onAgencyClick,
}: {
  naicsCode: string;
  keyword?: string;
  pscCode?: string;
  rankingLabel?: string;
  excludeDOD: boolean;
  email: string | null;
  /**
   * Click handler for agency-name rows in the 3 agency leaderboards
   * (Departments, Contracting Agencies, Funding Agencies). Parent
   * (MarketResearchPanel) sets parentAgencyFilter + scrolls the
   * All Agencies table into view. Vendors keep their existing
   * ContractorLink drawer behavior — they're a different drill-down.
   */
  onAgencyClick?: (agencyName: string) => void;
}) {
  const [data, setData] = useState<FpdsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyword-first: use market filter. Legacy NAICS mode uses first code.
  const primaryNaics = (naicsCode || '').split(',')[0]?.trim() || '';
  const useKeyword = Boolean(keyword?.trim());

  useEffect(() => {
    if (!useKeyword && !primaryNaics) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (useKeyword && keyword) {
      params.set('keyword', keyword.trim());
      if (pscCode) params.set('psc', pscCode);
    } else {
      params.set('naics', primaryNaics);
    }
    if (excludeDOD) params.set('excludeDOD', 'true');

    fetch(`/api/usaspending/fpds-top-n?${params.toString()}`)
      .then(async r => {
        const json = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok || !json?.success) {
          setError(json?.error || `HTTP ${r.status}`);
          return;
        }
        setData(json as FpdsResponse);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[FpdsLeaderboards] fetch failed:', err);
        setError('Network error loading leaderboards');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [primaryNaics, keyword, pscCode, excludeDOD, useKeyword]);

  if (!useKeyword && !primaryNaics) return null;

  const subtitle = useKeyword
    ? (rankingLabel || `keyword "${keyword}"`)
    : `NAICS ${primaryNaics}`;

  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between">
        <div>
          <h3 className="text-base font-bold text-white">FPDS Leaderboards</h3>
          <p className="text-xs text-slate-500">
            Top 10 by award $ · {subtitle}
            {data?.spend_window_label ? ` · ${data.spend_window_label}` : ''}
            {data?.cached ? ' · cached' : ''}
          </p>
        </div>
        {data?.total_obligation !== undefined && data.total_obligation > 0 && (
          <div className="text-right">
            <div className="text-xs text-slate-500">Tracked total</div>
            <div className="text-sm font-bold text-emerald-400">{chartMoney(data.total_obligation)}</div>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-900/10 p-3 text-xs text-red-300">
          {error}. Try Refresh.
        </div>
      )}

      {/* Top 10 Funding Agencies card removed 2026-05-25 per Eric:
          near-duplicate of Top 10 Departments for the SMB audience
          (same 10 names slightly reordered). 'Awarding vs funding'
          distinction is a power-user concept that adds confusion
          without action. Going from 4 cards → 3, full-width Vendors
          on lg screens. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <FpdsLeaderboardCard
          title="Top 10 Departments"
          subtitle="Parent agencies buying in this NAICS (click to filter table below)"
          rows={data?.top_departments || []}
          loading={loading}
          onAgencyClick={onAgencyClick}
        />
        <FpdsLeaderboardCard
          title="Top 10 Contracting Agencies"
          subtitle="Sub-agencies awarding the contracts (click to filter table below)"
          rows={data?.top_contracting || []}
          loading={loading}
          onAgencyClick={onAgencyClick}
        />
        <FpdsLeaderboardCard
          title="Top 10 Vendors"
          subtitle="The incumbents to KNOW — too big to team with. For partners, see Tier 2 below."
          rows={data?.top_vendors || []}
          loading={loading}
          linkVendor
          email={email}
        />
      </div>
    </section>
  );
}

function FpdsLeaderboardCard({
  title,
  subtitle,
  rows,
  loading,
  linkVendor,
  email,
  onAgencyClick,
}: {
  title: string;
  subtitle: string;
  rows: FpdsRow[];
  loading: boolean;
  linkVendor?: boolean;
  email?: string | null;
  /** Agency-card click handler. Wired only on the 3 agency cards
   *  (not vendors — vendors use ContractorLink). When provided, each
   *  row name becomes a button that filters the All Agencies table. */
  onAgencyClick?: (agencyName: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="mb-2">
        <h4 className="text-xs font-bold text-white uppercase tracking-wider">{title}</h4>
        <p className="text-[10px] text-slate-500">{subtitle}</p>
      </div>

      {loading && rows.length === 0 && (
        <div className="space-y-1.5 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 bg-slate-800 rounded" />
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-xs text-slate-500 italic">No data for this NAICS + filter.</p>
      )}

      {rows.length > 0 && (
        <ol className="space-y-1">
          {rows.slice(0, 10).map((row) => (
            <li key={`${row.rank}-${row.name}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 min-w-0 flex-1">
                <span className="shrink-0 inline-flex w-5 h-5 rounded-full bg-slate-800 text-slate-400 text-[10px] items-center justify-center font-semibold">
                  {row.rank}
                </span>
                {linkVendor && email ? (
                  <ContractorLink name={row.name} email={email} variant="plain" className="truncate text-slate-200 hover:text-white">
                    {row.name}
                  </ContractorLink>
                ) : onAgencyClick ? (
                  <button
                    type="button"
                    onClick={() => onAgencyClick(row.name)}
                    className="truncate text-left text-slate-200 hover:text-emerald-300 hover:underline cursor-pointer"
                    title={`Filter All Agencies table to ${row.name}`}
                  >
                    {row.name}
                  </button>
                ) : (
                  <span className="truncate text-slate-200">{row.name}</span>
                )}
              </span>
              <span className="shrink-0 text-emerald-400 font-semibold tabular-nums">
                {chartMoney(row.amount)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// MindyNarrative — Slice Mindy Says
// ---------------------------------------------------------------------
//
// Renders the Groq-generated market narrative + 3 recommended next
// actions in the purple gradient card at the bottom of the Market
// Map view. Self-contained: owns its own fetch state, caches via
// the endpoint's 7d server-side cache.
//
// Sources its prompt data from the same buyers / primes /
// satSummary the chart components already use — zero new data
// fetching per render. The endpoint call is the only network hit.

interface MindyNarrativeData {
  summary: string;
  actions: Array<{ label: string; link?: string }>;
}

function MindyNarrative({
  email,
  naicsCode,
  businessType,
  totalSpending,
  satTotal,
  agencyCount,
  topAgencies,
  topPrimes,
}: {
  email: string | null;
  naicsCode: string;
  businessType: string;
  totalSpending: number;
  satTotal: number;
  agencyCount: number;
  topAgencies: BuyerLike[];
  topPrimes: PrimeLike[];
}) {
  const [narrative, setNarrative] = useState<MindyNarrativeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeTeaser, setUpgradeTeaser] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  // Only fetch when we have enough data to be useful. No point
  // asking the model to summarize an empty market.
  useEffect(() => {
    if (!email || !naicsCode || !naicsCode.trim()) return;
    if (totalSpending === 0 && topAgencies.length === 0) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setUpgradeTeaser(null);

    fetch('/api/app/market-narrative', {
      method: 'POST',
      headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        email,
        naicsCode,
        businessType,
        totalSpending,
        satTotal,
        agencyCount,
        // Trim down what we send. Don't blast the whole agency
        // list — top 10 is what the prompt actually uses.
        topAgencies: topAgencies.slice(0, 10).map(a => ({
          contractingOffice: a.contractingOffice,
          parentAgency: a.parentAgency,
          subAgency: a.subAgency,
          spending: a.spending,
          contractCount: a.contractCount,
        })),
        topPrimes: topPrimes.slice(0, 5).map(p => ({ name: p.name, reason: p.reason })),
      }),
    })
      .then(async r => {
        const data = await r.json().catch(() => null);
        if (cancelled) return;
        if (r.status === 402 && data?.upgrade_required) {
          setUpgradeTeaser(data?.teaser?.summary || data?.message || 'Mindy Says is a Mindy Pro feature.');
          return;
        }
        if (!r.ok || !data?.success) {
          setError(data?.error || 'Could not load market narrative');
          return;
        }
        setNarrative(data.narrative);
        setCached(!!data.cached);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[MindyNarrative] fetch failed:', err);
        setError('Network error loading narrative');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  // We intentionally don't depend on topAgencies / topPrimes
  // identity — only their summary signals (totalSpending,
  // agencyCount) so we don't re-fetch every render. The endpoint
  // is cached so worst case is one extra round trip per stat
  // change, which is rare.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, naicsCode, businessType, totalSpending, satTotal, agencyCount]);

  // Free-tier teaser. Lives in the same card so the layout doesn't
  // shift between free and Pro users.
  if (upgradeTeaser) {
    return (
      <section className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-900/30 to-purple-800/10 p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-purple-300 text-lg">★</span>
          <h3 className="text-sm font-bold uppercase tracking-wider text-purple-300">Mindy Says</h3>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-purple-400/70">Pro feature</span>
        </div>
        <p className="text-sm text-slate-300 mb-3">{upgradeTeaser}</p>
        <a
          href="/market-intelligence"
          className="inline-block px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold"
        >
          Upgrade to Mindy Pro
        </a>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-purple-500/20 bg-gradient-to-br from-purple-900/20 to-purple-800/5 p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-purple-300 text-lg">★</span>
        <h3 className="text-sm font-bold uppercase tracking-wider text-purple-300">Mindy Says</h3>
        {cached && (
          <span className="ml-2 text-[10px] text-purple-400/60 uppercase tracking-wider">cached</span>
        )}
      </div>

      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-slate-700/60 rounded w-full" />
          <div className="h-3 bg-slate-700/60 rounded w-11/12" />
          <div className="h-3 bg-slate-700/60 rounded w-4/5" />
        </div>
      )}

      {error && (
        <p className="text-sm text-slate-400 italic">{error}</p>
      )}

      {!loading && !error && !narrative && (
        <p className="text-sm text-slate-500 italic">
          Build the report to load the AI market analysis.
        </p>
      )}

      {narrative && (
        <>
          <p className="text-sm text-slate-200 leading-relaxed mb-4">
            {narrative.summary}
          </p>
          {narrative.actions.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-purple-400/80 mb-2">
                Recommended next actions
              </p>
              <ul className="space-y-1.5">
                {narrative.actions.map((action, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-purple-400 text-xs mt-0.5 shrink-0">{idx + 1}.</span>
                    {action.link ? (
                      <a
                        href={action.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-purple-200 underline-offset-2 hover:underline"
                      >
                        {action.label}
                      </a>
                    ) : (
                      <span>{action.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// AgencyTable — Slice 1.5C
// ---------------------------------------------------------------------
//
// Renders all N target offices (60-100 typical) with 4 sortable
// metrics. Replaces the legacy 3-card "BEST / STRONGEST / COMPETITION"
// black box. Data comes from /api/app/target-market-research.
//
// Sort lenses correspond 1:1 to the metric_* fields the endpoint
// pre-computes server-side. Switching a lens does NOT re-fetch — it
// just re-sorts the existing rows.
//
// Methodology selectors on the 3 quick-pick cards above the table
// let users override which metric drives each card. Per the Tesla
// steering-wheel feedback: every "best by" call has a Why? tooltip
// + a metric dropdown so power users can drive.
type SortLens = 'top_total' | 'top_spending' | 'civilian_first' | 'easy_entry' | 'contracts';
type QuickPickKind = 'biggest_spender' | 'strongest_signal' | 'low_competition';

interface AgencyTableRow {
  id: string;
  name: string;
  contractingOffice: string;
  subAgency: string;
  parentAgency: string;
  officeId: string;
  location: string;
  setAsideSpending: number;
  totalSpending: number;          // All contracts (no set-aside filter)
  contractCount: number;
  satSpending: number;
  satContractCount: number;
  metric_top_spending: number;
  metric_top_total: number;       // For "Top Total $" sort lens
  metric_contracts: number;
  metric_easy_entry: number;
  metric_budget_growth: number;
  painPointCount: number;
  openOppCount: number;
  upcomingEventCount: number;
  satRatio: number;
  isSubAgency: boolean;
  // Triage decision intel added 2026-05-25 (v1 card upgrade)
  avgBidders?: number | null;     // Avg # offers per contract; null when no data
  uniqueVendorCount?: number;     // Distinct primes who won at this office
  smallBizPercent?: number | null;  // 0..1 from SBA Goaling FY23 (parent level)
  topPrimes?: Array<{ name: string; contractCount?: number; totalValue?: number }>;
}

// Sort lenses surfaced to the user. Slimmed May 23, 2026 per Eric:
// removed A-Z (nobody picks federal agencies alphabetically) and
// Budget Growth (was hardcoded zero pending FY-broken USAspending
// data — surfacing a dead chip is worse than not having one). Four
// lenses remain, each backed by real data that varies across rows:
//
//   - Top Spending  : metric_top_spending (set-aside $)
//   - Civilian First: partition by isDodAgency, then by spend
//   - Small Biz %   : sbShareFor(row) from SBA Goaling Report
//   - Contracts     : metric_contracts (raw contract count)
//
// Budget Growth deferred to a future commit when we wire
// USAspending's annual breakdown — captured in the TODO grep
// 'metric_budget_growth' for future-finder context.
const SORT_LENSES: Array<{ id: SortLens; label: string; hint: string }> = [
  { id: 'top_total',     label: 'Top Total $',      hint: 'Biggest total contract spend in your NAICS — surfaces market giants like USACE/NAVFAC even when their set-aside spend is small' },
  { id: 'top_spending',  label: 'Top Set-Aside $',  hint: 'Biggest set-aside pie in your NAICS — what gets carved out for your business type' },
  // "Civilian First" surfaces non-DOD agencies at the top, sorted
  // by spend within the civilian group. DOD agencies still appear
  // (sorted by spend among themselves) but at the bottom of the
  // list. Mental model per Eric: DOD is always #1 by total spend,
  // but for new entrants civilian agencies (HHS, GSA, VA, etc.)
  // are often easier to break into — simpler procurement, less
  // crowded vendor density, more SAT contracts. Toggle when
  // you're looking for first-contract candidates.
  { id: 'civilian_first', label: 'Civilian First',  hint: 'Non-DOD agencies first — often easier for new entrants' },
  { id: 'easy_entry',    label: 'Easy Entry (SAT)', hint: 'Highest share of contracts under the $250K Simplified Acquisition Threshold — the easiest entry points for new contractors (weighted by volume). Most useful for services/products; construction rarely has SAT-eligible spend.' },
  { id: 'contracts',     label: 'Contracts',        hint: 'Most contract awards in your NAICS — high-frequency buyers' },
];

// DOD recognition: substring matches against the agency name. Covers
// the variants USAspending returns ("Department of Defense", "Air
// Force", "Army", "Navy", etc.) plus their canonical abbrev. Keep
// case-insensitive; sub_agency names get checked too in the sort.
const DOD_AGENCY_PATTERNS = [
  'department of defense',
  'dod',
  'air force',
  'army',
  'navy',
  'marine',
  'defense logistics',
  'missile defense',
  'defense health',
  'defense advanced',  // DARPA
  'defense information', // DISA
  'defense threat',     // DTRA
  'national guard',
];
function isDodAgency(row: AgencyTableRow): boolean {
  const haystack = `${row.parentAgency || ''} ${row.subAgency || ''}`.toLowerCase();
  return DOD_AGENCY_PATTERNS.some(p => haystack.includes(p));
}

function formatRowCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

function AgencyTable({
  email,
  naicsCode,
  pscCode,
  businessType,
  veteranStatus,
  zipCode,
  excludeDOD,
  keyword,
  profileKeywords,
  onRowsChange,
  onSelectedAgenciesChange,
  parentAgencyFilter,
  onClearParentFilter,
  onLoadingChange,
}: {
  email: string | null;
  naicsCode: string;
  pscCode: string;
  businessType: string;
  veteranStatus: string;
  zipCode: string;
  excludeDOD: boolean;
  /** Sport-mode keyword — drives keyword-first NAICS coverage on the server. */
  keyword?: string;
  /** Saved profile keywords — unioned into agency discovery in Auto mode. */
  profileKeywords?: string[];
  // Optional escape hatch — parent can subscribe to the full row
  // set so the upstream charts (Spending by Agency, Set-Aside Mix)
  // can render from the same 96-row data this table uses, not the
  // legacy 7-row reportData.governmentBuyers path.
  onRowsChange?: (rows: AgencyTableRow[]) => void;
  /** Fires with the parent-agency names the user has STARRED, so the
   *  parent can scope report generation to the user's selection. */
  onSelectedAgenciesChange?: (agencies: string[]) => void;
  /** Set by FpdsLeaderboards click. Filters rows to a single parent
   *  agency (substring-matched against row.parentAgency or row.subAgency).
   *  Null = no filter. */
  parentAgencyFilter?: string | null;
  /** Clear handler, fired by the filter pill's X button. */
  onClearParentFilter?: () => void;
  /** Bubbles the agency-fetch loading state up so the panel header can show a
   *  moving indicator while the slow find-agencies call is still in flight. */
  onLoadingChange?: (loading: boolean) => void;
}) {
  const [rows, setRows] = useState<AgencyTableRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Bubble the agency-fetch loading state to the panel header so it can show a
  // moving indicator (the find-agencies call runs ~3-8s after the leaderboards
  // already rendered — users couldn't tell more was still coming).
  useEffect(() => { onLoadingChange?.(loading); }, [loading, onLoadingChange]);
  const [error, setError] = useState<string | null>(null);
  // Populated when find-agencies rejects the NAICS itself (invalid_naics).
  // Lets the error block offer real replacement codes instead of a dead end.
  const [naicsSuggestions, setNaicsSuggestions] = useState<Array<{ code: string; name: string }>>([]);
  const [activeLens, setActiveLens] = useState<SortLens>('top_total');
  // SBA Goaling small-business share per agency name. Populated by a
  // bulk fetch once rows arrive. Keyed by the agency name we PASSED
  // (parent or subAgency) so lookup in the row render is O(1).
  // Missing entry = no SBA data for that agency; UI shows "—".
  const [sbShareByAgency, setSbShareByAgency] = useState<Record<string, number>>({});
  const [quickPick, setQuickPick] = useState<Record<QuickPickKind, SortLens>>({
    biggest_spender: 'top_spending',
    strongest_signal: 'top_spending',   // overridden after fetch via painPointCount
    low_competition: 'top_spending',    // overridden after fetch via openOppCount inverse
  });
  const [cached, setCached] = useState(false);
  const [freeTierLimited, setFreeTierLimited] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Slice 1.5D — drawer for office detail. Holds the row currently
  // being inspected. Null = drawer closed. Persists between sort/lens
  // changes so a user can browse the row list without losing their
  // active selection.
  const [selectedRow, setSelectedRow] = useState<AgencyTableRow | null>(null);

  // Slice 3B — saved targets state. Map of office_name → target row id
  // so we know (a) which rows show the ★ saved indicator and (b) which
  // id to pass to DELETE on Undo. Hydrated once on mount via
  // GET /api/app/target-list. We update the map optimistically when
  // the user clicks Add / Remove inside the drawer.
  const [savedTargets, setSavedTargets] = useState<Record<string, string>>({});

  // Office drill-down (Eric: break out USACE/NAVFAC). Expand an agency row to
  // see its real buying offices for this NAICS (BQ awards data).
  const [expandedOffices, setExpandedOffices] = useState<Record<string, { loading: boolean; offices: Array<{ name: string; total: number; awards: number }> }>>({});
  const toggleOffices = useCallback(async (row: AgencyTableRow) => {
    const key = row.id;
    const ag = row.subAgency || row.parentAgency || row.name;
    setExpandedOffices(prev => {
      if (prev[key]) { const n = { ...prev }; delete n[key]; return n; } // collapse
      return { ...prev, [key]: { loading: true, offices: [] } };
    });
    // only fetch when expanding (not when collapsing)
    if (expandedOffices[key]) return;
    try {
      const res = await fetch(`/api/app/agency-offices?email=${encodeURIComponent(email || '')}&agency=${encodeURIComponent(ag)}&naics=${encodeURIComponent(naicsCode)}`, { headers: getMIApiHeaders(email) });
      const d = await res.json();
      setExpandedOffices(prev => ({ ...prev, [key]: { loading: false, offices: d.offices || [] } }));
    } catch {
      setExpandedOffices(prev => ({ ...prev, [key]: { loading: false, offices: [] } }));
    }
  }, [email, naicsCode, expandedOffices]);

  // Report the distinct PARENT AGENCIES of starred rows up to the
  // parent, so report generation can scope to the user's selection.
  // Keyed lookup matches how savedTargets is keyed (office || name).
  useEffect(() => {
    if (!onSelectedAgenciesChange) return;
    const starred = rows.filter(r => savedTargets[r.contractingOffice || r.name]);
    const agencies = uniqueStrings(
      starred.map(r => r.parentAgency || r.subAgency || r.name).filter(Boolean)
    );
    onSelectedAgenciesChange(agencies);
    // rows + savedTargets are the inputs; callback is stable from parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, savedTargets]);

  // Triage flow state. Modal opens via 'Start Tracking' CTA. Dismissed
  // set comes from /api/app/triage GET — agencies the user has already
  // skipped or deferred for this NAICS profile so the modal doesn't
  // surface them again.
  const [triageOpen, setTriageOpen] = useState(false);
  const [dismissedOfficeNames, setDismissedOfficeNames] = useState<Set<string>>(new Set());
  const { showToast: showAgencyToast } = useToast();

  // Fetch happens once per (naics, psc, businessType, veteran) combo.
  // The endpoint itself does the 24h cache layer — we just call it.
  useEffect(() => {
    const sportKw = (keyword || '').trim();
    if (!email || (!naicsCode.trim() && !sportKw)) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNaicsSuggestions([]);

    fetch('/api/app/target-market-research', {
      method: 'POST',
      headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        email,
        keyword: sportKw || undefined,
        profileKeywords: profileKeywords?.length ? profileKeywords : undefined,
        naicsCode,
        pscCode,
        businessType,
        veteranStatus,
        zipCode,
        excludeDOD,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (!data?.success) {
          // invalid_naics → show the friendly message + replacement codes the
          // route now passes through, not the raw "invalid_naics" token.
          if (data?.error === 'invalid_naics') {
            setError(data.message || data.naicsValidationError || `The NAICS code "${naicsCode}" isn't valid. Update your profile with a real code.`);
            setNaicsSuggestions(Array.isArray(data.suggestedNaicsCodes) ? data.suggestedNaicsCodes : []);
          } else {
            setError(data?.error || 'Could not load research data');
          }
          setRows([]);
          onRowsChange?.([]);
          return;
        }
        const nextRows = (data.agencies || []) as AgencyTableRow[];
        setRows(nextRows);
        setCached(!!data.cached);
        setFreeTierLimited(!!data.free_tier_limited);
        // Bubble the full row set to the parent for chart rendering.
        // Done inside the success branch so we never send the parent
        // a stale array during an error retry.
        onRowsChange?.(nextRows);

        // Bulk-fetch SBA Goaling small-business share for the
        // unique parent agencies in this row set. ONE network call
        // → instant lookup per row in the table cell. Failures are
        // silent: rows fall back to "—" in the "% SB" column.
        const uniqueAgencies = Array.from(new Set(
          nextRows
            .map((r) => r.parentAgency || r.subAgency || r.name)
            .filter(Boolean)
        ));
        if (uniqueAgencies.length > 0) {
          fetch('/api/sba-goaling/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agencies: uniqueAgencies }),
          })
            .then((r) => r.json())
            .then((sbaData) => {
              if (cancelled || !sbaData?.success) return;
              const map: Record<string, number> = {};
              for (const [name, info] of Object.entries(sbaData.matches || {})) {
                const share = (info as { small_business_share: number }).small_business_share;
                if (typeof share === 'number') map[name] = share;
              }
              setSbShareByAgency(map);
            })
            .catch((sbaErr) => {
              if (cancelled) return;
              console.warn('[AgencyTable] SBA bulk fetch failed (non-fatal):', sbaErr);
            });
        }
      })
      .catch(err => {
        if (cancelled) return;
        console.error('[AgencyTable] fetch failed:', err);
        setError('Network error loading research data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [email, naicsCode, pscCode, businessType, veteranStatus, zipCode, excludeDOD, keyword, profileKeywords?.join('|'), onRowsChange]);

  // Slice 3B — fetch my saved target list once per email change. We
  // store (office_name → target_id) so the row ★ indicator and the
  // drawer's Add/Remove button can both look up state instantly.
  // Fire-and-forget: failure leaves savedTargets empty, which means
  // the drawer button defaults to "Add" — degrading gracefully if
  // the endpoint is misbehaving.
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    fetch(`/api/app/target-list?email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.success) return;
        const map: Record<string, string> = {};
        for (const t of data.targets || []) {
          if (t.office_name && t.id) map[t.office_name] = t.id;
        }
        setSavedTargets(map);
      })
      .catch(err => console.warn('[AgencyTable] target-list fetch failed:', err));
    return () => { cancelled = true; };
  }, [email]);

  // Triage flow context — fetch dismissed office names so the
  // StartTrackingModal doesn't surface them. Re-fetches when NAICS
  // changes since dismissals are profile-scoped.
  useEffect(() => {
    if (!email || !naicsCode.trim()) return;
    let cancelled = false;
    fetch(`/api/app/triage?email=${encodeURIComponent(email)}&naics=${encodeURIComponent(naicsCode)}`, { headers: getMIApiHeaders(email) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.success) return;
        setDismissedOfficeNames(new Set(data.dismissed_office_names || []));
      })
      .catch(err => console.warn('[AgencyTable] triage context fetch failed:', err));
    return () => { cancelled = true; };
  }, [email, naicsCode]);

  // Slice 3B — add an office to my target list. Optimistic flip on
  // success, server-side Pro gate (402) surfaces as the upgrade toast.
  // Drawer calls this via the `onAddToList` prop.
  const handleAddToList = useCallback(async (row: AgencyTableRow) => {
    if (!email) {
      showAgencyToast({ message: 'Sign in before saving targets', variant: 'error' });
      return;
    }
    if (savedTargets[row.contractingOffice || row.name]) {
      showAgencyToast({ message: 'Already in your target list', variant: 'info' });
      return;
    }

    const officeName = row.contractingOffice || row.name;
    // Optimistic placeholder id so the UI flips immediately. We swap
    // it for the real id once the server responds.
    const tempId = `optimistic-${Date.now()}`;
    setSavedTargets(prev => ({ ...prev, [officeName]: tempId }));

    try {
      const res = await fetch('/api/app/target-list', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_email: email,
          agency_name: row.parentAgency || row.subAgency || row.name,
          sub_agency_name: row.subAgency || null,
          office_code: row.officeId || null,
          office_name: officeName,
          location: row.location || null,
          set_aside_spending: row.setAsideSpending,
          contract_count: row.contractCount,
          sat_ratio: row.satRatio,
          pain_point_count: row.painPointCount,
          open_opp_count: row.openOppCount,
          upcoming_event_count: row.upcomingEventCount,
          // Provenance — the active search filters that surfaced this
          // office. naicsCode/pscCode are AgencyTable props. Lets My
          // Target List show "surfaced from PSC D316" (roadmap Slice 5b).
          source_naics: naicsCode || null,
          source_psc: pscCode || null,
          added_from: 'research_drawer',
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 402 && data?.upgrade_required) {
        // Roll back optimistic + surface upgrade pitch.
        setSavedTargets(prev => {
          const next = { ...prev };
          delete next[officeName];
          return next;
        });
        showAgencyToast({
          message: data.message || 'Saving target lists is a Mindy Pro feature',
          variant: 'info',
          action: { label: 'Upgrade', onClick: () => { window.location.href = '/market-intelligence'; } },
        });
        return;
      }
      if (res.status === 409 || data?.already_saved) {
        // Server already had this office — flip our state to whatever
        // the server says is the real id by refetching the list.
        // Cheap fallback: pretend our optimistic id is correct; next
        // mount refresh fixes it.
        showAgencyToast({ message: 'Already in your target list', variant: 'info' });
        return;
      }
      if (!res.ok || !data?.success) {
        setSavedTargets(prev => {
          const next = { ...prev };
          delete next[officeName];
          return next;
        });
        showAgencyToast({
          message: data?.error || 'Could not save to target list',
          variant: 'error',
        });
        return;
      }

      // Success — replace optimistic id with the real one.
      const realId = data.target?.id as string | undefined;
      if (realId) {
        setSavedTargets(prev => ({ ...prev, [officeName]: realId }));
      }
      showAgencyToast({
        message: `Saved ${officeName} to your target list`,
        variant: 'success',
        action: realId ? {
          label: 'Undo',
          onClick: () => handleRemoveFromList(officeName, realId),
        } : undefined,
      });
    } catch (err) {
      console.error('[AgencyTable] add to list failed:', err);
      setSavedTargets(prev => {
        const next = { ...prev };
        delete next[officeName];
        return next;
      });
      showAgencyToast({ message: 'Network error — could not save', variant: 'error' });
    }
  // handleRemoveFromList is hoisted below — TS sees the binding via
  // closure of useCallback's stale-deps lint. Adding to deps later if
  // the linter complains.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, savedTargets, showAgencyToast, naicsCode, pscCode]);

  // Slice 3B — remove from my target list. Used by the drawer Remove
  // button AND by the Undo action on the success toast.
  const handleRemoveFromList = useCallback(async (officeName: string, targetId: string) => {
    if (!email) return;

    // Optimistic remove.
    setSavedTargets(prev => {
      const next = { ...prev };
      delete next[officeName];
      return next;
    });

    try {
      const res = await fetch('/api/app/target-list', {
        method: 'DELETE',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: targetId, user_email: email }),
      });
      if (!res.ok) {
        // Roll back if delete failed — better to show a stuck "saved"
        // than silently drop the user's saved row.
        setSavedTargets(prev => ({ ...prev, [officeName]: targetId }));
        const data = await res.json().catch(() => null);
        showAgencyToast({
          message: data?.error || 'Could not remove from list',
          variant: 'error',
        });
        return;
      }
      showAgencyToast({ message: `Removed ${officeName}`, variant: 'info' });
    } catch (err) {
      console.error('[AgencyTable] remove from list failed:', err);
      setSavedTargets(prev => ({ ...prev, [officeName]: targetId }));
      showAgencyToast({ message: 'Network error — could not remove', variant: 'error' });
    }
  }, [email, showAgencyToast]);

  // Resolve the small-business share for a row using the SBA Goaling
  // bulk fetch results. Multiple offices roll up to the same parent
  // agency (Federal Highway → DOT), so look up by parent first, fall
  // back to subAgency, then name. Returns 0 when no match (which we
  // render as "—" in the cell rather than literal 0%).
  const sbShareFor = (row: AgencyTableRow): number => {
    return (
      sbShareByAgency[row.parentAgency] ??
      sbShareByAgency[row.subAgency] ??
      sbShareByAgency[row.name] ??
      0
    );
  };

  // Pure sort step. The endpoint pre-computes every metric_* field so
  // switching lenses is a client-only re-sort with no network call.
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    switch (activeLens) {
      case 'top_total':
        copy.sort((a, b) => b.metric_top_total - a.metric_top_total);
        break;
      case 'top_spending':
        copy.sort((a, b) => b.metric_top_spending - a.metric_top_spending);
        break;
      case 'civilian_first':
        // Civilians first, then DOD. Within each group, sort by
        // spend descending so the biggest pie surfaces inside each
        // bucket. Mental model: "I want to see HHS and GSA at the
        // top of my list, not 5 different DOD sub-agencies."
        copy.sort((a, b) => {
          const aDod = isDodAgency(a) ? 1 : 0;
          const bDod = isDodAgency(b) ? 1 : 0;
          if (aDod !== bDod) return aDod - bDod;  // civilians (0) come before DOD (1)
          return b.metric_top_spending - a.metric_top_spending;
        });
        break;
      case 'easy_entry':
        // SAT% sort (restored Jun 23, 2026 per Eric — "swap back, don't add
        // another column"). metric_easy_entry = satRatio × √satContractCount:
        // the share of an office's contracts under the $250K Simplified
        // Acquisition Threshold, weighted by how many such contracts exist so
        // high-volume easy-entry offices outrank a 1-contract 100% fluke.
        // Caveat: collapses to 0 for NAICS with no SAT-eligible spend (e.g.
        // construction) — by design; the lens is for services/products.
        copy.sort((a, b) => b.metric_easy_entry - a.metric_easy_entry);
        break;
      case 'contracts':
        copy.sort((a, b) => b.metric_contracts - a.metric_contracts);
        break;
    }
    return copy;
  // sbShareByAgency is read via sbShareFor() closure inside the
  // easy_entry case. Must be a dep so the sort reorders when the
  // SBA bulk fetch returns after the initial render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, activeLens, sbShareByAgency]);

  // Triage candidate list: sorted rows minus already-tracked + dismissed.
  // Uses sortedRows (not filteredRows) so the parent-agency filter
  // doesn't accidentally limit triage scope — the modal should always
  // see the full eligible set, not the filtered view.
  //
  // IMPORTANT: This useMemo + the useCallback below MUST live before
  // the early returns at lines ~3660-3697 (no naics / loading / error /
  // no rows). React's hook order must be identical across renders; if
  // these hooks land AFTER an early return, they only run on some
  // renders → 'Rendered more hooks than during the previous render' →
  // white-screen crash. This bit us once already (commit feb239b,
  // rolled back, fixed in 49 — see tasks/lessons.md if it exists).
  const triageCandidates: TriageAgencyCard[] = useMemo(() => {
    return sortedRows
      .filter(r => {
        const officeName = r.contractingOffice || r.name;
        if (savedTargets[officeName]) return false;            // already tracked
        if (dismissedOfficeNames.has(officeName)) return false; // already skipped / deferred
        return true;
      })
      .map(r => ({
        id: r.id,
        name: r.name,
        contractingOffice: r.contractingOffice,
        subAgency: r.subAgency,
        parentAgency: r.parentAgency,
        officeId: r.officeId,
        location: r.location,
        totalSpending: r.totalSpending,
        setAsideSpending: r.setAsideSpending,
        contractCount: r.contractCount,
        satRatio: r.satRatio,
        satContractCount: r.satContractCount,
        painPointCount: r.painPointCount,
        openOppCount: r.openOppCount,
        upcomingEventCount: r.upcomingEventCount,
        // Decision intel v1 (2026-05-25): server-derived in TMR
        // route — all four signals arrive with the row.
        avgBidders: r.avgBidders,
        uniqueVendorCount: r.uniqueVendorCount,
        smallBizPercent: r.smallBizPercent,
        topPrimes: r.topPrimes,
      }));
  }, [sortedRows, savedTargets, dismissedOfficeNames]);

  // After a triage action, update local state so the table + modal
  // stay in sync without a full refetch. Also fire a toast — without
  // it the modal silently swaps cards and users think Track did
  // nothing (Eric reported this 2026-05-25, after the modal was
  // already working). Toast confirms the action took.
  const handleTriageAction = useCallback((action: 'track' | 'defer' | 'skip', officeName: string) => {
    // Truncate long office names to keep toast readable
    const shortName = officeName.length > 40 ? `${officeName.slice(0, 37)}…` : officeName;
    if (action === 'track') {
      // Optimistic flip — server returns the new target_id but we
      // don't need it for the ★ indicator; any truthy value works.
      // Next page navigation re-fetches anyway.
      setSavedTargets(prev => ({ ...prev, [officeName]: 'pending' }));
      showAgencyToast({ message: `✓ Tracked: ${shortName}`, variant: 'success' });
    } else {
      setDismissedOfficeNames(prev => {
        const next = new Set(prev);
        next.add(officeName);
        return next;
      });
      if (action === 'defer') {
        showAgencyToast({ message: `⏱ Deferred 30 days: ${shortName}`, variant: 'info' });
      } else {
        showAgencyToast({ message: `✕ Skipped: ${shortName}`, variant: 'info' });
      }
    }
  }, [showAgencyToast]);

  // Per-lens "is this lens inert on the current data" check. If a
  // lens would produce zero visible movement (because every row has
  // metric=0, or every row is the same agency-class, etc.) the chip
  // gets disabled with an explanatory tooltip — better than the user
  // clicking and thinking the feature is broken.
  //
  // For each lens we compute the discriminator quickly. Inert iff:
  //   - All rows have the same metric value (sort wouldn't reorder),
  //     OR
  //   - The metric is hardcoded zero (budget_growth in v1)
  const lensIsInert = useMemo(() => {
    const allRows = rows;
    const checkVariance = (getter: (r: AgencyTableRow) => number) => {
      if (allRows.length < 2) return true;
      const first = getter(allRows[0]);
      return allRows.every((r) => getter(r) === first);
    };
    return {
      top_total: checkVariance((r) => r.metric_top_total),
      top_spending: false,  // The default sort; always functional
      civilian_first: (() => {
        // Inert when all rows are civilian OR all are DOD.
        const dodCount = allRows.filter(isDodAgency).length;
        return dodCount === 0 || dodCount === allRows.length;
      })(),
      // easy_entry now sorts by SBA Goaling SB% (via sbShareFor).
      // Inert when no agency in the result has any SBA data — i.e.
      // the bulk fetch returned 0 matches, or every match is 0.
      easy_entry: allRows.every((r) => sbShareFor(r) === 0),
      contracts: checkVariance((r) => r.metric_contracts),
    };
  // sbShareByAgency must be a dep — without it the easy_entry inert
  // check would lock to its initial value (all zeros) on first render
  // before the SBA bulk fetch returns. Same reason sortedRows reads
  // sbShareByAgency through sbShareFor() but doesn't list it explicitly
  // (React's memo invalidation chain catches it via rows + activeLens).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sbShareByAgency]);

  // Pick the row that wins each quick-pick category using the user's
  // selected metric. The dropdowns on the cards write into quickPick
  // state and we recompute from sortedRows-style logic.
  const quickPicks = useMemo(() => {
    const pickBy = (lens: SortLens, mode: 'high' | 'low' = 'high'): AgencyTableRow | undefined => {
      if (rows.length === 0) return undefined;
      const copy = [...rows];
      const metric = (r: AgencyTableRow): number => {
        switch (lens) {
          case 'top_total':      return r.metric_top_total;
          case 'top_spending':   return r.metric_top_spending;
          // civilian_first ranks DOD lower by giving them a
          // negative spend signal — quick-pick still picks the
          // top civilian agency.
          case 'civilian_first': return isDodAgency(r) ? -1 : r.metric_top_spending;
          // easy_entry now sorts by SBA Goaling SB% per parent agency.
          // metric_easy_entry on the row is the legacy SAT-based score,
          // which is still useful as a tie-breaker but no longer the
          // primary signal. Using row-level metric_easy_entry keeps
          // the quick-pick consistent with the legacy behavior; the
          // main table sort uses sbShareFor() instead.
          case 'easy_entry':     return r.metric_easy_entry;
          case 'contracts':      return r.metric_contracts;
        }
      };
      copy.sort((a, b) => mode === 'high' ? metric(b) - metric(a) : metric(a) - metric(b));
      return copy[0];
    };
    return {
      biggest_spender:  pickBy(quickPick.biggest_spender, 'high'),
      strongest_signal: rows.length > 0
        ? [...rows].sort((a, b) => b.painPointCount - a.painPointCount)[0]
        : undefined,
      low_competition: rows.length > 0
        // Fewest open opps = least crowded near-term competition
        ? [...rows].sort((a, b) => a.openOppCount - b.openOppCount)[0]
        : undefined,
    };
  }, [rows, quickPick]);

  if (!naicsCode.trim() && !keyword?.trim()) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <p className="text-sm text-slate-400">
          Enter a keyword or NAICS/PSC code, then click Build Market Map to load agencies.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" strokeWidth={2.5} />
          Loading agency data…
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-300">
        <p>{error}</p>
        {naicsSuggestions.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-red-200/80 mb-1.5">Try one of these codes (update them in your profile / the “Explore a Different Market” box):</p>
            <div className="flex flex-wrap gap-1.5">
              {naicsSuggestions.map((s) => (
                <span
                  key={s.code}
                  className="rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-100"
                  title={s.name}
                >
                  <span className="font-mono font-semibold">{s.code}</span> · {s.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <p className="text-sm text-slate-400">No agencies found for this profile.</p>
      </section>
    );
  }

  // Apply parent-agency filter from FpdsLeaderboards clicks. Case-
  // insensitive substring match against parentAgency or subAgency so
  // 'Department of the Army' matches rows whose parentAgency is
  // 'Department of Defense' but subAgency is 'Department of the Army'.
  const filteredRows = parentAgencyFilter
    ? sortedRows.filter((r) => {
        const needle = parentAgencyFilter.toLowerCase();
        // FPDS "Department of Defense" → match all service branches (Army/Navy/Air
        // Force rows use those as parent/sub, not the top-level DoD label).
        if (needle.includes('defense') && isDodAgency(r)) return true;
        return (
          (r.parentAgency || '').toLowerCase().includes(needle) ||
          (r.subAgency || '').toLowerCase().includes(needle) ||
          (r.name || '').toLowerCase().includes(needle)
        );
      })
    : sortedRows;

  // "Selected first, then toggle to all" — like the rest of Market
  // Research. The agencies the user starred (savedTargets) float to the
  // top and are always visible; "Show all" reveals the full list. When
  // nothing is starred yet, fall back to the prior top-10 preview.
  const isRowSelected = (r: AgencyTableRow) => !!savedTargets[r.contractingOffice || r.name];
  const selectedRows = filteredRows.filter(isRowSelected);
  const unselectedRows = filteredRows.filter(r => !isRowSelected(r));
  const hasSelection = selectedRows.length > 0;
  const visibleRows = showAll
    ? [...selectedRows, ...unselectedRows]
    : hasSelection
      ? selectedRows                                  // selected agencies only, until "Show all"
      : filteredRows.slice(0, 10);                    // no selection → top-10 preview

  // (triageCandidates + handleTriageAction were defined above, before
  // the early returns, to avoid the React 'rendered more hooks than
  // previous render' crash that hit in commit feb239b.)

  return (
    <section className="space-y-4">
      {/* Quick-pick cards with methodology selectors. Each card shows
          which agency the LENS picked, plus a Why? tooltip explaining
          the metric, plus a dropdown letting power users swap the
          ranking rule. This is the Tesla steering-wheel fix. */}
      <div className="grid gap-3 lg:grid-cols-3">
        <QuickPickCard
          title="BIGGEST SPENDER"
          winner={quickPicks.biggest_spender}
          metricLabel="Spend"
          metricValue={quickPicks.biggest_spender ? formatRowCurrency(quickPicks.biggest_spender.metric_top_spending) : '—'}
          selectedLens={quickPick.biggest_spender}
          onLensChange={(lens) => setQuickPick(prev => ({ ...prev, biggest_spender: lens }))}
          rule="Highest tracked spending in your NAICS"
        />
        <QuickPickCard
          title="STRONGEST SIGNAL"
          winner={quickPicks.strongest_signal}
          metricLabel="Pain Points"
          metricValue={quickPicks.strongest_signal ? String(quickPicks.strongest_signal.painPointCount) : '—'}
          // Strongest signal currently fixed at pain-point count; future
          // versions could let users swap to "most upcoming events" or
          // "most recent awards" — leaving the prop here for that.
          selectedLens={null}
          onLensChange={undefined}
          rule="Most pain points + priorities logged for this agency. Hand-curated from GAO reports + agency strategic plans."
        />
        <QuickPickCard
          title="LOW COMPETITION"
          winner={quickPicks.low_competition}
          metricLabel="Open Opps"
          metricValue={quickPicks.low_competition ? String(quickPicks.low_competition.openOppCount) : '—'}
          selectedLens={null}
          onLensChange={undefined}
          rule="Fewest open SAM.gov solicitations right now. Less crowded near-term competition."
        />
      </div>

      {/* Data accuracy disclaimer — set expectations while we wait on
          SAM.gov System Account approval for true office-level data.
          USAspending caps award-level fetches at 10K so office $ is
          sampled, not total. Sub-agency $ aggregates from the same
          sample. Honest > silent. Remove when SAM access lands. */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
        <div className="flex items-start gap-2">
          <span className="text-amber-400 mt-0.5">ⓘ</span>
          <div className="flex-1">
            <span className="font-semibold text-amber-100">Data accuracy: limited</span>
            <span className="text-amber-300/80"> · Office-level dollar amounts are sampled from USAspending&apos;s public API (capped at 10K awards), not full totals. Use them as relative signal, not authoritative spend. True office-level data (NAVFAC Mid-Atlantic vs NAVFAC Pacific etc.) is coming once our SAM.gov Contract Data API access is approved (2-4 weeks). For accurate parent-agency totals in the meantime, see the &ldquo;FUNDING AGENCIES&rdquo; leaderboard above.</span>
          </div>
        </div>
      </div>

      {/* The agency table itself. Sort lens chips drive the order. */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="border-b border-slate-800 p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">
              {hasSelection && !showAll
                ? `Your Selected Agencies (${selectedRows.length})`
                : `All Agencies (${filteredRows.length}${parentAgencyFilter ? ` of ${rows.length}` : ''} found)`}
            </h3>
            <p className="text-xs text-slate-500">
              Sort lenses re-rank the same data — no re-fetch.
              {cached && <span className="ml-1 text-emerald-400">· cached</span>}
              {freeTierLimited && <span className="ml-1 text-amber-400">· Free tier shows top 10; upgrade for the full list</span>}
            </p>
            {parentAgencyFilter && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
                <span>Filtered: {parentAgencyFilter}</span>
                {onClearParentFilter && (
                  <button
                    type="button"
                    onClick={onClearParentFilter}
                    className="text-emerald-300 hover:text-white"
                    aria-label="Clear filter"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Start Tracking CTA — opens the triage flow modal. Disabled
                when no candidates remain (everything tracked or
                dismissed). Sized prominently to draw attention as the
                primary action on this table. */}
            <button
              type="button"
              onClick={() => setTriageOpen(true)}
              disabled={triageCandidates.length === 0}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
              title={triageCandidates.length === 0
                ? 'No offices left to triage — refresh the report or unskip dismissed targets.'
                : `Triage ${triageCandidates.length} offices — Track / Defer / Skip one at a time`}
            >
              Start Tracking →
              <span className="ml-1.5 text-[10px] font-normal text-emerald-200">
                {triageCandidates.length} ready
              </span>
            </button>
            {SORT_LENSES.map(lens => {
              const inert = lensIsInert[lens.id];
              // Per-lens reason copy. Surfaces in the tooltip so a
              // disabled chip explains itself instead of looking
              // broken.
              const inertReason = inert
                ? lens.id === 'civilian_first'
                  ? 'All agencies in this NAICS are the same class — sort would not change order.'
                  : lens.id === 'easy_entry'
                    ? 'Small business data from SBA Goaling not loaded for these agencies yet.'
                    : 'All rows have the same value for this metric.'
                : null;
              return (
                <button
                  key={lens.id}
                  onClick={() => { if (!inert) setActiveLens(lens.id); }}
                  disabled={inert}
                  title={inertReason || lens.hint}
                  className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                    inert
                      ? 'bg-slate-900 text-slate-600 cursor-not-allowed border border-slate-800'
                      : activeLens === lens.id
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {lens.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Agency / Office</th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  title="Total contract spend by this office on your NAICS (no set-aside filter). Surfaces market giants like USACE/NAVFAC."
                >Total $</th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  title="Set-aside-only spend by this office (filtered to contracts that match your business type)."
                >Set-Aside $</th>
                <th className="text-right px-4 py-2 font-medium">Contracts</th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  title="% of this agency's FY23 contracting that went to small businesses. Source: SBA Small Business Goaling Report."
                >% SB</th>
                <th className="text-right px-4 py-2 font-medium">Open Opps</th>
                <th className="text-right px-4 py-2 font-medium">Events</th>
                <th className="text-left px-4 py-2 font-medium">Location</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {visibleRows.map(row => (
                <Fragment key={row.id}>
                <tr
                  onClick={() => setSelectedRow(row)}
                  className="border-t border-slate-800/60 hover:bg-slate-800/30 cursor-pointer"
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {/* Office drill-down toggle — surfaces NAVFAC/USACE etc. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleOffices(row); }}
                        className="text-slate-500 hover:text-emerald-400 text-xs w-4 shrink-0"
                        title="Show contracting offices in your NAICS"
                      >
                        {expandedOffices[row.id] ? '▾' : '▸'}
                      </button>
                      {savedTargets[row.contractingOffice || row.name] && (
                        <span className="text-amber-400 text-xs" title="In your target list">★</span>
                      )}
                      <div className="font-medium text-slate-200">{row.contractingOffice || row.name}</div>
                    </div>
                    {row.subAgency && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {row.subAgency}
                        {row.parentAgency && row.parentAgency !== row.subAgency && (
                          <> · <span className="text-slate-600">{row.parentAgency}</span></>
                        )}
                        {row.officeId && <> · <span className="text-slate-600 font-mono">{row.officeId}</span></>}
                      </div>
                    )}
                  </td>
                  <td className="text-right px-4 py-2 text-white font-bold">{formatRowCurrency(row.totalSpending)}</td>
                  <td className="text-right px-4 py-2 text-emerald-400 font-semibold">{formatRowCurrency(row.setAsideSpending)}</td>
                  <td className="text-right px-4 py-2">{row.contractCount.toLocaleString()}</td>
                  <td className="text-right px-4 py-2">
                    {(() => {
                      // SB % from the SBA Goaling Report (FY23). Looked
                      // up by parent agency since the Goaling data is
                      // agency-aggregated. Multiple offices under the
                      // same agency share the same number — that's a
                      // real limitation of the underlying dataset.
                      // Falls back to "—" when no SBA data for the
                      // parent (small/independent agencies aren't in
                      // the Goaling Report slice).
                      const sbShare = sbShareFor(row);
                      if (sbShare === 0) return <span className="text-slate-600">—</span>;
                      return <span className="text-emerald-400">{(sbShare * 100).toFixed(1)}%</span>;
                    })()}
                  </td>
                  <td className="text-right px-4 py-2">
                    {row.openOppCount > 0 ? (
                      <span className="text-amber-300">{row.openOppCount}</span>
                    ) : <span className="text-slate-600">0</span>}
                  </td>
                  <td className="text-right px-4 py-2">
                    {row.upcomingEventCount > 0 ? (
                      <span className="text-purple-300">{row.upcomingEventCount}</span>
                    ) : <span className="text-slate-600">0</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{row.location}</td>
                </tr>
                {/* Office drill-down rows — NAVFAC/USACE etc. for this NAICS. */}
                {expandedOffices[row.id] && (
                  <tr className="bg-slate-950/40">
                    <td colSpan={20} className="px-4 py-2">
                      {expandedOffices[row.id].loading ? (
                        <span className="text-xs text-slate-500">Loading contracting offices…</span>
                      ) : expandedOffices[row.id].offices.length === 0 ? (
                        <span className="text-xs text-slate-500">No office-level data for this NAICS.</span>
                      ) : (
                        <div className="space-y-1 pl-6">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Contracting offices in NAICS {naicsCode}</div>
                          {expandedOffices[row.id].offices.map((o, i) => (
                            <div key={i} className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-slate-300 truncate">🏛 {o.name}</span>
                              <span className="text-slate-400 shrink-0">{formatRowCurrency(o.total)} · {o.awards.toLocaleString()} awards</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {!showAll && (hasSelection ? unselectedRows.length > 0 : sortedRows.length > 10) && (
          <div className="border-t border-slate-800 p-4 text-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-5 py-2.5 text-sm font-semibold text-emerald-200 shadow-sm transition-colors hover:bg-emerald-500/20 hover:text-white"
            >
              <span>Show all {filteredRows.length} agencies</span>
              <span aria-hidden="true">↓</span>
            </button>
            {hasSelection && (
              <p className="mt-2 text-xs text-slate-500">
                Showing your {selectedRows.length} selected of {filteredRows.length}
              </p>
            )}
          </div>
        )}
        {showAll && hasSelection && (
          <div className="border-t border-slate-800 p-3 text-center">
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="text-xs text-slate-400 hover:text-slate-200 underline"
            >
              Show only my {selectedRows.length} selected
            </button>
          </div>
        )}
      </div>

      {/* Slice 1.5D — office detail drawer. Opens when a row is clicked,
          matches the legacy /federal-market-assassin modal shape (4
          stat tiles + Office Information + Engagement signals +
          Market Research Links) so Mindy reaches parity with the
          legacy product. */}
      {selectedRow && (
        <AgencyDrawer
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
          savedTargetId={savedTargets[selectedRow.contractingOffice || selectedRow.name] || null}
          onAdd={() => handleAddToList(selectedRow)}
          onRemove={(targetId) => handleRemoveFromList(selectedRow.contractingOffice || selectedRow.name, targetId)}
        />
      )}

      {/* Triage flow modal — Start Tracking. Mounted at the AgencyTable
          level so it shares state with the table (savedTargets,
          dismissedOfficeNames). Closed by default; opens via the CTA
          button in the table header. */}
      <StartTrackingModal
        open={triageOpen}
        onClose={() => setTriageOpen(false)}
        email={email}
        naicsCode={naicsCode}
        agencies={triageCandidates}
        onAction={handleTriageAction}
      />
    </section>
  );
}

// Slice 1.5D — office detail drawer. Rendered as a modal overlay so
// the user can quickly compare offices without losing the table view
// state (active sort lens, scroll position, quick-pick selections).
//
// Surfaces every piece of office-level intel the agency table row
// already carries — no extra network call. Future-Slice 3 work
// (saved targets / outreach log) will mount additional sections here
// without re-architecting the drawer.

// ---------------------------------------------------------------------
// SbaMixSection — agency-level breakdown by socioeconomic category
// ---------------------------------------------------------------------
//
// Powered by /api/sba-goaling which reads the imported FY23 SBA
// Goaling Report data. Renders only when we have data for the
// agency; degrades gracefully to nothing when the agency isn't in
// the dataset (small/independent agencies often won't be).
//
// The bar chart is a horizontal stacked layout showing the 8 SBA
// categories as percentages of agency total. The headline number
// is "% goes to small business" (everything except "Not a Small
// Business").

interface SbaGoalingCategory {
  category: string;
  dollars: number;
  pct: number;
}
interface SbaGoalingResponse {
  success: boolean;
  fiscal_year?: number;
  funding_department?: string;
  total?: number;
  categories?: SbaGoalingCategory[];
  small_business_share?: number;
  error?: string;
}

// Color map for the 8 categories. Socioeconomic categories get
// distinct hues; non-SB is muted slate. Order matches the typical
// rank (Other SB usually #1 small-biz category by dollars).
const SBA_CATEGORY_COLORS: Record<string, string> = {
  'Asian American Owned Small Business': 'bg-rose-500',
  'Black American Owned Small Business': 'bg-amber-500',
  'Hispanic American Owned Small Business': 'bg-orange-500',
  'Native American Owned Small Business': 'bg-yellow-500',
  'Subcontinent Asian American Owned Small Business': 'bg-pink-500',
  'Other Minority Owned Small Business': 'bg-fuchsia-500',
  'Other Small Business': 'bg-emerald-500',
  'Not a Small Business': 'bg-slate-700',
};

function sbaCategoryShortLabel(category: string): string {
  // Drop the trailing "Owned Small Business" suffix for compact display.
  // "Asian American Owned Small Business" → "Asian American"
  // "Other Small Business" → "Other SB"
  // "Not a Small Business" → "Not SB"
  return category
    .replace(/ Owned Small Business$/, '')
    .replace(/Other Small Business$/, 'Other SB')
    .replace(/Not a Small Business$/, 'Not SB');
}

function SbaMixSection({ agencyName }: { agencyName: string }) {
  const [data, setData] = useState<SbaGoalingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!agencyName) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/sba-goaling?agency=${encodeURIComponent(agencyName)}`)
      .then(async (r) => {
        const json = (await r.json().catch(() => null)) as SbaGoalingResponse | null;
        if (cancelled) return;
        if (r.status === 404) {
          setNotFound(true);
          return;
        }
        if (!r.ok || !json?.success) {
          // Silent fail — drawer hides the section. The data is
          // a nice-to-have, not load-bearing.
          setNotFound(true);
          return;
        }
        setData(json);
      })
      .catch(() => {
        if (cancelled) return;
        setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [agencyName]);

  // Hide the section entirely when there's no data for this agency.
  // Most small/independent agencies aren't in the Goaling Report.
  if (notFound && !loading) return null;

  return (
    <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Small Business Mix</h3>
        {data?.fiscal_year && (
          <span className="text-[10px] text-slate-500">FY{data.fiscal_year} · SBA Goaling Report</span>
        )}
      </div>

      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-slate-800 rounded w-1/3" />
          <div className="h-8 bg-slate-800 rounded" />
        </div>
      )}

      {data && data.categories && (
        <>
          {/* Headline %: small business share */}
          <div className="mb-4">
            <div className="text-3xl font-bold text-emerald-400">
              {((data.small_business_share || 0) * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-slate-500 mt-1">
              of {(data.funding_department || agencyName).toLowerCase().replace(/(^|\s)\S/g, (s) => s.toUpperCase())}&apos;s
              {' '}${(data.total || 0 / 1e9).toFixed(2)}B FY{data.fiscal_year} spend went to small businesses
            </div>
          </div>

          {/* Stacked horizontal bar — visual representation of the 8 categories */}
          <div className="flex h-6 rounded-md overflow-hidden mb-3" title="Categories proportional to spend">
            {data.categories.map((c) => (
              <div
                key={c.category}
                className={SBA_CATEGORY_COLORS[c.category] || 'bg-slate-600'}
                style={{ width: `${(c.pct * 100).toFixed(2)}%` }}
                title={`${c.category}: $${(c.dollars / 1e6).toFixed(1)}M (${(c.pct * 100).toFixed(1)}%)`}
              />
            ))}
          </div>

          {/* Legend / detail table — clickable categories could
              eventually filter the Market Map to "show me agencies
              where this category is high". v1 just shows the
              numbers. */}
          <ul className="space-y-1.5">
            {data.categories.map((c) => (
              <li key={c.category} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`shrink-0 w-3 h-3 rounded ${SBA_CATEGORY_COLORS[c.category] || 'bg-slate-600'}`} />
                  <span className="truncate text-slate-300">{sbaCategoryShortLabel(c.category)}</span>
                </span>
                <span className="shrink-0 text-slate-400 tabular-nums">
                  {(c.pct * 100).toFixed(1)}%
                  <span className="text-slate-600 ml-2">${(c.dollars / 1e6).toFixed(0)}M</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="text-[10px] text-slate-500 mt-4 italic">
            Source: SBA Small Business Goaling Report via data.sba.gov. Categories from SBA verbatim — race/ethnicity-based socioeconomic classifications.
          </p>
        </>
      )}
    </div>
  );
}

function AgencyDrawer({
  row,
  onClose,
  savedTargetId,
  onAdd,
  onRemove,
}: {
  row: AgencyTableRow;
  onClose: () => void;
  // Slice 3B — target list integration. Null when this office isn't
  // saved; otherwise the target's id (for the Remove call).
  savedTargetId: string | null;
  onAdd: () => void;
  onRemove: (targetId: string) => void;
}) {
  // SAM.gov agency search URL builder. The agency name is the most
  // reliable handle since SAM's agency hierarchy uses sub-tier slugs
  // that we don't always have. Encode + open in a new tab.
  const samSearchUrl = `https://sam.gov/search/?index=opp&page=1&pageSize=25&sort=-modifiedDate&sfm[serviceClassifications][typeOfNotice][]=p&sfm[serviceClassifications][typeOfNotice][]=k&sfm[simpleSearch][keywords]=${encodeURIComponent(row.contractingOffice || row.name)}`;
  // USAspending.gov agency hash search — we link to the keyword
  // search since deep-linking to a specific agency_id requires the
  // toptier_code lookup we don't have inline here.
  const usaSpendingUrl = `https://www.usaspending.gov/search?keywords=${encodeURIComponent(row.parentAgency || row.contractingOffice || row.name)}`;

  // Close on Escape key — accessibility nicety matching the legacy
  // modal behavior. Cleanup on unmount + selection change so the
  // listener doesn't leak.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-4xl w-full my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — sticky so the close button is always reachable */}
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-start gap-4 rounded-t-xl">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white truncate">{row.contractingOffice || row.name}</h2>
            {row.subAgency && (
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {row.subAgency}
                {row.parentAgency && row.parentAgency !== row.subAgency && (
                  <> · {row.parentAgency}</>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-2xl leading-none shrink-0"
            aria-label="Close drawer"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* 4 stat tiles — matches the legacy modal exactly */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DrawerStat
              label="Total Spending"
              value={formatRowCurrency(row.totalSpending)}
              tone="slate"
              hint="All contracts in your NAICS (no set-aside filter)"
            />
            <DrawerStat
              label="Set-Aside Spending"
              value={formatRowCurrency(row.setAsideSpending)}
              tone="emerald"
              hint="Filtered to contracts matching your business type"
            />
            <DrawerStat
              label="Total Contracts"
              value={row.contractCount.toLocaleString()}
              tone="slate"
            />
            <DrawerStat
              label="SAT %"
              value={row.satContractCount > 0 ? `${Math.round(row.satRatio * 100)}%` : '—'}
              tone="blue"
              hint={
                row.satContractCount > 0
                  ? `${row.satContractCount} of ${row.contractCount} contracts under $350K`
                  : row.contractCount > 0
                    ? 'No small-dollar awards (<$350K) in our USAspending sample. Pipeline skews to large contracts; true SAT count needs SAM Contract Data API.'
                    : undefined
              }
            />
          </div>

          {/* Office Information block — full hierarchy + location */}
          <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">Office Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <DrawerField label="Contracting Office" value={row.contractingOffice || row.name} />
              <DrawerField label="Sub-Agency" value={row.subAgency || '—'} />
              <DrawerField label="Parent Agency" value={row.parentAgency || '—'} />
              <DrawerField label="Location" value={row.location || '—'} />
            </div>
          </div>

          {/* Engagement signals — pain points + open opps + events.
              This is where Mindy adds value vs. raw USAspending data.
              The numbers came from the merged endpoint; we just give
              them a human-readable home. */}
          <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">Engagement Signals</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SignalCard
                label="Pain Points Logged"
                value={row.painPointCount}
                tone="amber"
                hint="Hand-curated from GAO reports + agency strategic plans"
              />
              <SignalCard
                label="Open Opportunities"
                value={row.openOppCount}
                tone="emerald"
                hint="Current SAM.gov solicitations at this agency"
              />
              <SignalCard
                label="Upcoming Events (90 days)"
                value={row.upcomingEventCount}
                tone="purple"
                hint="Industry days / RFIs / webinars from SAM Special Notices"
              />
            </div>
          </div>

          {/* Small Business Mix — per-agency breakdown from the SBA
              Goaling Report. Tells the user what % of THIS specific
              agency's spend went to small businesses last fiscal year,
              broken out by socioeconomic category. Better than the
              page-level Set-Aside Mix donut for SMB targeting because
              it's specific to the office in front of them. */}
          <SbaMixSection agencyName={row.parentAgency || row.subAgency || row.contractingOffice || row.name} />

          {/* Market Research Links — deep-link out to the source */}
          <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">Market Research Links</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <a
                href={samSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg p-3 transition-colors"
              >
                <div>
                  <div className="text-sm font-semibold text-white">SAM.gov Opportunities</div>
                  <div className="text-xs text-slate-500">Search active contracts at this office</div>
                </div>
                <span className="text-slate-500">↗</span>
              </a>
              <a
                href={usaSpendingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg p-3 transition-colors"
              >
                <div>
                  <div className="text-sm font-semibold text-white">USAspending.gov</div>
                  <div className="text-xs text-slate-500">View historical spending</div>
                </div>
                <span className="text-slate-500">↗</span>
              </a>
            </div>
          </div>

          {/* Slice 3B — Add / Remove from my target list. The actual
              POST/DELETE happens in AgencyTable's handleAdd/Remove —
              the drawer just renders the button bound to the current
              saved state.

              When saved: green "✓ On my list" + Remove control.
              When not: purple "+ Add to my target list" CTA.

              Outreach log (Slice 3D) will sit below this once it
              ships — designed-in placement so we don't have to
              re-architect the drawer. */}
          <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-5">
            {savedTargetId ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">★</span>
                  <div>
                    <div className="text-sm font-semibold text-emerald-400">In your target list</div>
                    <p className="text-xs text-slate-500">Open My Target List to log outreach and track status.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(savedTargetId)}
                  className="text-xs text-slate-400 hover:text-red-400 hover:underline transition-colors"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Add to my target list</div>
                  <p className="text-xs text-slate-500">
                    Save this office to a persistent list you can work over months.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onAdd}
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-colors shrink-0"
                >
                  + Add
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DrawerStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'slate' | 'blue' | 'purple';
  hint?: string;
}) {
  const toneClass =
    tone === 'emerald' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
    : tone === 'blue' ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
    : tone === 'purple' ? 'border-purple-500/30 bg-purple-500/10 text-purple-400'
    : 'border-slate-700 bg-slate-800/40 text-slate-200';
  return (
    <div className={`rounded-lg border p-3 ${toneClass.split(' ')[0]} ${toneClass.split(' ')[1]}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-xl font-bold mt-1 ${toneClass.split(' ').slice(2).join(' ')}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function DrawerField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm text-slate-200 mt-0.5 break-words">{value}</div>
    </div>
  );
}

function SignalCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'emerald' | 'purple';
  hint?: string;
}) {
  const numColor =
    tone === 'amber' ? 'text-amber-300'
    : tone === 'emerald' ? 'text-emerald-400'
    : 'text-purple-300';
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${numColor}`}>{value.toLocaleString()}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-1.5">{hint}</div>}
    </div>
  );
}

// Used by AgencyTable for the 3 quick-pick cards above the table.
function QuickPickCard({
  title,
  winner,
  metricLabel,
  metricValue,
  selectedLens,
  onLensChange,
  rule,
}: {
  title: string;
  winner: AgencyTableRow | undefined;
  metricLabel: string;
  metricValue: string;
  selectedLens: SortLens | null;
  onLensChange?: (lens: SortLens) => void;
  rule: string;
}) {
  const [showWhy, setShowWhy] = useState(false);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</h4>
        <button
          type="button"
          onClick={() => setShowWhy(v => !v)}
          className="text-[10px] text-slate-500 hover:text-slate-300"
        >
          Why?
        </button>
      </div>
      {showWhy && (
        <p className="text-[10px] text-slate-400 italic border-l-2 border-slate-700 pl-2 mb-2">{rule}</p>
      )}
      {winner ? (
        <>
          <div className="text-sm font-bold text-white truncate" title={winner.contractingOffice || winner.name}>
            {winner.contractingOffice || winner.name}
          </div>
          <div className="text-xs text-slate-500 truncate mb-2">
            {winner.subAgency || winner.parentAgency}
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] text-slate-500">{metricLabel}</span>
            <span className="text-base font-semibold text-emerald-400">{metricValue}</span>
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-500">No data yet.</p>
      )}
      {/* Methodology dropdown — only shown for the card that supports
          swapping its rule. Strongest Signal + Low Competition are
          fixed in v1 (pain points / fewest opps); BIGGEST SPENDER
          can swap between any of the 4 lenses. */}
      {onLensChange && selectedLens && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <label className="text-[10px] uppercase tracking-wider text-slate-500">Rank by</label>
          <select
            value={selectedLens}
            onChange={(e) => onLensChange(e.target.value as SortLens)}
            className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
          >
            {SORT_LENSES.map(l => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// InsightCard component removed 2026-05-25 with the 'Start Here' row.

// Report Viewer Component
interface ReportViewerProps {
  reportId: string;
  reportData: ReportData[keyof ReportData] | null;
  isGenerating: boolean;
  email: string | null;
  naicsCode: string;
  recommendedOpportunities: RecommendedOpportunity[];
  onClose: () => void;
  formatCurrency: (value?: number) => string;
  onSaveBuyer: (buyer: {
    contractingOffice: string;
    parentAgency?: string;
    subAgency?: string;
    osbp?: { director?: string; email?: string; phone?: string } | null;
  }) => void;
  onSavePartner: (partner: {
    name: string;
    reason?: string;
    email?: string;
    phone?: string;
    sbloName?: string;
    certifications?: string[];
    naicsCategories?: string[];
  }) => void;
  onTrackOpportunity: (forecast: {
    agency: string;
    description?: string;
    estimatedValue?: string;
    solicitationDate?: string;
    naicsCode?: string;
  }) => void;
  savingContact: string | null;
  savedContacts: Set<string>;
  savingOpportunity: string | null;
  savedOpportunities: Set<string>;
  tier: AppTier;
}

function getOpportunityPlace(opportunity: RecommendedOpportunity): string | null {
  const cityState = [opportunity.popCity, opportunity.popState].filter(Boolean).join(', ');
  return cityState || opportunity.popState || opportunity.popCountry || null;
}

function getOpportunityDueDate(opportunity: RecommendedOpportunity): string | null {
  if (!opportunity.responseDeadline) return null;
  const date = new Date(opportunity.responseDeadline);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCount(value?: number | null): string {
  return Math.round(value || 0).toLocaleString('en-US');
}

function LiveOpportunityFallback({
  title,
  emptyCopy,
  opportunities,
}: {
  title: string;
  emptyCopy: string;
  opportunities: RecommendedOpportunity[];
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
        <div className="text-sm font-semibold text-amber-200">{title}</div>
        <div className="mt-1 text-sm text-amber-100/80">{emptyCopy}</div>
      </div>
      {opportunities.slice(0, 6).map((opportunity) => {
        const dueDate = getOpportunityDueDate(opportunity);
        const place = getOpportunityPlace(opportunity);
        const samUrl = isHttpUrl(opportunity.url) ? opportunity.url : null;
        return (
          <div key={opportunity.id} className="rounded-lg bg-slate-800/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-white">{opportunity.title}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                  {opportunity.buyerDisplay || opportunity.office || opportunity.subTier || opportunity.department || 'Agency not provided'}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                  {opportunity.naicsCode && <span className="rounded bg-slate-700/70 px-2 py-1">NAICS {opportunity.naicsCode}</span>}
                  {opportunity.noticeType && <span className="rounded bg-slate-700/70 px-2 py-1">{opportunity.noticeType}</span>}
                  {opportunity.setAsideDescription && <span className="rounded bg-slate-700/70 px-2 py-1">{opportunity.setAsideDescription}</span>}
                  {place && <span className="rounded bg-slate-700/70 px-2 py-1">{place}</span>}
                  {dueDate && <span className="rounded bg-slate-700/70 px-2 py-1">Due {dueDate}</span>}
                </div>
              </div>
              {samUrl && (
                <a
                  href={samUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  SAM.gov
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Expandable "recent awards" for a competitor — Competitor Intel intel.
// Lazy-fetches the competitor's recent federal awards from the BQ
// recipient engine (same data as the /contractors SEO pages) on demand.
interface CompetitorAward {
  awardId: string; description: string; amount: number; agency: string;
  naicsCode: string; actionDate: string; popEndDate: string | null;
}
function CompetitorAwardsExpander({ email, name }: { email: string | null; name: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [awards, setAwards] = useState<CompetitorAward[]>([]);
  const [recipient, setRecipient] = useState<{ totalObligated: number; awardCount: number; distinctAgencyCount: number } | null>(null);
  const [found, setFound] = useState(true);

  const load = async () => {
    if (loaded || loading || !email) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/app/competitor-awards?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`);
      const data = await res.json().catch(() => null);
      if (data?.success) {
        setFound(!!data.found);
        setAwards(data.awards || []);
        setRecipient(data.recipient || null);
      }
    } catch { /* non-fatal */ } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  const fmt = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!loaded) load(); }}
        className="text-xs text-blue-400 hover:text-blue-300 underline"
      >
        {open ? 'Hide recent awards' : '📊 See what they’ve won'}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
          {loading && <div className="text-[11px] text-slate-500">Loading award history…</div>}
          {!loading && loaded && !found && (
            <div className="text-[11px] text-slate-500">No federal award history found for this name.</div>
          )}
          {!loading && found && recipient && (
            <div className="flex flex-wrap gap-3 mb-2 text-[11px]">
              <span className="text-emerald-300">{fmt(recipient.totalObligated)} total obligated</span>
              <span className="text-slate-400">{recipient.awardCount.toLocaleString()} awards</span>
              <span className="text-slate-400">{recipient.distinctAgencyCount} agencies</span>
            </div>
          )}
          {!loading && awards.length > 0 && (
            <ul className="space-y-1.5">
              {awards.map((a, i) => (
                <li key={`${a.awardId}-${i}`} className="text-xs flex items-start justify-between gap-3 border-b border-slate-800/60 pb-1.5 last:border-0">
                  <span className="min-w-0">
                    <span className="text-slate-200 line-clamp-1">{a.description || a.awardId}</span>
                    <span className="text-slate-500 text-[10px]">
                      {a.agency}{a.naicsCode ? ` · NAICS ${a.naicsCode}` : ''}{a.actionDate ? ` · ${a.actionDate.slice(0, 10)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-emerald-400">{fmt(a.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ReportViewer({
  reportId,
  reportData,
  isGenerating,
  email,
  naicsCode,
  recommendedOpportunities,
  onClose,
  formatCurrency,
  onSaveBuyer,
  onSavePartner,
  onTrackOpportunity,
  savingContact,
  savedContacts,
  savingOpportunity,
  savedOpportunities,
  tier,
}: ReportViewerProps) {
  if (!reportData) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">
            {isGenerating ? 'Building your market map…' : 'Report not ready'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        {isGenerating ? (
          <div className="flex items-center gap-3 text-slate-400">
            <span className="inline-block w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p>Pulling agencies, buyers, partners, and forecasts for your profile. This takes 10–30 seconds.</p>
          </div>
        ) : (
          <p className="text-slate-400">
            Click <strong className="text-emerald-300">Build Market Map</strong> at the top to generate this report
            from your saved profile.
          </p>
        )}
      </div>
    );
  }

  const report = REPORTS.find(r => r.id === reportId);
  const liveOpportunities = recommendedOpportunities.slice(0, 10);
  const hasLiveOpportunities = liveOpportunities.length > 0;
  const liveAgencyNames = uniqueStrings(
    liveOpportunities.map((opportunity) => opportunity.buyerDisplay || opportunity.office || opportunity.subTier || opportunity.department)
  );
  const budgetReport = reportData as ReportData['budgetCheckup'];
  const budgetRows = reportId === 'budget'
    ? (
        budgetReport?.agencyBudgets?.map((agency) => ({
          name: agency.agency,
          fy2025: agency.fy2025?.budgetAuthority || 0,
          fy2026: agency.fy2026?.budgetAuthority || 0,
          changePercent: typeof agency.change?.percent === 'number'
            ? (agency.change.percent - 1) * 100
            : 0,
          trend: agency.change?.trend || '',
        })) ||
        budgetReport?.agencies?.map((agency) => ({
          name: agency.name,
          fy2025: agency.fy2025 || 0,
          fy2026: agency.fy2026 || 0,
          changePercent: agency.change?.percent || 0,
          trend: '',
        })) ||
        []
      )
    : [];
  const analyticsReport = reportData as ReportData['simplifiedAcquisition'];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <span className="text-xl">{report?.icon}</span>
          {report?.title}
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
      </div>

      {/* Government Buyers */}
      {reportId === 'buyers' && 'agencies' in reportData && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-white">{(reportData as ReportData['governmentBuyers'])?.summary?.totalAgencies || 0}</div>
              <div className="text-xs text-slate-500">Agencies</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-emerald-400">{formatCurrency((reportData as ReportData['governmentBuyers'])?.summary?.totalSpending)}</div>
              <div className="text-xs text-slate-500">Total Spending</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-white">{formatCount((reportData as ReportData['governmentBuyers'])?.summary?.totalContracts)}</div>
              <div className="text-xs text-slate-500">Contracts</div>
            </div>
          </div>
          {(reportData as ReportData['governmentBuyers'])?.agencies?.slice(0, 10).map((agency, idx) => {
            const buyerKey = `buyer:${agency.contractingOffice}`;
            const isSaved = savedContacts.has(buyerKey);
            const isSaving = savingContact === buyerKey;
            return (
              <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white">{agency.contractingOffice}</div>
                    {agency.parentAgency && <div className="text-xs text-slate-500">{agency.parentAgency}</div>}
                    <div className="flex gap-4 mt-2 text-sm">
                      <span className="text-emerald-400">{formatCurrency(agency.spending)}</span>
                      <span className="text-slate-400">{formatCount(agency.contractCount)} contracts</span>
                    </div>
                  </div>
                  {tier !== 'free' && (
                    <button
                      type="button"
                      onClick={() => onSaveBuyer(agency)}
                      disabled={isSaved || isSaving}
                      className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        isSaved
                          ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                          : isSaving
                            ? 'bg-slate-700 text-slate-400 cursor-wait'
                            : 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30'
                      }`}
                    >
                      {isSaved ? '✓ Saved' : isSaving ? 'Saving...' : 'Save to Network'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {((reportData as ReportData['governmentBuyers'])?.agencies?.length || 0) === 0 && hasLiveOpportunities && (
            <LiveOpportunityFallback
              title={`${liveAgencyNames.length} live buyer signals found from your recommendations`}
              emptyCopy="The buyer report did not return agency rows, so Mindy is showing buyer offices from current matching opportunities."
              opportunities={liveOpportunities}
            />
          )}
        </div>
      )}

      {/* OSBP Contacts */}
      {reportId === 'osbp' && 'agencies' in reportData && (
        <div className="space-y-3">
          {(reportData as ReportData['governmentBuyers'])?.agencies?.filter(a => a.osbp).slice(0, 10).map((agency, idx) => {
            const buyerKey = `buyer:${agency.contractingOffice}`;
            const isSaved = savedContacts.has(buyerKey);
            const isSaving = savingContact === buyerKey;
            return (
              <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white">{agency.contractingOffice}</div>
                    {agency.osbp && (
                      <div className="mt-2 text-sm">
                        {agency.osbp.director && <div className="text-slate-300">👤 {agency.osbp.director} <span className="text-[10px] text-slate-500">(as of Dec 2025 — verify)</span></div>}
                        {agency.osbp.email && <div className="text-blue-400">✉️ {agency.osbp.email}</div>}
                        {agency.osbp.phone && <div className="text-slate-400">📞 {agency.osbp.phone}</div>}
                      </div>
                    )}
                  </div>
                  {tier !== 'free' && (
                    <button
                      type="button"
                      onClick={() => onSaveBuyer(agency)}
                      disabled={isSaved || isSaving}
                      className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        isSaved
                          ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                          : isSaving
                            ? 'bg-slate-700 text-slate-400 cursor-wait'
                            : 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30'
                      }`}
                    >
                      {isSaved ? '✓ Saved' : isSaving ? 'Saving...' : 'Save to Network'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {((reportData as ReportData['governmentBuyers'])?.agencies?.filter(a => a.osbp).length || 0) === 0 && hasLiveOpportunities && (
            <LiveOpportunityFallback
              title="No OSBP contact rows came back for this market yet"
              emptyCopy="Use these live buyer offices first, then open SAM.gov for the contracting office contact details."
              opportunities={liveOpportunities}
            />
          )}
        </div>
      )}

      {/* Pain Points */}
      {reportId === 'pain' && 'painPoints' in reportData && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-white">{(reportData as ReportData['agencyPainPoints'])?.summary?.totalPainPoints || 0}</div>
              <div className="text-xs text-slate-500">Pain Points</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-amber-400">{(reportData as ReportData['agencyPainPoints'])?.summary?.highOpportunityMatches || 0}</div>
              <div className="text-xs text-slate-500">High-Value Matches</div>
            </div>
          </div>
          {(reportData as ReportData['agencyPainPoints'])?.highOpportunityMatches?.slice(0, 5).map((match, idx) => (
            <div key={idx} className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="font-medium text-white">{match.agency}</div>
              <div className="text-sm text-amber-400 mt-1">{match.area}</div>
              <div className="text-sm text-slate-400 mt-1">{match.painPoint}</div>
            </div>
          ))}
          {(reportData as ReportData['agencyPainPoints'])?.painPoints?.slice(0, 10).map((pp, idx) => (
            <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
              <div className="font-medium text-white">{pp.agency}</div>
              <div className="text-sm text-slate-400 mt-1">{pp.painPoint}</div>
            </div>
          ))}
          {((reportData as ReportData['agencyPainPoints'])?.painPoints?.length || 0) === 0 && hasLiveOpportunities && (
            <LiveOpportunityFallback
              title="Live demand signals from your recommended opportunities"
              emptyCopy="The static pain-point library did not return matches for this profile, so Mindy is using current notices as the signal source."
              opportunities={liveOpportunities}
            />
          )}
        </div>
      )}

      {/* Prime Contractors */}
      {reportId === 'primes' && 'suggestedPrimes' in reportData && (
        <div className="space-y-3">
          {(reportData as ReportData['primeContractor'])?.suggestedPrimes?.slice(0, 10).map((prime, idx) => {
            const partnerKey = `partner:${prime.name}`;
            const isSaved = savedContacts.has(partnerKey);
            const isSaving = savingContact === partnerKey;
            return (
              <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white">{prime.name}</div>
                    {prime.reason && <div className="text-sm text-slate-400 mt-1">{prime.reason}</div>}
                    {prime.email && <div className="text-sm text-blue-400 mt-1">✉️ {prime.email}</div>}
                    {prime.naicsCategories && prime.naicsCategories.length > 0 && (
                      <div className="text-xs text-slate-500 mt-1">NAICS: {prime.naicsCategories.slice(0, 3).join(', ')}</div>
                    )}
                    {/* Real competitor intel — what they've won recently */}
                    <CompetitorAwardsExpander email={email} name={prime.name} />
                  </div>
                  {tier !== 'free' && (
                    <button
                      type="button"
                      onClick={() => onSavePartner(prime)}
                      disabled={isSaved || isSaving}
                      className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        isSaved
                          ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                          : isSaving
                            ? 'bg-slate-700 text-slate-400 cursor-wait'
                            : 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30'
                      }`}
                    >
                      {isSaved ? '✓ Saved' : isSaving ? 'Saving...' : 'Save Partner'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {((reportData as ReportData['primeContractor'])?.suggestedPrimes?.length || 0) === 0 && hasLiveOpportunities && (
            <LiveOpportunityFallback
              title="No prime-contractor matches came back yet"
              emptyCopy="Mindy is showing current competitive opportunities instead. Open the notices and check interested vendors or incumbent clues."
              opportunities={liveOpportunities}
            />
          )}
        </div>
      )}

      {/* Forecasts */}
      {reportId === 'forecast' && 'forecasts' in reportData && (
        <div className="space-y-3">
          <div className="bg-slate-800/50 rounded-lg p-3 mb-4">
            <div className="text-lg font-bold text-white">{(reportData as ReportData['forecastList'])?.summary?.totalForecasts || 0}</div>
            <div className="text-xs text-slate-500">Upcoming Forecasts</div>
          </div>
          {(reportData as ReportData['forecastList'])?.forecasts?.slice(0, 10).map((forecast, idx) => {
            const oppKey = `forecast:${forecast.agency}:${forecast.description?.slice(0, 50)}`;
            const isTracked = savedOpportunities.has(oppKey);
            const isTracking = savingOpportunity === oppKey;
            return (
              <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white">{forecast.agency}</div>
                    <div className="text-sm text-slate-400 mt-1 line-clamp-2">{forecast.description}</div>
                    <div className="flex gap-4 mt-2 text-xs">
                      {forecast.estimatedValue && <span className="text-emerald-400">{forecast.estimatedValue}</span>}
                      {forecast.quarter && <span className="text-slate-500">{forecast.quarter}</span>}
                      {forecast.naicsCode && <span className="text-slate-500">NAICS {forecast.naicsCode}</span>}
                    </div>
                  </div>
                  {tier !== 'free' && (
                    <button
                      type="button"
                      onClick={() => onTrackOpportunity(forecast)}
                      disabled={isTracked || isTracking}
                      className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        isTracked
                          ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                          : isTracking
                            ? 'bg-slate-700 text-slate-400 cursor-wait'
                            : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                      }`}
                    >
                      {isTracked ? '✓ Tracked' : isTracking ? 'Adding...' : 'Track in Pipeline'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {((reportData as ReportData['forecastList'])?.forecasts?.length || 0) === 0 && hasLiveOpportunities && (
            <LiveOpportunityFallback
              title="Upcoming demand from live notices"
              emptyCopy="The agency forecast feed did not return future forecast rows, so Mindy is showing open opportunities ordered from your recommendation feed."
              opportunities={liveOpportunities}
            />
          )}
        </div>
      )}

      {/* IDV Contracts */}
      {reportId === 'vehicles' && 'contracts' in reportData && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-white">{formatCount((reportData as ReportData['idvContracts'])?.summary?.totalContracts)}</div>
              <div className="text-xs text-slate-500">IDV Contracts</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-emerald-400">{formatCurrency((reportData as ReportData['idvContracts'])?.summary?.totalValue)}</div>
              <div className="text-xs text-slate-500">Total Value</div>
            </div>
          </div>
          {(reportData as ReportData['idvContracts'])?.contracts?.slice(0, 10).map((contract, idx) => (
            <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
              <div className="font-medium text-white">{contract.recipientName}</div>
              {contract.awardingAgencyName && <div className="text-xs text-slate-500">{contract.awardingAgencyName}</div>}
              <div className="flex gap-4 mt-2 text-sm">
                <span className="text-emerald-400">{formatCurrency(contract.awardAmount)}</span>
                {contract.naicsCode && <span className="text-slate-400">NAICS {contract.naicsCode}</span>}
              </div>
            </div>
          ))}
          {((reportData as ReportData['idvContracts'])?.contracts?.length || 0) === 0 && hasLiveOpportunities && (
            <LiveOpportunityFallback
              title="No matching IDV vehicles found yet"
              emptyCopy="Mindy is showing active opportunity vehicles and notice types from your market while the IDV dataset has no match."
              opportunities={liveOpportunities}
            />
          )}
        </div>
      )}

      {/* Budget Checkup */}
      {reportId === 'budget' && (
        <div className="space-y-3">
          {budgetReport?.summary && (
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-slate-800/50 rounded-lg p-3">
                <div className="text-lg font-bold text-white">{formatCurrency(budgetReport.summary.totalFY2026)}</div>
                <div className="text-xs text-slate-500">FY26 Budget Authority</div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3">
                <div className="text-lg font-bold text-emerald-400">{budgetReport.summary.agenciesGrowing || 0}</div>
                <div className="text-xs text-slate-500">Agencies Growing</div>
              </div>
            </div>
          )}
          {budgetRows.slice(0, 10).map((agency, idx) => {
            const isGrowing = agency.changePercent >= 0;
            return (
              <div key={`${agency.name}-${idx}`} className="p-3 bg-slate-800/50 rounded-lg">
                <div className="font-medium text-white">{agency.name}</div>
                <div className="flex flex-wrap gap-4 mt-2 text-sm">
                  <span className="text-slate-400">FY25: {formatCurrency(agency.fy2025)}</span>
                  <span className="text-white">FY26: {formatCurrency(agency.fy2026)}</span>
                  <span className={isGrowing ? 'text-emerald-400' : 'text-red-400'}>
                    {isGrowing ? '↑' : '↓'} {Math.abs(agency.changePercent).toFixed(1)}%
                    {agency.trend ? ` ${agency.trend}` : ''}
                  </span>
                </div>
              </div>
            );
          })}
          {budgetRows.length === 0 && (
            <p className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 text-sm text-slate-400">
              No cached budget-authority matches were found for this agency set. Try a parent agency name such as Department of Defense, Department of Veterans Affairs, or General Services Administration.
            </p>
          )}
        </div>
      )}

      {/* Market Analytics — full Entry Accessibility table (task #41) */}
      {reportId === 'analytics' && (
        <EntryAccessibilityCard
          data={analyticsReport as SimplifiedAcquisitionReport | undefined}
        />
      )}

      {/* Teaming Partners */}
      {reportId === 'teaming' && 'suggestedPrimes' in reportData && (
        <div className="space-y-3">
          {(reportData as ReportData['tier2Subcontracting'])?.suggestedPrimes?.slice(0, 10).map((partner, idx) => {
            const partnerKey = `partner:${partner.name}`;
            const isSaved = savedContacts.has(partnerKey);
            const isSaving = savingContact === partnerKey;
            return (
              <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white">{partner.name}</div>
                    {partner.reason && <div className="text-sm text-slate-400 mt-1">{partner.reason}</div>}
                    {partner.email && <div className="text-sm text-blue-400 mt-1">✉️ {partner.email}</div>}
                    {partner.certifications && partner.certifications.length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {partner.certifications.slice(0, 3).map((cert, i) => (
                          <span key={i} className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">
                            {cert}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {tier !== 'free' && (
                    <button
                      type="button"
                      onClick={() => onSavePartner(partner)}
                      disabled={isSaved || isSaving}
                      className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        isSaved
                          ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                          : isSaving
                            ? 'bg-slate-700 text-slate-400 cursor-wait'
                            : 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30'
                      }`}
                    >
                      {isSaved ? '✓ Saved' : isSaving ? 'Saving...' : 'Save to Network'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Agency Needs */}
      {reportId === 'positioning' && 'needs' in reportData && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-white">{(reportData as ReportData['agencyNeeds'])?.summary?.totalNeeds || 0}</div>
              <div className="text-xs text-slate-500">Agency Needs</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-emerald-400">{(reportData as ReportData['agencyNeeds'])?.summary?.matchRate || 0}%</div>
              <div className="text-xs text-slate-500">Match Rate</div>
            </div>
          </div>
          {(reportData as ReportData['agencyNeeds'])?.needs?.slice(0, 10).map((need, idx) => (
            <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
              <div className="font-medium text-white">{need.agency}</div>
              <div className="text-sm text-slate-400 mt-1">{need.need}</div>
              {need.capabilityMatch && (
                <div className="text-sm text-emerald-400 mt-1">{need.capabilityMatch}</div>
              )}
            </div>
          ))}
          {((reportData as ReportData['agencyNeeds'])?.needs?.length || 0) === 0 && hasLiveOpportunities && (
            <LiveOpportunityFallback
              title="Agency needs inferred from live notices"
              emptyCopy="The needs library did not return structured matches, so Mindy is showing current demand signals from your recommendations."
              opportunities={liveOpportunities}
            />
          )}
        </div>
      )}
    </div>
  );
}
