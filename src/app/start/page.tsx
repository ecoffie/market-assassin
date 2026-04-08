'use client';

import { useState } from 'react';
import Link from 'next/link';

// Top 30 most common NAICS codes in federal contracting
const POPULAR_NAICS = [
  { code: '541512', name: 'Computer Systems Design Services' },
  { code: '541511', name: 'Custom Computer Programming Services' },
  { code: '541519', name: 'Other Computer Related Services' },
  { code: '541611', name: 'Administrative Management Consulting' },
  { code: '541330', name: 'Engineering Services' },
  { code: '541618', name: 'Other Management Consulting Services' },
  { code: '541620', name: 'Environmental Consulting Services' },
  { code: '541690', name: 'Other Scientific & Technical Consulting' },
  { code: '541990', name: 'All Other Professional Services' },
  { code: '561210', name: 'Facilities Support Services' },
  { code: '561720', name: 'Janitorial Services' },
  { code: '561730', name: 'Landscaping Services' },
  { code: '236220', name: 'Commercial Building Construction' },
  { code: '238210', name: 'Electrical Contractors' },
  { code: '238220', name: 'Plumbing & HVAC Contractors' },
  { code: '237310', name: 'Highway & Bridge Construction' },
  { code: '238910', name: 'Site Preparation Contractors' },
  { code: '561320', name: 'Temporary Help Services' },
  { code: '561110', name: 'Office Administrative Services' },
  { code: '541380', name: 'Testing Laboratories' },
  { code: '541712', name: 'R&D in Physical & Life Sciences' },
  { code: '541715', name: 'R&D in Social Sciences & Humanities' },
  { code: '517210', name: 'Wireless Telecommunications Carriers' },
  { code: '518210', name: 'Data Processing & Hosting Services' },
  { code: '334111', name: 'Electronic Computer Manufacturing' },
  { code: '334511', name: 'Search, Detection & Navigation Instruments' },
  { code: '336411', name: 'Aircraft Manufacturing' },
  { code: '621111', name: 'Offices of Physicians' },
  { code: '621610', name: 'Home Health Care Services' },
  { code: '624190', name: 'Other Individual & Family Services' },
];

const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'Washington DC' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

interface Opportunity {
  noticeId: string;
  title: string;
  agency: string;
  postedDate: string;
  responseDeadline: string;
  setAside?: string;
  naicsCode?: string;
}

