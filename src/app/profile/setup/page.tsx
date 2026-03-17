'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CERTIFICATION_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  CONTRACT_VEHICLE_OPTIONS,
  GEOGRAPHIC_OPTIONS,
  ProfileUpdatePayload,
} from '@/lib/smart-profile';

// US States for dropdown
const US_STATES = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' }, { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' }, { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' }, { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' }, { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' }, { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' }, { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' }, { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' }, { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' }, { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' }, { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' }, { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' }, { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' }, { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' }, { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' }, { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' }, { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' }, { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' }, { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' }, { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' }, { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' }, { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' }, { value: 'WY', label: 'Wyoming' },
  { value: 'DC', label: 'Washington DC' },
];

// Common target agencies
const TARGET_AGENCIES = [
  'DOD', 'Army', 'Navy', 'Air Force', 'DHS', 'VA', 'HHS', 'GSA',
  'DOE', 'DOT', 'DOJ', 'State', 'Treasury', 'Commerce', 'Interior',
  'USDA', 'Labor', 'Education', 'HUD', 'EPA', 'SBA', 'NASA', 'SSA',
];

// Step definitions
const STEPS = [
  { id: 1, title: 'Business Info', description: 'Tell us about your company' },
  { id: 2, title: 'NAICS Codes', description: 'What work do you do?' },
  { id: 3, title: 'Target Agencies', description: 'Who do you want to sell to?' },
  { id: 4, title: 'Certifications', description: 'Set-asides you qualify for' },
  { id: 5, title: 'Location', description: 'Where do you operate?' },
];

