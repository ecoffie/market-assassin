'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function ThanksContent() {
  const searchParams = useSearchParams();
  const rating = searchParams.get('rating');
  const isHelpful = rating === 'helpful';

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">{isHelpful ? '👍' : '👎'}</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">
          Thanks for your feedback!
        </h1>
        <p className="text-gray-400 mb-6">
          {isHelpful
            ? "We're glad the briefing was helpful. We'll keep delivering quality intel."
            : "We appreciate your honesty. We'll work to improve your briefings."}
        </p>
        <Link
          href="/briefings"
          className="inline-block py-3 px-6 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors"
        >
          View Your Briefings
        </Link>
      </div>
    </div>
  );
}

export default function FeedbackThanksPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    }>
      <ThanksContent />
    </Suspense>
  );
}
