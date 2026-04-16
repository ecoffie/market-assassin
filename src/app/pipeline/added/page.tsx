'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function AddedContent() {
  const searchParams = useSearchParams();
  const title = searchParams.get('title') || 'Opportunity';
  const stage = searchParams.get('stage') || 'tracking';

  const stageLabels: Record<string, string> = {
    tracking: 'Tracking',
    pursuing: 'Pursuing',
    bidding: 'Bidding',
    submitted: 'Submitted',
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-5xl">✓</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-3">Added to Pipeline!</h1>

        <p className="text-slate-400 mb-2">
          <span className="text-white font-medium">{decodeURIComponent(title)}</span>
        </p>

        <p className="text-slate-500 mb-8">
          Stage: <span className="text-violet-400 font-medium">{stageLabels[stage] || stage}</span>
        </p>

        <div className="space-y-3">
          <Link
            href="/bd-assist?tab=pipeline"
            className="block w-full bg-violet-600 hover:bg-violet-700 text-white py-3 px-6 rounded-lg font-semibold transition"
          >
            View in Pipeline
          </Link>

          <p className="text-slate-500 text-sm">
            You can close this tab and return to your email.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function PipelineAddedPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-violet-400">Loading...</div>
      </div>
    }>
      <AddedContent />
    </Suspense>
  );
}
