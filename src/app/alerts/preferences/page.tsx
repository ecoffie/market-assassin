'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const BUSINESS_TYPES = [
  { value: '', label: 'Any business type' },
  { value: 'Small Business', label: 'Small Business (General)' },
  { value: 'SDVOSB', label: 'SDVOSB - Service-Disabled Veteran-Owned' },
  { value: 'VOSB', label: 'VOSB - Veteran-Owned Small Business' },
  { value: '8a', label: '8(a) - SBA 8(a) Program' },
  { value: 'WOSB', label: 'WOSB - Women-Owned Small Business' },
  { value: 'EDWOSB', label: 'EDWOSB - Economically Disadvantaged WOSB' },
  { value: 'HUBZone', label: 'HUBZone' },
];

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time' },
  { value: 'America/Chicago', label: 'Central Time' },
  { value: 'America/Denver', label: 'Mountain Time' },
  { value: 'America/Los_Angeles', label: 'Pacific Time' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Anchorage', label: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
];

interface PreferencesResponse {
  success: boolean;
  error?: string;
  data?: {
    email: string;
    naicsCodes?: string[];
    businessType?: string | null;
    targetAgencies?: string[];
    locationState?: string | null;
    frequency?: 'daily' | 'weekly' | 'paused';
    alertsEnabled?: boolean;
    timezone?: string;
    lastAlertSent?: string | null;
    totalAlertsSent?: number | null;
  } | null;
}

