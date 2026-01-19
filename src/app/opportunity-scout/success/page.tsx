'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SuccessContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');

    if (!sessionId) {
      setStatus('error');
      setError('No session found. Please check your email for access instructions.');
      return;
    }

    // Fetch session and grant access
    async function grantAccess() {
      try {
        const response = await fetch(`/api/stripe-session?session_id=${sessionId}&product=opportunity-scout-pro`);
        const data = await response.json();

        if (data.success && data.email) {
          setEmail(data.email);
          // Store in localStorage for immediate access
          localStorage.setItem('opportunityScoutPro', JSON.stringify({
            hasAccess: true,
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
          <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Activating your Pro access...</p>
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
            href="/opportunity-scout"
            className="block w-full px-6 py-3 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-lg transition text-center"
          >
            Go to Opportunity Hunter
          </Link>
          <p className="text-sm text-gray-500 mt-4">
            Click &quot;I Have Access&quot; and enter your purchase email
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">You&apos;re In!</h1>
        <p className="text-lg text-gray-600 mb-2">Welcome to Opportunity Hunter Pro</p>

        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-amber-800">
            Your Pro access is now active for: <br />
            <strong className="text-amber-900">{email}</strong>
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
          <h3 className="font-semibold text-gray-900 mb-3">Your Pro features:</h3>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              All agencies (not just top 10)
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Agency Pain Points & Priorities
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Market Research Tips
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              CSV Export & Print Results
            </li>
          </ul>
        </div>

        <Link
          href="/opportunity-scout"
          className="block w-full px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold rounded-lg transition text-center text-lg"
        >
          Start Finding Agencies
        </Link>

        <p className="text-sm text-gray-500 mt-4">
          A confirmation email has also been sent to {email}
        </p>
      </div>
    </div>
  );
}

export default function OpportunityScoutSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading...</p>
        </div>
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
