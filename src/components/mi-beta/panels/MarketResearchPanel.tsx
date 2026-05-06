'use client';

import { useState, useCallback } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface MarketResearchPanelProps {
  email: string | null;
  tier: MIBetaTier;
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

// PSC Category options
const PSC_CATEGORIES = [
  { value: '', label: 'Select PSC Category...' },
  { value: 'D', label: 'D - IT & Telecom Services' },
  { value: 'R', label: 'R - Professional Services' },
  { value: 'J', label: 'J - Maintenance & Repair' },
  { value: 'S', label: 'S - Utilities & Housekeeping' },
  { value: 'Y', label: 'Y - Construction of Structures' },
  { value: 'Z', label: 'Z - Maintenance of Real Property' },
  { value: 'B', label: 'B - Special Studies & Analysis' },
  { value: 'C', label: 'C - Architect & Engineering' },
  { value: 'F', label: 'F - Natural Resources Management' },
  { value: 'G', label: 'G - Social Services' },
  { value: 'H', label: 'H - Quality Control & Testing' },
  { value: 'K', label: 'K - Modification of Equipment' },
  { value: 'L', label: 'L - Technical Representative' },
  { value: 'M', label: 'M - Operation of Facilities' },
  { value: 'N', label: 'N - Installation of Equipment' },
  { value: 'P', label: 'P - Salvage Services' },
  { value: 'Q', label: 'Q - Medical Services' },
  { value: 'T', label: 'T - Photo, Map, Print, Publishing' },
  { value: 'U', label: 'U - Education & Training' },
  { value: 'V', label: 'V - Transportation & Travel' },
  { value: 'W', label: 'W - Lease/Rental of Equipment' },
  { value: 'X', label: 'X - Lease/Rental of Facilities' },
  { value: 'A', label: 'A - R&D Services' },
  { value: '70', label: '70 - IT Equipment & Software' },
  { value: '58', label: '58 - Communication Equipment' },
  { value: '65', label: '65 - Medical & Dental Equipment' },
  { value: '66', label: '66 - Instruments & Lab Equipment' },
  { value: '75', label: '75 - Office Supplies' },
  { value: '71', label: '71 - Furniture' },
  { value: '23', label: '23 - Motor Vehicles' },
  { value: '25', label: '25 - Vehicular Equipment' },
  { value: '15', label: '15 - Aircraft & Airframe Components' },
  { value: '59', label: '59 - Electrical Equipment' },
  { value: '36', label: '36 - Special Industry Machinery' },
  { value: '89', label: '89 - Subsistence (Food)' },
  { value: '84', label: '84 - Clothing & Textiles' },
];

const BUSINESS_TYPES: BusinessType[] = ['Women Owned', 'HUBZone', '8(a) Certified', 'Small Business', 'Native American/Tribal'];
const VETERAN_STATUSES: VeteranStatus[] = ['Not Applicable', 'Veteran Owned', 'Service Disabled Veteran'];

export default function MarketResearchPanel({ email, tier }: MarketResearchPanelProps) {
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

  const canAccessReport = (reportTier: 'free' | 'pro') => {
    if (reportTier === 'free') return true;
    return tier !== 'free';
  };

  const validateForm = (): boolean => {
    setValidationError(null);

    if (!formData.businessType) {
      setValidationError('Please select a business type');
      return false;
    }

    const hasNaics = formData.naicsCode && formData.naicsCode.trim();
    const hasPsc = formData.pscCode && formData.pscCode.trim();

    if (!hasNaics && !hasPsc) {
      setValidationError('Please enter either a NAICS code or select a PSC code/category');
      return false;
    }

    return true;
  };

  const handleGenerateAll = useCallback(async () => {
    if (!email) return;
    if (!validateForm()) return;

    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/reports/generate-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: {
            naicsCode: formData.naicsCode,
            pscCode: formData.pscCode,
            businessType: formData.businessType || 'Small Business',
            veteranStatus: formData.veteranStatus,
            zipCode: formData.zipCode,
            companyName: formData.companyName,
            excludeDOD: formData.excludeDOD,
            goodsOrServices: 'services',
          },
          selectedAgencies: selectedAgency ? [selectedAgency] : ['Department of Defense', 'Department of Veterans Affairs', 'General Services Administration'],
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
        setError(data.error || 'Failed to generate reports');
      }
    } catch (err) {
      console.error('Failed to generate reports:', err);
      setError('Failed to connect to server');
    } finally {
      setIsGenerating(false);
    }
  }, [email, formData, selectedAgency, tier]);

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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Market Research</h1>
        <p className="text-slate-400 mt-1">Generate strategic intelligence reports</p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-300 hover:text-red-200">✕</button>
        </div>
      )}

      {/* Input Form - Full Federal Market Assassin */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="mb-4">
          <h3 className="font-semibold text-white">Enter Your 5 Core Inputs</h3>
          <p className="text-sm text-slate-500 mt-1">Provide your business information to discover matching government agencies</p>
        </div>

        {/* Validation Error */}
        {validationError && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm flex items-start">
            <span className="mr-2">⚠️</span>
            {validationError}
          </div>
        )}

        {/* Business Type - Required */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            1. Business Type <span className="text-red-400">*</span>
          </label>
          <select
            value={formData.businessType}
            onChange={(e) => setFormData({ ...formData, businessType: e.target.value as BusinessType })}
            className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
          >
            <option value="">Select your business type...</option>
            {BUSINESS_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        {/* NAICS Code and PSC Code - Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              2. NAICS Code(s) <span className="text-slate-500 text-xs">(or use PSC)</span>
            </label>
            <input
              type="text"
              value={formData.naicsCode}
              onChange={(e) => setFormData({ ...formData, naicsCode: e.target.value })}
              placeholder="e.g., 236, 238320, 541511"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">
              Multiple codes OK: <span className="text-blue-400">236, 238</span> = all construction
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              PSC Code <span className="text-slate-500 text-xs">(or use NAICS)</span>
            </label>
            <input
              type="text"
              value={formData.pscCode}
              onChange={(e) => setFormData({ ...formData, pscCode: e.target.value.toUpperCase() })}
              placeholder="e.g., D310, 7030"
              maxLength={4}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">Product/Service Code (4-char)</p>
          </div>
        </div>

        {/* Zip Code and Veteran Status - Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              3. Zip Code <span className="text-slate-500 text-xs">(Optional)</span>
            </label>
            <input
              type="text"
              value={formData.zipCode}
              onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
              placeholder="e.g., 20001"
              maxLength={5}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              4. Veteran Status <span className="text-slate-500 text-xs">(Optional)</span>
            </label>
            <select
              value={formData.veteranStatus}
              onChange={(e) => setFormData({ ...formData, veteranStatus: e.target.value as VeteranStatus })}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              {VETERAN_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
        </div>

        {/* PSC Category and Company Name - Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              5. PSC Category <span className="text-slate-500 text-xs">(Optional)</span>
            </label>
            <select
              value={formData.pscCode}
              onChange={(e) => setFormData({ ...formData, pscCode: e.target.value })}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              {PSC_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Company Name <span className="text-slate-500 text-xs">(Optional)</span>
            </label>
            <input
              type="text"
              value={formData.companyName}
              onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
              placeholder="Your company name"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>
        </div>

        {/* Civilian Agencies Only Checkbox */}
        <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
          <label className="flex items-start cursor-pointer">
            <input
              type="checkbox"
              checked={formData.excludeDOD}
              onChange={(e) => setFormData({ ...formData, excludeDOD: e.target.checked })}
              className="mt-0.5 h-4 w-4 text-amber-500 bg-slate-800 border-slate-600 rounded focus:ring-amber-500"
            />
            <div className="ml-3">
              <span className="text-sm font-semibold text-amber-400">Civilian Agencies Only</span>
              <p className="text-xs text-amber-300/70 mt-0.5">
                Exclude Department of Defense (DOD) agencies. Civilian agencies are often more accessible for startups and small businesses.
              </p>
            </div>
          </label>
        </div>

        {/* Target Agency (optional override) */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Target Agency <span className="text-slate-500 text-xs">(Optional - focuses reports on specific agency)</span>
          </label>
          <input
            type="text"
            value={selectedAgency}
            onChange={(e) => setSelectedAgency(e.target.value)}
            placeholder="e.g., Department of Defense, VA, GSA"
            className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
          />
        </div>

        {/* Generate Button - At Bottom of Form */}
        <button
          onClick={handleGenerateAll}
          disabled={isGenerating}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Finding Target Agencies...
            </>
          ) : (
            <>
              Find Target Agencies
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </>
          )}
        </button>
      </div>

      {/* Reports Grid */}
      <div>
        <h3 className="font-semibold text-white mb-4">Available Reports</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORTS.map((report) => {
            const hasAccess = canAccessReport(report.tier);
            const isGenerated = generatedReports.has(report.id);
            const isActive = activeReportId === report.id;
            return (
              <div
                key={report.id}
                className={`
                  bg-slate-900 border rounded-xl p-4 transition-all
                  ${isActive ? 'border-emerald-500 ring-1 ring-emerald-500' : ''}
                  ${hasAccess
                    ? 'border-slate-800 hover:border-emerald-500/50 cursor-pointer'
                    : 'border-slate-800/50 opacity-60'
                  }
                `}
                onClick={() => handleReportClick(report)}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-2xl">{report.icon}</span>
                  <div className="flex gap-2">
                    {isGenerated && (
                      <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded">
                        Ready
                      </span>
                    )}
                    {!hasAccess && (
                      <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">
                        Pro
                      </span>
                    )}
                  </div>
                </div>
                <h4 className="font-medium text-white mb-1">{report.title}</h4>
                <p className="text-sm text-slate-500">{report.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Report Viewer */}
      {activeReportId && reportData && (
        <ReportViewer
          reportId={activeReportId}
          reportData={getReportContent(activeReportId)}
          onClose={() => setActiveReportId(null)}
          formatCurrency={formatCurrency}
        />
      )}

      {/* Upgrade CTA for Free Users */}
      {tier === 'free' && (
        <div className="bg-gradient-to-r from-purple-900/30 to-slate-900 border border-purple-500/30 rounded-xl p-6 text-center">
          <h3 className="font-semibold text-white mb-2">Unlock All 10 Reports</h3>
          <p className="text-slate-400 text-sm mb-4">
            Upgrade to Pro to access Pain Points, Prime Analysis, Teaming Partners, and more.
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

// Report Viewer Component
interface ReportViewerProps {
  reportId: string;
  reportData: ReportData[keyof ReportData] | null;
  onClose: () => void;
  formatCurrency: (value?: number) => string;
}

function ReportViewer({ reportId, reportData, onClose, formatCurrency }: ReportViewerProps) {
  if (!reportData) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Report Loading...</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <p className="text-slate-400">Click "Generate All Reports" to load this report.</p>
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
          {(reportData as ReportData['governmentBuyers'])?.agencies?.slice(0, 10).map((agency, idx) => (
            <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
              <div className="font-medium text-white">{agency.contractingOffice}</div>
              {agency.parentAgency && <div className="text-xs text-slate-500">{agency.parentAgency}</div>}
              <div className="flex gap-4 mt-2 text-sm">
                <span className="text-emerald-400">{formatCurrency(agency.spending)}</span>
                <span className="text-slate-400">{agency.contractCount} contracts</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* OSBP Contacts */}
      {reportId === 'osbp' && 'agencies' in reportData && (
        <div className="space-y-3">
          {(reportData as ReportData['governmentBuyers'])?.agencies?.filter(a => a.osbp).slice(0, 10).map((agency, idx) => (
            <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
              <div className="font-medium text-white">{agency.contractingOffice}</div>
              {agency.osbp && (
                <div className="mt-2 text-sm">
                  {agency.osbp.director && <div className="text-slate-300">👤 {agency.osbp.director}</div>}
                  {agency.osbp.email && <div className="text-blue-400">✉️ {agency.osbp.email}</div>}
                  {agency.osbp.phone && <div className="text-slate-400">📞 {agency.osbp.phone}</div>}
                </div>
              )}
            </div>
          ))}
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
          {(reportData as ReportData['primeContractor'])?.suggestedPrimes?.slice(0, 10).map((prime, idx) => (
            <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
              <div className="font-medium text-white">{prime.name}</div>
              {prime.reason && <div className="text-sm text-slate-400 mt-1">{prime.reason}</div>}
              {prime.email && <div className="text-sm text-blue-400 mt-1">✉️ {prime.email}</div>}
              {prime.naicsCategories && prime.naicsCategories.length > 0 && (
                <div className="text-xs text-slate-500 mt-1">NAICS: {prime.naicsCategories.slice(0, 3).join(', ')}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Forecasts */}
      {reportId === 'forecast' && 'forecasts' in reportData && (
        <div className="space-y-3">
          <div className="bg-slate-800/50 rounded-lg p-3 mb-4">
            <div className="text-lg font-bold text-white">{(reportData as ReportData['forecastList'])?.summary?.totalForecasts || 0}</div>
            <div className="text-xs text-slate-500">Upcoming Forecasts</div>
          </div>
          {(reportData as ReportData['forecastList'])?.forecasts?.slice(0, 10).map((forecast, idx) => (
            <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
              <div className="font-medium text-white">{forecast.agency}</div>
              <div className="text-sm text-slate-400 mt-1 line-clamp-2">{forecast.description}</div>
              <div className="flex gap-4 mt-2 text-xs">
                {forecast.estimatedValue && <span className="text-emerald-400">{forecast.estimatedValue}</span>}
                {forecast.quarter && <span className="text-slate-500">{forecast.quarter}</span>}
                {forecast.naicsCode && <span className="text-slate-500">NAICS {forecast.naicsCode}</span>}
              </div>
            </div>
          ))}
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
          {(reportData as ReportData['tier2Subcontracting'])?.suggestedPrimes?.slice(0, 10).map((partner, idx) => (
            <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
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
          ))}
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
