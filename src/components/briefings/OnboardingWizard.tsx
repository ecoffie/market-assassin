'use client';

import { useState } from 'react';

// Industry presets from preferences page
const INDUSTRY_PRESETS = [
  { label: 'Construction', codes: ['236', '237', '238'], description: 'Building, heavy civil, specialty trades', icon: '🏗️' },
  { label: 'IT Services', codes: ['541511', '541512', '541513', '541519'], description: 'Software, systems design, data processing', icon: '💻' },
  { label: 'Cybersecurity', codes: ['541512', '541519', '518210'], description: 'Security systems, data protection', icon: '🛡️' },
  { label: 'Professional Services', codes: ['541'], description: 'Consulting, engineering, R&D', icon: '📊' },
  { label: 'Healthcare', codes: ['621', '622', '623'], description: 'Medical, hospitals, nursing care', icon: '🏥' },
  { label: 'Logistics & Supply', codes: ['493', '484', '488'], description: 'Warehousing, trucking, transportation', icon: '📦' },
  { label: 'Facilities & Maintenance', codes: ['561210', '561720', '561730'], description: 'Janitorial, landscaping, building services', icon: '🔧' },
  { label: 'Training & Education', codes: ['611430', '611420', '611710'], description: 'Professional training, educational services', icon: '🎓' },
];

const QUICK_AGENCIES = ['DHS', 'VA', 'GSA', 'DoD', 'Army Corps', 'HHS', 'DOE', 'NASA', 'DOJ', 'DOT'];

