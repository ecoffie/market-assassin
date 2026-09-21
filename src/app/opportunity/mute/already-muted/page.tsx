'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function AlreadyMutedContent() {
  const searchParams = useSearchParams();
  const title = searchParams.get('title') || 'Opportunity';

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-slate-700/50 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-5xl">🔇</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-3">Already Muted</h1>

        <p className="text-slate-400 mb-2">
          <span className="text-white font-medium">{decodeURIComponent(title)}</span>
        </p>

        <p className="text-slate-500 mb-8">
          This opportunity was already hidden from your briefings.
        </p>

        <div className="space-y-3">
          <Link
            href="/briefings"
            className="block w-full bg-violet-600 hover:bg-violet-700 text-white py-3 px-6 rounded-lg font-semibold transition"
          >
            View Dashboard
          </Link>

          <p className="text-slate-500 text-sm">
            You can close this tab and return to your email.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AlreadyMutedPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-violet-400">Loading...</div>
      </div>
    }>
      <AlreadyMutedContent />
    </Suspense>
  );
}
