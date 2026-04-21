'use client';

import { useState, useEffect, useCallback } from 'react';
import SampleOpportunitiesPicker from './SampleOpportunitiesPicker';

interface CodeSuggestion {
  code: string;
  name: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const INDUSTRY_PRESETS = [
  { label: 'Construction', codes: ['236', '237', '238'], icon: '🏗️', description: 'Building, heavy civil, specialty trades' },
  { label: 'IT Services', codes: ['541511', '541512', '541513', '541519'], icon: '💻', description: 'Software, systems design, data processing' },
  { label: 'Cybersecurity', codes: ['541512', '541519', '518210'], icon: '🛡️', description: 'Security systems, data protection' },
  { label: 'Professional Services', codes: ['541'], icon: '📊', description: 'Consulting, engineering, R&D' },
  { label: 'Healthcare', codes: ['621', '622', '623'], icon: '🏥', description: 'Medical, hospitals, nursing care' },
  { label: 'Logistics & Supply', codes: ['493', '484', '488'], icon: '📦', description: 'Warehousing, trucking, transportation' },
  { label: 'Facilities & Maintenance', codes: ['561210', '561720', '561730'], icon: '🔧', description: 'Janitorial, landscaping, building services' },
  { label: 'Training & Education', codes: ['611430', '611420', '611710'], icon: '🎓', description: 'Professional training, educational services' },
];

const BUSINESS_TYPES = [
  { value: '', label: 'Any Small Business' },
  { value: 'Small Business', label: 'Small Business (General)' },
  { value: 'SDVOSB', label: 'SDVOSB - Service-Disabled Veteran-Owned' },
  { value: 'VOSB', label: 'VOSB - Veteran-Owned Small Business' },
  { value: '8a', label: '8(a) - SBA 8(a) Program' },
  { value: 'WOSB', label: 'WOSB - Women-Owned Small Business' },
  { value: 'EDWOSB', label: 'EDWOSB - Economically Disadvantaged WOSB' },
  { value: 'HUBZone', label: 'HUBZone' },
];

const REGION_PRESETS = [
  { label: 'Southeast', states: ['FL', 'GA', 'AL', 'SC', 'NC', 'TN'] },
  { label: 'Mid-Atlantic', states: ['VA', 'MD', 'DC', 'WV', 'DE', 'PA', 'NJ'] },
  { label: 'Southwest', states: ['TX', 'OK', 'AR', 'LA', 'NM'] },
  { label: 'West Coast', states: ['CA', 'OR', 'WA', 'NV', 'AZ'] },
  { label: 'Northeast', states: ['NY', 'CT', 'MA', 'RI', 'NH', 'VT', 'ME'] },
  { label: 'Midwest', states: ['IL', 'OH', 'MI', 'IN', 'WI', 'MN'] },
];

const QUICK_AGENCIES = ['DHS', 'VA', 'GSA', 'DoD', 'Army Corps', 'HHS', 'DOE', 'NASA'];

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

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  email: string;
}

interface AlertSettings {
  naicsCodes: string[];
  keywords: string[];
  businessType: string;
  targetAgencies: string[];
  locationStates: string[];
  frequency: string;
  briefingsEnabled: boolean;
  alertsEnabled: boolean;
}