function parseList(value: string): string[] {
  return value
    .split(/[,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function AlertPreferencesContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [naicsInput, setNaicsInput] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [agenciesInput, setAgenciesInput] = useState('');
  const [locationState, setLocationState] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [frequency, setFrequency] = useState<'daily' | 'paused'>('daily');
  const [totalAlertsSent, setTotalAlertsSent] = useState<number | null>(null);
  const [lastAlertSent, setLastAlertSent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadPreferences = useCallback(async (targetEmail: string) => {
    if (!targetEmail.trim()) return;
    const normalizedEmail = targetEmail.trim().toLowerCase();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(`/api/alerts/preferences?email=${encodeURIComponent(normalizedEmail)}`);
      const data: PreferencesResponse = await res.json();

      if (!data.success) {
        setError(data.error || 'Could not load your preferences.');
        return;
      }

      setEmail(normalizedEmail);
      setEmailInput(normalizedEmail);
      localStorage.setItem('preferences_access_email', normalizedEmail);

      if (data.data) {
        setNaicsInput((data.data.naicsCodes || []).join(', '));
        setBusinessType(data.data.businessType || '');
        setAgenciesInput((data.data.targetAgencies || []).join(', '));
        setLocationState(data.data.locationState || '');
        setTimezone(data.data.timezone || 'America/New_York');
        setFrequency(data.data.alertsEnabled === false || data.data.frequency === 'paused' ? 'paused' : 'daily');
        setTotalAlertsSent(data.data.totalAlertsSent ?? null);
        setLastAlertSent(data.data.lastAlertSent || null);
      }
    } catch {
      setError('Could not load your preferences.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const queryEmail = searchParams.get('email');
    const storedEmail = typeof window !== 'undefined' ? localStorage.getItem('preferences_access_email') : null;
    const initialEmail = queryEmail || storedEmail || '';
    if (initialEmail) {
      void loadPreferences(initialEmail);
    }
  }, [loadPreferences, searchParams]);

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await loadPreferences(emailInput);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');

    const naicsCodes = naicsInput
      .split(/[,\s]+/)
      .map(code => code.trim())
      .filter(code => /^\d+$/.test(code));

    if (naicsCodes.length === 0) {
      setError('Add at least one NAICS code so we can match the right opportunities.');
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/alerts/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          naicsCodes,
          businessType: businessType || null,
          targetAgencies: parseList(agenciesInput),
          locationState: locationState || null,
          locationStates: locationState ? [locationState] : [],
          timezone,
          frequency,
          alertsEnabled: frequency !== 'paused',
          isActive: frequency !== 'paused',
          briefingsEnabled: false,
        }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Could not save preferences.');
        return;
      }

      setMessage('Daily Alerts preferences saved.');
      localStorage.setItem('preferences_access_email', email);
    } catch {
      setError('Could not save preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-900/70">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-red-500 to-red-700">
              <span className="text-sm font-bold text-white">GC</span>
            </div>
            <span className="font-semibold">GovCon Giants</span>
          </Link>
          <Link href="/alerts/signup" className="text-sm text-slate-400 hover:text-white">
            Set up alerts
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-8">
          <div className="mb-3 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-300">
            Daily Alerts Profile
          </div>
          <h1 className="text-3xl font-bold">Manage Daily Alerts</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Update the NAICS, set-aside, agency, and delivery settings that power your opportunity alert emails.
          </p>
        </div>

        {!email ? (
          <form onSubmit={handleEmailSubmit} className="max-w-xl rounded-xl border border-slate-800 bg-slate-900 p-6">
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-300">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={emailInput}
              onChange={event => setEmailInput(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              required
            />
            {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full rounded-lg bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {loading ? 'Loading...' : 'Continue'}
            </button>
          </form>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <form onSubmit={handleSave} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              {error ? (
                <div className="mb-5 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                  {error}
                </div>
              ) : null}
              {message ? (
                <div className="mb-5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                  {message}
                </div>
              ) : null}

              <div className="space-y-6">
                <div>
                  <label htmlFor="naics" className="mb-2 block text-sm font-medium text-slate-300">
                    NAICS Codes
                  </label>
                  <textarea
                    id="naics"
                    value={naicsInput}
                    onChange={event => setNaicsInput(event.target.value)}
                    rows={3}
                    placeholder="236, 237, 238, 541511"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 font-mono text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Use commas or spaces. Short prefixes like 236 match the whole category.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="businessType" className="mb-2 block text-sm font-medium text-slate-300">
                      Business Type
                    </label>
                    <select
                      id="businessType"
                      value={businessType}
                      onChange={event => setBusinessType(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white focus:border-emerald-500 focus:outline-none"
                    >
                      {BUSINESS_TYPES.map(type => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="frequency" className="mb-2 block text-sm font-medium text-slate-300">
                      Delivery
                    </label>
                    <select
                      id="frequency"
                      value={frequency}
                      onChange={event => setFrequency(event.target.value as 'daily' | 'paused')}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="daily">Daily alerts</option>
                      <option value="paused">Paused</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="agencies" className="mb-2 block text-sm font-medium text-slate-300">
                    Target Agencies
                  </label>
                  <input
                    id="agencies"
                    value={agenciesInput}
                    onChange={event => setAgenciesInput(event.target.value)}
                    placeholder="VA, GSA, DoD"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Optional. Leave blank to include all agencies matching your profile.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="state" className="mb-2 block text-sm font-medium text-slate-300">
                      State
                    </label>
                    <input
                      id="state"
                      value={locationState}
                      onChange={event => setLocationState(event.target.value.toUpperCase().slice(0, 2))}
                      placeholder="NY"
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="timezone" className="mb-2 block text-sm font-medium text-slate-300">
                      Timezone
                    </label>
                    <select
                      id="timezone"
                      value={timezone}
                      onChange={event => setTimezone(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white focus:border-emerald-500 focus:outline-none"
                    >
                      {TIMEZONES.map(zone => (
                        <option key={zone.value} value={zone.value}>
                          {zone.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-800 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem('preferences_access_email');
                      setEmail('');
                      setEmailInput('');
                    }}
                    className="text-sm text-slate-400 hover:text-white"
                  >
                    Use a different email
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {saving ? 'Saving...' : 'Save Daily Alerts'}
                  </button>
                </div>
              </div>
            </form>

            <aside className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-sm text-slate-500">Profile email</p>
                <p className="mt-1 break-all font-medium text-white">{email}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-slate-800 p-3">
                    <p className="text-slate-500">Sent</p>
                    <p className="mt-1 text-xl font-bold text-emerald-300">{totalAlertsSent ?? 0}</p>
                  </div>
                  <div className="rounded-lg bg-slate-800 p-3">
                    <p className="text-slate-500">Status</p>
                    <p className="mt-1 text-xl font-bold text-emerald-300">
                      {frequency === 'paused' ? 'Paused' : 'Daily'}
                    </p>
                  </div>
                </div>
                {lastAlertSent ? (
                  <p className="mt-4 text-xs text-slate-500">
                    Last sent: {new Date(lastAlertSent).toLocaleString()}
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-5">
                <h2 className="font-semibold text-white">Need prioritization?</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Daily Briefings turn alert matches into ranked priorities, weekly analysis, and pursuit guidance.
                </p>
                <Link
                  href="https://shop.govcongiants.org/market-intelligence"
                  className="mt-4 inline-flex rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500"
                >
                  See Daily Briefings
                </Link>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AlertPreferencesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 text-slate-300">Loading...</div>}>
      <AlertPreferencesContent />
    </Suspense>
  );
}
