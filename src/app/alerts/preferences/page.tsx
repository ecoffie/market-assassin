'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

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

// Popular industry categories with their NAICS codes
const INDUSTRY_PRESETS = [
  {
    label: '🏗️ Construction',
    codes: ['236', '237', '238'],
    description: 'Building, heavy civil, specialty trades'
  },
  {
    label: '💻 IT Services',
    codes: ['541511', '541512', '541513', '541519'],
    description: 'Software, systems design, data processing'
  },
  {
    label: '🛡️ Cybersecurity',
    codes: ['541512', '541519', '518210'],
    description: 'Security systems, data protection'
  },
  {
    label: '📊 Professional Services',
    codes: ['541'],
    description: 'Consulting, engineering, R&D'
  },
  {
    label: '🏥 Healthcare',
    codes: ['621', '622', '623'],
    description: 'Medical, hospitals, nursing care'
  },
  {
    label: '📦 Logistics & Supply',
    codes: ['493', '484', '488'],
    description: 'Warehousing, trucking, transportation'
  },
  {
    label: '🔧 Facilities & Maintenance',
    codes: ['561210', '561720', '561730'],
    description: 'Janitorial, landscaping, building services'
  },
  {
    label: '🎓 Training & Education',
    codes: ['611430', '611420', '611710'],
    description: 'Professional training, educational services'
  },
];


interface AlertSettings {
  email: string;
  primaryIndustry: string | null;
  naicsCodes: string[] | null;
  keywords: string[] | null;
  businessType: string | null;
  targetAgencies: string[];
  locationState: string | null;
  locationStates: string[] | null; // Multi-state support
  alertsEnabled: boolean;
  frequency: string;
  briefingsEnabled: boolean;
  briefingFrequency: string;
  timezone: string;
  isActive: boolean;
  lastAlertSent: string | null;
  totalAlertsSent: number | null;
}