export default function SettingsPanel({ isOpen, onClose, email }: SettingsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [naicsInput, setNaicsInput] = useState('');
  const [keywordsInput, setKeywordsInput] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [selectedAgencies, setSelectedAgencies] = useState<string[]>([]);
  const [customAgencies, setCustomAgencies] = useState('');
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'paused'>('daily');
  const [briefingsEnabled, setBriefingsEnabled] = useState(true);
  const [showStateSelector, setShowStateSelector] = useState(false);
  const [showIndustrySelector, setShowIndustrySelector] = useState(false);

  // AI Code Suggestion state
  const [showCodeAssistant, setShowCodeAssistant] = useState(false);
  const [businessDescription, setBusinessDescription] = useState('');
  const [suggestingCodes, setSuggestingCodes] = useState(false);
  const [naicsSuggestions, setNaicsSuggestions] = useState<CodeSuggestion[]>([]);
  const [pscSuggestions, setPscSuggestions] = useState<CodeSuggestion[]>([]);
  const [suggestionError, setSuggestionError] = useState('');

  // Sample Opportunities Picker state
  const [showSamplePicker, setShowSamplePicker] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/alerts/preferences?email=${encodeURIComponent(email)}`);
      const data = await res.json();

      if (data.success && data.data) {
        const settings: AlertSettings = data.data;
        // Load NAICS codes
        const cleanedNaics = (settings.naicsCodes || []).filter((c: string) => /^\d+$/.test(c.trim()));
        setNaicsInput(cleanedNaics.join(', '));

        // Load keywords
        setKeywordsInput((settings.keywords || []).join(', '));

        // Load business type
        setBusinessType(settings.businessType || '');

        // Load agencies
        const agencies = settings.targetAgencies || [];
        const quickAgencies = agencies.filter((a: string) => QUICK_AGENCIES.includes(a));
        const otherAgencies = agencies.filter((a: string) => !QUICK_AGENCIES.includes(a));
        setSelectedAgencies(quickAgencies);
        setCustomAgencies(otherAgencies.join(', '));

        // Load states
        setSelectedStates(settings.locationStates || []);

        // Load frequency
        if (!settings.alertsEnabled || !settings.briefingsEnabled) {
          setFrequency('paused');
        } else {
          setFrequency(settings.frequency === 'weekly' ? 'weekly' : 'daily');
        }

        setBriefingsEnabled(settings.briefingsEnabled ?? true);
      }
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen, loadSettings]);

  const getAllAgencies = (): string[] => {
    const custom = customAgencies
      .split(/[,]+/)
      .map(a => a.trim())
      .filter(a => a.length > 0);
    return [...new Set([...selectedAgencies, ...custom])];
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const naicsCodes = naicsInput
        .split(/[,\s]+/)
        .map(c => c.trim())
        .filter(c => /^\d+$/.test(c));

      const keywords = keywordsInput
        .split(/[,]+/)
        .map(k => k.trim())
        .filter(k => k.length > 0);

      const res = await fetch('/api/alerts/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          naicsCodes,
          keywords,
          businessType: businessType || null,
          targetAgencies: getAllAgencies(),
          locationStates: selectedStates,
          locationState: selectedStates[0] || null,
          frequency,
          alertsEnabled: frequency !== 'paused',
          briefingsEnabled,
          isActive: frequency !== 'paused',
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess('Settings saved');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
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

  // Get industry match for visual feedback
  const getMatchedIndustries = (): string[] => {
    const codes = naicsInput.split(/[,\s]+/).map(c => c.trim()).filter(Boolean);
    return INDUSTRY_PRESETS
      .filter(preset => preset.codes.some(code => codes.includes(code)))
      .map(p => p.label);
  };

  // AI Code Suggestion handler
  const handleSuggestCodes = async () => {
    if (businessDescription.trim().length < 10) {
      setSuggestionError('Please describe your business in more detail (at least 10 characters)');
      return;
    }

    setSuggestingCodes(true);
    setSuggestionError('');
    setNaicsSuggestions([]);
    setPscSuggestions([]);

    try {
      const res = await fetch('/api/suggest-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: businessDescription.trim(),
          maxResults: 5,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setNaicsSuggestions(data.naicsSuggestions || []);
        setPscSuggestions(data.pscSuggestions || []);
      } else {
        setSuggestionError(data.error || 'Failed to get suggestions');
      }
    } catch {
      setSuggestionError('Failed to get suggestions. Please try again.');
    } finally {
      setSuggestingCodes(false);
    }
  };

  // Add suggested NAICS code to input
  const addSuggestedCode = (code: string) => {
    const existingCodes = naicsInput.split(/[,\s]+/).map(c => c.trim()).filter(Boolean);
    if (!existingCodes.includes(code)) {
      const newCodes = [...existingCodes, code];
      setNaicsInput(newCodes.join(', '));
    }
  };

  // Add suggested PSC code as keyword (since we use NAICS primarily)
  const addPscAsKeyword = (code: string, name: string) => {
    const existingKeywords = keywordsInput.split(/[,]+/).map(k => k.trim()).filter(Boolean);
    // Add both the code and a keyword from the name
    const newKeyword = name.split(' - ')[1]?.split(' ').slice(0, 3).join(' ') || name;
    if (!existingKeywords.includes(code) && !existingKeywords.includes(newKeyword)) {
      const newKeywords = [...existingKeywords, newKeyword];
      setKeywordsInput(newKeywords.join(', '));
    }
  };

  // Handle profile extracted from Sample Opportunities Picker
  interface ExtractedProfile {
    naicsCodes: Array<{ code: string; name: string; count: number }>;
    pscCodes: Array<{ code: string; count: number }>;
    keywords: string[];
    agencies: Array<{ name: string; count: number }>;
  }

  const handleProfileExtracted = (profile: ExtractedProfile) => {
    // Add NAICS codes
    if (profile.naicsCodes.length > 0) {
      const newCodes = profile.naicsCodes.map(n => n.code);
      const existingCodes = naicsInput.split(/[,\s]+/).map(c => c.trim()).filter(Boolean);
      const mergedCodes = [...new Set([...existingCodes, ...newCodes])];
      setNaicsInput(mergedCodes.join(', '));
    }

    // Add keywords
    if (profile.keywords.length > 0) {
      const existingKeywords = keywordsInput.split(/[,]+/).map(k => k.trim()).filter(Boolean);
      const mergedKeywords = [...new Set([...existingKeywords, ...profile.keywords])];
      setKeywordsInput(mergedKeywords.join(', '));
    }

    // Add agencies (take top 3)
    if (profile.agencies.length > 0) {
      const agencyNames = profile.agencies.slice(0, 3).map(a => {
        // Match to quick agencies if possible
        const matchedQuick = QUICK_AGENCIES.find(qa =>
          a.name.toLowerCase().includes(qa.toLowerCase()) ||
          qa.toLowerCase().includes(a.name.split(' ')[0].toLowerCase())
        );
        return matchedQuick || a.name.split(',')[0].split(' ').slice(0, 2).join(' ');
      });

      const matchedQuickAgencies = agencyNames.filter(a => QUICK_AGENCIES.includes(a));
      const customAgencyNames = agencyNames.filter(a => !QUICK_AGENCIES.includes(a));

      if (matchedQuickAgencies.length > 0) {
        setSelectedAgencies(prev => [...new Set([...prev, ...matchedQuickAgencies])]);
      }
      if (customAgencyNames.length > 0) {
        const existing = customAgencies.split(/[,]+/).map(a => a.trim()).filter(Boolean);
        const merged = [...new Set([...existing, ...customAgencyNames])];
        setCustomAgencies(merged.join(', '));
      }
    }

    // Close picker and show success
    setShowSamplePicker(false);
    setSuccess('Profile updated from your selections! Review and save.');
    setTimeout(() => setSuccess(''), 5000);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-gray-900 border-l border-gray-800 z-50 overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <p className="text-xs text-gray-500">Market Intelligence preferences</p>
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

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-gray-400">Loading settings...</div>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Messages */}
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
                {success}
              </div>
            )}

            {/* Smart Profile Setup */}
            <div className="p-4 bg-gradient-to-r from-purple-600/10 to-blue-600/10 border border-purple-500/20 rounded-xl">
              <div className="flex items-start gap-3">
                <div className="text-2xl">🎯</div>
                <div className="flex-1">
                  <h3 className="text-white font-medium text-sm">Not sure which codes to pick?</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Browse real opportunities and pick ones that fit. We'll auto-calibrate your profile.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowSamplePicker(true)}
                    className="mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Browse Sample Opportunities
                  </button>
                </div>
              </div>
            </div>

            {/* Industry Presets */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Industry
              </label>
              <button
                type="button"
                onClick={() => setShowIndustrySelector(!showIndustrySelector)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-left text-sm text-gray-400 hover:border-gray-600 flex items-center justify-between mb-2"
              >
                <span>{getMatchedIndustries().length > 0 ? `${getMatchedIndustries().length} industries selected` : 'Quick-select industries'}</span>
                <span>{showIndustrySelector ? '▲' : '▼'}</span>
              </button>
              {showIndustrySelector && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {INDUSTRY_PRESETS.map((preset) => {
                    const currentCodes = naicsInput.split(/[,\s]+/).map(c => c.trim()).filter(Boolean);
                    const isSelected = preset.codes.some(code => currentCodes.includes(code));
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          const existingCodes = naicsInput.split(/[,\s]+/).map(c => c.trim()).filter(Boolean);
                          if (isSelected) {
                            const newCodes = existingCodes.filter(code => !preset.codes.includes(code));
                            setNaicsInput(newCodes.length > 0 ? newCodes.join(', ') : '');
                          } else {
                            const newCodes = [...new Set([...existingCodes, ...preset.codes])];
                            setNaicsInput(newCodes.join(', '));
                          }
                        }}
                        className={`text-left p-2 rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-purple-600/20 border-purple-500/40 text-white'
                            : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:text-white'
                        }`}
                      >
                        <div className="text-xs font-medium flex items-center gap-1">
                          <span>{preset.icon}</span>
                          <span>{preset.label}</span>
                          {isSelected && <span className="text-purple-400">✓</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* NAICS Codes */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                NAICS Codes
              </label>
              <textarea
                value={naicsInput}
                onChange={e => setNaicsInput(e.target.value)}
                rows={2}
                placeholder="236, 541512, 541"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none font-mono text-sm"
              />
              {getMatchedIndustries().length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {getMatchedIndustries().map(industry => (
                    <span key={industry} className="text-xs px-2 py-0.5 bg-purple-600/20 text-purple-400 rounded">
                      {industry}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Short codes (236) match entire categories
              </p>

              {/* AI Code Assistant */}
              <button
                type="button"
                onClick={() => setShowCodeAssistant(!showCodeAssistant)}
                className="mt-3 text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <span className="text-lg">✨</span>
                <span>{showCodeAssistant ? 'Hide' : "Need help finding codes?"}</span>
              </button>

              {showCodeAssistant && (
                <div className="mt-3 p-4 bg-gray-800/70 border border-purple-500/20 rounded-lg">
                  <p className="text-sm text-gray-300 mb-3">
                    Describe what your company does, and we'll suggest the best NAICS and PSC codes:
                  </p>
                  <textarea
                    value={businessDescription}
                    onChange={e => setBusinessDescription(e.target.value)}
                    rows={3}
                    placeholder="Example: We provide IT security consulting, penetration testing, and vulnerability assessments for federal agencies..."
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none text-sm mb-3"
                  />
                  <button
                    type="button"
                    onClick={handleSuggestCodes}
                    disabled={suggestingCodes || businessDescription.trim().length < 10}
                    className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {suggestingCodes ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <span>✨</span> Suggest Codes
                      </>
                    )}
                  </button>

                  {suggestionError && (
                    <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs">
                      {suggestionError}
                    </div>
                  )}

                  {/* NAICS Suggestions */}
                  {naicsSuggestions.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        Suggested NAICS Codes
                      </h4>
                      <div className="space-y-2">
                        {naicsSuggestions.map((suggestion, idx) => (
                          <div
                            key={idx}
                            className="p-2 bg-gray-900/50 border border-gray-700 rounded-lg"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-purple-400 text-sm">{suggestion.code}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                    suggestion.confidence === 'high'
                                      ? 'bg-green-500/20 text-green-400'
                                      : suggestion.confidence === 'medium'
                                      ? 'bg-yellow-500/20 text-yellow-400'
                                      : 'bg-gray-500/20 text-gray-400'
                                  }`}>
                                    {suggestion.confidence}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-400 truncate">{suggestion.name}</p>
                                <p className="text-[11px] text-gray-500 mt-1">{suggestion.reason}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => addSuggestedCode(suggestion.code)}
                                className="shrink-0 px-2 py-1 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 text-xs rounded transition-colors"
                              >
                                + Add
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PSC Suggestions */}
                  {pscSuggestions.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        Related PSC Codes <span className="font-normal">(added as keywords)</span>
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {pscSuggestions.map((suggestion, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => addPscAsKeyword(suggestion.code, suggestion.name)}
                            className="group px-2 py-1 bg-gray-700/50 hover:bg-purple-600/20 border border-gray-600 hover:border-purple-500/40 rounded text-xs transition-colors"
                            title={suggestion.reason}
                          >
                            <span className="font-mono text-gray-300 group-hover:text-purple-400">{suggestion.code}</span>
                            <span className="text-gray-500 ml-1">+</span>
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-500 mt-2">
                        PSC codes help the government classify services. Click to add related keywords.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Keywords */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Keywords <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Catch mislabeled opportunities. We'll search titles and descriptions for these terms.
              </p>
              <textarea
                value={keywordsInput}
                onChange={e => setKeywordsInput(e.target.value)}
                rows={2}
                placeholder="construction, IT services, software development"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none text-sm"
              />
            </div>

            {/* Business Type / Set-Aside */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Set-Aside Type
              </label>
              <select
                value={businessType}
                onChange={e => setBusinessType(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-purple-500 focus:outline-none text-sm"
              >
                {BUSINESS_TYPES.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Target Agencies */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Target Agencies
              </label>
              <div className="flex flex-wrap gap-2 mb-3">
                {QUICK_AGENCIES.map(agency => (
                  <button
                    key={agency}
                    type="button"
                    onClick={() => toggleAgency(agency)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      selectedAgencies.includes(agency)
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                  >
                    {agency}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={customAgencies}
                onChange={e => setCustomAgencies(e.target.value)}
                placeholder="Other agencies..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none text-sm"
              />
            </div>

            {/* Geography */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Place of Performance
              </label>

              {/* Selected states chips */}
              {selectedStates.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {selectedStates.map(state => (
                    <span
                      key={state}
                      className="inline-flex items-center gap-1 bg-purple-600/20 border border-purple-500/30 rounded-full px-2.5 py-1 text-xs"
                    >
                      <span className="text-white">{state}</span>
                      <button
                        type="button"
                        onClick={() => toggleState(state)}
                        className="text-purple-400 hover:text-red-400"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Region Presets */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {REGION_PRESETS.map(region => {
                  const allSelected = region.states.every(s => selectedStates.includes(s));
                  return (
                    <button
                      key={region.label}
                      type="button"
                      onClick={() => {
                        if (allSelected) {
                          setSelectedStates(selectedStates.filter(s => !region.states.includes(s)));
                        } else {
                          setSelectedStates([...new Set([...selectedStates, ...region.states])]);
                        }
                      }}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                        allSelected
                          ? 'bg-purple-600/20 border-purple-500/40 text-purple-300'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                      }`}
                    >
                      {region.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setShowStateSelector(!showStateSelector)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-left text-sm text-gray-400 hover:border-gray-600 flex items-center justify-between"
              >
                <span>{selectedStates.length === 0 ? 'All States (Nationwide)' : `${selectedStates.length} states selected`}</span>
                <span>{showStateSelector ? '▲' : '▼'}</span>
              </button>

              {showStateSelector && (
                <div className="mt-2 max-h-48 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg p-2">
                  <button
                    type="button"
                    onClick={() => { setSelectedStates([]); setShowStateSelector(false); }}
                    className="w-full px-3 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-700 rounded mb-1"
                  >
                    Clear all (Nationwide)
                  </button>
                  <div className="grid grid-cols-4 gap-1">
                    {US_STATES.map(state => (
                      <button
                        key={state.value}
                        type="button"
                        onClick={() => toggleState(state.value)}
                        className={`px-2 py-1 rounded text-xs transition-all ${
                          selectedStates.includes(state.value)
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-700/50 text-gray-400 hover:text-white'
                        }`}
                      >
                        {state.value}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Delivery Frequency */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Delivery Frequency
              </label>
              <div className="space-y-2">
                {(['daily', 'weekly', 'paused'] as const).map(opt => (
                  <label
                    key={opt}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      frequency === opt
                        ? 'bg-purple-600/20 border border-purple-500/30'
                        : 'bg-gray-800/50 border border-transparent hover:bg-gray-800'
                    }`}
                  >
                    <input
                      type="radio"
                      name="frequency"
                      value={opt}
                      checked={frequency === opt}
                      onChange={() => setFrequency(opt)}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-600 bg-gray-700"
                    />
                    <div>
                      <span className="text-white font-medium capitalize">{opt}</span>
                      <p className="text-xs text-gray-500">
                        {opt === 'daily' && 'Every morning at 7 AM'}
                        {opt === 'weekly' && 'Sunday digest'}
                        {opt === 'paused' && 'Keep settings but pause emails'}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Briefings Toggle */}
            <div className="p-4 bg-gray-800/50 rounded-lg">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="text-white font-medium">Market Intelligence Briefings</span>
                  <p className="text-xs text-gray-500">Daily, weekly, and pursuit briefs</p>
                </div>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={briefingsEnabled}
                    onChange={e => setBriefingsEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:bg-purple-600 transition-colors"></div>
                  <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
                </div>
              </label>
            </div>

            {/* Save Button */}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>

            {/* Account info */}
            <div className="pt-4 border-t border-gray-800 text-center">
              <p className="text-xs text-gray-500">
                Logged in as <span className="text-gray-400">{email}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Sample Opportunities Picker Modal */}
      {showSamplePicker && (
        <SampleOpportunitiesPicker
          email={email}
          onProfileExtracted={handleProfileExtracted}
          onClose={() => setShowSamplePicker(false)}
        />
      )}
    </>
  );
}
