'use client';

import { useEffect, useRef, useState } from 'react';

interface SampleOpportunity {
  notice_id: string;
  title: string;
  department: string;
  naics_code: string;
  psc_code: string;
  set_aside_description: string | null;
  notice_type: string;
  response_deadline: string | null;
  ui_link: string;
}

interface ExtractedProfile {
  naicsCodes: Array<{ code: string; name: string; count: number }>;
  pscCodes: Array<{ code: string; count: number }>;
  keywords: string[];
  agencies: Array<{ name: string; count: number }>;
}

interface SampleOpportunitiesPickerProps {
  email: string; // User's email for storing business intelligence
  initialDescription?: string;
  autoFetch?: boolean;
  onProfileExtracted: (profile: ExtractedProfile) => void;
  onClose: () => void;
}

export default function SampleOpportunitiesPicker({
  email,
  initialDescription = '',
  autoFetch = false,
  onProfileExtracted,
  onClose,
}: SampleOpportunitiesPickerProps) {
  const [step, setStep] = useState<'describe' | 'select' | 'results'>('describe');
  const [description, setDescription] = useState(initialDescription);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [opportunities, setOpportunities] = useState<SampleOpportunity[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [extractedProfile, setExtractedProfile] = useState<ExtractedProfile | null>(null);
  const [recommendation, setRecommendation] = useState('');
  const didAutoFetch = useRef(false);

  // Fetch sample opportunities
  const handleFetchSamples = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/sample-opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim(), email }),
      });

      const data = await res.json();

      if (data.success) {
        setOpportunities(data.opportunities || []);
        setStep('select');
      } else {
        setError(data.error || 'Failed to fetch opportunities');
      }
    } catch {
      setError('Failed to fetch sample opportunities');
    } finally {
      setLoading(false);
    }
  };

  // Toggle selection
  const toggleSelection = (noticeId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(noticeId)) {
      newSelected.delete(noticeId);
    } else {
      newSelected.add(noticeId);
    }
    setSelectedIds(newSelected);
  };

  // Extract profile from selections
  const handleExtractProfile = async () => {
    if (selectedIds.size < 3) {
      setError('Please select at least 3 opportunities for better accuracy');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/sample-opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extract',
          selectedIds: Array.from(selectedIds),
          email,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setExtractedProfile(data.extractedProfile);
        setRecommendation(data.recommendation || '');
        setStep('results');
      } else {
        setError(data.error || 'Failed to extract profile');
      }
    } catch {
      setError('Failed to extract profile patterns');
    } finally {
      setLoading(false);
    }
  };

  // Apply the extracted profile
  const handleApplyProfile = () => {
    if (extractedProfile) {
      onProfileExtracted(extractedProfile);
    }
  };

  useEffect(() => {
    if (!autoFetch || didAutoFetch.current || initialDescription.trim().length < 10) return;
    didAutoFetch.current = true;
    handleFetchSamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, initialDescription]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {step === 'describe' && 'Tell us about your business'}
              {step === 'select' && 'Pick opportunities that fit you'}
              {step === 'results' && 'Your profile patterns'}
            </h2>
            <p className="text-xs text-gray-500">
              {step === 'describe' && 'We\'ll show you real opportunities to help calibrate'}
              {step === 'select' && `${selectedIds.size} of ${opportunities.length} selected`}
              {step === 'results' && 'Review and apply these settings'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Describe business */}
        {step === 'describe' && (
          <div className="p-6 flex-1">
            <div className="bg-gray-800/50 rounded-xl p-6">
              <p className="text-gray-300 mb-4">
                Describe what your company does in a few sentences. We&apos;ll use this to find relevant sample opportunities.
              </p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Example: We're a small IT company providing cybersecurity consulting, network security assessments, and compliance services to government agencies. We're SDVOSB certified and focus on DoD and VA."
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-2">
                The more specific, the better matches we can show you.
              </p>
            </div>

            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFetchSamples}
                disabled={loading || description.trim().length < 10}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>Show Me Opportunities</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Select opportunities */}
        {step === 'select' && (
          <>
            <div className="flex-1 overflow-y-auto p-6">
              <p className="text-gray-400 text-sm mb-4">
                Select opportunities that look like good matches for your business (at least 3):
              </p>
              <div className="space-y-3">
                {opportunities.map((opp) => {
                  const isSelected = selectedIds.has(opp.notice_id);
                  return (
                    <button
                      key={opp.notice_id}
                      onClick={() => toggleSelection(opp.notice_id)}
                      className={`w-full text-left p-4 rounded-lg border transition-all ${
                        isSelected
                          ? 'bg-purple-600/20 border-purple-500/40'
                          : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                          isSelected
                            ? 'bg-purple-600 border-purple-600'
                            : 'border-gray-600'
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className={`font-medium text-sm line-clamp-2 ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                            {opp.title}
                          </h4>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs">
                            <span className="text-gray-500">{opp.department?.split(',')[0]}</span>
                            {opp.naics_code && (
                              <span className="text-purple-400">NAICS: {opp.naics_code}</span>
                            )}
                            {opp.psc_code && (
                              <span className="text-blue-400">PSC: {opp.psc_code}</span>
                            )}
                            {opp.set_aside_description && (
                              <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded text-[10px]">
                                {opp.set_aside_description.split(' ').slice(0, 2).join(' ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
              <button
                onClick={() => setStep('describe')}
                className="text-gray-400 hover:text-white transition-colors text-sm"
              >
                Back
              </button>
              <div className="flex gap-3">
                <span className="text-sm text-gray-500 self-center">
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={handleExtractProfile}
                  disabled={loading || selectedIds.size < 3}
                  className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Analyzing...
                    </>
                  ) : (
                    <>Extract My Profile</>
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 3: Results */}
        {step === 'results' && extractedProfile && (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Recommendation */}
              {recommendation && (
                <div className="p-4 bg-purple-600/10 border border-purple-500/20 rounded-xl">
                  <p className="text-sm text-purple-300">{recommendation}</p>
                </div>
              )}

              {/* NAICS Codes */}
              {extractedProfile.naicsCodes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">Recommended NAICS Codes</h3>
                  <div className="flex flex-wrap gap-2">
                    {extractedProfile.naicsCodes.map((naics) => (
                      <div
                        key={naics.code}
                        className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
                      >
                        <span className="font-mono text-purple-400 text-sm">{naics.code}</span>
                        <p className="text-xs text-gray-500 mt-0.5">{naics.name}</p>
                        <span className="text-[10px] text-gray-600">Found in {naics.count} selections</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* PSC Codes */}
              {extractedProfile.pscCodes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">Related PSC Codes</h3>
                  <div className="flex flex-wrap gap-2">
                    {extractedProfile.pscCodes.slice(0, 6).map((psc) => (
                      <span
                        key={psc.code}
                        className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded font-mono"
                      >
                        {psc.code}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Keywords */}
              {extractedProfile.keywords.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">Suggested Keywords</h3>
                  <div className="flex flex-wrap gap-2">
                    {extractedProfile.keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Agencies */}
              {extractedProfile.agencies.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">Target Agencies</h3>
                  <div className="flex flex-wrap gap-2">
                    {extractedProfile.agencies.slice(0, 5).map((agency) => (
                      <span
                        key={agency.name}
                        className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded"
                      >
                        {agency.name.split(' ').slice(0, 3).join(' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            </div>

            <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
              <button
                onClick={() => setStep('select')}
                className="text-gray-400 hover:text-white transition-colors text-sm"
              >
                Back to selections
              </button>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyProfile}
                  className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors"
                >
                  Apply to My Profile
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
