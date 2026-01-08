'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function MarketAssassinLockedPage() {
  const [accessCode, setAccessCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/verify-ma-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: accessCode }),
      });

      const data = await response.json();

      if (data.success) {
        // Redirect to Market Assassin
        window.location.href = '/federal-market-assassin';
      } else {
        setError(data.error || 'Invalid access code');
      }
    } catch {
      setError('Failed to verify access code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-900 to-red-800 p-5">
      <div className="bg-white rounded-2xl p-10 max-w-lg text-center shadow-2xl">
        <div className="text-6xl mb-5">🎯</div>
        <h1 className="text-red-800 mb-3 text-3xl font-bold">
          Federal Market Assassin
        </h1>
        <p className="text-gray-600 mb-8 text-base leading-relaxed">
          Generate 8 comprehensive strategic reports from just 5 inputs. Market analytics, government buyers, subcontracting opportunities, and more.
        </p>

        <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-8 text-left">
          <h3 className="text-red-800 mt-0 mb-3 font-semibold">8 Reports Included:</h3>
          <ul className="text-red-700 m-0 pl-5 leading-loose text-sm">
            <li>Market Analytics Dashboard</li>
            <li>Government Buyers Report</li>
            <li>Subcontracting Opportunities</li>
            <li>IDV Contracts Analysis</li>
            <li>Similar Awards Report</li>
            <li>Tribal Contracting</li>
            <li>OSBP Contacts Directory</li>
            <li>Export to HTML/PDF/JSON</li>
          </ul>
        </div>

        <a
          href="https://govcongiants.lemonsqueezy.com/checkout/buy/federal-market-assassin"
          className="inline-block bg-red-600 hover:bg-red-700 text-white py-4 px-8 rounded-lg font-bold text-lg mb-4 transition-colors"
        >
          Get Access - $597
        </a>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-gray-500 text-sm mb-4">Already purchased? Enter your access code:</p>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
              placeholder="Enter access code"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-center font-mono tracking-wider uppercase"
              maxLength={24}
            />
            <button
              type="submit"
              disabled={loading || !accessCode}
              className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '...' : 'Unlock'}
            </button>
          </form>
          {error && (
            <p className="text-red-600 text-sm mt-3">{error}</p>
          )}
        </div>

        <p className="text-gray-400 text-xs mt-6">
          <Link href="/" className="text-red-600 hover:underline">
            ← Back to Home
          </Link>
        </p>
      </div>
    </div>
  );
}
