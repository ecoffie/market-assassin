'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const errorMessages: Record<string, { title: string; message: string }> = {
  missing_params: {
    title: 'Invalid Request',
    message: 'The link appears to be incomplete. Please try clicking the button in your email again.',
  },
  db_error: {
    title: 'Service Unavailable',
    message: 'We\'re having trouble connecting to our database. Please try again in a few minutes.',
  },
  user_not_found: {
    title: 'Account Not Found',
    message: 'We couldn\'t find your account. Please set up your alert preferences first.',
  },
  save_failed: {
    title: 'Save Failed',
    message: 'We couldn\'t save this opportunity. It may have already been saved, or there was a temporary issue.',
  },
  server_error: {
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred. Our team has been notified. Please try again later.',
  },
};

function ErrorContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason') || 'server_error';
  const email = searchParams.get('email');

  const error = errorMessages[reason] || errorMessages.server_error;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 text-center">
        <div className="w-20 h-20 bg-gradient-to-br from-red-500 to-rose-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          {error.title}
        </h1>

        <p className="text-gray-600 mb-6">
          {error.message}
        </p>

        {reason === 'user_not_found' && (
          <a
            href={`/alerts/preferences${email ? `?email=${encodeURIComponent(email)}` : ''}`}
            className="inline-block bg-gradient-to-r from-purple-600 to-violet-600 text-white font-semibold px-6 py-3 rounded-lg hover:from-purple-700 hover:to-violet-700 transition-all mb-4"
          >
            Set Up Alert Preferences
          </a>
        )}

        <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
          <a
            href="/alerts/preferences"
            className="block text-purple-600 hover:text-purple-800 text-sm font-medium"
          >
            Manage Preferences
          </a>
          <a
            href="mailto:service@govcongiants.com"
            className="block text-gray-500 hover:text-gray-700 text-sm"
          >
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}

export default function PursuitBriefError() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}
