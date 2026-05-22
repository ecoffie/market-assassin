'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import { useAppTracker } from '../track';
import { useToast } from '../Toast';
import ContractorLink from '../contractors/ContractorLink';
import type { Agency } from '@/types/federal-market-assassin';
import { formatMindyCurrency } from '@/lib/mindy/formatters';

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
  certifications?: string[] | null;
  set_aside_preferences?: string[] | null;
  aggregated_profile?: {
    naics_codes?: string[] | null;
    agencies?: string[] | null;
    keywords?: string[] | null;
    zip_codes?: string[] | null;
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
    agencies?: Array<{
      name: string;
      fy2025?: number;
      fy2026?: number;
      change?: { absolute: number; percent: number };
    }>;
    summary?: { averageChange: number };
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
  const businessType = normalizeBusinessType(
    notification.business_type || notificationAggregated.business_type || briefingAggregated.business_type,
    certifications
  );
  const zipCodes = firstArray(notificationAggregated.zip_codes, notification.zip_codes, briefingAggregated.zip_codes);
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
    zipCode: briefing.zip_code || zipCodes[0] || '',
    companyName,
    source: data.settings ? 'MI workspace settings' : notification.naics_codes || notificationAggregated.naics_codes ? 'briefing settings' : 'saved profile',
  };
}

