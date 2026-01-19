/**
 * FEDERAL MARKET ASSASSIN PAGE
 * ============================
 *
 * CRITICAL FEATURES - DO NOT REMOVE OR MODIFY WITHOUT TESTING:
 *
 * 1. THREE-STEP WORKFLOW:
 *    - Step 1 (inputs): CoreInputForm - collects 5 core inputs
 *    - Step 2 (agencies): AgencySelectionTable - select target agencies
 *    - Step 3 (reports): ReportsDisplay - shows 8 strategic reports
 *
 * 2. REQUIRED STATE VARIABLES:
 *    - step: controls which step is shown ('inputs' | 'agencies' | 'reports')
 *    - coreInputs: stores the 5 core inputs from step 1
 *    - agencies: list of agencies from API
 *    - selectedAgencies: agencies selected by user
 *    - reports: the generated comprehensive report data
 *    - loading, error: loading and error states
 *
 * 3. REQUIRED API CALLS:
 *    - /api/usaspending/find-agencies - finds agencies based on inputs
 *    - /api/reports/generate-all - generates all 8 reports
 *
 * 4. REQUIRED COMPONENTS (in /components/federal-market-assassin/):
 *    - forms/CoreInputForm.tsx
 *    - tables/AgencySelectionTable.tsx
 *    - reports/ReportsDisplay.tsx
 *
 * 5. REQUIRED HANDLERS:
 *    - handleFindAgencies(): API call to find agencies
 *    - handleGenerateReports(): API call to generate reports
 *    - handleBack(): navigation between steps
 *
 * Last working version: 2026-01-07
 * If something breaks, check git history for this file.
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CoreInputs, Agency, ComprehensiveReport, AlternativeSearchOption } from '@/types/federal-market-assassin';
import CoreInputForm from '@/components/federal-market-assassin/forms/CoreInputForm';
import AgencySelectionTable from '@/components/federal-market-assassin/tables/AgencySelectionTable';
import ReportsDisplay from '@/components/federal-market-assassin/reports/ReportsDisplay';
import KittLoader from '@/components/federal-market-assassin/ui/KittLoader';
import { MarketAssassinTier } from '@/lib/access-codes';

export default function FederalMarketAssassinPage() {
  const router = useRouter();
  const [step, setStep] = useState<'inputs' | 'agencies' | 'reports'>('inputs');
  const [coreInputs, setCoreInputs] = useState<CoreInputs | null>(null);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [selectedAgencies, setSelectedAgencies] = useState<string[]>([]);
  const [reports, setReports] = useState<ComprehensiveReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternativeSearches, setAlternativeSearches] = useState<AlternativeSearchOption[] | undefined>(undefined);
  const [naicsError, setNaicsError] = useState<string | null>(null);
  const [suggestedNaicsCodes, setSuggestedNaicsCodes] = useState<Array<{ code: string; name: string }>>([]);

  // Tier access state
  const [tier, setTier] = useState<MarketAssassinTier>('standard');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);

  // Usage tracking state
  const [usageInfo, setUsageInfo] = useState<{
    currentUsage: number;
    limit: number;
    remaining: number;
  } | null>(null);

  // Fetch usage info
  const fetchUsageInfo = async (email: string) => {
    try {
      const response = await fetch(`/api/ma-usage?email=${encodeURIComponent(email)}`);
      const data = await response.json();
      if (data.success) {
        setUsageInfo({
          currentUsage: data.currentUsage,
          limit: data.limit,
          remaining: data.remaining,
        });
      }
    } catch (err) {
      console.error('Error fetching usage info:', err);
    }
  };

  // Check for tier access on mount
  useEffect(() => {
    // First check localStorage for cached access
    const cached = localStorage.getItem('marketAssassinAccess');

    if (cached) {
      try {
        const data = JSON.parse(cached);

        if (data.hasAccess && data.expiresAt > Date.now()) {
          setTier(data.tier || 'standard');
          setUserEmail(data.email);
          setCheckingAccess(false);
          // Fetch usage info for standard users
          if (data.tier === 'standard') {
            fetchUsageInfo(data.email);
          }
          return;
        }
      } catch {
        // Invalid cache, continue to redirect
      }
    }

    // No valid access found - redirect to locked page
    router.replace('/market-assassin-locked');
  }, [router]);

  const handleFindAgencies = async (inputs: CoreInputs) => {
    setLoading(true);
    setError(null);
    setNaicsError(null);
    setSuggestedNaicsCodes([]);
    setAlternativeSearches(undefined);

    try {
      const response = await fetch('/api/usaspending/find-agencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      });

      const data = await response.json();

      // Check for NAICS validation error
      if (data.error === 'invalid_naics') {
        setNaicsError(data.naicsValidationError || 'Invalid NAICS code');
        setSuggestedNaicsCodes(data.suggestedNaicsCodes || []);
        setCoreInputs(inputs); // Keep the inputs so user can modify
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch agencies');
      }

      setCoreInputs(inputs);
      setAgencies(data.agencies || []);
      setAlternativeSearches(data.alternativeSearches);
      setStep('agencies');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleAlternativeSearch = async (alternative: AlternativeSearchOption) => {
    if (!coreInputs) return;
    
    setLoading(true);
    setError(null);
    setAlternativeSearches(undefined);

    try {
      // Merge alternative filters with original inputs
      // Handle null filters by removing them (using original values)
      const searchInputs: CoreInputs = {
        ...coreInputs,
        naicsCode: alternative.filters.naicsCode ?? coreInputs.naicsCode,
        zipCode: alternative.filters.zipCode ?? coreInputs.zipCode,
        businessType: alternative.filters.businessType !== null && alternative.filters.businessType !== undefined
          ? (alternative.filters.businessType as CoreInputs['businessType'])
          : coreInputs.businessType,
        veteranStatus: alternative.filters.veteranStatus !== null && alternative.filters.veteranStatus !== undefined
          ? (alternative.filters.veteranStatus as CoreInputs['veteranStatus'])
          : coreInputs.veteranStatus,
      };

      const response = await fetch('/api/usaspending/find-agencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchInputs),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch agencies');
      }

      const data = await response.json();
      setCoreInputs(searchInputs);
      setAgencies(data.agencies || []);
      setAlternativeSearches(data.alternativeSearches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReports = async () => {
    if (!coreInputs || selectedAgencies.length === 0) {
      setError('Please select at least one agency');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check usage limit for standard tier users
      if (tier === 'standard' && userEmail) {
        const usageCheck = await fetch(`/api/ma-usage?email=${encodeURIComponent(userEmail)}`);
        const usageData = await usageCheck.json();

        if (!usageData.allowed) {
          setError(`You've reached your monthly limit of ${usageData.limit} reports. Upgrade to Premium for unlimited reports.`);
          setLoading(false);
          return;
        }
      }

      // Get full agency objects for selected agencies
      const selectedAgencyObjects = agencies.filter(agency =>
        selectedAgencies.includes(agency.id)
      );

      const response = await fetch('/api/reports/generate-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: coreInputs,
          selectedAgencies,
          selectedAgencyData: selectedAgencyObjects,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate reports');
      }

      const data = await response.json();
      setReports(data.report);
      setStep('reports');

      // Increment usage after successful report generation (for standard tier)
      if (tier === 'standard' && userEmail) {
        await fetch('/api/ma-usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail }),
        });
        // Refresh usage info
        fetchUsageInfo(userEmail);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep('inputs');
    setCoreInputs(null);
    setAgencies([]);
    setSelectedAgencies([]);
    setReports(null);
    setError(null);
  };

  // Show loading screen while checking access
  if (checkingAccess) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <span className="text-2xl font-bold text-blue-400">GovCon</span>
            <span className="text-2xl font-bold text-amber-400">Giants</span>
          </div>
          <div className="relative h-2 w-48 bg-slate-800 rounded-full overflow-hidden mx-auto mb-4">
            <div className="absolute h-full w-1/3 bg-cyan-400 rounded-full animate-kitt" />
          </div>
          <p className="text-slate-400">Verifying access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="container mx-auto px-4 py-8">
        {/* Enhanced Tier Banner - Mobile Responsive */}
        {userEmail && (
          <div className={`max-w-4xl mx-auto mb-6 rounded-2xl overflow-hidden ${
            tier === 'premium'
              ? 'bg-gradient-to-br from-amber-900/30 via-orange-900/20 to-amber-900/30 border border-amber-500/40'
              : 'bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-800/80 border border-slate-600/50'
          }`}>
            {/* Premium shimmer effect */}
            {tier === 'premium' && (
              <div className="absolute inset-0 animate-shimmer pointer-events-none" />
            )}

            <div className="relative p-4 md:p-5">
              {/* Mobile Layout */}
              <div className="md:hidden space-y-4">
                {/* Top row: Icon + Plan name + Sign out */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`relative w-10 h-10 rounded-lg flex items-center justify-center ${
                      tier === 'premium'
                        ? 'premium-gradient glow-amber'
                        : 'standard-gradient glow-blue'
                    }`}>
                      <span className="text-xl">{tier === 'premium' ? '👑' : '⭐'}</span>
                    </div>
                    <div>
                      <h3 className={`font-bold text-lg ${tier === 'premium' ? 'text-amber-300' : 'text-blue-300'}`}>
                        {tier === 'premium' ? 'Premium' : 'Standard'}
                      </h3>
                      <p className="text-slate-400 text-xs truncate max-w-[150px]">{userEmail}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      localStorage.removeItem('marketAssassinAccess');
                      window.location.href = '/market-assassin-locked';
                    }}
                    className="px-3 py-1.5 text-xs bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 rounded-lg transition-colors border border-slate-600/50"
                  >
                    Sign Out
                  </button>
                </div>

                {/* Features/Usage row */}
                {tier === 'premium' ? (
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30">
                      ✓ 8 Reports
                    </span>
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30">
                      ✓ Unlimited
                    </span>
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30">
                      ✓ Premium Intel
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Report count */}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 text-sm">4 of 8 Reports</span>
                      <span className="text-amber-400 text-xs">4 locked</span>
                    </div>

                    {/* Usage meter */}
                    {usageInfo && (
                      <div className="bg-slate-900/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-slate-400">Monthly Usage</span>
                          <span className={`text-xs font-bold ${usageInfo.remaining <= 2 ? 'text-amber-400' : 'text-cyan-400'}`}>
                            {usageInfo.remaining}/{usageInfo.limit}
                          </span>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              usageInfo.remaining <= 2 ? 'bg-amber-500' : 'bg-cyan-400'
                            }`}
                            style={{ width: `${Math.max(5, (usageInfo.remaining / usageInfo.limit) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Upgrade CTA */}
                    <a
                      href="https://buy.stripe.com/5kQdRaeb497cfRHdpefnO0f"
                      className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-sm font-semibold rounded-lg transition-all glow-amber"
                    >
                      <span>Unlock All 8 Reports</span>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </a>
                  </div>
                )}
              </div>

              {/* Desktop Layout */}
              <div className="hidden md:flex items-start justify-between">
                {/* Left side - Plan info */}
                <div className="flex items-center gap-4">
                  <div className={`relative w-14 h-14 rounded-xl flex items-center justify-center ${
                    tier === 'premium'
                      ? 'premium-gradient glow-amber'
                      : 'standard-gradient glow-blue'
                  }`}>
                    <span className="text-2xl">{tier === 'premium' ? '👑' : '⭐'}</span>
                    {tier === 'premium' && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className={`font-bold text-xl ${tier === 'premium' ? 'text-amber-300' : 'text-blue-300'}`}>
                        {tier === 'premium' ? 'Premium Access' : 'Standard Access'}
                      </h3>
                      {tier === 'premium' && (
                        <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30">
                          FULL ACCESS
                        </span>
                      )}
                    </div>
                    <p className="text-slate-400 text-sm mt-0.5">{userEmail}</p>
                    <button
                      onClick={() => {
                        localStorage.removeItem('marketAssassinAccess');
                        window.location.href = '/market-assassin-locked';
                      }}
                      className="mt-2 px-3 py-1 text-xs bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 rounded-lg transition-colors border border-slate-600/50"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>

                {/* Right side - Feature comparison */}
                <div className="text-right">
                  {tier === 'premium' ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-emerald-400">✓</span>
                        <span className="text-slate-200 font-medium">8 Strategic Reports</span>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-emerald-400">✓</span>
                        <span className="text-slate-200 font-medium">Unlimited Monthly Usage</span>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-emerald-400">✓</span>
                        <span className="text-slate-200 font-medium">Premium Intelligence</span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-end gap-3">
                        <div className="text-right">
                          <p className="text-slate-200 font-semibold">4 Reports</p>
                          <p className="text-xs text-slate-500">Core intelligence only</p>
                        </div>
                        <div className="w-px h-8 bg-slate-600" />
                        <div className="text-right opacity-50">
                          <p className="text-slate-400 font-semibold line-through">8 Reports</p>
                          <p className="text-xs text-slate-500">Premium</p>
                        </div>
                      </div>

                      {/* Usage meter */}
                      {usageInfo && (
                        <div className="bg-slate-900/50 rounded-lg p-3 mt-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-400">Monthly Usage</span>
                            <span className={`text-xs font-bold ${usageInfo.remaining <= 2 ? 'text-amber-400' : 'text-cyan-400'}`}>
                              {usageInfo.remaining}/{usageInfo.limit} remaining
                            </span>
                          </div>
                          <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                usageInfo.remaining <= 2 ? 'bg-amber-500' : 'bg-cyan-400'
                              }`}
                              style={{ width: `${Math.max(5, (usageInfo.remaining / usageInfo.limit) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Upgrade CTA */}
                      <a
                        href="https://buy.stripe.com/5kQdRaeb497cfRHdpefnO0f"
                        className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-sm font-semibold rounded-lg transition-all glow-amber"
                      >
                        <span>Unlock All 8 Reports</span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Header with Tier Badge */}
        <div className="text-center mb-8">
          <div className="mb-4 flex items-center justify-center gap-2">
            <span className="text-3xl font-bold text-blue-400">GovCon</span>
            <span className="text-3xl font-bold text-amber-400">Giants</span>
          </div>
          <h1 className="text-5xl font-bold text-slate-100 mb-4">
            Federal Market Assassin
          </h1>

          {/* Prominent Tier Badge */}
          <div className="flex justify-center mb-4">
            <div className={`inline-flex items-center gap-3 px-6 py-3 rounded-full border-2 ${
              tier === 'premium'
                ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-amber-500/60 glow-amber'
                : 'bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border-blue-500/60 glow-blue'
            }`}>
              <span className="text-2xl">{tier === 'premium' ? '👑' : '⭐'}</span>
              <div className="text-left">
                <p className={`font-bold text-lg ${tier === 'premium' ? 'text-amber-300' : 'text-blue-300'}`}>
                  {tier === 'premium' ? 'PREMIUM' : 'STANDARD'} PLAN
                </p>
                <p className={`text-sm ${tier === 'premium' ? 'text-amber-400/80' : 'text-blue-400/80'}`}>
                  {tier === 'premium' ? '8 Reports • Unlimited Usage' : '4 Reports • 30/month'}
                </p>
              </div>
              {tier === 'standard' && (
                <a
                  href="https://buy.stripe.com/5kQdRaeb497cfRHdpefnO0f"
                  className="ml-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black text-sm font-bold rounded-full hover:from-amber-400 hover:to-orange-400 transition-all"
                >
                  Upgrade
                </a>
              )}
            </div>
          </div>

          <p className="text-xl text-slate-400 max-w-3xl mx-auto">
            The Ultimate Government Contracting Intelligence System
          </p>
          <p className="text-lg text-slate-500 mt-2">
            Generate comprehensive market reports from 5 core inputs → Select target agencies → Get {tier === 'premium' ? 'all 8' : '4'} strategic reports instantly
          </p>
        </div>

        {/* Enhanced Progress Indicator - Mobile Responsive */}
        <div className="max-w-4xl mx-auto mb-8 px-2">
          <div className="relative bg-gradient-to-r from-slate-900/80 via-slate-800/60 to-slate-900/80 rounded-2xl p-4 md:p-6 border-2 border-cyan-500/30 shadow-lg shadow-cyan-500/10">
            {/* Mobile: Compact horizontal stepper */}
            <div className="md:hidden">
              <div className="flex items-center justify-between mb-3">
                {/* Step indicators */}
                {[
                  { num: '1', label: 'Inputs', active: step === 'inputs', done: step === 'agencies' || step === 'reports' },
                  { num: '2', label: 'Agencies', active: step === 'agencies', done: step === 'reports' },
                  { num: '3', label: 'Reports', active: step === 'reports', done: false },
                ].map((s, idx) => (
                  <div key={idx} className="flex items-center">
                    <div className={`relative w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm transition-all ${
                      s.active
                        ? 'bg-cyan-500 text-white animate-glow-pulse'
                        : s.done
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-700 text-slate-400'
                    }`}>
                      {s.done ? (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : s.num}
                    </div>
                    {idx < 2 && (
                      <div className={`w-8 sm:w-12 h-1 mx-1 rounded-full transition-all ${
                        s.done ? 'bg-gradient-to-r from-emerald-500 to-cyan-500' : 'bg-slate-700'
                      }`} />
                    )}
                  </div>
                ))}
              </div>
              {/* Current step label */}
              <div className="text-center">
                <p className="text-cyan-300 font-semibold">
                  {step === 'inputs' && 'Step 1: Enter Your Inputs'}
                  {step === 'agencies' && 'Step 2: Select Target Agencies'}
                  {step === 'reports' && 'Step 3: View Intelligence Reports'}
                </p>
                <p className="text-slate-500 text-sm">
                  {tier === 'premium' ? '8 Reports Available' : '4 Reports Available'}
                </p>
              </div>
            </div>

            {/* Desktop: Full horizontal stepper */}
            <div className="hidden md:flex items-center justify-between">
              {/* Step 1 */}
              <div className="flex-1">
                <div className="flex items-center">
                  <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center font-bold transition-all duration-300 ${
                    step === 'inputs'
                      ? 'bg-cyan-500 text-white animate-glow-pulse'
                      : step === 'agencies' || step === 'reports'
                        ? 'bg-emerald-500 text-white glow-emerald'
                        : 'bg-slate-700 text-slate-400'
                  }`}>
                    {step === 'agencies' || step === 'reports' ? (
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : '1'}
                  </div>
                  <div className="ml-3">
                    <p className={`font-semibold ${step === 'inputs' ? 'text-cyan-300' : step === 'agencies' || step === 'reports' ? 'text-emerald-400' : 'text-slate-400'}`}>
                      Core Inputs
                    </p>
                    <p className="text-sm text-slate-500">Your business profile</p>
                  </div>
                </div>
              </div>

              {/* Connector 1-2 */}
              <div className="flex-1 mx-4 relative">
                <div className={`h-1 rounded-full transition-all duration-500 ${
                  step === 'agencies' || step === 'reports'
                    ? 'bg-gradient-to-r from-emerald-500 to-cyan-500'
                    : 'bg-slate-700'
                }`}>
                  {step === 'inputs' && (
                    <div className="absolute inset-0 h-1 rounded-full animate-progress-flow" />
                  )}
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex-1">
                <div className="flex items-center">
                  <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center font-bold transition-all duration-300 ${
                    step === 'agencies'
                      ? 'bg-cyan-500 text-white animate-glow-pulse'
                      : step === 'reports'
                        ? 'bg-emerald-500 text-white glow-emerald'
                        : 'bg-slate-700 text-slate-400'
                  }`}>
                    {step === 'reports' ? (
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : '2'}
                  </div>
                  <div className="ml-3">
                    <p className={`font-semibold ${step === 'agencies' ? 'text-cyan-300' : step === 'reports' ? 'text-emerald-400' : 'text-slate-400'}`}>
                      Select Agencies
                    </p>
                    <p className="text-sm text-slate-500">Target your buyers</p>
                  </div>
                </div>
              </div>

              {/* Connector 2-3 */}
              <div className="flex-1 mx-4 relative">
                <div className={`h-1 rounded-full transition-all duration-500 ${
                  step === 'reports'
                    ? 'bg-gradient-to-r from-emerald-500 to-cyan-500'
                    : 'bg-slate-700'
                }`}>
                  {step === 'agencies' && (
                    <div className="absolute inset-0 h-1 rounded-full animate-progress-flow" />
                  )}
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex-1">
                <div className="flex items-center">
                  <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center font-bold transition-all duration-300 ${
                    step === 'reports'
                      ? 'bg-cyan-500 text-white animate-glow-pulse'
                      : 'bg-slate-700 text-slate-400'
                  }`}>
                    3
                  </div>
                  <div className="ml-3">
                    <p className={`font-semibold ${step === 'reports' ? 'text-cyan-300' : 'text-slate-400'}`}>
                      Intelligence
                    </p>
                    <p className="text-sm text-slate-500">
                      {tier === 'premium' ? (
                        <span className="flex items-center gap-1">
                          <span className="text-amber-400">8 Reports</span>
                          <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded-full">PRO</span>
                        </span>
                      ) : (
                        <span>4 Reports</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="max-w-4xl mx-auto mb-6">
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl">
              <p className="font-semibold">Error:</p>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="max-w-6xl mx-auto">
          {/* Show KITT loader when generating reports */}
          {loading && step === 'agencies' && (
            <KittLoader
              message="Generating Intelligence Reports"
              subMessage="Analyzing federal contracting data for strategic insights"
              variant="cyan"
            />
          )}

          {step === 'inputs' && (
            <>
              <CoreInputForm
                onSubmit={handleFindAgencies}
                loading={loading}
              />

              {/* NAICS Validation Error */}
              {naicsError && (
                <div className="mt-6 max-w-2xl mx-auto">
                  <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-6">
                    <div className="flex items-start">
                      <svg className="w-6 h-6 text-red-400 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-red-400 mb-2">Invalid NAICS Code</h3>
                        <p className="text-sm text-red-300 mb-4">{naicsError}</p>

                        {suggestedNaicsCodes.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-slate-300 mb-2">Try one of these similar codes:</h4>
                            <div className="space-y-2">
                              {suggestedNaicsCodes.map((suggestion) => (
                                <button
                                  key={suggestion.code}
                                  onClick={() => {
                                    setNaicsError(null);
                                    setSuggestedNaicsCodes([]);
                                    if (coreInputs) {
                                      handleFindAgencies({ ...coreInputs, naicsCode: suggestion.code });
                                    }
                                  }}
                                  className="w-full text-left px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg hover:bg-slate-700 hover:border-cyan-500/50 transition-colors"
                                >
                                  <span className="font-bold text-cyan-400">{suggestion.code}</span>
                                  <span className="text-slate-300 ml-2">- {suggestion.name}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'agencies' && !loading && (
            <AgencySelectionTable
              agencies={agencies}
              selectedAgencies={selectedAgencies}
              onSelectionChange={setSelectedAgencies}
              onGenerateReports={handleGenerateReports}
              onBack={handleReset}
              loading={loading}
              alternativeSearches={alternativeSearches}
              onAlternativeSearch={handleAlternativeSearch}
            />
          )}

          {step === 'reports' && reports && (
            <ReportsDisplay
              reports={reports}
              onReset={handleReset}
              tier={tier}
            />
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-12 pt-8 border-t border-slate-800">
          <div className="mb-2">
            <span className="text-lg font-bold text-blue-400">GovCon</span>
            <span className="text-lg font-bold text-amber-400">Giants</span>
          </div>
          <p className="text-sm text-slate-400">
            Federal Market Assassin - Your Strategic Advantage in Government Contracting
          </p>
          <p className="text-xs mt-2 text-slate-500">
            Enter 5 inputs. Select agencies. Dominate the market.
          </p>
          <p className="text-xs mt-1 text-slate-600">
            © {new Date().getFullYear()} GovCon Giants. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