export default function ProfileSetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get('email');

  const [currentStep, setCurrentStep] = useState(1);
  const [email, setEmail] = useState(emailParam || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [completeness, setCompleteness] = useState(0);

  // Form state
  const [formData, setFormData] = useState<ProfileUpdatePayload>({
    companyName: '',
    cageCode: '',
    companySize: undefined,
    naicsCodes: [],
    targetAgencies: [],
    certifications: [],
    contractVehicles: [],
    state: '',
    zipCode: '',
    geographicPreference: 'national',
    capabilityKeywords: [],
  });

  // NAICS input state
  const [naicsInput, setNaicsInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  // Load existing profile if email provided
  useEffect(() => {
    if (emailParam) {
      loadProfile(emailParam);
    }
  }, [emailParam]);

  const loadProfile = async (userEmail: string) => {
    try {
      const res = await fetch(`/api/profile?email=${encodeURIComponent(userEmail)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.profile) {
          setFormData({
            companyName: data.profile.companyName || '',
            cageCode: data.profile.cageCode || '',
            companySize: data.profile.companySize || undefined,
            naicsCodes: data.profile.naicsCodes || [],
            targetAgencies: data.profile.targetAgencies || [],
            certifications: data.profile.certifications || [],
            contractVehicles: data.profile.contractVehicles || [],
            state: data.profile.state || '',
            zipCode: data.profile.zipCode || '',
            geographicPreference: data.profile.geographicPreference || 'national',
            capabilityKeywords: data.profile.capabilityKeywords || [],
          });
          setCompleteness(data.completeness?.total || 0);
        }
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    }
  };

  const saveStep = async () => {
    if (!email) {
      setError('Email is required');
      return false;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...formData }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      const data = await res.json();
      setCompleteness(data.completeness?.total || 0);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleNext = async () => {
    if (currentStep === 1 && !email) {
      setError('Email is required');
      return;
    }

    const saved = await saveStep();
    if (saved && currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    } else if (saved && currentStep === STEPS.length) {
      // Complete onboarding
      router.push(`/profile/complete?email=${encodeURIComponent(email)}`);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const addNaics = () => {
    const code = naicsInput.trim();
    if (code && !formData.naicsCodes?.includes(code)) {
      setFormData({ ...formData, naicsCodes: [...(formData.naicsCodes || []), code] });
      setNaicsInput('');
    }
  };

  const removeNaics = (code: string) => {
    setFormData({ ...formData, naicsCodes: formData.naicsCodes?.filter(c => c !== code) });
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !formData.capabilityKeywords?.includes(kw)) {
      setFormData({ ...formData, capabilityKeywords: [...(formData.capabilityKeywords || []), kw] });
      setKeywordInput('');
    }
  };

  const removeKeyword = (kw: string) => {
    setFormData({ ...formData, capabilityKeywords: formData.capabilityKeywords?.filter(k => k !== kw) });
  };

  const toggleAgency = (agency: string) => {
    const current = formData.targetAgencies || [];
    if (current.includes(agency)) {
      setFormData({ ...formData, targetAgencies: current.filter(a => a !== agency) });
    } else {
      setFormData({ ...formData, targetAgencies: [...current, agency] });
    }
  };

  const toggleCert = (cert: string) => {
    const current = formData.certifications || [];
    if (current.includes(cert)) {
      setFormData({ ...formData, certifications: current.filter(c => c !== cert) });
    } else {
      setFormData({ ...formData, certifications: [...current, cert] });
    }
  };

  const toggleVehicle = (vehicle: string) => {
    const current = formData.contractVehicles || [];
    if (current.includes(vehicle)) {
      setFormData({ ...formData, contractVehicles: current.filter(v => v !== vehicle) });
    } else {
      setFormData({ ...formData, contractVehicles: [...current, vehicle] });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a8a] to-[#7c3aed]">
      {/* Header */}
      <header className="bg-white/10 backdrop-blur-sm border-b border-white/20">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">GovCon Giants</h1>
          <div className="text-white/80 text-sm">
            Profile Setup
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((step, i) => (
              <div
                key={step.id}
                className={`flex items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                    step.id < currentStep
                      ? 'bg-green-500 text-white'
                      : step.id === currentStep
                      ? 'bg-white text-[#1e3a8a]'
                      : 'bg-white/30 text-white/60'
                  }`}
                >
                  {step.id < currentStep ? '✓' : step.id}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-1 mx-2 ${
                      step.id < currentStep ? 'bg-green-500' : 'bg-white/30'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-bold text-white">{STEPS[currentStep - 1].title}</h2>
            <p className="text-white/70">{STEPS[currentStep - 1].description}</p>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-xl shadow-xl p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Business Info */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1e3a8a] focus:border-transparent"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company Name
                </label>
                <input
                  type="text"
                  value={formData.companyName || ''}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1e3a8a] focus:border-transparent"
                  placeholder="Your Company LLC"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    CAGE Code
                  </label>
                  <input
                    type="text"
                    value={formData.cageCode || ''}
                    onChange={(e) => setFormData({ ...formData, cageCode: e.target.value.toUpperCase() })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1e3a8a] focus:border-transparent"
                    placeholder="5 characters"
                    maxLength={5}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Company Size
                  </label>
                  <select
                    value={formData.companySize || ''}
                    onChange={(e) => setFormData({ ...formData, companySize: e.target.value as ProfileUpdatePayload['companySize'] })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1e3a8a] focus:border-transparent"
                  >
                    <option value="">Select size...</option>
                    {COMPANY_SIZE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: NAICS Codes */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Add NAICS Codes
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={naicsInput}
                    onChange={(e) => setNaicsInput(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addNaics())}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1e3a8a] focus:border-transparent"
                    placeholder="e.g., 541511"
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={addNaics}
                    className="px-4 py-2 bg-[#1e3a8a] text-white rounded-lg hover:bg-[#1e40af]"
                  >
                    Add
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Enter 2-6 digit NAICS codes for your services
                </p>
              </div>
              {formData.naicsCodes && formData.naicsCodes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formData.naicsCodes.map(code => (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-[#1e3a8a]/10 text-[#1e3a8a] rounded-full text-sm"
                    >
                      {code}
                      <button
                        type="button"
                        onClick={() => removeNaics(code)}
                        className="hover:text-red-600"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Capability Keywords
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1e3a8a] focus:border-transparent"
                    placeholder="e.g., cybersecurity, cloud migration"
                  />
                  <button
                    type="button"
                    onClick={addKeyword}
                    className="px-4 py-2 bg-[#1e3a8a] text-white rounded-lg hover:bg-[#1e40af]"
                  >
                    Add
                  </button>
                </div>
              </div>
              {formData.capabilityKeywords && formData.capabilityKeywords.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formData.capabilityKeywords.map(kw => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm"
                    >
                      {kw}
                      <button
                        type="button"
                        onClick={() => removeKeyword(kw)}
                        className="hover:text-red-600"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Target Agencies */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 mb-2">
                Select agencies you want to do business with:
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {TARGET_AGENCIES.map(agency => (
                  <button
                    key={agency}
                    type="button"
                    onClick={() => toggleAgency(agency)}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      formData.targetAgencies?.includes(agency)
                        ? 'bg-[#1e3a8a] text-white border-[#1e3a8a]'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-[#1e3a8a]'
                    }`}
                  >
                    {agency}
                  </button>
                ))}
              </div>
              {formData.targetAgencies && formData.targetAgencies.length > 0 && (
                <p className="text-sm text-green-600">
                  {formData.targetAgencies.length} agencies selected
                </p>
              )}
            </div>
          )}

          {/* Step 4: Certifications */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Select your certifications:
                </p>
                <div className="space-y-2">
                  {CERTIFICATION_OPTIONS.map(cert => (
                    <label
                      key={cert.value}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        formData.certifications?.includes(cert.value)
                          ? 'bg-[#1e3a8a]/10 border-[#1e3a8a]'
                          : 'border-gray-300 hover:border-[#1e3a8a]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.certifications?.includes(cert.value) || false}
                        onChange={() => toggleCert(cert.value)}
                        className="w-5 h-5 text-[#1e3a8a] rounded"
                      />
                      <span className="text-gray-700">{cert.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Contract vehicles you hold:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {CONTRACT_VEHICLE_OPTIONS.map(vehicle => (
                    <button
                      key={vehicle.value}
                      type="button"
                      onClick={() => toggleVehicle(vehicle.value)}
                      className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                        formData.contractVehicles?.includes(vehicle.value)
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-purple-600'
                      }`}
                    >
                      {vehicle.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Location */}
          {currentStep === 5 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    State
                  </label>
                  <select
                    value={formData.state || ''}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1e3a8a] focus:border-transparent"
                  >
                    <option value="">Select state...</option>
                    {US_STATES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ZIP Code
                  </label>
                  <input
                    type="text"
                    value={formData.zipCode || ''}
                    onChange={(e) => setFormData({ ...formData, zipCode: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1e3a8a] focus:border-transparent"
                    placeholder="12345"
                    maxLength={5}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Geographic Preference
                </label>
                <div className="space-y-2">
                  {GEOGRAPHIC_OPTIONS.map(opt => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        formData.geographicPreference === opt.value
                          ? 'bg-[#1e3a8a]/10 border-[#1e3a8a]'
                          : 'border-gray-300 hover:border-[#1e3a8a]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="geographicPreference"
                        checked={formData.geographicPreference === opt.value}
                        onChange={() => setFormData({ ...formData, geographicPreference: opt.value })}
                        className="w-5 h-5 text-[#1e3a8a]"
                      />
                      <span className="text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t">
            <button
              type="button"
              onClick={handleBack}
              disabled={currentStep === 1}
              className={`px-6 py-2 rounded-lg font-medium ${
                currentStep === 1
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={loading}
              className="px-6 py-2 bg-gradient-to-r from-[#1e3a8a] to-[#7c3aed] text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Saving...' : currentStep === STEPS.length ? 'Complete Setup' : 'Next'}
            </button>
          </div>
        </div>

        {/* Profile completeness indicator */}
        {completeness > 0 && (
          <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/80 text-sm">Profile Completeness</span>
              <span className="text-white font-bold">{completeness}%</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-400 rounded-full transition-all duration-500"
                style={{ width: `${completeness}%` }}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
