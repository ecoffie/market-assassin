'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function ThankYouContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get('type');

  const messages: Record<string, { emoji: string; title: string; message: string }> = {
    helpful: {
      emoji: '🎉',
      title: 'Glad it helped!',
      message: "We'll keep sending you relevant opportunities.",
    },
    not_helpful: {
      emoji: '📝',
      title: 'Thanks for letting us know',
      message: "We'll work on improving our matching algorithm.",
    },
    wrong_match: {
      emoji: '🎯',
      title: 'Thanks for the feedback',
      message: "We'll refine your opportunity matches.",
    },
    spam: {
      emoji: '📧',
      title: 'Noted',
      message: "We'll review your email preferences.",
    },
    feature_request: {
      emoji: '💡',
      title: 'Great idea!',
      message: "We've logged your suggestion for our team.",
    },
  };

  const content = messages[type || ''] || {
    emoji: '✅',
    title: 'Thank you!',
    message: 'Your feedback has been recorded.',
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl p-8 max-w-md text-center shadow-xl border border-slate-700">
        <div className="text-6xl mb-4">{content.emoji}</div>
        <h1 className="text-2xl font-bold text-white mb-2">{content.title}</h1>
        <p className="text-slate-300 mb-6">{content.message}</p>

        <div className="space-y-3">
          <a
            href="/alerts/preferences"
            className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
          >
            Update My Preferences
          </a>
          <a
            href="https://govcongiants.org"
            className="block w-full py-3 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition"
          >
            Back to GovCon Giants
          </a>
        </div>

        <p className="text-slate-500 text-sm mt-6">
          Questions? Email{' '}
          <a href="mailto:service@govcongiants.com" className="text-blue-400 hover:underline">
            service@govcongiants.com
          </a>
        </p>
      </div>
    </div>
  );
}

export default function FeedbackThanksPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <div className="text-white">Loading...</div>
        </div>
      }
    >
      <ThankYouContent />
    </Suspense>
  );
}
