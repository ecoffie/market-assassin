'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CoreInputs, Agency, ComprehensiveReport } from '@/types/federal-market-assassin';
import CoreInputForm from '@/components/federal-market-assassin/forms/CoreInputForm';
import AgencySelectionTable from '@/components/federal-market-assassin/tables/AgencySelectionTable';
import ReportsDisplay from '@/components/federal-market-assassin/reports/ReportsDisplay';

type AccessStatus = 'loading' | 'valid' | 'invalid' | 'used' | 'completed';

export default function AccessPage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  const [accessStatus, setAccessStatus] = useState<AccessStatus>('loading');
  const [accessInfo, setAccessInfo] = useState<{ email?: string; companyName?: string }>({});
  const [errorMessage, setErrorMessage] = useState('');

  // Form state
  const [step, setStep] = useState<'inputs' | 'agencies' | 'reports'>('inputs');
  const [coreInputs, setCoreInputs] = useState<CoreInputs | null>(null);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [selectedAgencies, setSelectedAgencies] = useState<string[]>([]);
  const [reports, setReports] = useState<ComprehensiveReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate access code on load
  useEffect(() => {
    async function validateCode() {
      try {
        const response = await fetch(`/api/access-codes?code=${code}`);
        const data = await response.json();

        if (data.success) {
          setAccessStatus('valid');
          setAccessInfo({
            email: data.accessCode?.email,
            companyName: data.accessCode?.companyName,
          });
        } else if (data.error?.includes('already been used')) {
          setAccessStatus('used');
          setErrorMessage('This access link has already been used. Each link can only be used once.');
        } else {
          setAccessStatus('invalid');
          setErrorMessage('Invalid access link. Please check your email for the correct link.');
        }
      } catch (err) {
        setAccessStatus('invalid');
        setErrorMessage('Unable to validate access. Please try again later.');
      }
    }

    if (code) {
      validateCode();
    }
  }, [code]);

  const handleFindAgencies = async (inputs: CoreInputs) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/usaspending/find-agencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      });

      const data = await response.json();

      if (data.error === 'invalid_naics') {
        setError(data.naicsValidationError || 'Invalid NAICS code');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch agencies');
      }

      setCoreInputs(inputs);
      setAgencies(data.agencies || []);
      setStep('agencies');
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

      // Mark the access code as used
      await fetch('/api/access-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'use', code }),
      });

      setStep('reports');
      setAccessStatus('completed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (accessStatus === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-white text-lg">Validating your access...</p>
        </div>
      </div>
    );
  }

  // Invalid or used state
  if (accessStatus === 'invalid' || accessStatus === 'used') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full text-center">
          <div className="mb-6">
            <span className="text-3xl font-bold text-blue-700">GovCon</span>
            <span className="text-3xl font-bold text-amber-500">Giants</span>
          </div>

          <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${accessStatus === 'used' ? 'bg-amber-100' : 'bg-red-100'}`}>
            <svg className={`w-8 h-8 ${accessStatus === 'used' ? 'text-amber-600' : 'text-red-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {accessStatus === 'used' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              )}
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {accessStatus === 'used' ? 'Access Already Used' : 'Invalid Access Link'}
          </h1>

          <p className="text-slate-600 mb-6">{errorMessage}</p>

          <div className="bg-slate-50 rounded-lg p-4 text-left">
            <p className="text-sm text-slate-600">
              <strong>Need help?</strong> Contact us at{' '}
              <a href="mailto:hello@govconedu.com" className="text-blue-600 hover:underline">
                hello@govconedu.com
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Valid access - show the tool
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
            Federal Market Assassin
          </h1>
          <p className="text-xl text-slate-600 max-w-3xl mx-auto">
            Your Personalized Government Contracting Intelligence Report
          </p>
          {accessInfo.companyName && (
            <p className="text-lg text-blue-600 mt-2">
              Welcome, {accessInfo.companyName}!
            </p>
          )}

          {/* One-time use notice */}
          {accessStatus !== 'completed' && (
            <div className="mt-4 inline-flex items-center bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              <svg className="w-5 h-5 text-amber-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-amber-800 text-sm font-medium">
                One-time access: Make sure to download your report before leaving this page
              </span>
            </div>
          )}
        </div>

        {/* Progress Indicator */}
        <div className="max-w-4xl mx-auto mb-8">
          <div className="flex items-center justify-between">
            <div className={`flex-1 ${step === 'inputs' ? 'opacity-100' : 'opacity-50'}`}>
              <div className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step === 'inputs' ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-600'}`}>
                  1
                </div>
                <div className="ml-3">
                  <p className="font-semibold text-slate-900">Your Info</p>
                  <p className="text-sm text-slate-500">Enter business details</p>
                </div>
              </div>
            </div>

            <div className="flex-1 border-t-2 border-slate-300 mx-4"></div>

            <div className={`flex-1 ${step === 'agencies' ? 'opacity-100' : 'opacity-50'}`}>
              <div className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step === 'agencies' ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-600'}`}>
                  2
                </div>
                <div className="ml-3">
                  <p className="font-semibold text-slate-900">Select Agencies</p>
                  <p className="text-sm text-slate-500">Choose targets</p>
                </div>
              </div>
            </div>

            <div className="flex-1 border-t-2 border-slate-300 mx-4"></div>

            <div className={`flex-1 ${step === 'reports' ? 'opacity-100' : 'opacity-50'}`}>
              <div className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step === 'reports' ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-600'}`}>
                  3
                </div>
                <div className="ml-3">
                  <p className="font-semibold text-slate-900">Your Report</p>
                  <p className="text-sm text-slate-500">Download & save</p>
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
            <CoreInputForm
              onSubmit={handleFindAgencies}
              loading={loading}
            />
          )}

          {step === 'agencies' && (
            <AgencySelectionTable
              agencies={agencies}
              selectedAgencies={selectedAgencies}
              onSelectionChange={setSelectedAgencies}
              onGenerateReports={handleGenerateReports}
              onBack={() => setStep('inputs')}
              loading={loading}
            />
          )}

          {step === 'reports' && reports && (
            <>
              {/* Download reminder */}
              <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center text-green-800">
                  <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-semibold">Report Generated Successfully!</span>
                </div>
                <p className="text-green-700 mt-1">
                  Click "Export All (HTML)" below to download your report. This is your only chance to save it!
                </p>
              </div>

              <ReportsDisplay
                reports={reports}
                onReset={() => {}} // Disable reset for one-time use
              />
            </>
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
          <p className="text-xs mt-1 text-slate-400">
            © {new Date().getFullYear()} GovCon Giants. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
