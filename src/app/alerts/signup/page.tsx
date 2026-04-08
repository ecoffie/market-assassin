'use client';

import { useState } from 'react';
import Link from 'next/link';

const BUSINESS_TYPES = [
  { value: '', label: 'Select your business type...' },
  { value: 'SDVOSB', label: 'SDVOSB - Service-Disabled Veteran-Owned' },
  { value: 'VOSB', label: 'VOSB - Veteran-Owned Small Business' },
  { value: '8a', label: '8(a) - SBA 8(a) Program' },
  { value: 'WOSB', label: 'WOSB - Women-Owned Small Business' },
  { value: 'EDWOSB', label: 'EDWOSB - Economically Disadvantaged WOSB' },
  { value: 'HUBZone', label: 'HUBZone' },
  { value: 'Small Business', label: 'Small Business (General)' },
];

export default function AlertSignupPage() {
  const [email, setEmail] = useState('');
  const [naicsInput, setNaicsInput] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const rememberPreferencesEmail = () => {
    if (email.trim()) {
      localStorage.setItem('preferences_access_email', email.trim().toLowerCase());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      // Parse NAICS codes
      const naicsCodes = naicsInput
        .split(/[,\s]+/)
        .map(c => c.trim())
        .filter(c => c.length > 0);

      if (naicsCodes.length === 0) {
        setError('Please enter at least one NAICS code');
        setSubmitting(false);
        return;
      }

      const res = await fetch('/api/alerts/save-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          naicsCodes,
          businessType: businessType || null,
          source: 'free-signup',
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(true);
      } else {
        setError(data.error || 'Failed to sign up. Please try again.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-950">
        <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-700 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">GC</span>
              </div>
              <span className="text-white font-semibold">GovCon Giants</span>
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-16">
          <div className="text-center">
            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white mb-4">You&apos;re Signed Up!</h1>
            <p className="text-slate-400 text-lg mb-8">
              You&apos;ll receive weekly SAM.gov opportunity alerts at <span className="text-white font-medium">{email}</span>.
            </p>

            {/* Alert Pro Upsell */}
            <div className="bg-gradient-to-br from-slate-900 to-emerald-950/30 border border-emerald-500/40 rounded-xl p-6 mb-6 text-left">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Free Tier: 5 Opportunities/Week
              </h3>
              <p className="text-slate-400 mb-4">
                You&apos;re on the free tier. Upgrade to <strong className="text-emerald-400">Alert Pro</strong> for daily alerts and unlimited opportunities.
              </p>
              <ul className="text-slate-400 text-sm space-y-1 mb-4">
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <strong className="text-white">Daily</strong> alerts (not weekly)
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <strong className="text-white">Unlimited</strong> opportunities (no 5 cap)
                </li>
              </ul>
              <Link
                href="https://buy.stripe.com/8x24gA1oifvAcFv3OEfnO0y"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-semibold py-2 px-4 rounded-lg transition-all text-sm"
              >
                Upgrade to Alert Pro - $19/mo
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>

            {/* Market Assassin Upsell */}
            <div className="bg-gradient-to-br from-slate-900 to-red-950/30 border border-red-500/30 rounded-xl p-6 mb-8 text-left">
              <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Go Beyond Alerts
              </h3>
              <p className="text-slate-400 text-sm mb-4">
                <strong className="text-white">Federal Market Assassin</strong> gives you complete agency intelligence: pain points, contract history, competitor analysis, and strategic reports.
              </p>
              <Link
                href="/market-assassin"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold py-2 px-4 rounded-lg transition-all text-sm"
              >
                Explore Market Assassin
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <p className="text-slate-500 text-sm mt-2">Starting at $297</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/opportunity-hunter"
                className="text-slate-400 hover:text-white text-sm flex items-center justify-center gap-1 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Search opportunities now
              </Link>
              <Link
                href="/alerts/preferences"
                onClick={rememberPreferencesEmail}
                className="text-slate-400 hover:text-white text-sm flex items-center justify-center gap-1 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Manage preferences
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

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
          <Link href="/alerts/preferences" className="text-slate-400 hover:text-white text-sm">
            Already signed up?
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-4">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Free Weekly Alerts
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Get SAM.gov Opportunities <br className="hidden sm:block" />
            Delivered to Your Inbox
          </h1>
          <p className="text-slate-400 text-lg">
            Never miss a contracting opportunity. Get 5 matched opportunities every week.
          </p>
        </div>

        {/* Features */}
        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 text-center">
            <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-white font-medium mb-1">NAICS Matched</h3>
            <p className="text-slate-500 text-sm">Opportunities in your industry</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 text-center">
            <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-white font-medium mb-1">Set-Aside Filtered</h3>
            <p className="text-slate-500 text-sm">SDVOSB, 8(a), WOSB & more</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 text-center">
            <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-white font-medium mb-1">Weekly Email</h3>
            <p className="text-slate-500 text-sm">Direct to your inbox</p>
          </div>
        </div>

        {/* Signup Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-4 flex items-center gap-3">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                Email Address *
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

            {/* NAICS Codes */}
            <div>
              <label htmlFor="naics" className="block text-sm font-medium text-slate-300 mb-2">
                NAICS Codes *
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Enter your NAICS codes separated by commas. Don&apos;t know yours?{' '}
                <a href="https://www.census.gov/naics/" target="_blank" rel="noopener noreferrer" className="text-red-400 hover:text-red-300">
                  Look it up here
                </a>
              </p>
              <textarea
                id="naics"
                value={naicsInput}
                onChange={(e) => setNaicsInput(e.target.value)}
                rows={2}
                placeholder="e.g., 541511, 236220, 238"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent font-mono text-sm"
                required
              />
            </div>

            {/* Business Type */}
            <div>
              <label htmlFor="businessType" className="block text-sm font-medium text-slate-300 mb-2">
                Business Type (Optional)
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Select if you want to see only set-aside opportunities
              </p>
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

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold py-4 px-6 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Signing up...
                </span>
              ) : 'Get Free Weekly Alerts'}
            </button>

            <p className="text-slate-500 text-xs text-center">
              By signing up, you agree to receive weekly emails. You can unsubscribe anytime.
            </p>
          </form>
        </div>

        {/* Upgrade Options */}
        <div className="mt-8 space-y-4">
          <h2 className="text-white font-semibold text-lg text-center mb-6">Ready to Go Further?</h2>

          {/* Alert Pro - $19/mo */}
          <div className="bg-gradient-to-br from-slate-900 to-emerald-950/30 border border-emerald-500/40 rounded-xl p-6 hover:border-emerald-500/60 transition-colors relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
              BEST VALUE
            </div>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-white font-semibold text-lg">Alert Pro</h3>
                  <div className="text-right">
                    <span className="text-emerald-400 font-bold text-xl">$19</span>
                    <span className="text-emerald-400/70 text-sm">/mo</span>
                  </div>
                </div>
                <p className="text-slate-400 text-sm mb-3">
                  Fresh opportunities every morning. Never miss a deadline again.
                </p>
                <ul className="text-slate-400 text-sm space-y-1.5 mb-4">
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <strong className="text-white">Daily alerts</strong> (not weekly)
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <strong className="text-white">Unlimited opportunities</strong> (no cap)
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Priority scoring & deadline tracking
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Cancel anytime
                  </li>
                </ul>
                <Link
                  href="https://buy.stripe.com/8x24gA1oifvAcFv3OEfnO0y"
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-semibold py-3 px-5 rounded-lg transition-all text-sm"
                >
                  Start Alert Pro - $19/mo
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>

          {/* Market Assassin */}
          <div className="bg-gradient-to-br from-slate-900 to-red-950/30 border border-red-500/30 rounded-xl p-6 hover:border-red-500/50 transition-colors relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
              POPULAR
            </div>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-red-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-white font-semibold text-lg">Federal Market Assassin</h3>
                  <span className="text-red-400 font-bold">$297+</span>
                </div>
                <p className="text-slate-400 text-sm mb-3">
                  Complete agency intelligence platform. Know exactly which agencies buy your services and how to win.
                </p>
                <ul className="text-slate-400 text-sm space-y-1 mb-4">
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Agency pain points & strategic reports
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Contract history & spending analysis
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Competitor intelligence & positioning
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    PDF reports you can use for proposals
                  </li>
                </ul>
                <div className="flex items-center gap-3">
                  <Link
                    href="/market-assassin"
                    className="inline-flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold py-2 px-4 rounded-lg transition-all text-sm"
                  >
                    See Market Assassin
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </Link>
                  <span className="text-slate-500 text-xs">Standard $297 | Premium $497</span>
                </div>
              </div>
            </div>
          </div>
        </div>

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
