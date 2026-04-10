'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// Redirect component that preserves email param
function RedirectToBriefings() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get('email');

  useEffect(() => {
    const url = email ? `/briefings?email=${encodeURIComponent(email)}` : '/briefings';
    router.replace(url);
  }, [email, router]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center">
          <span className="text-white font-bold text-2xl">MI</span>
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Redirecting to Market Intelligence</h1>
        <p className="text-slate-400 mb-4">Your preferences have moved to the unified dashboard</p>
        <Link
          href={email ? `/briefings?email=${encodeURIComponent(email)}` : '/briefings'}
          className="text-purple-400 hover:text-purple-300 underline"
        >
          Click here if not redirected
        </Link>
      </div>
    </div>
  );
}

export default function AlertPreferencesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    }>
      <RedirectToBriefings />
    </Suspense>
  );
}
