'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const BUSINESS_TYPES = [
  { value: '', label: 'Any / Not specified' },
  { value: 'SDVOSB', label: 'SDVOSB - Service-Disabled Veteran-Owned' },
  { value: 'VOSB', label: 'VOSB - Veteran-Owned Small Business' },
  { value: '8a', label: '8(a) - SBA 8(a) Program' },
  { value: 'WOSB', label: 'WOSB - Women-Owned Small Business' },
  { value: 'EDWOSB', label: 'EDWOSB - Economically Disadvantaged WOSB' },
  { value: 'HUBZone', label: 'HUBZone' },
  { value: 'Small Business', label: 'Small Business (General)' },
];

const US_STATES = [
  { value: '', label: 'All States (Nationwide)' },
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' }, { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'District of Columbia' }, { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' }, { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' }, { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' }, { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' }, { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' }, { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' }, { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' }, { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' }, { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' }, { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' }, { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' }, { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' }, { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
];

interface AlertSettings {
  email: string;
  naicsCodes: string[] | null;
  businessType: string | null;
  targetAgencies: string[];
  locationState: string | null;
  frequency: string;
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
  const [businessType, setBusinessType] = useState('');
  const [locationState, setLocationState] = useState('');
  const [isActive, setIsActive] = useState(true);

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
        setNaicsInput(data.data.naicsCodes?.join(', ') || '');
        setBusinessType(data.data.businessType || '');
        setLocationState(data.data.locationState || '');
        setIsActive(data.data.isActive);
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
      const naicsCodes = naicsInput
        .split(/[,\s]+/)
        .map(c => c.trim())
        .filter(c => c.length > 0);

      const res = await fetch('/api/alerts/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: settings?.email || email,
          naicsCodes,
          businessType: businessType || null,
          locationState: locationState || null,
          isActive,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess('Your alert preferences have been saved!');
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
    if (!confirm('Are you sure you want to unsubscribe from SAM.gov alerts?')) {
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
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess('You have been unsubscribed from alerts.');
        setIsActive(false);
        if (settings) {
          setSettings({ ...settings, isActive: false });
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
          <div className="text-slate-400 text-sm">Alert Preferences</div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        {/* Title */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            SAM.gov Opportunity Alerts
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Manage Your Alerts
          </h1>
          <p className="text-slate-400 text-lg">
            Customize which government contracting opportunities you receive weekly
          </p>
        </div>

        {/* Email lookup form */}
        {!settings && !notFound && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 md:p-8">
            <form onSubmit={handleLookup} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                  Enter your email to manage preferences
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
                className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold py-3 px-6 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Loading...
                  </span>
                ) : 'Look Up My Settings'}
              </button>
            </form>
          </div>
        )}

        {/* Not found message */}
        {notFound && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-amber-400 mb-2">No Alert Profile Found</h3>
                <p className="text-slate-300 mb-4">
                  We couldn&apos;t find alert settings for <span className="text-white font-medium">{email}</span>.
                </p>
                <p className="text-slate-400 mb-4">
                  To receive SAM.gov alerts, sign up on our{' '}
                  <Link href="/alerts/signup" className="text-red-400 hover:text-red-300 underline">
                    alerts signup page
                  </Link>{' '}
                  or visit{' '}
                  <Link href="/opportunity-hunter" className="text-red-400 hover:text-red-300 underline">
                    Opportunity Hunter
                  </Link>.
                </p>
                <button
                  onClick={() => { setNotFound(false); setEmail(''); }}
                  className="text-slate-400 hover:text-white text-sm flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Try another email
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Settings form */}
        {settings && (
          <div className="space-y-6">
            {/* Status card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">Managing alerts for</p>
                  <p className="text-white font-medium text-lg">{settings.email}</p>
                </div>
                <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                  settings.isActive
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-slate-700/50 text-slate-400 border border-slate-600'
                }`}>
                  {settings.isActive ? 'Active' : 'Paused'}
                </span>
              </div>

              {settings.totalAlertsSent !== null && settings.totalAlertsSent > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-800 flex items-center gap-6 text-sm">
                  <div>
                    <span className="text-slate-400">Alerts received:</span>
                    <span className="text-white font-medium ml-2">{settings.totalAlertsSent}</span>
                  </div>
                  {settings.lastAlertSent && (
                    <div>
                      <span className="text-slate-400">Last sent:</span>
                      <span className="text-white font-medium ml-2">
                        {new Date(settings.lastAlertSent).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Messages */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-4 flex items-center gap-3">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}
            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg p-4 flex items-center gap-3">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {success}
              </div>
            )}

            {/* Edit form */}
            <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-xl p-6 md:p-8 space-y-6">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Preferences
              </h2>

              {/* NAICS Codes */}
              <div>
                <label htmlFor="naics" className="block text-sm font-medium text-slate-300 mb-2">
                  NAICS Codes
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Enter your NAICS codes separated by commas. Use prefixes (e.g., 541) to match all codes in that category.
                </p>
                <textarea
                  id="naics"
                  value={naicsInput}
                  onChange={(e) => setNaicsInput(e.target.value)}
                  rows={3}
                  placeholder="541511, 236220, 238"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent font-mono text-sm"
                />
              </div>

              {/* Business Type */}
              <div>
                <label htmlFor="businessType" className="block text-sm font-medium text-slate-300 mb-2">
                  Business Type / Set-Aside
                </label>
                <select
                  id="businessType"
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  {BUSINESS_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Location */}
              <div>
                <label htmlFor="state" className="block text-sm font-medium text-slate-300 mb-2">
                  Location (Optional)
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  We search nationwide by default for better results. Add a state filter if you only want local opportunities.
                </p>
                <select
                  id="state"
                  value={locationState}
                  onChange={(e) => setLocationState(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  {US_STATES.map((state) => (
                    <option key={state.value} value={state.value}>
                      {state.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-lg">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-5 w-5 rounded border-slate-600 bg-slate-700 text-red-600 focus:ring-red-500 focus:ring-offset-0"
                />
                <label htmlFor="isActive" className="text-slate-300">
                  Receive weekly opportunity alerts
                </label>
              </div>

              {/* Save button */}
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold py-3 px-6 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Saving...
                  </span>
                ) : 'Save Preferences'}
              </button>
            </form>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => { setSettings(null); setEmail(''); setNotFound(false); }}
                className="text-slate-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Different email
              </button>
              <button
                onClick={handleUnsubscribe}
                disabled={saving || !settings.isActive}
                className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Unsubscribe from all alerts
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center">
          <p className="text-slate-500 text-sm">
            Questions?{' '}
            <a href="mailto:service@govcongiants.com" className="text-red-400 hover:text-red-300">
              service@govcongiants.com
            </a>
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
