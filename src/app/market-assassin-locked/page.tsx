'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function MarketAssassinLockedPage() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [redirecting, setRedirecting] = useState(false);

  const handleVerifyAccess = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const email = emailRef.current?.value?.trim() || '';

    if (!email) {
      setError('Please enter your email');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/verify-ma-tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.hasAccess) {
        // Store in localStorage
        const accessData = {
          hasAccess: true,
          tier: data.tier,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          email: data.email,
        };
        localStorage.setItem('marketAssassinAccess', JSON.stringify(accessData));

        // Set cookie for middleware (expires in 24 hours)
        document.cookie = `ma_access_email=${data.email}; path=/; max-age=86400; SameSite=Lax`;

        // Redirect to the app
        setRedirecting(true);
        router.push('/federal-market-assassin');
        return;
      } else {
        setError('No access found for this email. Please purchase below.');
      }
    } catch {
      setError('Failed to verify access');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-5">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-2xl w-full shadow-2xl">
        <div className="text-center mb-8">
          <div className="mb-4 flex items-center justify-center gap-2">
            <span className="text-2xl font-bold text-blue-400">GovCon</span>
            <span className="text-2xl font-bold text-amber-400">Giants</span>
          </div>
          <h1 className="text-slate-100 mb-3 text-3xl font-bold">
            Federal Market Assassin
          </h1>
          <p className="text-slate-400 text-base leading-relaxed">
            Generate comprehensive strategic reports from just 5 inputs. Choose your plan below.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Standard Plan */}
          <div className="border border-blue-500/30 rounded-xl p-6 bg-slate-900/50 card-hover">
            <div className="text-center mb-4">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-400 text-sm font-bold rounded-full border border-blue-500/30">Standard</span>
              <div className="mt-3">
                <span className="text-4xl font-bold text-slate-100">$297</span>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-slate-300 mb-6">
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Market Analytics Dashboard
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Government Buyers Report
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                OSBP Contacts Directory
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Export to CSV/HTML/PDF/JSON
              </li>
              <li className="flex items-center gap-2 text-slate-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">Subcontracting Opportunities</span>
              </li>
              <li className="flex items-center gap-2 text-slate-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">IDV Contracts Analysis</span>
              </li>
              <li className="flex items-center gap-2 text-slate-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">Similar Awards Report</span>
              </li>
              <li className="flex items-center gap-2 text-slate-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">Tribal Contracting</span>
              </li>
            </ul>
            <a
              href="https://buy.stripe.com/3cI3cw9UOdns34V84UfnO0j"
              className="block w-full text-center bg-blue-500 hover:bg-blue-600 text-white py-3 px-6 rounded-lg font-bold transition-all glow-blue"
            >
              Get Standard
            </a>
          </div>

          {/* Premium Plan */}
          <div className="border border-amber-500/50 rounded-xl p-6 bg-gradient-to-br from-amber-500/10 to-orange-500/10 relative card-hover">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
              <span className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-full">
                BEST VALUE
              </span>
            </div>
            <div className="text-center mb-4">
              <span className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold rounded-full">Premium</span>
              <div className="mt-3">
                <span className="text-4xl font-bold text-slate-100">$497</span>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-slate-300 mb-6">
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Market Analytics Dashboard
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Government Buyers Report
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                OSBP Contacts Directory
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Export to CSV/HTML/PDF/JSON
              </li>
              <li className="flex items-center gap-2 font-medium text-amber-400">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Subcontracting Opportunities
              </li>
              <li className="flex items-center gap-2 font-medium text-amber-400">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                IDV Contracts Analysis
              </li>
              <li className="flex items-center gap-2 font-medium text-amber-400">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Similar Awards Report
              </li>
              <li className="flex items-center gap-2 font-medium text-amber-400">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Tribal Contracting
              </li>
            </ul>
            <a
              href="https://buy.stripe.com/5kQdRaeb497cfRHdpefnO0f"
              className="block w-full text-center bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black py-3 px-6 rounded-lg font-bold transition-all"
            >
              Get Premium
            </a>
          </div>
        </div>

        {/* Already have access section */}
        <div className="border-t border-slate-700 pt-6">
          <p className="text-slate-400 text-sm mb-4 text-center">Already purchased? Enter your email to access:</p>
          <form onSubmit={handleVerifyAccess} className="flex gap-2">
            <input
              ref={emailRef}
              type="email"
              placeholder="Enter your purchase email"
              className="flex-1 px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all glow-blue"
            >
              {loading ? '...' : 'Access'}
            </button>
          </form>
          {error && (
            <p className="text-red-400 text-sm mt-3 text-center">{error}</p>
          )}
        </div>

        <p className="text-slate-500 text-xs mt-6 text-center">
          <Link href="/" className="text-blue-400 hover:text-blue-300">
            ← Back to Home
          </Link>
        </p>
      </div>
    </div>
  );
}
