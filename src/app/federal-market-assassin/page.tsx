'use client';

import { useState } from 'react';
import { CoreInputs, Agency, ComprehensiveReport, AlternativeSearchOption } from '@/types/federal-market-assassin';
import CoreInputForm from '@/components/federal-market-assassin/forms/CoreInputForm';
import AgencySelectionTable from '@/components/federal-market-assassin/tables/AgencySelectionTable';
import ReportsDisplay from '@/components/federal-market-assassin/reports/ReportsDisplay';

export default function FederalMarketAssassinPage() {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mb-4">
            <span className="text-3xl font-bold text-blue-700">GovCon</span>
            <span className="text-3xl font-bold text-amber-500">Giants</span>
          </div>
          <h1 className="text-5xl font-bold text-slate-900 mb-4">
            🎯 Federal Market Assassin
          </h1>
          <p className="text-xl text-slate-600 max-w-3xl mx-auto">
            The Ultimate Government Contracting Intelligence System
          </p>
          <p className="text-lg text-slate-500 mt-2">
            Generate comprehensive market reports from 5 core inputs → Select target agencies → Get all 8 strategic reports instantly
          </p>
        </div>

        {/* Progress Indicator */}
        <div className="max-w-4xl mx-auto mb-8">
          <div className="flex items-center justify-between">
            <div className={`flex-1 ${step === 'inputs' ? 'opacity-100' : 'opacity-50'}`}>
              <div className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  step === 'inputs' ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-600'
                }`}>
                  1
                </div>
                <div className="ml-3">
                  <p className="font-semibold text-slate-900">Core Inputs</p>
                  <p className="text-sm text-slate-500">Enter your 5 inputs</p>
                </div>
              </div>
            </div>

            <div className="flex-1 border-t-2 border-slate-300 mx-4"></div>

            <div className={`flex-1 ${step === 'agencies' ? 'opacity-100' : 'opacity-50'}`}>
              <div className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  step === 'agencies' ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-600'
                }`}>
                  2
                </div>
                <div className="ml-3">
                  <p className="font-semibold text-slate-900">Select Agencies</p>
                  <p className="text-sm text-slate-500">Choose target agencies</p>
                </div>
              </div>
            </div>

            <div className="flex-1 border-t-2 border-slate-300 mx-4"></div>

            <div className={`flex-1 ${step === 'reports' ? 'opacity-100' : 'opacity-50'}`}>
              <div className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  step === 'reports' ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-600'
                }`}>
                  3
                </div>
                <div className="ml-3">
                  <p className="font-semibold text-slate-900">View Reports</p>
                  <p className="text-sm text-slate-500">8 comprehensive reports</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="max-w-4xl mx-auto mb-6">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              <p className="font-semibold">Error:</p>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="max-w-6xl mx-auto">
          {step === 'inputs' && (
            <>
              <CoreInputForm
                onSubmit={handleFindAgencies}
                loading={loading}
              />

              {/* NAICS Validation Error */}
              {naicsError && (
                <div className="mt-6 max-w-2xl mx-auto">
                  <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                    <div className="flex items-start">
                      <svg className="w-6 h-6 text-red-500 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-red-900 mb-2">Invalid NAICS Code</h3>
                        <p className="text-sm text-red-800 mb-4">{naicsError}</p>

                        {suggestedNaicsCodes.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-red-900 mb-2">Try one of these similar codes:</h4>
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
                                  className="w-full text-left px-4 py-3 bg-white border border-red-200 rounded-lg hover:bg-red-100 hover:border-red-300 transition-colors"
                                >
                                  <span className="font-bold text-red-700">{suggestion.code}</span>
                                  <span className="text-red-600 ml-2">- {suggestion.name}</span>
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

          {step === 'agencies' && (
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
            />
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-12 text-slate-500">
          <div className="mb-2">
            <span className="text-lg font-bold text-blue-700">GovCon</span>
            <span className="text-lg font-bold text-amber-500">Giants</span>
          </div>
          <p className="text-sm">
            Federal Market Assassin - Your Strategic Advantage in Government Contracting
          </p>
          <p className="text-xs mt-2">
            Enter 5 inputs. Select agencies. Dominate the market.
          </p>
          <p className="text-xs mt-1 text-slate-400">
            © {new Date().getFullYear()} GovCon Giants. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
