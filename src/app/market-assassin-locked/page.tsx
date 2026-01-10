'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function MarketAssassinLockedPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleVerifyAccess = async (e: React.FormEvent) => {
    e.preventDefault();
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
        // Store in localStorage and redirect
        localStorage.setItem('marketAssassinAccess', JSON.stringify({
          hasAccess: true,
          tier: data.tier,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          email: data.email,
        }));
        window.location.href = '/federal-market-assassin';
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-5">
      <div className="bg-white rounded-2xl p-8 max-w-2xl w-full shadow-2xl">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🎯</div>
          <h1 className="text-slate-900 mb-3 text-3xl font-bold">
            Federal Market Assassin
          </h1>
          <p className="text-gray-600 text-base leading-relaxed">
            Generate comprehensive strategic reports from just 5 inputs. Choose your plan below.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Standard Plan */}
          <div className="border-2 border-blue-200 rounded-xl p-6 bg-blue-50">
            <div className="text-center mb-4">
              <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-bold rounded-full">Standard</span>
              <div className="mt-3">
                <span className="text-4xl font-bold text-slate-900">$297</span>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-slate-700 mb-6">
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Market Analytics Dashboard
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Government Buyers Report
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                OSBP Contacts Directory
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Export to CSV/HTML/PDF/JSON
              </li>
              <li className="flex items-center gap-2 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">Subcontracting Opportunities</span>
              </li>
              <li className="flex items-center gap-2 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">IDV Contracts Analysis</span>
              </li>
              <li className="flex items-center gap-2 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">Similar Awards Report</span>
              </li>
              <li className="flex items-center gap-2 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">Tribal Contracting</span>
              </li>
            </ul>
            <a
              href="https://buy.stripe.com/3cI3cw9UOdns34V84UfnO0j"
              className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-lg font-bold transition-colors"
            >
              Get Standard
            </a>
          </div>

          {/* Premium Plan */}
          <div className="border-2 border-amber-400 rounded-xl p-6 bg-gradient-to-br from-amber-50 to-orange-50 relative">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
              <span className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-full">
                BEST VALUE
              </span>
            </div>
            <div className="text-center mb-4">
              <span className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold rounded-full">Premium</span>
              <div className="mt-3">
                <span className="text-4xl font-bold text-slate-900">$497</span>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-slate-700 mb-6">
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Market Analytics Dashboard
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Government Buyers Report
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                OSBP Contacts Directory
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Export to CSV/HTML/PDF/JSON
              </li>
              <li className="flex items-center gap-2 font-medium text-amber-700">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Subcontracting Opportunities
              </li>
              <li className="flex items-center gap-2 font-medium text-amber-700">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                IDV Contracts Analysis
              </li>
              <li className="flex items-center gap-2 font-medium text-amber-700">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Similar Awards Report
              </li>
              <li className="flex items-center gap-2 font-medium text-amber-700">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Tribal Contracting
              </li>
            </ul>
            <a
              href="https://buy.stripe.com/5kQdRaeb497cfRHdpefnO0f"
              className="block w-full text-center bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black py-3 px-6 rounded-lg font-bold transition-colors"
            >
              Get Premium
            </a>
          </div>
        </div>

        {/* Already have access section */}
        <div className="border-t border-gray-200 pt-6">
          <p className="text-gray-500 text-sm mb-4 text-center">Already purchased? Enter your email to access:</p>
          <form onSubmit={handleVerifyAccess} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your purchase email"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg"
            />
            <button
              type="submit"
              disabled={loading || !email}
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '...' : 'Access'}
            </button>
          </form>
          {error && (
            <p className="text-red-600 text-sm mt-3 text-center">{error}</p>
          )}
        </div>

        <p className="text-gray-400 text-xs mt-6 text-center">
          <Link href="/" className="text-blue-600 hover:underline">
            ← Back to Home
          </Link>
        </p>
      </div>
    </div>
  );
}
