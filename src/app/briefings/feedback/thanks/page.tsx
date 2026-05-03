'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';

// Feedback reasons with labels
const FEEDBACK_REASONS = [
  { value: 'wrong_industry', label: 'Wrong industry/NAICS codes', icon: '🏭' },
  { value: 'wrong_location', label: 'Wrong state/region', icon: '📍' },
  { value: 'too_broad', label: 'Too many irrelevant opportunities', icon: '📊' },
  { value: 'too_narrow', label: 'Not enough opportunities', icon: '🔍' },
  { value: 'irrelevant_agencies', label: 'Wrong agencies', icon: '🏛️' },
  { value: 'already_saw', label: 'Already saw these elsewhere', icon: '👀' },
  { value: 'other', label: 'Other reason', icon: '💬' },
];

function ThanksContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rating = searchParams.get('rating');
  const email = searchParams.get('email');
  const date = searchParams.get('date');
  const type = searchParams.get('type') || 'daily';
  const isHelpful = rating === 'helpful';

  // State for reason selection
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [otherComment, setOtherComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reasonSubmitted, setReasonSubmitted] = useState(false);

  // Check if we need to collect a reason (not_helpful without a reason already set)
  const needsReason = !isHelpful && email && date && !reasonSubmitted;

  const handleSubmitReason = async () => {
    if (!selectedReason || !email || !date) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/briefings/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          date,
          type,
          rating: 'not_helpful',
          reason: selectedReason,
          comment: selectedReason === 'other' ? otherComment : null,
        }),
      });

      if (response.ok) {
        setReasonSubmitted(true);
      }
    } catch (error) {
      console.error('Failed to submit reason:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">{isHelpful ? '👍' : '👎'}</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">
          {reasonSubmitted ? 'Got it!' : 'Thanks for your feedback!'}
        </h1>
        <p className="text-gray-400 mb-6">
          {isHelpful
            ? "We're glad the briefing was helpful. We'll keep delivering quality intel."
            : reasonSubmitted
              ? "We'll use this to improve your future briefings."
              : "Help us understand what went wrong so we can fix it."}
        </p>

        {/* Reason Selection for Not Helpful */}
        {needsReason && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6 text-left">
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
              <span className="text-xl">❓</span> What was the main issue?
            </h3>
            <div className="space-y-2 mb-4">
              {FEEDBACK_REASONS.map((reason) => (
                <button
                  key={reason.value}
                  onClick={() => setSelectedReason(reason.value)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                    selectedReason === reason.value
                      ? 'border-purple-500 bg-purple-500/10 text-white'
                      : 'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-600'
                  }`}
                >
                  <span className="text-lg">{reason.icon}</span>
                  <span className="text-sm">{reason.label}</span>
                  {selectedReason === reason.value && (
                    <span className="ml-auto text-purple-400">✓</span>
                  )}
                </button>
              ))}
            </div>

            {/* Other comment field */}
            {selectedReason === 'other' && (
              <textarea
                value={otherComment}
                onChange={(e) => setOtherComment(e.target.value)}
                placeholder="Tell us what we could improve..."
                className="w-full p-3 mb-4 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:border-purple-500 focus:outline-none resize-none"
                rows={3}
              />
            )}

            <button
              onClick={handleSubmitReason}
              disabled={!selectedReason || submitting}
              className="w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all"
            >
              {submitting ? 'Saving...' : 'Submit Feedback'}
            </button>
          </div>
        )}

        {/* Profile Refinement CTA - show after reason is submitted or for general not_helpful */}
        {!isHelpful && (reasonSubmitted || !needsReason) && (
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
                <span><strong className="text-white">Keywords</strong> - Add specific terms like &quot;cybersecurity&quot; or &quot;cloud&quot;</span>
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
        ) : (reasonSubmitted || !needsReason) ? (
          <Link
            href="/briefings"
            className="inline-block py-2 px-4 text-gray-400 hover:text-white text-sm transition-colors"
          >
            Skip for now
          </Link>
        ) : null}
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
