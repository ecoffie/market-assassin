'use client';

// Path kept for already-sent email save links (save-redirect lands here).
// Pursuit Briefs were retired by product decision 2026-09-28 — this page only
// confirms the save; it must not promise a brief.

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
          Opportunity Saved
        </h1>

        <p className="text-gray-600 mb-6">
          <strong className="text-purple-700">{decodeURIComponent(title)}</strong> was saved to your watchlist{email ? <> for <span className="font-mono text-purple-600">{email}</span></> : null}.
        </p>

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
