'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function DatabaseLockedPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/verify-db-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (data.success) {
        window.location.href = '/database.html';
      } else {
        setError(data.error || 'Invalid password');
      }
    } catch {
      setError('Failed to verify password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-800 p-5">
      <div className="bg-white rounded-2xl p-10 max-w-lg text-center shadow-2xl">
        <div className="text-6xl mb-5">🔒</div>
        <h1 className="text-blue-800 mb-3 text-3xl font-bold">
          Federal Contractor Database
        </h1>
        <p className="text-gray-600 mb-8 text-base leading-relaxed">
          Access to this database requires a password. Get lifetime access to 3,500+ federal contractors for teaming opportunities.
        </p>

        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-8 text-left">
          <h3 className="text-green-800 mt-0 mb-3 font-semibold">What&apos;s Included:</h3>
          <ul className="text-green-700 m-0 pl-5 leading-loose text-sm">
            <li><strong>3,500+</strong> federal contractors</li>
            <li><strong>$430B+</strong> in contract data</li>
            <li><strong>800+</strong> SBLO contacts with emails</li>
            <li><strong>115+</strong> supplier portal links</li>
            <li>Export to CSV for outreach</li>
            <li>Lifetime access</li>
          </ul>
        </div>

        <a
          href="https://buy.stripe.com/4gMaEY3wqcjo6h70CsfnO0g"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white py-4 px-8 rounded-lg font-bold text-lg mb-4 transition-colors"
        >
          Get Access - $497
        </a>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-gray-500 text-sm mb-4">Already have access? Enter your email:</p>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="email"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="your@email.com"
              style={{ color: '#000000', backgroundColor: '#ffffff' }}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-center"
            />
            <button
              type="submit"
              disabled={loading || !password}
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
          <Link href="/" className="text-blue-600 hover:underline">
            ← Back to Home
          </Link>
        </p>
      </div>
    </div>
  );
}
