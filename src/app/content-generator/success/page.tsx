'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SuccessContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [tier, setTier] = useState<string>('content-engine');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    const product = searchParams.get('product') || 'content-engine';

    if (!sessionId) {
      setStatus('error');
      setError('No session found. Please check your email for access instructions.');
      return;
    }

    // Fetch session and grant access
    async function grantAccess() {
      try {
        const response = await fetch(`/api/stripe-session?session_id=${sessionId}&product=${product}`);
        const data = await response.json();

        if (data.success && data.email) {
          setEmail(data.email);
          setTier(data.tier || 'content-engine');
          // Store tier in localStorage for immediate access
          localStorage.setItem('gcg_tier', data.tier || 'content-engine');
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
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Activating your Content Reaper access...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-indigo-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Almost There!</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link
            href="/content-generator"
            className="block w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition text-center"
          >
            Go to Content Reaper
          </Link>
          <p className="text-sm text-gray-500 mt-4">
            Log in with your purchase email to access
          </p>
        </div>
      </div>
    );
  }

  const isFullFix = tier === 'full-fix';
  const tierName = isFullFix ? 'Full Fix' : 'Content Engine';

  const features = isFullFix ? [
    'Unlimited LinkedIn post generation',
    'AI graphics generation',
    'Post scheduling & calendar',
    'Brand colors customization',
    'Priority support',
  ] : [
    '100 posts/day generation',
    'Real-time agency spending data',
    '15 content templates',
    'Company personalization',
    'Hashtag optimization',
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">You&apos;re In!</h1>
        <p className="text-lg text-gray-600 mb-2">Welcome to Content Reaper</p>
        <p className="text-sm font-semibold text-blue-600 mb-4">{tierName} Access</p>

        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-blue-800">
            Your access is now active for: <br />
            <strong className="text-blue-900">{email}</strong>
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
          <h3 className="font-semibold text-gray-900 mb-3">Your {tierName} features:</h3>
          <ul className="space-y-2 text-sm text-gray-700">
            {features.map((feature, i) => (
              <li key={i} className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <Link
          href="/content-generator"
          className="block w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-lg transition text-center text-lg"
        >
          Start Generating Content
        </Link>

        <p className="text-sm text-gray-500 mt-4">
          A confirmation email has also been sent to {email}
        </p>
      </div>
    </div>
  );
}

export default function ContentGeneratorSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading...</p>
        </div>
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