export default function MarketResearchPanel({ email, tier, onNavigate }: MarketResearchPanelProps) {
  const [formData, setFormData] = useState<FormData>({
    businessType: '',
    naicsCode: '',
    pscCode: '',
    zipCode: '',
    veteranStatus: 'Not Applicable',
    companyName: '',
    excludeDOD: false,
  });
  const [selectedAgency, setSelectedAgency] = useState('');
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
  // tmrRows — the full row set from /api/app/target-market-research,
  // captured via AgencyTable's onRowsChange callback. Powers the
  // upstream charts (Spending by Agency, Set-Aside Mix) so they
  // render from the same 96-row data the table uses instead of the
  // legacy 7-row reportData.governmentBuyers path.
  const [tmrRows, setTmrRows] = useState<AgencyTableRow[]>([]);
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
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);
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

  const handleGenerateAll = useCallback(async (override?: { nextFormData?: FormData; nextSelectedAgency?: string }) => {
    if (!email) return;
    const activeFormData = override?.nextFormData || formData;
    const activeSelectedAgency = override?.nextSelectedAgency ?? selectedAgency;
    if (!validateForm(activeFormData, activeSelectedAgency)) return;

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
      const rawReportAgencyNames = selectedAgencies.length > 0 && selectedAgencyData.length > 0
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
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
        showToast({ message: 'Market map ready', variant: 'success' });
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
      setIsGenerating(false);
    }
  }, [canAccessReport, email, formData, getAuthHeaders, loadRecommendedOpportunities, selectedAgency, validateForm, showToast, tier, track]);

  const applySavedProfile = useCallback((profile: SavedResearchProfile) => {
    setFormData((current) => ({
      ...current,
      businessType: profile.businessType || current.businessType || 'Small Business',
      naicsCode: profile.naicsCodes.length > 0 ? profile.naicsCodes.slice(0, 8).join(', ') : current.naicsCode,
      pscCode: profile.pscCodes[0] || current.pscCode,
      zipCode: profile.zipCode || current.zipCode,
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
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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

        const profile: SavedResearchProfile | null = (
          workspaceProfile || naicsCodes.length > 0 || pscCodes.length > 0 || agencies.length > 0 || prefsData.businessType || prefsData.companyName
        ) ? {
          businessType: workspaceProfile?.businessType || normalizeBusinessType(prefsData.businessType, prefsData.setAsides || []),
          naicsCodes,
          pscCodes,
          agencies,
          zipCode: workspaceProfile?.zipCode || '',
          companyName: workspaceProfile?.companyName || prefsData.companyName || '',
          source: workspaceProfile?.source || 'alert settings',
        } : null;

        setSavedProfile(profile);

        if (profile) {
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
  }, [email, applySavedProfile, getAuthHeaders]);

  useEffect(() => {
    loadMarketFocuses();
  }, [loadMarketFocuses]);

  useEffect(() => {
    loadRecommendedOpportunities();
  }, [loadRecommendedOpportunities]);

  useEffect(() => {
    if (autoGeneratedRef.current || profileLoading || !profileApplied || !email) return;
    // Auto-generate if user has NAICS, PSC, or target agencies - businessType is optional
    const hasInputs = Boolean(
      formData.naicsCode.trim() ||
      formData.pscCode.trim() ||
      selectedAgency.trim()
    );
    if (!hasInputs) return;

    autoGeneratedRef.current = true;
    handleGenerateAll();
  }, [email, formData.businessType, formData.naicsCode, formData.pscCode, handleGenerateAll, profileApplied, profileLoading, selectedAgency]);

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
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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

  // chartBuyers — prefer the full TMR row set when it's loaded; fall
  // back to the legacy 7-row governmentBuyers data so the charts
  // never empty out mid-render. AgencyTableRow uses
  // `setAsideSpending` whereas BuyerLike expects `spending`, so we
  // map the field name. setAsideSpending IS the correct number to
  // show — it's the total tracked spend per office in this NAICS
  // window, not just SAT-eligible spend. Confusing field name from
  // the upstream USASpending wrapper; documented in
  // src/types/federal-market-assassin.ts.
  const chartBuyers: BuyerLike[] = tmrRows.length > 0
    ? tmrRows.map((row) => ({
        contractingOffice: row.contractingOffice,
        parentAgency: row.parentAgency,
        subAgency: row.subAgency,
        spending: row.setAsideSpending,
        contractCount: row.contractCount,
      }))
    : buyers;

  // Total spend across the full TMR row set, used by the Set-Aside
  // Mix chart denominator and Mindy Says narrative. Falls back to
  // the legacy buyerSummary value when TMR hasn't loaded.
  const chartTotalSpending = tmrRows.length > 0
    ? tmrRows.reduce((sum, row) => sum + (row.setAsideSpending || 0), 0)
    : 0;

  const chartSatTotal = tmrRows.length > 0
    ? tmrRows.reduce((sum, row) => sum + (row.satSpending || 0), 0)
    : 0;
  const buyerSummary = reportData?.governmentBuyers?.summary;
  const painSummary = reportData?.agencyPainPoints?.summary;
  const primeSummary = reportData?.primeContractor?.summary;
  const vehicleSummary = reportData?.idvContracts?.summary;
  const forecastSummary = reportData?.forecastList?.summary;
  const bestBuyer = buyers[0];
  const topNeed = reportData?.agencyPainPoints?.highOpportunityMatches?.[0] || reportData?.agencyPainPoints?.painPoints?.[0];
  const recommendedReports: readonly string[] = RESEARCH_LENSES.find(lens => lens.id === activeLens)?.reports || [];
  const readyReports = REPORTS.filter(report => recommendedReports.includes(report.id) && canAccessReport(report.tier));

  return (
    <div className="p-6 space-y-6">
      {/* Compact Header with Inline Profile Pills */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Market Research</h1>
          {profileLoading ? (
            <span className="text-sm text-slate-500">Loading profile...</span>
          ) : savedProfile ? (
            <div className="flex flex-wrap items-center gap-2">
              {savedProfile.naicsCodes.length > 0 && (
                <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                  {savedProfile.naicsCodes.slice(0, 2).join(', ')}{savedProfile.naicsCodes.length > 2 ? ` +${savedProfile.naicsCodes.length - 2}` : ''}
                </span>
              )}
              {savedProfile.businessType && (
                <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                  {savedProfile.businessType}
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowAdvancedProfile((v) => !v)}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                {showAdvancedProfile ? '✕' : 'Edit'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdvancedProfile(true)}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              + Set profile
            </button>
          )}
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
              handleGenerateAll();
              loadRecommendedOpportunities();
            }}
            disabled={isGenerating || profileLoading}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {isGenerating ? 'Building...' : reportData ? 'Refresh' : 'Build Market Map'}
          </button>
        </div>
      </div>

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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
              <span className="text-sm text-slate-400">Industry codes</span>
              <input
                type="text"
                value={formData.naicsCode}
                onChange={(e) => setFormData({ ...formData, naicsCode: e.target.value })}
                placeholder="236, 541512"
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
                handleGenerateAll();
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

      {isGenerating && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-5 text-blue-200">
          Building your market map from spending, buyers, budgets, forecasts, and partners...
        </div>
      )}

      {/* Phase 2 Slice 1 — Market Map flagship view. Shows when
          viewMode === 'map' AND reports have been generated. Slice 1
          renders the 4 headline stat cards + 4 chart placeholder
          tiles + Mindy Says placeholder. Slices 2-5 fill in the
          real charts, AI narrative, and export. */}
      {viewMode === 'map' && reportData && (
        <div className="space-y-6">
          {/* Headline stats — same 4 numbers as the reports view's
              MetricCards but with stronger visual hierarchy here. */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard label="Agencies to review" value={(chartBuyers.length || buyerSummary?.totalAgencies || buyers.length).toLocaleString()} />
            <MetricCard label="Relevant spending" value={formatCurrency(chartTotalSpending || buyerSummary?.totalSpending)} tone="green" />
            <MetricCard label="Competition signals" value={(primeSummary?.totalPrimes || vehicleSummary?.totalContracts || 0).toLocaleString()} />
            <MetricCard label="Upcoming signals" value={(forecastSummary?.totalForecasts || painSummary?.highOpportunityMatches || 0).toLocaleString()} tone="amber" />
          </section>

          {/* Chart placeholders — Slice 2 fills these with Recharts
              (Spending by Agency bar + Set-Aside donut), Slice 3
              adds Trend line + Top 5 Primes. The slots are here
              so the layout is visible/scannable from Slice 1. */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SpendingByAgencyChart buyers={chartBuyers} />
            <SetAsideMixChart
              buyers={chartBuyers}
              satTotal={chartSatTotal || (reportData?.simplifiedAcquisition?.summary?.totalSATSpending) || 0}
              totalSpend={chartTotalSpending || buyerSummary?.totalSpending || 0}
            />
            <TrendPlaceholderChart
              totalSpend={chartTotalSpending || buyerSummary?.totalSpending || 0}
              agencyCount={chartBuyers.length}
            />
            <TopPrimesChart primes={reportData?.primeContractor?.suggestedPrimes || []} email={email} />
          </section>

          {/* FPDS-style top-10 leaderboards (Departments / Contracting
              Agencies / Vendors / Funding Agencies). Real award-
              derived data via USAspending category aggregations —
              the same view a BD person used to get from the FPDS-NG
              search sidebar before FPDS retired in Feb 2026. */}
          <FpdsLeaderboards
            naicsCode={formData.naicsCode}
            excludeDOD={formData.excludeDOD}
            email={email}
          />

          {/* Slice 1.5C — Agency table with sort lenses. Replaces the
              old "Start Here" 3-card black box with full transparency:
              all N offices, 4 sortable metrics, methodology you can
              swap. Drives off /api/app/target-market-research which
              merges USAspending + SAM + pain points + events. */}
          <AgencyTable
            email={email}
            naicsCode={formData.naicsCode}
            pscCode={formData.pscCode}
            businessType={formData.businessType}
            veteranStatus={formData.veteranStatus}
            zipCode={formData.zipCode}
            excludeDOD={formData.excludeDOD}
            onRowsChange={setTmrRows}
          />

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

      {viewMode === 'reports' && reportData && (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard label="Agencies to review" value={(chartBuyers.length || buyerSummary?.totalAgencies || buyers.length).toLocaleString()} />
            <MetricCard label="Relevant spending" value={formatCurrency(chartTotalSpending || buyerSummary?.totalSpending)} tone="green" />
            <MetricCard label="Competition signals" value={(primeSummary?.totalPrimes || vehicleSummary?.totalContracts || 0).toLocaleString()} />
            <MetricCard label="Upcoming signals" value={(forecastSummary?.totalForecasts || painSummary?.highOpportunityMatches || 0).toLocaleString()} tone="amber" />
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Start Here</h2>
                <p className="text-sm text-slate-500">The three things worth looking at first.</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveReportId('buyers')}
                className="self-start rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
              >
                View all buyers
              </button>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <InsightCard
                label="Best first agency"
                title={bestBuyer?.parentAgency || bestBuyer?.contractingOffice || 'No agency found yet'}
                detail={bestBuyer ? `${formatCurrency(bestBuyer.spending)} tracked spend • ${bestBuyer.contractCount || 0} contracts` : 'Refresh research after your profile loads.'}
                action="See buyers"
                onClick={() => setActiveReportId('buyers')}
              />
              <InsightCard
                label="Strongest need signal"
                title={topNeed?.agency || 'Needs analysis'}
                detail={'painPoint' in (topNeed || {}) && topNeed?.painPoint ? topNeed.painPoint : 'Open the needs view to see positioning themes.'}
                action="See signals"
                onClick={() => setActiveReportId('pain')}
              />
              <InsightCard
                label="Competition angle"
                title={`${primeSummary?.totalPrimes || 0} prime targets`}
                detail={`${vehicleSummary?.totalContracts || 0} contract vehicle records in this market.`}
                action="See competition"
                onClick={() => setActiveReportId('primes')}
              />
            </div>
          </section>

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
            onClick={() => handleGenerateAll()}
            className="mt-5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Build My Market Map
          </button>
        </section>
      )}

      {/* Report Viewer */}
      {activeReportId && reportData && (
        <ReportViewer
          reportId={activeReportId}
          reportData={getReportContent(activeReportId)}
          isGenerating={isGenerating}
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
            <DetailTile label="Buyer / Office" value={agency} />
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

function MetricCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'green' | 'amber' }) {
  const color = tone === 'green' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
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
function SpendingByAgencyChart({ buyers }: { buyers: BuyerLike[] }) {
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
      subtitle={`Top ${data.length} by tracked spend in your NAICS`}
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

// 2) Set-Aside Mix — donut. Splits total spend into SAT (<$350K
// simplified-acquisition contracts, where small business wins easier)
// vs the rest. This is the "is this market accessible?" signal.
function SetAsideMixChart({
  buyers,
  satTotal,
  totalSpend,
}: {
  buyers: BuyerLike[];
  satTotal: number;
  totalSpend: number;
}) {
  const fallbackTotal = useMemo(
    () => (buyers || []).reduce((sum, b) => sum + (b.spending || 0), 0),
    [buyers]
  );
  const total = totalSpend || fallbackTotal;
  const nonSat = Math.max(0, total - satTotal);

  if (total === 0) {
    return (
      <ChartShell title="Set-Aside Mix" subtitle="Where small business plays">
        <div className="flex items-center justify-center h-full text-xs text-slate-500">
          No spending data yet to chart.
        </div>
      </ChartShell>
    );
  }

  const data = [
    { name: 'SAT (≤$350K — accessible)', value: satTotal, color: CHART_PALETTE.emerald },
    { name: 'Above SAT', value: nonSat, color: CHART_PALETTE.slateDim },
  ];
  const satPct = total > 0 ? (satTotal / total) * 100 : 0;

  // Honest copy for the footer. Three meaningful states:
  //
  //   - satTotal === 0 AND total > 0   = this NAICS is dominated by
  //     mega-contracts above the $350K SAT line. Real signal, not
  //     missing data. Tell the user the market is hard to enter via
  //     SAT, point them at teaming as the alternative.
  //
  //   - satTotal > 0  AND satPct < 5  = SAT exists but is thin.
  //     Surface the % honestly without overselling addressability.
  //
  //   - satPct >= 5                    = normal copy.
  let footerMessage;
  if (satTotal === 0 && total > 0) {
    footerMessage = (
      <p className="text-[11px] text-amber-300/80">
        No SAT-eligible spending tracked under $350K in this NAICS.
        The market favors large contracts — consider teaming with a
        prime as your entry path.
      </p>
    );
  } else {
    footerMessage = (
      <p className="text-[11px] text-slate-400">
        <span className="text-emerald-400 font-semibold">{satPct.toFixed(1)}%</span> of
        {' '}{chartMoney(total)} total is SAT-eligible
        ({chartMoney(satTotal)} addressable for first-contract wins).
      </p>
    );
  }

  return (
    <ChartShell
      title="Set-Aside Mix"
      subtitle="Where small business plays — % of spend under $350K"
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
}
function TopPrimesChart({ primes, email }: { primes: PrimeLike[]; email: string | null }) {
  // Reframed May 22, 2026 per user: "The top 5 primes data is that
  // useful for SMBs?" Not as a 'who's dominant' chart \— SMBs
  // already know Booz Allen + Leidos exist. Reframed as TEAMING
  // CANDIDATES \— these are active primes in your NAICS who you
  // can pursue as subcontracting partners. Each click opens their
  // sales history so the user can judge: are they growing? do
  // they have recompetes coming up? do they sub at all?
  //
  // Future v2: filter the upstream suggestPrimesForAgencies() to
  // skip primes with >25% market share (those don't need subs)
  // and rank by mid-tier teaming viability instead of dominance.
  const top = primes.slice(0, 5);

  if (top.length === 0) {
    return (
      <ChartShell title="Teaming Candidates" subtitle="Primes in your NAICS who actively sub work out">
        <div className="flex items-center justify-center h-full text-xs text-slate-500">
          No prime data yet. Build the report to populate.
        </div>
      </ChartShell>
    );
  }

  return (
    <ChartShell
      title="Teaming Candidates"
      subtitle="Primes in your NAICS — click for sales history + recompete signals"
      footer={
        <p className="text-[11px] text-slate-500">
          Teaming viability score (market share + sub-history) ships in v2. Today: surfaced by NAICS overlap only.
        </p>
      }
    >
      <ul className="space-y-2">
        {top.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex items-start gap-3">
            <div className="shrink-0 w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-[10px] font-semibold text-purple-300">
              {i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <ContractorLink name={p.name} email={email} variant="plain" className="text-xs font-medium block truncate">
                {p.name}
              </ContractorLink>
              {p.reason && (
                <div className="text-[10px] text-slate-500 truncate">{p.reason}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </ChartShell>
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
  fiscal_year?: number;
  top_departments?: FpdsRow[];
  top_contracting?: FpdsRow[];
  top_vendors?: FpdsRow[];
  top_funding_agencies?: FpdsRow[];
  total_obligation?: number;
}

function FpdsLeaderboards({
  naicsCode,
  excludeDOD,
  email,
}: {
  naicsCode: string;
  excludeDOD: boolean;
  email: string | null;
}) {
  const [data, setData] = useState<FpdsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use the first NAICS code from comma-separated input. The FPDS
  // endpoint takes a single NAICS at a time (USAspending category
  // queries don't accept OR'd NAICS lists). Future: fan out N calls.
  const primaryNaics = (naicsCode || '').split(',')[0]?.trim() || '';

  useEffect(() => {
    if (!primaryNaics) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ naics: primaryNaics });
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
  }, [primaryNaics, excludeDOD]);

  if (!primaryNaics) return null;

  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between">
        <div>
          <h3 className="text-base font-bold text-white">FPDS Leaderboards</h3>
          <p className="text-xs text-slate-500">
            Top 10 by award $ in NAICS {primaryNaics}
            {data?.fiscal_year ? ` · FY${data.fiscal_year}` : ''}
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FpdsLeaderboardCard
          title="Top 10 Departments"
          subtitle="Parent agencies buying in this NAICS"
          rows={data?.top_departments || []}
          loading={loading}
        />
        <FpdsLeaderboardCard
          title="Top 10 Contracting Agencies"
          subtitle="Sub-agencies awarding the contracts"
          rows={data?.top_contracting || []}
          loading={loading}
        />
        <FpdsLeaderboardCard
          title="Top 10 Vendors"
          subtitle="Primes winning the awards (click for history)"
          rows={data?.top_vendors || []}
          loading={loading}
          linkVendor
          email={email}
        />
        <FpdsLeaderboardCard
          title="Top 10 Funding Agencies"
          subtitle="Agencies funding the contracts (FPDS Treasury Acct equivalent)"
          rows={data?.top_funding_agencies || []}
          loading={loading}
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
}: {
  title: string;
  subtitle: string;
  rows: FpdsRow[];
  loading: boolean;
  linkVendor?: boolean;
  email?: string | null;
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
      headers: { 'Content-Type': 'application/json' },
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
type SortLens = 'top_spending' | 'civilian_first' | 'easy_entry' | 'budget_growth' | 'contracts' | 'a_z';
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
  contractCount: number;
  satSpending: number;
  satContractCount: number;
  metric_top_spending: number;
  metric_contracts: number;
  metric_easy_entry: number;
  metric_budget_growth: number;
  painPointCount: number;
  openOppCount: number;
  upcomingEventCount: number;
  satRatio: number;
  isSubAgency: boolean;
}

const SORT_LENSES: Array<{ id: SortLens; label: string; hint: string }> = [
  { id: 'top_spending',  label: 'Top Spending',     hint: 'Biggest pie in your NAICS' },
  // "Civilian First" surfaces non-DOD agencies at the top, sorted
  // by spend within the civilian group. DOD agencies still appear
  // (sorted by spend among themselves) but at the bottom of the
  // list. Mental model per Eric: DOD is always #1 by total spend,
  // but for new entrants civilian agencies (HHS, GSA, VA, etc.)
  // are often easier to break into — simpler procurement, less
  // crowded vendor density, more SAT contracts. Toggle when
  // you're looking for first-contract candidates.
  { id: 'civilian_first', label: 'Civilian First',  hint: 'Non-DOD agencies first — often easier for new entrants' },
  { id: 'easy_entry',    label: 'Easy Entry (SAT)', hint: 'Most contracts under $350K — easiest first wins' },
  { id: 'budget_growth', label: 'Budget Growth',    hint: 'Where the trend favors you (coming in Slice 2)' },
  { id: 'contracts',     label: 'Contracts',        hint: 'High-frequency buyers' },
  { id: 'a_z',           label: 'A-Z',              hint: 'Alphabetical (tie-breaker)' },
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
  onRowsChange,
}: {
  email: string | null;
  naicsCode: string;
  pscCode: string;
  businessType: string;
  veteranStatus: string;
  zipCode: string;
  excludeDOD: boolean;
  // Optional escape hatch — parent can subscribe to the full row
  // set so the upstream charts (Spending by Agency, Set-Aside Mix)
  // can render from the same 96-row data this table uses, not the
  // legacy 7-row reportData.governmentBuyers path.
  onRowsChange?: (rows: AgencyTableRow[]) => void;
}) {
  const [rows, setRows] = useState<AgencyTableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLens, setActiveLens] = useState<SortLens>('top_spending');
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
  const { showToast: showAgencyToast } = useToast();

  // Fetch happens once per (naics, psc, businessType, veteran) combo.
  // The endpoint itself does the 24h cache layer — we just call it.
  useEffect(() => {
    if (!email || !naicsCode.trim()) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/app/target-market-research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
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
          setError(data?.error || 'Could not load research data');
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
  }, [email, naicsCode, pscCode, businessType, veteranStatus, zipCode, excludeDOD]);

  // Slice 3B — fetch my saved target list once per email change. We
  // store (office_name → target_id) so the row ★ indicator and the
  // drawer's Add/Remove button can both look up state instantly.
  // Fire-and-forget: failure leaves savedTargets empty, which means
  // the drawer button defaults to "Add" — degrading gracefully if
  // the endpoint is misbehaving.
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    fetch(`/api/app/target-list?email=${encodeURIComponent(email)}`)
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
        headers: { 'Content-Type': 'application/json' },
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
  }, [email, savedTargets, showAgencyToast]);

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
        headers: { 'Content-Type': 'application/json' },
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

  // Pure sort step. The endpoint pre-computes every metric_* field so
  // switching lenses is a client-only re-sort with no network call.
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    switch (activeLens) {
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
        copy.sort((a, b) => b.metric_easy_entry - a.metric_easy_entry);
        break;
      case 'budget_growth':
        copy.sort((a, b) => b.metric_budget_growth - a.metric_budget_growth);
        break;
      case 'contracts':
        copy.sort((a, b) => b.metric_contracts - a.metric_contracts);
        break;
      case 'a_z':
        copy.sort((a, b) => (a.contractingOffice || a.name).localeCompare(b.contractingOffice || b.name));
        break;
    }
    return copy;
  }, [rows, activeLens]);

  // Pick the row that wins each quick-pick category using the user's
  // selected metric. The dropdowns on the cards write into quickPick
  // state and we recompute from sortedRows-style logic.
  const quickPicks = useMemo(() => {
    const pickBy = (lens: SortLens, mode: 'high' | 'low' = 'high'): AgencyTableRow | undefined => {
      if (rows.length === 0) return undefined;
      const copy = [...rows];
      const metric = (r: AgencyTableRow): number => {
        switch (lens) {
          case 'top_spending':   return r.metric_top_spending;
          // civilian_first ranks DOD lower by giving them a
          // negative spend signal — quick-pick still picks the
          // top civilian agency.
          case 'civilian_first': return isDodAgency(r) ? -1 : r.metric_top_spending;
          case 'easy_entry':     return r.metric_easy_entry;
          case 'budget_growth':  return r.metric_budget_growth;
          case 'contracts':      return r.metric_contracts;
          case 'a_z':            return 0;
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

  if (!naicsCode.trim()) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <p className="text-sm text-slate-400">
          Enter a NAICS or PSC code in your profile to load Target Market Research.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <p className="text-sm text-slate-400">Loading agency data...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-300">
        {error}
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

  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, 10);

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

      {/* The agency table itself. Sort lens chips drive the order. */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="border-b border-slate-800 p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">All Agencies ({rows.length} found)</h3>
            <p className="text-xs text-slate-500">
              Sort lenses re-rank the same data — no re-fetch.
              {cached && <span className="ml-1 text-emerald-400">· cached</span>}
              {freeTierLimited && <span className="ml-1 text-amber-400">· Free tier shows top 10; upgrade for the full list</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SORT_LENSES.map(lens => (
              <button
                key={lens.id}
                onClick={() => setActiveLens(lens.id)}
                title={lens.hint}
                className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                  activeLens === lens.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {lens.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Agency / Office</th>
                <th className="text-right px-4 py-2 font-medium">Set-Aside $</th>
                <th className="text-right px-4 py-2 font-medium">Contracts</th>
                <th className="text-right px-4 py-2 font-medium">SAT %</th>
                <th className="text-right px-4 py-2 font-medium">Open Opps</th>
                <th className="text-right px-4 py-2 font-medium">Events</th>
                <th className="text-left px-4 py-2 font-medium">Location</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {visibleRows.map(row => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedRow(row)}
                  className="border-t border-slate-800/60 hover:bg-slate-800/30 cursor-pointer"
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {/* Slice 3B — ★ when this office is in the
                          user's saved target list. Tiny but high-
                          signal: lets users scan their list at a
                          glance while browsing. */}
                      {savedTargets[row.contractingOffice || row.name] && (
                        <span
                          className="text-amber-400 text-xs"
                          title="In your target list"
                        >★</span>
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
                  <td className="text-right px-4 py-2 text-emerald-400 font-semibold">{formatRowCurrency(row.setAsideSpending)}</td>
                  <td className="text-right px-4 py-2">{row.contractCount.toLocaleString()}</td>
                  <td className="text-right px-4 py-2">
                    {row.contractCount > 0 ? `${Math.round(row.satRatio * 100)}%` : '—'}
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
              ))}
            </tbody>
          </table>
        </div>

        {!showAll && sortedRows.length > 10 && (
          <div className="border-t border-slate-800 p-3 text-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-xs text-emerald-400 hover:text-emerald-300 underline"
            >
              Show all {sortedRows.length} agencies
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
              label="Set-Aside Spending"
              value={formatRowCurrency(row.setAsideSpending)}
              tone="emerald"
            />
            <DrawerStat
              label="Total Contracts"
              value={row.contractCount.toLocaleString()}
              tone="slate"
            />
            <DrawerStat
              label="SAT %"
              value={row.contractCount > 0 ? `${Math.round(row.satRatio * 100)}%` : '—'}
              tone="blue"
              hint={row.contractCount > 0
                ? `${row.satContractCount} of ${row.contractCount} contracts under $350K`
                : undefined}
            />
            <DrawerStat
              label="Office ID"
              value={row.officeId || '—'}
              tone="purple"
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
            {SORT_LENSES.filter(l => l.id !== 'a_z').map(l => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function InsightCard({
  label,
  title,
  detail,
  action,
  onClick,
}: {
  label: string;
  title: string;
  detail: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-800 bg-slate-950/50 p-5 text-left hover:border-emerald-500/50"
    >
      <div className="text-xs uppercase tracking-wider text-emerald-300">{label}</div>
      <div className="mt-3 text-lg font-semibold text-white">{title}</div>
      <div className="mt-2 line-clamp-3 text-sm text-slate-400">{detail}</div>
      <div className="mt-4 text-sm font-medium text-emerald-300">{action} →</div>
    </button>
  );
}

// Report Viewer Component
interface ReportViewerProps {
  reportId: string;
  reportData: ReportData[keyof ReportData] | null;
  isGenerating: boolean;
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

function ReportViewer({
  reportId,
  reportData,
  isGenerating,
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
              <div className="text-lg font-bold text-white">{(reportData as ReportData['governmentBuyers'])?.summary?.totalContracts || 0}</div>
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
                      <span className="text-slate-400">{agency.contractCount} contracts</span>
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
                        {agency.osbp.director && <div className="text-slate-300">👤 {agency.osbp.director}</div>}
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
              <div className="text-lg font-bold text-white">{(reportData as ReportData['idvContracts'])?.summary?.totalContracts || 0}</div>
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
      {reportId === 'budget' && 'agencies' in reportData && (
        <div className="space-y-3">
          {(reportData as ReportData['budgetCheckup'])?.agencies?.slice(0, 10).map((agency, idx) => (
            <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
              <div className="font-medium text-white">{agency.name}</div>
              <div className="flex gap-4 mt-2 text-sm">
                <span className="text-slate-400">FY25: {formatCurrency(agency.fy2025)}</span>
                <span className="text-white">FY26: {formatCurrency(agency.fy2026)}</span>
                {agency.change && (
                  <span className={agency.change.percent > 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {agency.change.percent > 0 ? '↑' : '↓'} {Math.abs(agency.change.percent).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Simplified Acquisition */}
      {reportId === 'analytics' && 'agencies' in reportData && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-emerald-400">{formatCurrency((reportData as ReportData['simplifiedAcquisition'])?.summary?.totalSATSpending)}</div>
              <div className="text-xs text-slate-500">SAT Spending</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-lg font-bold text-white">{(reportData as ReportData['simplifiedAcquisition'])?.summary?.totalSATContracts || 0}</div>
              <div className="text-xs text-slate-500">SAT Contracts</div>
            </div>
          </div>
          {(reportData as ReportData['simplifiedAcquisition'])?.agencies?.slice(0, 10).map((agency, idx) => (
            <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="font-medium text-white">{agency.agency}</div>
                <span className={`px-2 py-0.5 rounded text-xs ${
                  agency.accessibilityLevel === 'high' ? 'bg-emerald-500/20 text-emerald-400' :
                  agency.accessibilityLevel === 'moderate' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-slate-500/20 text-slate-400'
                }`}>
                  {agency.accessibilityLevel}
                </span>
              </div>
              <div className="flex gap-4 mt-2 text-sm">
                <span className="text-emerald-400">{formatCurrency(agency.satSpending)}</span>
                <span className="text-slate-400">{agency.satContractCount} contracts</span>
              </div>
            </div>
          ))}
        </div>
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
