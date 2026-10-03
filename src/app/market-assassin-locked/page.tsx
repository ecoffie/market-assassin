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

      if (!response.ok) {
        console.error('API response not ok:', response.status, response.statusText);
        setError(`Server error: ${response.status}`);
        return;
      }

      const data = await response.json();
      console.log('Verify response:', data);

      if (data.hasAccess) {
        // Store in localStorage with 1 year expiry (matches server cookie)
        const accessData = {
          hasAccess: true,
          tier: data.tier,
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
          email: data.email,
        };
        localStorage.setItem('marketAssassinAccess', JSON.stringify(accessData));

        // Cookie is now set server-side in the API response
        // This ensures it's available before the redirect

        // Small delay to ensure cookie is processed by browser
        setRedirecting(true);
        await new Promise(resolve => setTimeout(resolve, 100));

        // Use window.location for full page reload to ensure cookie is sent
        window.location.href = '/federal-market-assassin';
        return;
      } else {
        setError('No access found for this email. Please purchase below.');
      }
    } catch (err) {
      console.error('Verification error:', err);
      setError('Failed to verify access. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center px-5 py-16">
      <div className="bg-(--mp-surface) border border-(--mp-line) p-8 max-w-2xl w-full">
        <div className="text-center mb-8">
          <div className="mb-4 flex items-center justify-center gap-2">
            <span className="text-2xl font-bold text-(--mp-navy)">GovCon</span>
            <span className="text-2xl font-bold text-(--mp-accent)">Giants</span>
          </div>
          <h1 className="font-(family-name:--mp-font-serif) text-(--mp-ink) mb-3 text-3xl font-bold">
            Federal Market Assassin
          </h1>
          <p className="text-(--mp-body) text-base leading-relaxed">
            Generate comprehensive strategic reports from just 5 inputs. Choose your plan below.
          </p>
        </div>

        {/* Already have access section */}
        <div className="border border-(--mp-line) p-4 mb-8 bg-(--mp-wash)">
          <p className="text-(--mp-muted) text-sm mb-3 text-center">Already purchased? Enter your email to access:</p>
          <form onSubmit={handleVerifyAccess} className="flex gap-2">
            <input
              ref={emailRef}
              type="email"
              placeholder="Enter your purchase email"
              className="flex-1 px-4 py-3 bg-(--mp-surface) border border-(--mp-line) rounded-[8px] text-(--mp-ink) placeholder:text-(--mp-subtle) focus:border-(--mp-navy)"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '...' : 'Access'}
            </button>
          </form>
          {error && (
            <p className="text-(--mp-crit) text-sm mt-3 text-center">{error}</p>
          )}
          {redirecting && (
            <p className="text-(--mp-ok) text-sm mt-3 text-center">Access verified! Redirecting...</p>
          )}
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Standard Plan */}
          <div className="border border-(--mp-line) p-6 bg-(--mp-surface)">
            <div className="text-center mb-4">
              <span className="px-3 py-1 bg-(--mp-navy-wash) text-(--mp-navy) text-sm font-bold rounded-[6px] border border-(--mp-line)">Standard</span>
              <div className="mt-3">
                <span className="font-(family-name:--mp-font-mono) text-4xl font-semibold text-(--mp-ink)">$297</span>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-(--mp-body) mb-6">
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-(--mp-ok)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Market Analytics Dashboard
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-(--mp-ok)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Government Buyers Report
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-(--mp-ok)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                OSBP Contacts Directory
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-(--mp-ok)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Export to CSV/HTML/PDF/JSON
              </li>
              <li className="flex items-center gap-2 text-(--mp-muted)">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">Subcontracting Opportunities</span>
              </li>
              <li className="flex items-center gap-2 text-(--mp-muted)">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">IDV Contracts Analysis</span>
              </li>
              <li className="flex items-center gap-2 text-(--mp-muted)">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">Similar Awards Report</span>
              </li>
              <li className="flex items-center gap-2 text-(--mp-muted)">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="line-through">Tribal Contracting</span>
              </li>
            </ul>
            <a
              href="/pricing"
              className="block w-full text-center bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white py-3 px-6 font-semibold transition-colors"
            >
              See Mindy Plans
            </a>
          </div>

          {/* Premium Plan */}
          <div className="border-2 border-(--mp-ink) p-6 bg-(--mp-surface) relative">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
              <span className="px-3 py-1 bg-(--mp-ink) text-white text-xs font-bold rounded-[6px] tracking-wide">
                BEST VALUE
              </span>
            </div>
            <div className="text-center mb-4">
              <span className="px-3 py-1 bg-(--mp-wash) text-(--mp-ink) text-sm font-bold rounded-[6px] border border-(--mp-line)">Premium</span>
              <div className="mt-3">
                <span className="font-(family-name:--mp-font-mono) text-4xl font-semibold text-(--mp-ink)">$497</span>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-(--mp-body) mb-6">
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-(--mp-ok)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Market Analytics Dashboard
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-(--mp-ok)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Government Buyers Report
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-(--mp-ok)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                OSBP Contacts Directory
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-(--mp-ok)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Export to CSV/HTML/PDF/JSON
              </li>
              <li className="flex items-center gap-2 font-medium text-(--mp-ink)">
                <svg className="w-5 h-5 text-(--mp-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Subcontracting Opportunities
              </li>
              <li className="flex items-center gap-2 font-medium text-(--mp-ink)">
                <svg className="w-5 h-5 text-(--mp-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                IDV Contracts Analysis
              </li>
              <li className="flex items-center gap-2 font-medium text-(--mp-ink)">
                <svg className="w-5 h-5 text-(--mp-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Similar Awards Report
              </li>
              <li className="flex items-center gap-2 font-medium text-(--mp-ink)">
                <svg className="w-5 h-5 text-(--mp-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Tribal Contracting
              </li>
            </ul>
            <a
              href="/pricing"
              className="block w-full text-center bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white py-3 px-6 font-semibold transition-colors"
            >
              See Mindy Plans
            </a>
          </div>
        </div>

        <p className="text-(--mp-muted) text-xs mt-6 text-center">
          <Link href="/" className="text-(--mp-navy) hover:underline">
            ← Back to Home
          </Link>
        </p>
      </div>
    </div>
  );
}
