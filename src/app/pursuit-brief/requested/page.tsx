'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function RequestedContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  const title = searchParams.get('title') || 'the opportunity';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 text-center">
        <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-violet-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          Pursuit Brief Requested!
        </h1>

        <p className="text-gray-600 mb-6">
          We're generating your personalized Pursuit Brief for <strong className="text-purple-700">{decodeURIComponent(title)}</strong>.
        </p>

        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
          <p className="text-purple-800 text-sm">
            <strong>Check your inbox!</strong><br />
            Your brief will be sent to <span className="font-mono text-purple-600">{email}</span> within the next 5-10 minutes.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Your Pursuit Brief includes:</h3>
          <ul className="text-left text-sm text-gray-600 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Win probability score with explanation</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Key evaluation criteria breakdown</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Competitive positioning analysis</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Teaming recommendations</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Go/No-Go decision framework</span>
            </li>
          </ul>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <a
            href="/alerts/preferences"
            className="text-purple-600 hover:text-purple-800 text-sm font-medium"
          >
            Manage Alert Preferences →
          </a>
        </div>
      </div>
    </div>
  );
}

export default function PursuitBriefRequested() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <RequestedContent />
    </Suspense>
  );
}
