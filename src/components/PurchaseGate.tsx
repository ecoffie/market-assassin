'use client';

import { useState, useEffect, ReactNode } from 'react';
import Link from 'next/link';

interface PurchaseGateProps {
  productId: string;
  productName: string;
  productDescription: string;
  productIcon: string;
  regularPrice: string;
  salePrice: string;
  checkoutUrl: string;
  features: string[];
  children: ReactNode;
}

export default function PurchaseGate({
  productId,
  productName,
  productDescription,
  productIcon,
  regularPrice,
  salePrice,
  checkoutUrl,
  features,
  children,
}: PurchaseGateProps) {
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [accessEmail, setAccessEmail] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [accessError, setAccessError] = useState('');

  // Check for saved access on load
  useEffect(() => {
    const savedEmail = localStorage.getItem(`${productId}_access_email`);
    if (savedEmail) {
      checkAccess(savedEmail);
    }
  }, [productId]);

  const checkAccess = async (email: string) => {
    setCheckingAccess(true);
    setAccessError('');

    try {
      const response = await fetch('/api/verify-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, productId }),
      });

      const data = await response.json();

      if (data.hasAccess) {
        setHasAccess(true);
        localStorage.setItem(`${productId}_access_email`, email);
      } else {
        setHasAccess(false);
        setAccessError('No active purchase found for this email.');
      }
    } catch {
      setAccessError('Failed to verify access. Please try again.');
    } finally {
      setCheckingAccess(false);
    }
  };

  const checkLicenseAccess = async () => {
    if (!licenseKey.trim()) {
      setAccessError('Please enter your license key');
      return;
    }

    setCheckingAccess(true);
    setAccessError('');

    try {
      const response = await fetch('/api/verify-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey, productId }),
      });

      const data = await response.json();

      if (data.hasAccess) {
        setHasAccess(true);
        if (data.email) {
          localStorage.setItem(`${productId}_access_email`, data.email);
        }
      } else {
        setHasAccess(false);
        setAccessError('Invalid or expired license key.');
      }
    } catch {
      setAccessError('Failed to verify license. Please try again.');
    } finally {
      setCheckingAccess(false);
    }
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (accessEmail.trim()) {
      checkAccess(accessEmail.trim().toLowerCase());
    }
  };

  // If access verified, show the actual product
  if (hasAccess === true) {
    return <>{children}</>;
  }

  // Purchase gate UI
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

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Product Hero */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl shadow-2xl p-8 text-white mb-8 border-4 border-amber-500">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl">{productIcon}</span>
            <h1 className="text-3xl font-bold">{productName}</h1>
          </div>
          <p className="text-lg opacity-95 mb-6">{productDescription}</p>
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="bg-white/20 rounded-lg px-4 py-2">
              <span className="text-sm opacity-80">Value:</span>
              <span className="font-bold ml-2 line-through">{regularPrice}</span>
            </div>
            <div className="bg-amber-500 text-slate-900 rounded-lg px-4 py-2 font-bold">
              {salePrice} (Lifetime Access)
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">What You Get</h2>
          <ul className="space-y-3">
            {features.map((feature, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="text-green-500 mt-0.5">✓</span>
                <span className="text-gray-700">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Purchase CTA */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 text-center">Get Instant Access</h2>
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full px-8 py-4 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg transition-colors text-center text-lg"
          >
            Buy Now - {salePrice} (Lifetime Access)
          </a>
          <p className="text-center text-sm text-gray-500 mt-4">
            Secure checkout powered by Lemon Squeezy. Instant access after purchase.
          </p>
        </div>

        {/* Already Purchased Section */}
        <div className="bg-gray-50 rounded-xl p-8">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Already Purchased?</h3>

          <div className="space-y-6">
            {/* Email Access */}
            <div>
              <p className="text-sm text-gray-600 mb-3">Enter your purchase email to access:</p>
              <form onSubmit={handleEmailSubmit} className="flex gap-2">
                <input
                  type="email"
                  value={accessEmail}
                  onChange={(e) => setAccessEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900"
                />
                <button
                  type="submit"
                  disabled={checkingAccess}
                  className="px-6 py-2 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {checkingAccess ? 'Checking...' : 'Verify'}
                </button>
              </form>
            </div>

            {/* License Key Access */}
            <div className="border-t border-gray-200 pt-6">
              <p className="text-sm text-gray-600 mb-3">Or enter your license key:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900 font-mono"
                />
                <button
                  onClick={checkLicenseAccess}
                  disabled={checkingAccess}
                  className="px-6 py-2 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {checkingAccess ? 'Checking...' : 'Activate'}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {accessError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {accessError}
              </div>
            )}
          </div>
        </div>

        {/* Back to Home */}
        <div className="mt-8 text-center">
          <Link href="/" className="text-gray-500 hover:text-gray-700">
            ← Back to all tools
          </Link>
        </div>
      </main>
    </div>
  );
}
