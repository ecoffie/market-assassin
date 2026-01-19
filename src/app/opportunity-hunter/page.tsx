/**
 * OPPORTUNITY SCOUT PAGE
 * ======================
 *
 * CRITICAL FEATURES - DO NOT REMOVE OR MODIFY WITHOUT TESTING:
 *
 * 1. AGENCY MODAL (lines ~700-890):
 *    - Opens when clicking any agency row in the results table
 *    - Must display: Key Statistics, Office Information, Set-Aside Types,
 *      Market Research Links, Pain Points, Market Research Tips
 *    - Pain points are loaded from /api/agency-knowledge-base/ API
 *
 * 2. REQUIRED STATE VARIABLES:
 *    - modalOpen: controls modal visibility
 *    - modalAgency: stores the selected agency data
 *    - painPoints: stores loaded pain points from API
 *    - painPointsLoading: loading state for pain points
 *
 * 3. REQUIRED FUNCTIONS:
 *    - openAgencyModal(): opens modal and loads pain points
 *    - closeAgencyModal(): closes modal and clears state
 *    - loadPainPoints(): fetches pain points from knowledge base API
 *
 * 4. TABLE ROW CLICK HANDLER:
 *    - onClick={() => openAgencyModal(agency)} - DO NOT CHANGE
 *
 * Last working version: 2026-01-07
 * If something breaks, check git history for this file.
 */

'use client';

import React, { useState, FormEvent, useEffect, useCallback } from 'react';
import Link from 'next/link';

const OPPORTUNITY_SCOUT_PRO_PRODUCT_ID = 'opportunity-scout-pro';

interface SearchCriteria {
  businessFormation: string;
  naicsCode: string;
  zipCode: string;
  goodsOrServices: string;
  veteranStatus: string;
}

interface Agency {
  agencyId: string | { _?: string };
  agencyName: string | { _?: string };
  parentAgency?: string;
  contractingOffice?: string;
  totalSpending: number;
  setAsideSpending: number;
  contractCount: number;
  setAsideContractCount: number;
  setAsideTypes?: string[];
  location?: string;
  city?: string;
  searchableOfficeCode?: string;
  subAgencyCode?: string;
  agencyCode?: string;
  primaryPlaceOfPerformance?: {
    city_name?: string;
  };
  noSetAsidesFound?: boolean;
  bidsPerContractAvg?: number | null;
  bidsPerContract5th?: number | null;
  bidsPerContract95th?: number | null;
}

const FREE_AGENCY_LIMIT = 10;

interface PainPoint {
  point: string;
  source?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
}


interface SearchSuggestion {
  type: string;
  value: string;
  label: string;
  description: string;
  estimatedContracts: number;
}

interface SearchResult {
  agencies: Agency[];
  summary: {
    totalAwards: number;
    totalAgencies: number;
    totalSpending: number;
  };
  searchCriteria: SearchCriteria;
  suggestions?: {
    message: string;
    alternatives: SearchSuggestion[];
  };
  locationTier?: number;
  searchedState?: string;
  naicsCorrectionMessage?: string;
}

