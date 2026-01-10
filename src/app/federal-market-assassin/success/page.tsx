'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

type Tier = 'standard' | 'premium';

function SuccessContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    const tierParam = searchParams.get('tier') as Tier | null;

    if (!sessionId) {
      setStatus('error');
      setError('No session found. Please check your email for access instructions.');
      return;
    }

    // Fetch session and grant access
    async function grantAccess() {
      try {
        const product = tierParam === 'premium' ? 'market-assassin-premium' : 'market-assassin-standard';
        const response = await fetch(`/api/stripe-session?session_id=${sessionId}&product=${product}`);
        const data = await response.json();

        if (data.success && data.email) {
          setEmail(data.email);
          setTier(data.tier || tierParam || 'standard');
          // Store in localStorage for immediate access
          localStorage.setItem('marketAssassinAccess', JSON.stringify({
            hasAccess: true,
            tier: data.tier || tierParam || 'standard',
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            email: data.email,
          }));
          setStatus('success');
        } else {
          setStatus('error');
          setError(data.error || 'Failed to verify purchase. Please check your email.');
        }
      } catch {
        setStatus('error');
        setError('Failed to verify purchase. Please check your email for access instructions.');
      }
    }

    grantAccess();
  }, [searchParams]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Activating your access...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Almost There!</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link
            href="/federal-market-assassin"
            className="block w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition text-center"
          >
            Go to Federal Market Assassin
          </Link>
          <p className="text-sm text-gray-500 mt-4">
            Use your purchase email to verify access
          </p>
        </div>
      </div>
    );
  }

  const isPremium = tier === 'premium';

  const standardFeatures = [
    'Standard Report',
    'Analytics Dashboard',
    'Government Buyers',
    'OSBP Contacts',
    'PDF/Print Export',
  ];

  const premiumFeatures = [
    ...standardFeatures,
    'IDV Contracts (BPAs, IDIQs, GWACs)',
    'Similar Awards Analysis',
    'Subcontracting Opportunities',
    'Tribal Contracting Partnerships',
  ];

  const features = isPremium ? premiumFeatures : standardFeatures;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">You&apos;re In!</h1>
        <p className="text-lg text-gray-600 mb-2">
          Welcome to Federal Market Assassin
          <span className={`ml-2 px-2 py-1 rounded-full text-sm font-bold ${
            isPremium
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'
              : 'bg-blue-100 text-blue-800'
          }`}>
            {isPremium ? 'Premium' : 'Standard'}
          </span>
        </p>

        <div className={`rounded-xl p-4 mb-6 ${
          isPremium
            ? 'bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200'
            : 'bg-blue-50 border border-blue-200'
        }`}>
          <p className={`text-sm ${isPremium ? 'text-amber-800' : 'text-blue-800'}`}>
            Your access is now active for: <br />
            <strong className={isPremium ? 'text-amber-900' : 'text-blue-900'}>{email}</strong>
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
          <h3 className="font-semibold text-gray-900 mb-3">Your features:</h3>
          <ul className="space-y-2 text-sm text-gray-700">
            {features.map((feature, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {!isPremium && (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 mb-6">
            <p className="text-sm text-amber-800 mb-2">
              <strong>Want more?</strong> Upgrade to Premium for IDV Contracts, Similar Awards, Subcontracting, and Tribal Contracting.
            </p>
            <a
              href="https://buy.stripe.com/5kQdRaeb497cfRHdpefnO0f"
              className="inline-block px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold rounded-lg text-sm hover:from-amber-600 hover:to-orange-600 transition"
            >
              Upgrade to Premium - $200
            </a>
          </div>
        )}

        <Link
          href="/federal-market-assassin"
          className={`block w-full px-6 py-4 font-bold rounded-lg transition text-center text-lg ${
            isPremium
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          Generate Your Report
        </Link>

        <p className="text-sm text-gray-500 mt-4">
          A confirmation email has also been sent to {email}
        </p>
      </div>
    </div>
  );
}

export default function MarketAssassinSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading...</p>
        </div>
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
