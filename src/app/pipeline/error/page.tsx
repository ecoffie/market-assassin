'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function ErrorContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason') || 'unknown';

  const errorMessages: Record<string, string> = {
    missing_params: 'The link was missing required information.',
    db_error: 'There was a problem saving to your pipeline.',
    unknown: 'Something went wrong. Please try again.',
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-5xl">!</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-3">Couldn&apos;t Add to Pipeline</h1>

        <p className="text-slate-400 mb-8">
          {errorMessages[reason] || errorMessages.unknown}
        </p>

        <div className="space-y-3">
          <Link
            href="/bd-assist?tab=pipeline"
            className="block w-full bg-violet-600 hover:bg-violet-700 text-white py-3 px-6 rounded-lg font-semibold transition"
          >
            Go to Pipeline
          </Link>

          <Link
            href="/briefings"
            className="block w-full bg-slate-800 hover:bg-slate-700 text-white py-3 px-6 rounded-lg font-semibold transition"
          >
            Back to Briefings
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PipelineErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-violet-400">Loading...</div>
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}
