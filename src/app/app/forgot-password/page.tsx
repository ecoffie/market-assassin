'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MindyLogo } from '@/components/mindy/MindyLogo';

export default function MIForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) {
      setError('Enter your email address');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/mindy-magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Unable to send sign-in link');
        return;
      }

      setSent(true);
    } catch {
      setError('Unable to send sign-in link');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <MindyLogo size={56} className="mx-auto mb-5" />
          <h1 className="text-2xl font-bold text-white">Sign in to Mindy</h1>
          <p className="mt-2 text-sm text-slate-400">
            Enter your email and we&apos;ll send a fresh secure link.
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {sent ? (
          <div className="text-center">
            <div className="mb-6 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
              If that email has Mindy access, a sign-in link is on the way.
            </div>
            <Link href="/app" className="font-medium text-emerald-400 hover:text-emerald-300">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none transition-colors placeholder:text-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white transition-colors hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400"
            >
              {isLoading ? 'Sending sign-in link...' : 'Email me a sign-in link'}
            </button>
            <div className="text-center">
              <Link href="/app" className="text-sm font-medium text-slate-400 hover:text-slate-200">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
