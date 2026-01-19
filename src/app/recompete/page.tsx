'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function RecompeteLockedPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasAccess, setHasAccess] = useState(false);
  const [accessMethod, setAccessMethod] = useState<'email' | 'password'>('email');

  // Check for cached access on mount
  useEffect(() => {
    const cached = localStorage.getItem('recompeteAccess');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (data.hasAccess && data.expiresAt > Date.now()) {
          setHasAccess(true);
        }
      } catch {
        // Invalid cache, ignore
      }
    }
  }, []);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/verify-recompete-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        // Cache access for 30 days
        localStorage.setItem('recompeteAccess', JSON.stringify({
          hasAccess: true,
          email: email.toLowerCase(),
          expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000),
        }));
        setHasAccess(true);
      } else {
        setError(data.error || 'No access found for this email');
      }
    } catch {
      setError('Failed to verify access');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/verify-recompete-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (data.success) {
        // Cache access for 30 days
        localStorage.setItem('recompeteAccess', JSON.stringify({
          hasAccess: true,
          expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000),
        }));
        setHasAccess(true);
      } else {
        setError(data.error || 'Invalid password');
      }
    } catch {
      setError('Failed to verify password');
    } finally {
      setLoading(false);
    }
  };

  // If has access, show the tool
  if (hasAccess) {
    return (
      <div className="w-screen h-screen">
        <iframe
          src="/recompete.html"
          className="w-full h-full border-0"
          title="Recompete Contracts Tracker"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-900 to-orange-800 p-5">
      <div className="bg-white rounded-2xl p-10 max-w-lg text-center shadow-2xl">
        <div className="text-6xl mb-5">📋</div>
        <h1 className="text-amber-800 mb-3 text-3xl font-bold">
          Recompete Contracts Tracker
        </h1>
        <p className="text-gray-600 mb-8 text-base leading-relaxed">
          Track expiring federal contracts and identify recompete opportunities before they hit the market.
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-8 text-left">
          <h3 className="text-amber-800 mt-0 mb-3 font-semibold">What&apos;s Included:</h3>
          <ul className="text-amber-700 m-0 pl-5 leading-loose text-sm">
            <li><strong>6,900+</strong> expiring contracts</li>
            <li><strong>$77T+</strong> total contract value</li>
            <li><strong>36</strong> federal agencies</li>
            <li><strong>435</strong> NAICS codes</li>
            <li>Filter by agency, NAICS, prime contractor</li>
            <li>Contract value filtering</li>
            <li>Lifetime access</li>
          </ul>
        </div>

        <a
          href="https://buy.stripe.com/7sYfZi9UOdnsaxnbh6fnO0k"
          className="inline-block bg-amber-600 hover:bg-amber-700 text-white py-4 px-8 rounded-lg font-bold text-lg mb-4 transition-colors"
        >
          Get Access - $397
        </a>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-gray-500 text-sm mb-4">Already have access?</p>

          {/* Toggle between email and password */}
          <div className="flex justify-center gap-2 mb-4">
            <button
              onClick={() => setAccessMethod('email')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                accessMethod === 'email'
                  ? 'bg-amber-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Email
            </button>
            <button
              onClick={() => setAccessMethod('password')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                accessMethod === 'password'
                  ? 'bg-amber-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Password
            </button>
          </div>

          {accessMethod === 'email' ? (
            <form onSubmit={handleEmailSubmit} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                style={{ color: '#000000', backgroundColor: '#ffffff' }}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg"
              />
              <button
                type="submit"
                disabled={loading || !email}
                className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '...' : 'Verify'}
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="flex gap-2">
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
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
          )}

          {error && (
            <p className="text-red-600 text-sm mt-3">{error}</p>
          )}
        </div>

        <p className="text-gray-400 text-xs mt-6">
          <Link href="/" className="text-amber-600 hover:underline">
            ← Back to Home
          </Link>
        </p>
      </div>
    </div>
  );
}
