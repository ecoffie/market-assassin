'use client';

import { useState, useCallback } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface MarketResearchPanelProps {
  email: string | null;
  tier: MIBetaTier;
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

export default function MarketResearchPanel({ email, tier }: MarketResearchPanelProps) {
  const [selectedNaics, setSelectedNaics] = useState('541512');
  const [selectedAgency, setSelectedAgency] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [generatedReports, setGeneratedReports] = useState<Set<string>>(new Set());

  const canAccessReport = (reportTier: 'free' | 'pro') => {
    if (reportTier === 'free') return true;
    return tier !== 'free';
  };

  const handleGenerateAll = useCallback(async () => {
    if (!email || !selectedNaics) return;

    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/reports/generate-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: {
            naicsCode: selectedNaics,
            businessType: businessType || 'small_business',
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
  }, [email, selectedNaics, selectedAgency, businessType, tier]);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Market Research</h1>
          <p className="text-slate-400 mt-1">Generate strategic intelligence reports</p>
        </div>
        <button
          onClick={handleGenerateAll}
          disabled={isGenerating || !selectedNaics}
          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {isGenerating ? 'Generating...' : 'Generate All Reports'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-300 hover:text-red-200">✕</button>
        </div>
      )}

      {/* Input Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="font-semibold text-white mb-4">Research Parameters</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">NAICS Code *</label>
            <input
              type="text"
              value={selectedNaics}
              onChange={(e) => setSelectedNaics(e.target.value)}
              placeholder="e.g., 541512"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">Target Agency (optional)</label>
            <input
              type="text"
              value={selectedAgency}
              onChange={(e) => setSelectedAgency(e.target.value)}
              placeholder="e.g., Department of Defense"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">Business Type</label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-emerald-500 outline-none"
            >
              <option value="">Small Business (default)</option>
              <option value="8a">8(a)</option>
              <option value="wosb">WOSB</option>
              <option value="sdvosb">SDVOSB</option>
              <option value="hubzone">HUBZone</option>
            </select>
          </div>
        </div>
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
