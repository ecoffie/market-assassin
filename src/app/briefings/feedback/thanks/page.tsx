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
            : "We appreciate your honesty. Let's make your briefings more relevant."}
        </p>

        {/* Profile Refinement CTA for Not Helpful */}
        {!isHelpful && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6 text-left">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <span className="text-xl">🎯</span> Refine Your Profile
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              Better briefings start with a focused profile. Take 2 minutes to update:
            </p>
            <ul className="text-sm text-gray-400 space-y-2 mb-4">
              <li className="flex items-start gap-2">
                <span className="text-purple-400 mt-0.5">1.</span>
                <span><strong className="text-white">NAICS Codes</strong> - Focus on your top 3-5 codes</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400 mt-0.5">2.</span>
                <span><strong className="text-white">Keywords</strong> - Add specific terms like "cybersecurity" or "cloud"</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400 mt-0.5">3.</span>
                <span><strong className="text-white">Agencies</strong> - Select the agencies you want to target</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400 mt-0.5">4.</span>
                <span><strong className="text-white">Location</strong> - Set your state/region for local opps</span>
              </li>
            </ul>
            <Link
              href="/briefings"
              className="inline-flex items-center justify-center w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white font-semibold rounded-lg transition-all"
            >
              <span className="mr-2">⚙️</span> Update My Preferences
            </Link>
          </div>
        )}

        {isHelpful ? (
          <Link
            href="/briefings"
            className="inline-block py-3 px-6 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors"
          >
            View Your Briefings
          </Link>
        ) : (
          <Link
            href="/briefings"
            className="inline-block py-2 px-4 text-gray-400 hover:text-white text-sm transition-colors"
          >
            Skip for now
          </Link>
        )}
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