export default function OpportunityScoutPage() {
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAgency, setModalAgency] = useState<Agency | null>(null);
  const [painPoints, setPainPoints] = useState<PainPoint[]>([]);
  const [painPointsLoading, setPainPointsLoading] = useState(false);

  // Pro access state
  const [isPro, setIsPro] = useState(false);
  const [proCheckComplete, setProCheckComplete] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [accessEmail, setAccessEmail] = useState('');
  const [verifyingAccess, setVerifyingAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const [formData, setFormData] = useState<SearchCriteria>({
    businessFormation: '',
    naicsCode: '',
    zipCode: '',
    goodsOrServices: '',
    veteranStatus: '',
  });

  // Check for Pro access on mount (from localStorage)
  useEffect(() => {
    const savedProAccess = localStorage.getItem('opportunityScoutPro');
    if (savedProAccess) {
      try {
        const parsed = JSON.parse(savedProAccess);
        if (parsed.hasAccess && parsed.expiresAt > Date.now()) {
          setIsPro(true);
        } else {
          localStorage.removeItem('opportunityScoutPro');
        }
      } catch {
        localStorage.removeItem('opportunityScoutPro');
      }
    }
    setProCheckComplete(true);
  }, []);

  // Verify Pro access with email
  const verifyProAccess = async () => {
    if (!accessEmail) {
      setAccessError('Please enter your email');
      return;
    }

    setVerifyingAccess(true);
    setAccessError(null);

    try {
      const response = await fetch('/api/verify-ospro-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: accessEmail,
        }),
      });

      const data = await response.json();

      if (data.hasAccess) {
        setIsPro(true);
        setShowUpgradeModal(false);
        // Cache access for 24 hours
        localStorage.setItem('opportunityScoutPro', JSON.stringify({
          hasAccess: true,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          email: data.email,
        }));
      } else {
        setAccessError('No Pro access found for this email. Please purchase to unlock Pro features.');
      }
    } catch {
      setAccessError('Failed to verify access. Please try again.');
    } finally {
      setVerifyingAccess(false);
    }
  };

  const loadingMessages = [
    'Connecting to USAspending API...',
    'Fetching contract data...',
    'Analyzing set-aside types...',
    'Matching NAICS codes...',
    'Ranking agencies by spending...',
    'Enhancing agency names...',
    'Almost done...'
  ];

  const getAgencyName = (agency: Agency): string => {
    if (typeof agency.agencyName === 'string') return agency.agencyName;
    if (typeof agency.agencyName === 'object' && agency.agencyName._) return String(agency.agencyName._);
    return 'Unknown Office';
  };

  const getAgencyId = (agency: Agency): string => {
    if (typeof agency.agencyId === 'string') return agency.agencyId;
    if (typeof agency.agencyId === 'object' && agency.agencyId._) return String(agency.agencyId._);
    return 'N/A';
  };

  const loadPainPoints = useCallback(async (agency: Agency) => {
    const officeName = getAgencyName(agency);
    const parentAgency = agency.parentAgency || '';
    const location = agency.location || agency.city || agency.primaryPlaceOfPerformance?.city_name || '';

    setPainPointsLoading(true);
    setPainPoints([]);

    // Build search strategies
    const searchStrategies = [
      officeName,
      officeName?.match(/NAVFAC|NAVSEA|NAVWAR|NAVAIR|NAVSUP/i)?.[0],
      officeName?.match(/USACE|Army Corps/i) ? 'USACE' : null,
      officeName?.match(/Army Contracting Command|ACC-/i) ? 'Army Contracting Command' : null,
      officeName?.match(/Defense Logistics Agency|DLA/i) ? 'Defense Logistics Agency' : null,
      officeName?.match(/National Institutes of Health|NIH/i) ? 'NIH' : null,
      officeName?.match(/Centers for Disease Control|CDC/i) ? 'CDC' : null,
      officeName?.match(/General Services Administration|GSA/i) ? 'GSA' : null,
      parentAgency,
      parentAgency?.replace('Department of the ', '').replace('Department of ', ''),
    ].filter(Boolean);

    try {
      // Special handling for USACE
      if (searchStrategies.includes('USACE')) {
        const usaceResponse = await fetch(
          `/api/usace-mission-pain-points?officeName=${encodeURIComponent(officeName)}&location=${encodeURIComponent(location)}`
        );
        const usaceData = await usaceResponse.json();

        if (usaceData.success && usaceData.painPoints) {
          setPainPoints(usaceData.painPoints.map((pp: string) => ({ point: pp, priority: 'high' as const })));
          setPainPointsLoading(false);
          return;
        }
      }

      // Try standard search strategies
      for (const name of searchStrategies) {
        if (!name) continue;

        try {
          const response = await fetch(`/api/agency-knowledge-base/${encodeURIComponent(name)}`);
          const data = await response.json();

          if (data.success && data.data?.painPoints) {
            const points: PainPoint[] = data.data.painPoints.map((item: string | PainPoint) => {
              if (typeof item === 'string') {
                return { point: item };
              }
              return item;
            });
            setPainPoints(points);
            setPainPointsLoading(false);
            return;
          }
        } catch {
          // Continue to next strategy
        }
      }

      setPainPointsLoading(false);
    } catch {
      setPainPointsLoading(false);
    }
  }, []);

  const openAgencyModal = useCallback((agency: Agency) => {
    setModalAgency(agency);
    setModalOpen(true);
    loadPainPoints(agency);
  }, [loadPainPoints]);

  const closeAgencyModal = useCallback(() => {
    setModalOpen(false);
    setModalAgency(null);
    setPainPoints([]);
  }, []);

  // Close modal on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAgencyModal();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeAgencyModal]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResults(null);
    setProgress(0);

    let messageIndex = 0;
    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + Math.random() * 15, 95));
      if (messageIndex < loadingMessages.length) {
        setLoadingMessage(loadingMessages[messageIndex]);
        messageIndex++;
      }
    }, 3000);

    try {
      const response = await fetch('/api/government-contracts/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to search government contracts');
      }

      const result = await response.json();
      clearInterval(progressInterval);
      setProgress(100);
      setLoadingMessage('Complete!');

      setTimeout(() => {
        setLoading(false);
        setResults(result);
      }, 500);

    } catch (err) {
      clearInterval(progressInterval);
      setLoading(false);
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const applySuggestion = (suggestion: SearchSuggestion) => {
    const newFormData = { ...formData };

    switch (suggestion.type) {
      case 'set-aside':
        newFormData.businessFormation = suggestion.value;
        break;
      case 'location':
      case 'naics-setaside-nationwide':
        newFormData.zipCode = '';
        break;
      case 'naics-prefix':
        const prefixMatch = suggestion.value.match(/naics-prefix:(\d+)/);
        if (prefixMatch?.[1]) {
          newFormData.naicsCode = prefixMatch[1];
        }
        break;
      case 'naics':
        if (suggestion.value === 'all') {
          newFormData.naicsCode = '';
        }
        break;
    }

    setFormData(newFormData);
    setTimeout(() => {
      document.getElementById('search-form')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    }, 100);
  };

  const formatSearchCriteria = (criteria: SearchCriteria): string => {
    const parts: string[] = [];
    if (criteria.naicsCode) parts.push(`NAICS ${criteria.naicsCode}`);
    if (criteria.businessFormation) parts.push(criteria.businessFormation.replace(/-/g, ' '));
    if (criteria.veteranStatus && criteria.veteranStatus !== 'not-applicable') {
      parts.push(criteria.veteranStatus.replace(/-/g, ' '));
    }
    if (criteria.goodsOrServices) parts.push(criteria.goodsOrServices);
    if (criteria.zipCode) parts.push(`ZIP ${criteria.zipCode}`);
    return parts.join(', ') || 'All contracts';
  };

  const exportToCSV = () => {
    if (!results?.agencies?.length) return;

    let csv = 'Agency Name,Total Contracts,Total Spending,Average Contract Value,Set-Aside Types\n';

    results.agencies.forEach(agency => {
      const name = getAgencyName(agency).replace(/"/g, '""');
      const contracts = agency.contractCount || 0;
      const spending = agency.totalSpending || 0;
      const avgValue = contracts > 0 ? Math.round(spending / contracts) : 0;
      const setAsides = (agency.setAsideTypes || []).join('; ');

      csv += `"${name}",${contracts},${spending.toFixed(2)},${avgValue.toFixed(2)},"${setAsides}"\n`;
    });

    csv += '\n';
    csv += 'Search Summary\n';
    csv += `Total Contracts,${results.summary?.totalAwards || 0}\n`;
    csv += `Total Agencies,${results.summary?.totalAgencies || 0}\n`;
    csv += `Total Spending,${(results.summary?.totalSpending || 0).toFixed(2)}\n`;
    csv += `Search Date,${new Date().toLocaleDateString()}\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opportunity-scout-results-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mb-4">
            <span className="text-3xl font-bold text-blue-400">GovCon</span>
            <span className="text-3xl font-bold text-amber-400">Giants</span>
          </div>
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-4xl font-bold text-white">Opportunity Hunter</h1>
            {isPro && (
              <span className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold rounded-full shadow-lg">
                PRO
              </span>
            )}
          </div>
          <p className="text-slate-300 mt-2">Discover 50+ agencies awarding contracts to businesses like yours</p>

          {/* Free user upgrade banner */}
          {proCheckComplete && !isPro && (
            <div className="mt-4 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/50 rounded-lg p-4 max-w-2xl mx-auto">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-left">
                  <p className="text-amber-300 font-semibold">Upgrade to Pro</p>
                  <p className="text-sm text-slate-300">Unlock pain points, market research tips, and CSV export</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowUpgradeModal(true)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold rounded-lg transition text-sm"
                  >
                    Unlock Pro
                  </button>
                  <button
                    onClick={() => setShowUpgradeModal(true)}
                    className="px-4 py-2 bg-transparent border border-amber-500 text-amber-400 hover:bg-amber-500/20 font-semibold rounded-lg transition text-sm"
                  >
                    I Have Access
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="sticky top-4 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl shadow-2xl p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
                <div>
                  <p className="font-semibold">Scouting Opportunities...</p>
                  <p className="text-sm opacity-90">{loadingMessage}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">{Math.floor(progress)}%</p>
                <p className="text-xs opacity-75">Complete</p>
              </div>
            </div>
            <div className="mt-3 bg-white bg-opacity-20 rounded-full h-2 overflow-hidden">
              <div
                className="bg-white h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Search Form */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <form id="search-form" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Business Type
                </label>
                <select
                  value={formData.businessFormation}
                  onChange={(e) => setFormData({ ...formData, businessFormation: e.target.value })}
                  className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select type</option>
                  <option value="women-owned">Women Owned</option>
                  <option value="hubzone">HUBZone</option>
                  <option value="8a">8(a) Certified</option>
                  <option value="small-business">Small Business</option>
                  <option value="dot-certified">DOT Certified</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  NAICS Code
                </label>
                <input
                  type="text"
                  value={formData.naicsCode}
                  onChange={(e) => setFormData({ ...formData, naicsCode: e.target.value })}
                  placeholder="e.g., 541330"
                  className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Zip Code
                </label>
                <input
                  type="text"
                  value={formData.zipCode}
                  onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                  placeholder="e.g., 10001"
                  maxLength={5}
                  pattern="[0-9]{5}"
                  className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Goods or Services?
                </label>
                <select
                  value={formData.goodsOrServices}
                  onChange={(e) => setFormData({ ...formData, goodsOrServices: e.target.value })}
                  className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select one</option>
                  <option value="goods">Goods</option>
                  <option value="services">Services</option>
                  <option value="both">Both</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Veteran Status
                </label>
                <select
                  value={formData.veteranStatus}
                  onChange={(e) => setFormData({ ...formData, veteranStatus: e.target.value })}
                  className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select status</option>
                  <option value="veteran-owned">Veteran Owned</option>
                  <option value="service-disabled-veteran">Service Disabled Vet</option>
                  <option value="not-applicable">Not Applicable</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white px-6 py-2 text-sm rounded-lg font-bold hover:bg-blue-700 transition shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Scout Opportunities
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 mb-6">
            <h2 className="text-xl font-bold text-red-900 mb-2">Error</h2>
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-6">
            {/* Action Buttons */}
            <div className="flex justify-end gap-3">
              {isPro ? (
                <>
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print Results
                  </button>
                  <button
                    onClick={exportToCSV}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export CSV
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowUpgradeModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-semibold rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Unlock Export (Pro)
                </button>
              )}
            </div>

            {/* Summary */}
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6">
              <h2 className="text-xl font-bold text-blue-900 mb-4">Search Summary</h2>
              <div className="space-y-2 text-blue-800">
                <p><strong>Total Contracts Found:</strong> {results.summary.totalAwards.toLocaleString()}</p>
                <p><strong>Agencies Spending in Your Category:</strong> {results.summary.totalAgencies}</p>
                <p><strong>Total Contract Value:</strong> ${(results.summary.totalSpending / 1000000).toFixed(2)}M</p>
                <p><strong>Search Criteria:</strong> {formatSearchCriteria(results.searchCriteria)}</p>

                {results.locationTier && results.locationTier > 1 && results.searchedState && (
                  <div className="mt-3 p-3 bg-amber-100 border border-amber-400 rounded-lg">
                    <p className="text-sm text-amber-900">
                      <strong>
                        {results.locationTier === 2 && 'Geographic Expansion:'}
                        {results.locationTier === 3 && 'Geographic Expansion:'}
                        {results.locationTier === 4 && 'Geographic Expansion:'}
                      </strong>{' '}
                      {results.locationTier === 2 && `Search expanded from ${results.searchedState} to include bordering states to find more opportunities.`}
                      {results.locationTier === 3 && `Search expanded from ${results.searchedState} to include the extended region (~200 mile radius) to find more opportunities.`}
                      {results.locationTier === 4 && `Search expanded to nationwide to find more opportunities (started from ${results.searchedState}).`}
                    </p>
                  </div>
                )}

                {results.naicsCorrectionMessage && (
                  <div className="mt-3 p-3 bg-blue-100 border border-blue-300 rounded-lg">
                    <p className="text-sm text-blue-900">
                      <strong>Search Info:</strong> {results.naicsCorrectionMessage}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Search Suggestions */}
            {results.suggestions?.alternatives && results.suggestions.alternatives.length > 0 && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl p-6">
                <h3 className="text-lg font-bold text-blue-900 mb-2">Expand Your Search</h3>
                <p className="text-sm text-blue-800 mb-4">{results.suggestions.message}</p>
                <div className="space-y-3">
                  {results.suggestions.alternatives.map((alt, index) => (
                    <div
                      key={index}
                      onClick={() => applySuggestion(alt)}
                      className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-400"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900 mb-1">{alt.label}</h4>
                          <p className="text-sm text-gray-600">{alt.description}</p>
                        </div>
                        <div className="ml-4 text-right">
                          <p className="text-2xl font-bold text-green-600">~{alt.estimatedContracts.toLocaleString()}</p>
                          <p className="text-xs text-gray-500">contracts</p>
                        </div>
                      </div>
                      <button className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
                        Search with this option
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agencies Table */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-white">Top Government Agencies</h2>
                  <p className="text-slate-300">These agencies have awarded the most contracts matching your business profile</p>
                </div>
                {!isPro && results.agencies && results.agencies.length > FREE_AGENCY_LIMIT && (
                  <div className="text-right">
                    <span className="text-amber-400 text-sm">
                      Showing {FREE_AGENCY_LIMIT} of {results.agencies.length} agencies
                    </span>
                  </div>
                )}
              </div>

              {results.agencies && results.agencies.length > 0 ? (
                <div className="bg-white rounded-xl shadow overflow-hidden">
                  {results.agencies.some(a => a.noSetAsidesFound) && (
                    <div className="p-4 bg-yellow-50 border-l-4 border-yellow-400">
                      <p className="text-sm text-yellow-800 font-semibold mb-2">No set-aside contracts found</p>
                      <p className="text-sm text-yellow-700">
                        These offices award contracts in your NAICS category, but no {results.searchCriteria.businessFormation || 'set-aside'} contracts were found in recent data.
                        They may still award {results.searchCriteria.businessFormation || 'set-aside'} contracts - check SAM.gov for active opportunities.
                      </p>
                    </div>
                  )}
                  <div className="p-4 text-sm text-gray-700 bg-blue-50">
                    <strong>Market Research Guide:</strong> Contracting offices below are ranked by set-aside spending.
                    Use the <strong>Contracting Office</strong> and columns to identify program needs and gaps.
                    The <strong>Office ID</strong> can be searched on <a href="https://sam.gov" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-semibold">SAM.gov</a> to find active opportunities.
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100 border-b-2 border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Agency ID</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Contracting Office</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Set-Aside Spending</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Total Spending</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Contracts</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {(isPro ? results.agencies : results.agencies.slice(0, FREE_AGENCY_LIMIT)).map((agency, index) => {
                          const agencyIdStr = getAgencyId(agency);
                          const agencyNameStr = getAgencyName(agency);
                          const displayAgencyId = agency.searchableOfficeCode || agency.subAgencyCode || agency.agencyCode || agencyIdStr;
                          const samSearchUrl = `https://sam.gov/search/?index=opp&page=1&pageSize=25&sort=-modifiedDate&sfm%5Bstatus%5D%5Bis_active%5D=true&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&q=${encodeURIComponent(agencyNameStr)}`;

                          const cityName = agency.primaryPlaceOfPerformance?.city_name || '';
                          const locationDisplay = [cityName, agency.location].filter(Boolean).join(', ');

                          return (
                            <tr
                              key={index}
                              className="hover:bg-blue-50 transition cursor-pointer"
                              onClick={() => openAgencyModal(agency)}
                            >
                              <td className="px-4 py-4">
                                <a
                                  href={samSearchUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-blue-600 hover:underline font-semibold text-sm"
                                  title={`Search SAM.gov for opportunities from ${agencyNameStr}`}
                                >
                                  {displayAgencyId}
                                </a>
                              </td>
                              <td className="px-4 py-4">
                                <div className="font-semibold text-sm text-gray-900">{agencyNameStr}</div>
                                {locationDisplay && (
                                  <div className="text-xs text-gray-600 mt-1">{locationDisplay}</div>
                                )}
                              </td>
                              <td className="px-4 py-4">
                                <span className={`text-sm font-bold ${agency.setAsideSpending > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                  ${(agency.setAsideSpending / 1000000).toFixed(2)}M
                                </span>
                                {agency.setAsideContractCount > 0 && (
                                  <span className="block text-xs text-gray-600">{agency.setAsideContractCount} contracts</span>
                                )}
                              </td>
                              <td className="px-4 py-4 text-sm font-semibold text-gray-600">
                                ${(agency.totalSpending / 1000000).toFixed(2)}M
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-900">{agency.contractCount}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Upgrade CTA for free users when more agencies available */}
                  {!isPro && results.agencies.length > FREE_AGENCY_LIMIT && (
                    <div className="p-6 bg-gradient-to-r from-amber-50 to-orange-50 border-t-2 border-amber-200">
                      <div className="flex items-center justify-between flex-wrap gap-4">
                        <div>
                          <p className="font-semibold text-amber-900">
                            +{results.agencies.length - FREE_AGENCY_LIMIT} more agencies available
                          </p>
                          <p className="text-sm text-amber-700">
                            Upgrade to Pro to see all {results.agencies.length} agencies plus pain points & export
                          </p>
                        </div>
                        <button
                          onClick={() => setShowUpgradeModal(true)}
                          className="px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold rounded-lg transition"
                        >
                          Unlock All Agencies
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-6">
                  <h3 className="text-lg font-bold text-yellow-900 mb-3">No agencies found matching your criteria</h3>
                  <ul className="list-disc list-inside text-yellow-800 space-y-2">
                    <li>Try adjusting your NAICS code or removing geographic restrictions</li>
                    <li>Verify your search criteria are correct</li>
                    <li>Some NAICS codes have limited contract activity</li>
                  </ul>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-slate-400">
          <p className="text-sm">
            &copy; {new Date().getFullYear()} GovCon Giants. All rights reserved.
          </p>
          <div className="mt-2">
            <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
              Back to Home
            </Link>
          </div>
        </div>
      </div>

      {/* Agency Details Modal */}
      {modalOpen && modalAgency && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={closeAgencyModal}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">{getAgencyName(modalAgency)}</h2>
              <button
                onClick={closeAgencyModal}
                className="text-gray-400 hover:text-gray-600 text-3xl font-bold"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Key Statistics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">Set-Aside Spending</div>
                  <div className="text-2xl font-bold text-blue-600">
                    ${(modalAgency.setAsideSpending / 1000000).toFixed(2)}M
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{modalAgency.setAsideContractCount || 0} contracts</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">Total Spending</div>
                  <div className="text-2xl font-bold text-gray-700">
                    ${(modalAgency.totalSpending / 1000000).toFixed(2)}M
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{modalAgency.contractCount || 0} contracts</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">Set-Aside %</div>
                  <div className="text-2xl font-bold text-green-600">
                    {modalAgency.totalSpending > 0
                      ? ((modalAgency.setAsideSpending / modalAgency.totalSpending) * 100).toFixed(1)
                      : '0'}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">of total spending</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">Agency ID</div>
                  <div className="text-xl font-bold text-purple-600">
                    {modalAgency.searchableOfficeCode || modalAgency.subAgencyCode || modalAgency.agencyCode || 'N/A'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Search on SAM.gov</div>
                </div>
              </div>

              {/* Office Information */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Office Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-600">Contracting Office</div>
                    <div className="text-base font-semibold text-gray-900">{getAgencyName(modalAgency)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Parent Agency</div>
                    <div className="text-base font-semibold text-gray-900">{modalAgency.parentAgency || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Location</div>
                    <div className="text-base text-gray-900">
                      {[modalAgency.primaryPlaceOfPerformance?.city_name, modalAgency.location].filter(Boolean).join(', ') || 'Not specified'}
                    </div>
                  </div>
                  {modalAgency.contractingOffice && modalAgency.contractingOffice !== getAgencyName(modalAgency) && (
                    <div>
                      <div className="text-sm text-gray-600">Office Detail</div>
                      <div className="text-base text-gray-900">{modalAgency.contractingOffice}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Set-Aside Types */}
              {modalAgency.setAsideTypes && modalAgency.setAsideTypes.length > 0 && (
                <div className="bg-blue-50 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Set-Aside Types Used</h3>
                  <div className="flex flex-wrap gap-2">
                    {modalAgency.setAsideTypes.map((type, i) => (
                      <span key={i} className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                        {type}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Links */}
              <div className="bg-blue-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Market Research Links</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <a
                    href={`https://sam.gov/search/?index=opp&page=1&pageSize=25&sort=-modifiedDate&sfm%5Bstatus%5D%5Bis_active%5D=true&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&q=${encodeURIComponent(getAgencyName(modalAgency))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between bg-white rounded-lg p-4 hover:bg-blue-100 transition border border-blue-200"
                  >
                    <div>
                      <div className="font-semibold text-gray-900">SAM.gov Opportunities</div>
                      <div className="text-sm text-gray-600">Search active contracts</div>
                    </div>
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  <a
                    href={`https://www.usaspending.gov/search/?hash=&filters=%7B%22keyword%22%3A%22${encodeURIComponent(getAgencyName(modalAgency))}%22%7D`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between bg-white rounded-lg p-4 hover:bg-blue-100 transition border border-blue-200"
                  >
                    <div>
                      <div className="font-semibold text-gray-900">USASpending</div>
                      <div className="text-sm text-gray-600">View spending data</div>
                    </div>
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>

              {/* Agency Pain Points - Pro Only */}
              {isPro ? (
                <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-l-4 border-purple-500 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-purple-900 mb-3">Agency Priorities & Pain Points</h3>
                  <div className="space-y-2">
                    {painPointsLoading ? (
                      <p className="text-sm text-purple-800">Loading agency insights...</p>
                    ) : painPoints.length > 0 ? (
                      <ul className="space-y-2 text-sm text-purple-800">
                        {painPoints.map((item, i) => (
                          <li key={i} className="flex items-start">
                            <span className="text-purple-600 mr-2">•</span>
                            <div className="flex-1">
                              <span>{item.point}</span>
                              {item.source && (
                                <span className="text-purple-600 text-xs ml-2 italic">({item.source})</span>
                              )}
                              {item.priority && (
                                <span className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
                                  item.priority === 'critical' ? 'bg-red-100 text-red-800' :
                                  item.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                                  'bg-blue-100 text-blue-800'
                                }`}>
                                  {item.priority}
                                </span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-purple-700 italic">
                        Agency priorities data not available for this office yet. Check the office website for current priorities.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-gradient-to-r from-gray-100 to-gray-200 border-l-4 border-gray-400 rounded-lg p-6 relative overflow-hidden">
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-10">
                    <button
                      onClick={() => {
                        closeAgencyModal();
                        setShowUpgradeModal(true);
                      }}
                      className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold rounded-lg shadow-lg transition flex items-center gap-2"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Unlock Pain Points (Pro)
                    </button>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-500 mb-3">Agency Priorities & Pain Points</h3>
                  <ul className="space-y-2 text-sm text-gray-400">
                    <li className="blur-sm">• Critical infrastructure modernization needs...</li>
                    <li className="blur-sm">• Cybersecurity concerns and compliance gaps...</li>
                    <li className="blur-sm">• Budget constraints impacting program delivery...</li>
                    <li className="blur-sm">• Workforce challenges in key technical areas...</li>
                  </ul>
                </div>
              )}

              {/* Market Research Tips - Pro Only */}
              {isPro ? (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-yellow-900 mb-3">Market Research Tips</h3>
                  <ul className="space-y-2 text-sm text-yellow-800">
                    <li>• Check SAM.gov for active opportunities from this office</li>
                    <li>• Research this office&apos;s typical contract sizes and durations</li>
                    <li>• Identify past awardees to understand competition</li>
                    <li>• Look for upcoming solicitations in your NAICS code</li>
                    <li>• Align your capabilities with the agency priorities shown above</li>
                  </ul>
                </div>
              ) : (
                <div className="bg-gray-100 border-l-4 border-gray-300 rounded-lg p-6 relative overflow-hidden">
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-10">
                    <div className="text-center">
                      <p className="text-gray-600 font-medium mb-2">Market Research Tips</p>
                      <p className="text-sm text-gray-500">Available with Pro</p>
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-400 mb-3">Market Research Tips</h3>
                  <ul className="space-y-2 text-sm text-gray-400 blur-sm">
                    <li>• Strategic approach to engaging this office...</li>
                    <li>• Key contacts and decision makers...</li>
                    <li>• Typical procurement timeline...</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upgrade/Access Modal */}
      {showUpgradeModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowUpgradeModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-black">Unlock Pro Features</h2>
                <button
                  onClick={() => setShowUpgradeModal(false)}
                  className="text-black/60 hover:text-black text-2xl font-bold"
                >
                  &times;
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Pro Features List */}
              <div className="bg-amber-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Pro includes:</h3>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <strong>All agencies</strong> (Free shows top 10)
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Agency Pain Points & Priorities
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Market Research Tips
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    CSV Export & Print Results
                  </li>
                </ul>
              </div>

              {/* Already Have Access */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Already have access?</h3>
                <div className="space-y-3">
                  <input
                    type="email"
                    placeholder="Email used for purchase"
                    value={accessEmail}
                    onChange={(e) => setAccessEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && verifyProAccess()}
                    style={{ color: '#000000', backgroundColor: '#ffffff' }}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />

                  {accessError && (
                    <p className="text-sm text-red-600">{accessError}</p>
                  )}

                  <button
                    onClick={verifyProAccess}
                    disabled={verifyingAccess}
                    className="w-full py-2 bg-gray-800 hover:bg-gray-900 text-white font-semibold rounded-lg transition disabled:opacity-50"
                  >
                    {verifyingAccess ? 'Verifying...' : 'Verify Access'}
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-200 pt-4">
                <h3 className="font-semibold text-gray-900 mb-3">New customer?</h3>
                <a
                  href="https://buy.stripe.com/00wcN60ke97c5d384UfnO0i"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold rounded-lg text-center transition"
                >
                  Get Pro Access - $49
                </a>
                <p className="text-xs text-gray-500 text-center mt-2">
                  One-time payment. Lifetime access.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