const US_STATES = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' }, { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' }, { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' }, { value: 'DC', label: 'Washington DC' },
  { value: 'FL', label: 'Florida' }, { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' }, { value: 'IL', label: 'Illinois' }, { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' }, { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' }, { value: 'ME', label: 'Maine' }, { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' }, { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' }, { value: 'MO', label: 'Missouri' }, { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' }, { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NM', label: 'New Mexico' }, { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' }, { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' }, { value: 'OR', label: 'Oregon' }, { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' }, { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' }, { value: 'TX', label: 'Texas' }, { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' }, { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' }, { value: 'WI', label: 'Wisconsin' }, { value: 'WY', label: 'Wyoming' },
];

const REGION_PRESETS = {
  'Southeast': ['FL', 'GA', 'AL', 'SC', 'NC', 'TN'],
  'Mid-Atlantic': ['VA', 'MD', 'DC', 'WV', 'DE', 'PA', 'NJ'],
  'Southwest': ['TX', 'OK', 'AR', 'LA', 'NM'],
  'West Coast': ['CA', 'OR', 'WA', 'NV', 'AZ'],
  'Midwest': ['IL', 'IN', 'OH', 'MI', 'WI', 'MN', 'IA', 'MO'],
  'Northeast': ['NY', 'MA', 'CT', 'RI', 'NH', 'VT', 'ME'],
};

interface OnboardingWizardProps {
  email: string;
  onComplete: () => void;
}

export default function OnboardingWizard({ email, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [customNaics, setCustomNaics] = useState('');
  const [selectedAgencies, setSelectedAgencies] = useState<string[]>([]);
  const [customAgencies, setCustomAgencies] = useState('');
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');

  const totalSteps = 4;

  // Get all NAICS codes from selected industries + custom
  const getAllNaicsCodes = (): string[] => {
    const fromIndustries = selectedIndustries.flatMap(industry => {
      const preset = INDUSTRY_PRESETS.find(p => p.label === industry);
      return preset?.codes || [];
    });
    const custom = customNaics
      .split(/[,\s]+/)
      .map(c => c.trim())
      .filter(c => /^\d+$/.test(c));
    return [...new Set([...fromIndustries, ...custom])];
  };

  // Get all agencies from selected + custom
  const getAllAgencies = (): string[] => {
    const custom = customAgencies
      .split(/[,]+/)
      .map(a => a.trim())
      .filter(a => a.length > 0);
    return [...new Set([...selectedAgencies, ...custom])];
  };

  const saveStepToAPI = async (stepData: Record<string, unknown>) => {
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/alerts/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...stepData }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to save');
        return false;
      }
      return true;
    } catch {
      setError('Failed to save. Please try again.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    if (step === 1) {
      // Validate: at least one industry or NAICS code
      if (getAllNaicsCodes().length === 0) {
        setError('Please select at least one industry or enter NAICS codes');
        return;
      }
      const success = await saveStepToAPI({
        naicsCodes: getAllNaicsCodes(),
        primaryIndustry: selectedIndustries[0] || null,
      });
      if (success) setStep(2);
    } else if (step === 2) {
      // Agencies are optional but recommended
      const success = await saveStepToAPI({
        targetAgencies: getAllAgencies(),
      });
      if (success) setStep(3);
    } else if (step === 3) {
      // Geography is optional (nationwide if empty)
      const success = await saveStepToAPI({
        locationStates: selectedStates,
        locationState: selectedStates[0] || null,
      });
      if (success) setStep(4);
    } else if (step === 4) {
      // Final step - save frequency and complete
      const success = await saveStepToAPI({
        frequency,
        alertsEnabled: true,
        briefingsEnabled: true,
        isActive: true,
      });
      if (success) onComplete();
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const toggleIndustry = (industry: string) => {
    setSelectedIndustries(prev =>
      prev.includes(industry)
        ? prev.filter(i => i !== industry)
        : [...prev, industry]
    );
  };

  const toggleAgency = (agency: string) => {
    setSelectedAgencies(prev =>
      prev.includes(agency)
        ? prev.filter(a => a !== agency)
        : [...prev, agency]
    );
  };

  const toggleState = (state: string) => {
    setSelectedStates(prev =>
      prev.includes(state)
        ? prev.filter(s => s !== state)
        : [...prev, state]
    );
  };

  const setRegion = (regionName: string) => {
    const states = REGION_PRESETS[regionName as keyof typeof REGION_PRESETS] || [];
    setSelectedStates(states);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4 py-12">
      <div className="max-w-2xl w-full">
        {/* Header with branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center">
              <span className="text-white font-bold text-xl">MI</span>
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold text-white">Market Intelligence</h1>
              <p className="text-purple-400 text-sm">Setup your briefing profile</p>
            </div>
          </div>
          <p className="text-gray-400 max-w-md mx-auto">
            Configure your profile so we can deliver personalized GovCon intelligence.
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {[1, 2, 3, 4].map(s => (
              <div
                key={s}
                className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold text-sm transition-colors ${
                  s < step
                    ? 'bg-purple-600 text-white'
                    : s === step
                    ? 'bg-purple-600 text-white ring-4 ring-purple-600/30'
                    : 'bg-gray-800 text-gray-500'
                }`}
              >
                {s < step ? '✓' : s}
              </div>
            ))}
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-600 to-purple-500 transition-all duration-300"
              style={{ width: `${((step - 1) / (totalSteps - 1)) * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>Industries</span>
            <span>Agencies</span>
            <span>Geography</span>
            <span>Delivery</span>
          </div>
        </div>

        {/* Step content */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 md:p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Industries/NAICS */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">What industries do you serve?</h2>
              <p className="text-gray-400 text-sm mb-6">
                Select your primary industries. This determines which opportunities appear in your briefings.
              </p>

              <div className="grid grid-cols-2 gap-3 mb-6">
                {INDUSTRY_PRESETS.map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => toggleIndustry(preset.label)}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      selectedIndustries.includes(preset.label)
                        ? 'bg-purple-600/20 border-purple-500/50 ring-2 ring-purple-500/30'
                        : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{preset.icon}</span>
                      <span className="font-medium text-white text-sm">{preset.label}</span>
                    </div>
                    <p className="text-xs text-gray-500">{preset.description}</p>
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Additional NAICS codes (optional)
                </label>
                <input
                  type="text"
                  value={customNaics}
                  onChange={e => setCustomNaics(e.target.value)}
                  placeholder="541512, 236220"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use short codes like &quot;236&quot; to match all codes starting with 236.
                </p>
              </div>

              {getAllNaicsCodes().length > 0 && (
                <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <p className="text-xs text-purple-400 font-medium mb-1">Selected NAICS codes:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {getAllNaicsCodes().slice(0, 12).map(code => (
                      <span key={code} className="px-2 py-0.5 bg-purple-600/30 rounded text-xs text-purple-300 font-mono">
                        {code}
                      </span>
                    ))}
                    {getAllNaicsCodes().length > 12 && (
                      <span className="text-xs text-gray-500">+{getAllNaicsCodes().length - 12} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Agencies */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Which agencies do you target?</h2>
              <p className="text-gray-400 text-sm mb-6">
                Select agencies to prioritize in your briefings. Skip for all agencies.
              </p>

              <div className="flex flex-wrap gap-2 mb-6">
                {QUICK_AGENCIES.map(agency => (
                  <button
                    key={agency}
                    type="button"
                    onClick={() => toggleAgency(agency)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      selectedAgencies.includes(agency)
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                  >
                    {agency}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Other agencies (optional)
                </label>
                <textarea
                  value={customAgencies}
                  onChange={e => setCustomAgencies(e.target.value)}
                  placeholder="Army Corps of Engineers, USPS, FBI"
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none text-sm"
                />
              </div>

              {getAllAgencies().length > 0 && (
                <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <p className="text-xs text-purple-400 font-medium mb-1">Selected agencies:</p>
                  <p className="text-sm text-gray-300">{getAllAgencies().join(', ')}</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Geography */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Where do you perform work?</h2>
              <p className="text-gray-400 text-sm mb-6">
                Select states for place of performance filtering. Leave empty for nationwide.
              </p>

              {/* Region quick-select */}
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.keys(REGION_PRESETS).map(region => (
                  <button
                    key={region}
                    type="button"
                    onClick={() => setRegion(region)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                  >
                    {region}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedStates([])}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                >
                  Clear all
                </button>
              </div>

              {/* State grid */}
              <div className="max-h-64 overflow-y-auto border border-gray-800 rounded-xl p-3 mb-4">
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1">
                  {US_STATES.map(state => (
                    <button
                      key={state.value}
                      type="button"
                      onClick={() => toggleState(state.value)}
                      className={`px-2 py-1.5 rounded text-xs font-medium transition-all ${
                        selectedStates.includes(state.value)
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-800'
                      }`}
                    >
                      {state.value}
                    </button>
                  ))}
                </div>
              </div>

              {selectedStates.length > 0 ? (
                <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <p className="text-xs text-purple-400 font-medium mb-1">
                    {selectedStates.length} states selected (+ auto-expanded bordering states + DC)
                  </p>
                  <p className="text-sm text-gray-300">{selectedStates.join(', ')}</p>
                </div>
              ) : (
                <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
                  <p className="text-xs text-gray-400">
                    No states selected = Nationwide coverage
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Delivery preferences */}
          {step === 4 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">How often should we brief you?</h2>
              <p className="text-gray-400 text-sm mb-6">
                Choose your preferred briefing frequency. You can change this anytime.
              </p>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setFrequency('daily')}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    frequency === 'daily'
                      ? 'bg-purple-600/20 border-purple-500/50 ring-2 ring-purple-500/30'
                      : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      frequency === 'daily' ? 'border-purple-500' : 'border-gray-600'
                    }`}>
                      {frequency === 'daily' && <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />}
                    </div>
                    <div>
                      <span className="font-medium text-white">Daily</span>
                      <p className="text-sm text-gray-400">Every morning at 7 AM your time</p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setFrequency('weekly')}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    frequency === 'weekly'
                      ? 'bg-purple-600/20 border-purple-500/50 ring-2 ring-purple-500/30'
                      : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      frequency === 'weekly' ? 'border-purple-500' : 'border-gray-600'
                    }`}>
                      {frequency === 'weekly' && <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />}
                    </div>
                    <div>
                      <span className="font-medium text-white">Weekly</span>
                      <p className="text-sm text-gray-400">Sunday digest with the week&apos;s top intel</p>
                    </div>
                  </div>
                </button>
              </div>

              <div className="mt-6 p-4 bg-gradient-to-r from-purple-900/30 to-purple-800/20 border border-purple-500/30 rounded-xl">
                <h3 className="font-medium text-white mb-2">What you&apos;ll receive:</h3>
                <ul className="space-y-2 text-sm text-gray-300">
                  <li className="flex items-center gap-2">
                    <span className="text-purple-400">✓</span> Daily Brief — prioritized opportunities and deadlines
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-purple-400">✓</span> Weekly Deep Dive — strategic analysis and teaming
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-purple-400">✓</span> Pursuit Briefs — capture guidance for targets
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-800">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 1}
              className="px-6 py-2.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={saving}
              className="px-8 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : step === totalSteps ? 'Complete Setup' : 'Continue'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-6">
          Logged in as {email}
        </p>
      </div>
    </div>
  );
}
