'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// Loading fallback for Suspense boundary
function LoadingFallback() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mx-auto mb-4 animate-pulse">
          <span className="text-white font-bold text-2xl">MI</span>
        </div>
        <p className="text-emerald-400">Redirecting to Market Intelligence...</p>
      </div>
    </div>
  );
}

// Inner component that uses useSearchParams (needs Suspense boundary)
function ContactsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const email = searchParams.get('email');
    const redirectUrl = email ? `/briefings?email=${encodeURIComponent(email)}` : '/briefings';
    router.replace(redirectUrl);
  }, [router, searchParams]);

  return <LoadingFallback />;
}

// Redirect to unified MI platform at /briefings
// Contacts is now a panel within the MI dashboard
export default function ContactsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ContactsRedirect />
    </Suspense>
  );
}