export default function StartPage() {
  const [email, setEmail] = useState('');
  const [naicsCode, setNaicsCode] = useState('');
  const [naicsSearch, setNaicsSearch] = useState('');
  const [state, setState] = useState('');
  const [showNaicsDropdown, setShowNaicsDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loadingOpps, setLoadingOpps] = useState(false);

  const rememberPreferencesEmail = () => {
    if (email.trim()) {
      localStorage.setItem('preferences_access_email', email.trim().toLowerCase());
    }
  };

  // Filter NAICS codes based on search
  const filteredNaics = POPULAR_NAICS.filter(n =>
    n.code.includes(naicsSearch) ||
    n.name.toLowerCase().includes(naicsSearch.toLowerCase())
  );

  // Get selected NAICS name
  const selectedNaicsName = POPULAR_NAICS.find(n => n.code === naicsCode)?.name || '';

  // Fetch matching opportunities after successful signup
  const fetchOpportunities = async (naics: string, stateCode: string) => {
    setLoadingOpps(true);
    try {
      const res = await fetch(`/api/opportunities/search?naics=${naics}&state=${stateCode}&limit=5`);
      const data = await res.json();
      if (data.opportunities) {
        setOpportunities(data.opportunities.slice(0, 5));
      }
    } catch {
      console.error('Failed to fetch opportunities');
    } finally {
      setLoadingOpps(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    if (!naicsCode) {
      setError('Please select a NAICS code');
      setSubmitting(false);
      return;
    }

    if (!state) {
      setError('Please select your state');
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/alerts/save-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          naicsCodes: [naicsCode],
          businessType: null, // Will fill in later if they upgrade
          locationState: state,
          source: 'start-page',
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(true);
        // Fetch matching opportunities immediately
        fetchOpportunities(naicsCode, state);
      } else {
        setError(data.error || 'Failed to sign up. Please try again.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Success state with instant opportunities
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
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

        <main className="max-w-3xl mx-auto px-4 py-12">
          {/* Success message */}
          <div className="text-center mb-10">
            <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">You&apos;re In!</h1>
            <p className="text-slate-400">
              Check your inbox at <span className="text-white font-medium">{email}</span> for your first intel brief.
            </p>
          </div>

          {/* Instant opportunities */}
          <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Here&apos;s Your First Intel
              </h2>
              <span className="text-xs text-slate-500">
                NAICS {naicsCode} • {US_STATES.find(s => s.code === state)?.name}
              </span>
            </div>

            {loadingOpps ? (
              <div className="flex items-center justify-center py-8">
                <svg className="animate-spin h-8 w-8 text-slate-400" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            ) : opportunities.length > 0 ? (
              <div className="space-y-3">
                {opportunities.map((opp, idx) => (
                  <a
                    key={opp.noticeId || idx}
                    href={`https://sam.gov/opp/${opp.noticeId}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-slate-800/50 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 rounded-lg p-4 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-white font-medium truncate group-hover:text-emerald-400 transition-colors">
                          {opp.title}
                        </h3>
                        <p className="text-slate-500 text-sm mt-1">{opp.agency}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs text-slate-500">Deadline</div>
                        <div className="text-sm text-amber-400">{formatDate(opp.responseDeadline)}</div>
                      </div>
                    </div>
                    {opp.setAside && (
                      <span className="inline-block mt-2 text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                        {opp.setAside}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-500">
                <p>No opportunities found for your criteria right now.</p>
                <p className="text-sm mt-1">You&apos;ll receive an email when new ones are posted!</p>
              </div>
            )}
          </div>

          {/* Free tier notice + upgrade */}
          <div className="bg-gradient-to-br from-emerald-950/30 to-slate-900 border border-emerald-500/30 rounded-xl p-6 mb-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold mb-1">Free Plan: 5 Opportunities/Week</h3>
                <p className="text-slate-400 text-sm mb-3">
                  We&apos;ll send you a weekly digest with the best 5 opportunities matching your profile.
                </p>
                <Link
                  href="https://buy.stripe.com/8x24gA1oifvAcFv3OEfnO0y"
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-4 rounded-lg transition-all text-sm"
                >
                  Upgrade to Daily Alerts - $19/mo
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>

          {/* Next steps */}
          <div className="text-center space-y-3">
            <Link
              href="/alerts/preferences"
              onClick={rememberPreferencesEmail}
              className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Add more NAICS codes or adjust preferences
            </Link>
            <br />
            <Link
              href="/opportunity-hunter"
              className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search for more opportunities now
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // Signup form
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-700 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">GC</span>
            </div>
            <span className="text-white font-semibold">GovCon Giants</span>
          </Link>
          <Link href="/alerts/preferences" className="text-slate-400 hover:text-white text-sm">
            Already have an account?
          </Link>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-12">
        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-4">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            60 Seconds to Your First Intel
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">
            Get Your Free <br className="sm:hidden" />GovCon Intel Brief
          </h1>
          <p className="text-slate-400">
            5 matched opportunities every week. No credit card required.
          </p>
        </div>

        {/* Form */}
        <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-3 text-sm flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            {/* NAICS Code Dropdown */}
            <div className="relative">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                What&apos;s your primary NAICS code?
              </label>
              <div
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white cursor-pointer flex items-center justify-between hover:border-slate-600 transition-colors"
                onClick={() => setShowNaicsDropdown(!showNaicsDropdown)}
              >
                {naicsCode ? (
                  <span>
                    <span className="text-emerald-400 font-mono">{naicsCode}</span>
                    <span className="text-slate-400 ml-2">- {selectedNaicsName}</span>
                  </span>
                ) : (
                  <span className="text-slate-500">Select your NAICS code...</span>
                )}
                <svg className={`w-5 h-5 text-slate-400 transition-transform ${showNaicsDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {showNaicsDropdown && (
                <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-64 overflow-hidden">
                  <div className="p-2 border-b border-slate-700">
                    <input
                      type="text"
                      value={naicsSearch}
                      onChange={(e) => setNaicsSearch(e.target.value)}
                      placeholder="Search by code or name..."
                      className="w-full bg-slate-700 border-0 rounded px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredNaics.length > 0 ? (
                      filteredNaics.map((n) => (
                        <button
                          key={n.code}
                          type="button"
                          onClick={() => {
                            setNaicsCode(n.code);
                            setShowNaicsDropdown(false);
                            setNaicsSearch('');
                          }}
                          className={`w-full text-left px-4 py-2.5 hover:bg-slate-700 transition-colors ${naicsCode === n.code ? 'bg-emerald-500/20' : ''}`}
                        >
                          <span className="text-emerald-400 font-mono text-sm">{n.code}</span>
                          <span className="text-slate-300 ml-2 text-sm">{n.name}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-slate-500 text-sm">No matches found</div>
                    )}
                  </div>
                  <div className="p-2 border-t border-slate-700 text-center">
                    <a
                      href="https://www.census.gov/naics/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      Don&apos;t know your NAICS? Look it up →
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* State Dropdown */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                What state are you in?
              </label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent cursor-pointer"
              >
                <option value="">Select your state...</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Your email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                required
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-semibold py-4 px-6 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg shadow-lg shadow-emerald-500/20"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Setting up...
                </span>
              ) : 'Get My Free Intel →'}
            </button>

            <p className="text-slate-500 text-xs text-center">
              ✓ 5 opportunities/week &nbsp; ✓ No credit card &nbsp; ✓ Unsubscribe anytime
            </p>
          </form>
        </div>

        {/* Social proof */}
        <div className="mt-8 text-center">
          <p className="text-slate-500 text-sm mb-3">Trusted by 10,000+ government contractors</p>
          <div className="flex items-center justify-center gap-4 text-slate-400">
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            </div>
            <span className="text-sm">4.9/5 from 500+ reviews</span>
          </div>
        </div>
      </main>
    </div>
  );
}