function AlertPreferencesContent() {
  const searchParams = useSearchParams();
  const emailParam = searchParams.get('email');

  const [email, setEmail] = useState(emailParam || '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Form state
  const [primaryIndustry, setPrimaryIndustry] = useState('');
  const [naicsInput, setNaicsInput] = useState('');
  const [keywordsInput, setKeywordsInput] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [locationState, setLocationState] = useState('');
  const [locationStates, setLocationStates] = useState<string[]>([]); // Multi-state support
  const [showStateSelector, setShowStateSelector] = useState(false);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'paused'>('daily');
  const [briefingsEnabled, setBriefingsEnabled] = useState(true);

  // US States for location filter
  const US_STATES = [
    { value: '', label: 'All States (Nationwide)' },
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

  // Helper to filter NAICS codes (only numeric values)
  const cleanNaicsCodes = (codes: string[]): string[] => {
    return codes.filter(c => /^\d+$/.test(c.trim()));
  };

  useEffect(() => {
    if (emailParam) {
      loadSettings(emailParam);
    }
  }, [emailParam]);

  const loadSettings = async (emailToLoad: string) => {
    setLoading(true);
    setError('');
    setNotFound(false);

    try {
      const res = await fetch(`/api/alerts/preferences?email=${encodeURIComponent(emailToLoad)}`);
      const data = await res.json();

      if (data.success && data.data) {
        setSettings(data.data);
        // Load primary industry
        setPrimaryIndustry(data.data.primaryIndustry || '');
        // Clean NAICS codes - filter out non-numeric values
        const cleanedNaics = cleanNaicsCodes(data.data.naicsCodes || []);
        setNaicsInput(cleanedNaics.join(', '));
        setKeywordsInput(data.data.keywords?.join(', ') || '');
        setBusinessType(data.data.businessType || '');
        setLocationState(data.data.locationState || '');
        // Load multi-state selection (new feature)
        const savedStates = data.data.locationStates || (data.data.locationState ? [data.data.locationState] : []);
        setLocationStates(savedStates);

        // Map isActive + alertsEnabled to our frequency state
        // Priority: isActive=false means paused, then check alertsEnabled and frequency
        if (!data.data.isActive || !data.data.alertsEnabled) {
          setFrequency('paused');
        } else {
          setFrequency(data.data.frequency === 'weekly' ? 'weekly' : 'daily');
        }

        // Load briefings enabled from API
        setBriefingsEnabled(data.data.briefingsEnabled ?? true);
      } else {
        setNotFound(true);
      }
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      loadSettings(email);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Parse and clean NAICS codes (only numeric)
      const naicsCodes = naicsInput
        .split(/[,\s]+/)
        .map(c => c.trim())
        .filter(c => /^\d+$/.test(c));

      // Parse keywords
      const keywords = keywordsInput
        .split(/[,]+/)
        .map(k => k.trim())
        .filter(k => k.length > 0);

      const res = await fetch('/api/alerts/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: settings?.email || email,
          primaryIndustry: primaryIndustry || null,
          naicsCodes,
          keywords,
          businessType: businessType || null,
          locationState: locationStates[0] || locationState || null, // Primary state for legacy
          locationStates: locationStates.length > 0 ? locationStates : (locationState ? [locationState] : []),
          frequency: frequency,
          alertsEnabled: frequency !== 'paused',
          isActive: frequency !== 'paused',
          briefingsEnabled: briefingsEnabled,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess('Your preferences have been saved!');
        loadSettings(settings?.email || email);
      } else {
        setError(data.error || 'Failed to save preferences');
      }
    } catch {
      setError('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleUnsubscribe = async () => {
    if (!confirm('Are you sure you want to unsubscribe from all emails? You can always re-enable them later.')) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/alerts/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: settings?.email || email,
          isActive: false,
          frequency: 'paused',
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess('You have been unsubscribed from all emails.');
        setFrequency('paused');
        if (settings) {
          setSettings({ ...settings, isActive: false, frequency: 'paused' });
        }
      } else {
        setError(data.error || 'Failed to unsubscribe');
      }
    } catch {
      setError('Failed to unsubscribe');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-700 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">GC</span>
            </div>
            <span className="text-white font-semibold">GovCon Giants</span>
          </Link>
          <div className="text-slate-400 text-sm">Email Preferences</div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-12">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
            📬 Email Preferences
          </h1>
          <p className="text-slate-400">
            Control what emails you receive from GovCon Giants
          </p>
        </div>

        {/* Email lookup form */}
        {!settings && !notFound && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <form onSubmit={handleLookup} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                  Enter your email
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold py-3 px-6 rounded-lg transition-all disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Look Up My Settings'}
              </button>
            </form>
          </div>
        )}

        {/* Not found message */}
        {notFound && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-amber-400 mb-2">No Profile Found</h3>
            <p className="text-slate-300 mb-4">
              We couldn&apos;t find settings for <span className="text-white font-medium">{email}</span>.
            </p>
            <p className="text-slate-400 mb-4">
              Sign up at{' '}
              <Link href="/opportunity-hunter" className="text-red-400 hover:text-red-300 underline">
                Opportunity Hunter
              </Link>{' '}
              to start receiving alerts.
            </p>
            <button
              onClick={() => { setNotFound(false); setEmail(''); }}
              className="text-slate-400 hover:text-white text-sm"
            >
              ← Try another email
            </button>
          </div>
        )}

        {/* Settings form */}
        {settings && (
          <div className="space-y-6">
            {/* Current email */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-500 text-xs uppercase tracking-wide">Email</p>
                  <p className="text-white font-medium">{settings.email}</p>
                </div>
                <button
                  onClick={() => { setSettings(null); setEmail(''); setNotFound(false); }}
                  className="text-slate-400 hover:text-white text-sm"
                >
                  Change
                </button>
              </div>
            </div>

            {/* Messages */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-4">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg p-4">
                ✓ {success}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-6">
              {/* Section: Email Frequency */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  🔔 Opportunity Alerts
                </h2>
                <p className="text-slate-400 text-sm mb-4">
                  New SAM.gov opportunities matching your profile
                </p>

                <div className="space-y-3">
                  <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${frequency === 'daily' ? 'bg-red-500/10 border border-red-500/30' : 'bg-slate-800/50 border border-transparent hover:bg-slate-800'}`}>
                    <input
                      type="radio"
                      name="frequency"
                      value="daily"
                      checked={frequency === 'daily'}
                      onChange={() => setFrequency('daily')}
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-slate-600 bg-slate-700"
                    />
                    <div>
                      <span className="text-white font-medium">Daily</span>
                      <span className="text-slate-400 text-sm ml-2">Every morning around 6 AM your time</span>
                    </div>
                  </label>

                  <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${frequency === 'weekly' ? 'bg-red-500/10 border border-red-500/30' : 'bg-slate-800/50 border border-transparent hover:bg-slate-800'}`}>
                    <input
                      type="radio"
                      name="frequency"
                      value="weekly"
                      checked={frequency === 'weekly'}
                      onChange={() => setFrequency('weekly')}
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-slate-600 bg-slate-700"
                    />
                    <div>
                      <span className="text-white font-medium">Weekly</span>
                      <span className="text-slate-400 text-sm ml-2">Sunday digest of the week&apos;s opportunities</span>
                    </div>
                  </label>

                  <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${frequency === 'paused' ? 'bg-slate-700/50 border border-slate-600' : 'bg-slate-800/50 border border-transparent hover:bg-slate-800'}`}>
                    <input
                      type="radio"
                      name="frequency"
                      value="paused"
                      checked={frequency === 'paused'}
                      onChange={() => setFrequency('paused')}
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-slate-600 bg-slate-700"
                    />
                    <div>
                      <span className="text-white font-medium">Paused</span>
                      <span className="text-slate-400 text-sm ml-2">Don&apos;t send alerts (keep my settings)</span>
                    </div>
                  </label>
                </div>

                <div className="mt-3 px-3 py-2 bg-red-500/5 rounded-lg border border-red-500/10">
                  <p className="text-red-300 text-xs">
                    🎁 <strong>FREE PREVIEW</strong> — Alerts are free during beta. Premium features coming soon.
                  </p>
                </div>
              </div>

              {/* Section: Daily Briefings */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  📊 Daily Briefings
                </h2>
                <p className="text-slate-400 text-sm mb-4">
                  Curated intel with win probability, agency insights, and market trends
                </p>

                <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${briefingsEnabled ? 'bg-purple-500/10 border border-purple-500/30' : 'bg-slate-800/50 border border-transparent hover:bg-slate-800'}`}>
                  <input
                    type="checkbox"
                    checked={briefingsEnabled}
                    onChange={(e) => setBriefingsEnabled(e.target.checked)}
                    className="h-5 w-5 rounded text-purple-600 focus:ring-purple-500 border-slate-600 bg-slate-700"
                  />
                  <div>
                    <span className="text-white font-medium">Send me daily briefings</span>
                    <p className="text-slate-400 text-sm">Personalized GovCon intelligence every morning</p>
                  </div>
                </label>

                <div className="mt-3 px-3 py-2 bg-purple-500/5 rounded-lg border border-purple-500/10">
                  <p className="text-purple-300 text-xs">
                    🎁 <strong>FREE PREVIEW</strong> — Briefings are free during beta. Premium features coming soon.
                  </p>
                </div>
              </div>

              {/* Section: Filters */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  🎯 What Opportunities?
                </h2>

                {/* Primary Industry Selector */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Primary Industry <span className="text-red-400">*</span>
                  </label>
                  <p className="text-xs text-slate-500 mb-3">
                    Select your main business type. Briefings will prioritize opportunities in this industry.
                  </p>
                  <select
                    value={primaryIndustry}
                    onChange={(e) => {
                      const newPrimary = e.target.value;
                      setPrimaryIndustry(newPrimary);
                      // Also add the primary industry's NAICS codes if not already present
                      if (newPrimary) {
                        const preset = INDUSTRY_PRESETS.find(p => p.label.includes(newPrimary));
                        if (preset) {
                          const existingCodes = naicsInput.split(/[,\s]+/).map(c => c.trim()).filter(Boolean);
                          const newCodes = [...new Set([...preset.codes, ...existingCodes])];
                          setNaicsInput(newCodes.join(', '));
                        }
                      }
                    }}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="">-- Select Primary Industry --</option>
                    {INDUSTRY_PRESETS.map((preset) => {
                      const cleanLabel = preset.label.replace(/^[^\w]+\s*/, ''); // Remove emoji prefix
                      return (
                        <option key={preset.label} value={cleanLabel}>
                          {preset.label} — {preset.description}
                        </option>
                      );
                    })}
                  </select>
                  {primaryIndustry && (
                    <div className="mt-2 px-3 py-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                      <p className="text-emerald-400 text-xs">
                        Your briefings will prioritize {primaryIndustry} opportunities first.
                      </p>
                    </div>
                  )}
                </div>

                {/* Quick Industry Select */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-3">
                    Additional Industries (Optional)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {INDUSTRY_PRESETS.map((preset) => {
                      // Check if ANY of the preset codes are in the input
                      const currentCodes = naicsInput.split(/[,\s]+/).map(c => c.trim()).filter(Boolean);
                      const isSelected = preset.codes.some(code => currentCodes.includes(code));

                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            const existingCodes = naicsInput.split(/[,\s]+/).map(c => c.trim()).filter(Boolean);

                            if (isSelected) {
                              // Remove all codes from this preset
                              const newCodes = existingCodes.filter(code => !preset.codes.includes(code));
                              setNaicsInput(newCodes.length > 0 ? newCodes.join(', ') : '');
                            } else {
                              // Add the preset codes (avoid duplicates)
                              const newCodes = [...new Set([...existingCodes, ...preset.codes])];
                              setNaicsInput(newCodes.join(', '));
                            }
                          }}
                          className={`text-left p-3 rounded-lg border transition-all ${
                            isSelected
                              ? 'bg-red-500/20 border-red-500/40 text-white'
                              : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                          }`}
                        >
                          <div className="font-medium text-sm flex items-center gap-2">
                            {preset.label}
                            {isSelected && <span className="text-xs text-red-400">✓</span>}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{preset.description}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* NAICS Codes */}
                <div className="mb-5">
                  <label htmlFor="naics" className="block text-sm font-medium text-slate-300 mb-1">
                    NAICS Codes
                  </label>
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3 mb-3">
                    <p className="text-sm text-slate-300 mb-2">
                      💡 <strong>Pro tip:</strong> Use short codes to match entire industries:
                    </p>
                    <ul className="text-xs text-slate-400 space-y-1 ml-4">
                      <li><code className="bg-slate-700 px-1.5 py-0.5 rounded text-emerald-400">236</code> → matches <strong>ALL</strong> building construction (236110, 236115, 236220, etc.)</li>
                      <li><code className="bg-slate-700 px-1.5 py-0.5 rounded text-emerald-400">238</code> → matches <strong>ALL</strong> specialty trades (electrical, plumbing, HVAC, etc.)</li>
                      <li><code className="bg-slate-700 px-1.5 py-0.5 rounded text-emerald-400">541</code> → matches <strong>ALL</strong> professional services</li>
                    </ul>
                  </div>
                  <textarea
                    id="naics"
                    value={naicsInput}
                    onChange={(e) => setNaicsInput(e.target.value)}
                    rows={2}
                    placeholder="236, 238, 541512"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono text-sm"
                  />
                  {naicsInput && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {naicsInput.split(/[,\s]+/).filter(c => /^\d+$/.test(c.trim())).map((code, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 bg-slate-800 border border-slate-600 rounded-full px-2.5 py-1 text-xs"
                        >
                          <span className="text-white font-mono">{code.trim()}</span>
                          {code.trim().length <= 3 && (
                            <span className="text-emerald-400">✓ prefix</span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const codes = naicsInput.split(/[,\s]+/).filter(c => c.trim() !== code.trim());
                              setNaicsInput(codes.join(', '));
                            }}
                            className="text-slate-500 hover:text-red-400 ml-1"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Keywords */}
                <div className="mb-5">
                  <label htmlFor="keywords" className="block text-sm font-medium text-slate-300 mb-1">
                    Keywords <span className="text-slate-500 font-normal">(optional)</span>
                  </label>
                  <p className="text-xs text-slate-500 mb-2">
                    Catch mislabeled opportunities. We&apos;ll search titles and descriptions for these terms.
                  </p>
                  <textarea
                    id="keywords"
                    value={keywordsInput}
                    onChange={(e) => setKeywordsInput(e.target.value)}
                    rows={2}
                    placeholder="construction, remediation, IT services, software development"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
                  />
                </div>

                {/* Business Type */}
                <div className="mb-5">
                  <label htmlFor="businessType" className="block text-sm font-medium text-slate-300 mb-1">
                    Set-Aside Type
                  </label>
                  <select
                    id="businessType"
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {BUSINESS_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Location States - Multi-Select with Smart Expansion */}
                <div className="mb-5">
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    📍 Place of Performance
                  </label>
                  <p className="text-xs text-slate-500 mb-2">
                    Select multiple states. We auto-expand to include bordering states + DC.
                  </p>

                  {/* Selected states chips */}
                  {locationStates.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {locationStates.map((state) => {
                        const stateLabel = US_STATES.find(s => s.value === state)?.label || state;
                        return (
                          <span
                            key={state}
                            className="inline-flex items-center gap-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full px-2.5 py-1 text-xs"
                          >
                            <span className="text-white font-medium">{stateLabel}</span>
                            <button
                              type="button"
                              onClick={() => setLocationStates(locationStates.filter(s => s !== state))}
                              className="text-emerald-400 hover:text-red-400 ml-1"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                      {locationStates.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setLocationStates([])}
                          className="text-xs text-slate-500 hover:text-red-400 px-2"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                  )}

                  {/* Add state dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowStateSelector(!showStateSelector)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-left text-white focus:outline-none focus:ring-2 focus:ring-red-500 flex items-center justify-between"
                    >
                      <span className={locationStates.length === 0 ? 'text-slate-500' : 'text-white'}>
                        {locationStates.length === 0 ? 'All States (Nationwide)' : `${locationStates.length} state${locationStates.length > 1 ? 's' : ''} selected`}
                      </span>
                      <span className="text-slate-400">{showStateSelector ? '▲' : '▼'}</span>
                    </button>

                    {showStateSelector && (
                      <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                        {/* Nationwide option */}
                        <button
                          type="button"
                          onClick={() => {
                            setLocationStates([]);
                            setShowStateSelector(false);
                          }}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-700 ${
                            locationStates.length === 0 ? 'bg-red-500/20 text-red-400' : 'text-slate-300'
                          }`}
                        >
                          ✓ All States (Nationwide)
                        </button>
                        <div className="border-t border-slate-700" />
                        {/* State list */}
                        {US_STATES.filter(s => s.value !== '').map((state) => (
                          <button
                            key={state.value}
                            type="button"
                            onClick={() => {
                              if (locationStates.includes(state.value)) {
                                setLocationStates(locationStates.filter(s => s !== state.value));
                              } else {
                                setLocationStates([...locationStates, state.value]);
                              }
                            }}
                            className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-700 flex items-center justify-between ${
                              locationStates.includes(state.value) ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-300'
                            }`}
                          >
                            <span>{state.label}</span>
                            {locationStates.includes(state.value) && <span>✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Quick region buttons */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setLocationStates(['FL', 'GA', 'AL', 'SC', 'NC', 'TN'])}
                      className="text-xs px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600"
                    >
                      Southeast
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocationStates(['VA', 'MD', 'DC', 'WV', 'DE', 'PA', 'NJ'])}
                      className="text-xs px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600"
                    >
                      Mid-Atlantic
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocationStates(['TX', 'OK', 'AR', 'LA', 'NM'])}
                      className="text-xs px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600"
                    >
                      Southwest
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocationStates(['CA', 'OR', 'WA', 'NV', 'AZ'])}
                      className="text-xs px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600"
                    >
                      West Coast
                    </button>
                  </div>

                  {/* Smart expansion preview */}
                  {locationStates.length > 0 && (
                    <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                      <p className="text-xs text-emerald-400 font-medium mb-1">
                        🎯 Smart Expansion Active
                      </p>
                      <p className="text-xs text-slate-400">
                        {(() => {
                          const borders: Record<string, string[]> = {
                            FL: ['AL', 'GA'], GA: ['AL', 'FL', 'NC', 'SC', 'TN'], TX: ['AR', 'LA', 'NM', 'OK'],
                            CA: ['AZ', 'NV', 'OR'], NY: ['CT', 'MA', 'NJ', 'PA', 'VT'], VA: ['DC', 'KY', 'MD', 'NC', 'TN', 'WV'],
                            NC: ['GA', 'SC', 'TN', 'VA'], PA: ['DE', 'MD', 'NJ', 'NY', 'OH', 'WV'], OH: ['IN', 'KY', 'MI', 'PA', 'WV'],
                            IL: ['IA', 'IN', 'KY', 'MO', 'WI'], MI: ['IN', 'OH', 'WI'], NJ: ['DE', 'NY', 'PA'],
                            MD: ['DC', 'DE', 'PA', 'VA', 'WV'], AZ: ['CA', 'CO', 'NM', 'NV', 'UT'], CO: ['AZ', 'KS', 'NE', 'NM', 'OK', 'UT', 'WY'],
                            AL: ['FL', 'GA', 'MS', 'TN'], SC: ['GA', 'NC'], TN: ['AL', 'AR', 'GA', 'KY', 'MO', 'MS', 'NC', 'VA'],
                            AR: ['LA', 'MO', 'MS', 'OK', 'TN', 'TX'], LA: ['AR', 'MS', 'TX'], NM: ['AZ', 'CO', 'OK', 'TX', 'UT'],
                            OK: ['AR', 'CO', 'KS', 'MO', 'NM', 'TX'], NV: ['AZ', 'CA', 'ID', 'OR', 'UT'], OR: ['CA', 'ID', 'NV', 'WA'],
                            WA: ['ID', 'OR'], DC: ['MD', 'VA'], WV: ['KY', 'MD', 'OH', 'PA', 'VA'], DE: ['MD', 'NJ', 'PA'],
                          };
                          const stateNames: Record<string, string> = {
                            FL: 'FL', GA: 'GA', TX: 'TX', CA: 'CA', NY: 'NY', VA: 'VA', NC: 'NC', PA: 'PA', OH: 'OH', IL: 'IL',
                            MI: 'MI', NJ: 'NJ', MD: 'MD', AZ: 'AZ', CO: 'CO', AL: 'AL', SC: 'SC', TN: 'TN', AR: 'AR', LA: 'LA',
                            NM: 'NM', OK: 'OK', NV: 'NV', OR: 'OR', CT: 'CT', MA: 'MA', VT: 'VT', DC: 'DC', KY: 'KY', WV: 'WV',
                            IN: 'IN', WI: 'WI', MO: 'MO', IA: 'IA', DE: 'DE', KS: 'KS', NE: 'NE', UT: 'UT', WY: 'WY', WA: 'WA',
                            ID: 'ID', MS: 'MS',
                          };
                          // Collect all border states for selected states
                          const allBorders = new Set<string>();
                          locationStates.forEach(state => {
                            (borders[state] || []).forEach(b => allBorders.add(b));
                          });
                          allBorders.add('DC'); // Always include DC
                          // Combine selected + borders
                          const allStates = [...new Set([...locationStates, ...allBorders])].sort();
                          return `Searching ${allStates.length} states: ${allStates.slice(0, 10).map(s => stateNames[s] || s).join(', ')}${allStates.length > 10 ? '...' : ''}`;
                        })()}
                      </p>
                    </div>
                  )}
                </div>

              </div>

              {/* Save button */}
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 px-6 rounded-xl transition-all disabled:opacity-50 text-lg"
              >
                {saving ? 'Saving...' : 'Save Preferences'}
              </button>
            </form>

            {/* Unsubscribe */}
            <div className="pt-6 border-t border-slate-800 text-center">
              <button
                onClick={handleUnsubscribe}
                disabled={saving}
                className="text-slate-500 hover:text-red-400 text-sm transition-colors"
              >
                🗑️ Unsubscribe from all emails
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center">
          <p className="text-slate-500 text-sm">
            Questions? <a href="mailto:service@govcongiants.com" className="text-red-400 hover:text-red-300">service@govcongiants.com</a>
          </p>
        </div>
      </main>
    </div>
  );
}

export default function AlertPreferencesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    }>
      <AlertPreferencesContent />
    </Suspense>
  );
}
