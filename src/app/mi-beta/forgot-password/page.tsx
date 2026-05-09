'use client';

import Link from 'next/link';
import { useState } from 'react';

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
      await fetch('/api/auth/mi-password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      // Always show success to avoid confirming whether an account exists.
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-xl font-bold text-white">
            MI
          </div>
          <h1 className="text-2xl font-bold text-white">Reset your MI password</h1>
          <p className="mt-2 text-sm text-slate-400">
            Enter your email and we will send a secure reset link.
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
              If an MI account exists for that email, a reset link is on the way.
            </div>
            <Link href="/mi-beta" className="font-medium text-emerald-400 hover:text-emerald-300">
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
              {isLoading ? 'Sending reset link...' : 'Send reset link'}
            </button>
            <div className="text-center">
              <Link href="/mi-beta" className="text-sm font-medium text-slate-400 hover:text-slate-200">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
