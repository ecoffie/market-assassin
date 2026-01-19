'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SuccessContent() {
  const searchParams = useSearchParams();
  const [productName, setProductName] = useState('your purchase');

  useEffect(() => {
    // Get product info from URL params (set by Lemon Squeezy redirect)
    const product = searchParams.get('product');
    if (product) {
      const productNames: Record<string, string> = {
        'contractor-database': 'Contractor Database',
        'recompete-contracts': 'Recompete Contracts',
        'prime-lookup': 'Prime Lookup',
        'ai-content-generator': 'AI Content Generator',
        'starter-bundle': 'Starter Bundle',
        'pro-bundle': 'Pro Giant Bundle',
        'ultimate-bundle': 'Ultimate Giant Bundle',
        'opportunity-hunter-pro': 'Opportunity Hunter Pro',
      };
      setProductName(productNames[product] || product);
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-blue-700">GovCon</span>
              <span className="text-xl font-bold text-amber-500">Giants</span>
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Success Message */}
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="mb-6">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Purchase Successful!
            </h1>
            <p className="text-lg text-gray-600">
              Thank you for purchasing {productName}
            </p>
          </div>

          <div className="bg-blue-50 rounded-xl p-6 mb-8 text-left">
            <h2 className="font-bold text-gray-900 mb-4">What happens next:</h2>
            <ol className="space-y-3 text-gray-700">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
                <span>Check your email for your receipt and license key</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">2</span>
                <span>Use your purchase email or license key to access your tools</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">3</span>
                <span>Start winning government contracts!</span>
              </li>
            </ol>
          </div>

          <div className="space-y-4">
            <Link
              href="/"
              className="block w-full px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg transition-colors text-center"
            >
              Access Your Tools
            </Link>
            <p className="text-sm text-gray-500">
              Need help? Contact us at{' '}
              <a href="mailto:support@govcongiants.com" className="text-blue-600 hover:underline">
                support@govcongiants.com
              </a>
            </p>
          </div>
        </div>

        {/* Quick Links */}
        <div className="mt-8 bg-white rounded-xl shadow-lg p-6">
          <h3 className="font-bold text-gray-900 mb-4">Quick Access</h3>
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/contractor-database"
              className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-center text-sm transition-colors"
            >
              Contractor Database
            </Link>
            <Link
              href="/recompete-contracts"
              className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-center text-sm transition-colors"
            >
              Recompete Contracts
            </Link>
            <Link
              href="/prime-lookup"
              className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-center text-sm transition-colors"
            >
              Prime Lookup
            </Link>
            <Link
              href="/ai-content"
              className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-center text-sm transition-colors"
            >
              AI Content Generator
            </Link>
            <Link
              href="/opportunity-hunter"
              className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-center text-sm transition-colors"
            >
              Opportunity Hunter
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function PurchaseSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
