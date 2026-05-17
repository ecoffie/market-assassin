'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';
import { getMIApiHeaders } from '../authHeaders';
import type { Agency } from '@/types/federal-market-assassin';

interface MarketResearchPanelProps {
  email: string | null;
  tier: MIBetaTier;
  onNavigate?: (panel: string, context?: Record<string, unknown>) => void;
}

type BusinessType = 'Women Owned' | 'HUBZone' | '8(a) Certified' | 'Small Business' | 'Native American/Tribal' | '';
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

const REPORTS: Report[] = [
  { id: 'analytics', title: 'Market Analytics', description: 'Spending patterns and trends', icon: '📊', tier: 'free', reportKey: 'simplifiedAcquisition' },
  { id: 'budget', title: 'Budget Authority', description: 'Agency budget analysis', icon: '💰', tier: 'free', reportKey: 'budgetCheckup' },
  { id: 'buyers', title: 'Gov Buyers', description: 'Decision maker identification', icon: '👤', tier: 'free', reportKey: 'governmentBuyers' },
  { id: 'osbp', title: 'OSBP Contacts', description: 'Small business office contacts', icon: '🤝', tier: 'free', reportKey: 'governmentBuyers' },
  { id: 'pain', title: 'Pain Points', description: 'Agency challenges and needs', icon: '🎯', tier: 'pro', reportKey: 'agencyPainPoints' },
  { id: 'primes', title: 'Prime Analysis', description: 'Incumbent contractor intel', icon: '🏢', tier: 'pro', reportKey: 'primeContractor' },
  { id: 'vehicles', title: 'Contract Vehicles', description: 'Relevant acquisition vehicles', icon: '🚗', tier: 'pro', reportKey: 'idvContracts' },
  { id: 'positioning', title: 'Agency Needs', description: 'Strategic positioning intel', icon: '📈', tier: 'pro', reportKey: 'agencyNeeds' },
  { id: 'teaming', title: 'Teaming Partners', description: 'Potential partner analysis', icon: '🤲', tier: 'pro', reportKey: 'tier2Subcontracting' },
  { id: 'forecast', title: 'Market Forecast', description: 'Future opportunity pipeline', icon: '🔮', tier: 'pro', reportKey: 'forecastList' },
];

const RESEARCH_LENSES = [
  { id: 'map', label: 'Market Map', description: 'Where to focus first', reports: ['buyers', 'budget', 'analytics'] },
  { id: 'buyers', label: 'Buyers', description: 'Offices and contacts', reports: ['buyers', 'osbp'] },
  { id: 'competition', label: 'Competition', description: 'Primes and vehicles', reports: ['primes', 'vehicles'] },
  { id: 'signals', label: 'Signals', description: 'Needs and upcoming demand', reports: ['pain', 'positioning', 'forecast'] },
  { id: 'partners', label: 'Partners', description: 'Teaming targets', reports: ['teaming'] },
] as const;

type ResearchLensId = typeof RESEARCH_LENSES[number]['id'];

const BUSINESS_TYPES: BusinessType[] = ['Women Owned', 'HUBZone', '8(a) Certified', 'Small Business', 'Native American/Tribal'];

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

function normalizeMatchText(value?: string | null): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
    const targetFiltered = selectedAgencies.length > 0
      ? agencies.filter((agency) => selectedAgencies.some((target) => agencyMatchesTarget(agency, target)))
      : [];

    return (targetFiltered.length > 0 ? targetFiltered : agencies).slice(0, 25);
  } catch (err) {
    console.error('Failed to lookup agency data for market research:', err);
    return [];
  }
}

