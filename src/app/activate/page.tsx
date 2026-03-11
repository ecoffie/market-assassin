'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Tool {
  name: string;
  key: string;
  active: boolean;
  url: string;
}

export default function ActivatePage() {
  const [userEmail, setUserEmail] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; tools?: Tool[]; error?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: userEmail, license_key: licenseKey || undefined }),
      });

      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ success: false, error: 'Something went wrong. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full p-8 bg-gray-800 rounded-2xl">
        <div className="flex items-center justify-center mb-6">
          <span className="text-4xl mr-3">🚀</span>
          <h2 className="text-3xl font-bold text-white">Activate Your Access</h2>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block mb-2 text-gray-300">Email (from receipt)</label>
          <input
            type="email"
            id="user_email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            required
            className="w-full p-3 mb-4 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            placeholder="you@example.com"
          />

          <label className="block mb-2 text-gray-300">License Key (optional)</label>
          <input
            type="text"
            id="license_key"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
            className="w-full p-3 mb-6 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none font-mono"
            placeholder="XXXX-XXXX-XXXX-XXXX"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 py-4 rounded-xl text-white font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Activating...' : 'Activate Access'}
          </button>
        </form>

        <div id="result" className="mt-6">
          {result && (
            result.success ? (
              <div>
                <div className="bg-green-900/30 border border-green-500/50 rounded-xl p-4 mb-4">
                  <p className="text-green-400 font-medium flex items-center">
                    <span className="mr-2">✅</span>
                    Access unlocked! You have {result.tools?.length} tool{result.tools?.length !== 1 ? 's' : ''}:
                  </p>
                </div>
                <div className="space-y-3">
                  {result.tools?.map((tool) => (
                    <Link
                      key={tool.key}
                      href={tool.url}
                      className="flex items-center justify-between bg-gray-900 hover:bg-gray-700 p-4 rounded-xl transition-colors group"
                    >
                      <div>
                        <span className="text-white font-medium">{tool.name}</span>
                        <span className="block text-gray-500 text-sm">{tool.url}</span>
                      </div>
                      <span className="text-indigo-400 group-hover:translate-x-1 transition-transform">→</span>
                    </Link>
                  ))}
                </div>
                <Link
                  href="/"
                  className="block mt-6 text-center bg-gray-700 hover:bg-gray-600 py-3 rounded-xl text-white font-medium transition-colors"
                >
                  Go to Homepage
                </Link>
              </div>
            ) : (
              <div className="bg-red-900/30 border border-red-500/50 rounded-xl p-4">
                <p className="text-red-400">{result.error}</p>
              </div>
            )
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-gray-700 text-center">
          <p className="text-sm text-gray-500">
            Need help?{' '}
            <a href="mailto:support@govcongiants.com" className="text-indigo-400 hover:underline">
              support@govcongiants.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
