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
  naicsCodes: string[] | null;
  keywords: string[] | null;
  businessType: string | null;
  targetAgencies: string[];
  locationState: string | null;
  frequency: string;
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
  const [naicsInput, setNaicsInput] = useState('');
  const [keywordsInput, setKeywordsInput] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'paused'>('daily');
  const [briefingsEnabled, setBriefingsEnabled] = useState(true);

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
        // Clean NAICS codes - filter out non-numeric values
        const cleanedNaics = cleanNaicsCodes(data.data.naicsCodes || []);
        setNaicsInput(cleanedNaics.join(', '));
        setKeywordsInput(data.data.keywords?.join(', ') || '');
        setBusinessType(data.data.businessType || '');
        // Map isActive + frequency to our new frequency state
        if (!data.data.isActive) {
          setFrequency('paused');
        } else {
          setFrequency(data.data.frequency === 'weekly' ? 'weekly' : 'daily');
        }
        // For now, briefings is always enabled (no DB field yet)
        setBriefingsEnabled(true);
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
          naicsCodes,
          keywords,
          businessType: businessType || null,
          frequency: frequency,
          isActive: frequency !== 'paused',
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

                {/* Quick Industry Select */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-3">
                    Quick Select by Industry
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