function normalizeBusinessType(value?: string | null, certifications: string[] = []): BusinessType {
  const combined = [value || '', ...certifications].join(' ').toLowerCase();
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
  const certifications = firstArray(briefing.certifications, briefing.set_aside_preferences);
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
  const [marketFocuses, setMarketFocuses] = useState<MarketFocus[]>([]);
  const [activeFocusId, setActiveFocusId] = useState<string>('saved-profile');
  const [showSaveFocus, setShowSaveFocus] = useState(false);
  const [newFocusName, setNewFocusName] = useState('');
  const [focusSaving, setFocusSaving] = useState(false);
  const autoGeneratedRef = useRef(false);
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

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
      const res = await fetch(`/api/mi-beta/market-focus?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) setMarketFocuses(data.focuses || []);
    } catch (err) {
      console.error('Failed to load market focuses:', err);
    }
  }, [email, getAuthHeaders, tier]);

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
      const selectedAgencyData = await lookupAgencyData(activeFormData, selectedAgencies);
      const reportAgencyNames = selectedAgencies.length > 0
        ? selectedAgencies
        : selectedAgencyData.length > 0
          ? uniqueStrings(selectedAgencyData.map((agency) => agency.parentAgency || agency.subAgency || agency.name)).slice(0, 10)
          : ['Department of Defense', 'Department of Veterans Affairs', 'General Services Administration'];

      const res = await fetch('/api/reports/generate-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          selectedAgencies: reportAgencyNames,
          selectedAgencyData,
          userEmail: email,
        }),
      });

      const data = await res.json();

      if (data.success && data.report) {
        setReportData(data.report);
        // Mark all free reports as generated, and pro reports if user has access
        const generated = new Set<string>();
        REPORTS.forEach(r => {
          if (canAccessReport(r.tier)) {
            generated.add(r.id);
          }
        });
        setGeneratedReports(generated);
      } else {
        // Show error with hint if available
        const errorMsg = data.error || 'Failed to generate reports';
        const hint = data.hint ? ` (${data.hint})` : '';
        setError(errorMsg + hint);
      }
    } catch (err) {
      console.error('Failed to generate reports:', err);
      setError('Failed to connect to server. Please check your connection and try again.');
    } finally {
      setIsGenerating(false);
    }
  }, [canAccessReport, email, formData, selectedAgency, validateForm]);

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
      const res = await fetch('/api/mi-beta/market-focus', {
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
      const res = await fetch('/api/mi-beta/market-focus', {
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
      fetch(`/api/mi-beta/workspace?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      }).then((res) => res.ok ? res.json() : null).catch(() => null),
      fetch(`/api/alerts/preferences?email=${encodeURIComponent(email)}`)
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
          businessType: workspaceProfile?.businessType || normalizeBusinessType(prefsData.businessType),
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

  const getReportContent = (reportId: string): ReportData[keyof ReportData] | null => {
    if (!reportData) return null;
    const report = REPORTS.find(r => r.id === reportId);
    if (!report) return null;
    return reportData[report.reportKey];
  };

  const formatCurrency = (value?: number) => {
    if (!value) return '$0';
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value.toLocaleString()}`;
  };

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
      const res = await fetch('/api/mi-beta/relationships', {
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
      const res = await fetch('/api/mi-beta/relationships', {
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

  const buyers = reportData?.governmentBuyers?.agencies || [];
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
          <button
            onClick={() => handleGenerateAll()}
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

      {reportData && (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard label="Agencies to review" value={(buyerSummary?.totalAgencies || buyers.length).toLocaleString()} />
            <MetricCard label="Relevant spending" value={formatCurrency(buyerSummary?.totalSpending)} tone="green" />
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

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-4 text-xl font-semibold text-white">Choose What You Need</h2>
            <div className="grid gap-3 md:grid-cols-5">
              {RESEARCH_LENSES.map((lens) => (
                <button
                  key={lens.id}
                  type="button"
                  onClick={() => setActiveLens(lens.id)}
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
            MI will use your saved profile to find target agencies, buyers, budgets, competition, vehicles, and partner signals.
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

function MetricCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'green' | 'amber' }) {
  const color = tone === 'green' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
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
  tier: MIBetaTier;
}

function ReportViewer({
  reportId,
  reportData,
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
          <h3 className="font-semibold text-white">Report Loading...</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <p className="text-slate-400">Generate reports to load this view.</p>
      </div>
    );
  }

  const report = REPORTS.find(r => r.id === reportId);

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
        </div>
      )}
    </div>
  );
}
