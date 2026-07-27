'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MindyLogo } from '@/components/mindy/MindyLogo';

/**
 * Forgot / set your password (getmindy.ai/forgot-password → this page).
 *
 * FIXED 2026-07-27: this page used to POST to `mindy-magic-link/request` (a passwordless SIGN-IN
 * link), which is NOT a password reset — so "forgot password" never actually reset a password.
 * It now hits `mi-password-reset/request`, which mints a Supabase RECOVERY link landing on
 * `/app/reset-password` where the user writes a new password (`updateUser`). Works whether the
 * account already had a password (reset) OR never did — OAuth / magic-link / imported accounts
 * (this is how a passwordless user SETS a password, per "every account gets a password").
 *
 * The magic-link path still exists as a secondary "just get me in" option (offer, don't force).
 */
export default function MIForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [sent, setSent] = useState<false | 'reset' | 'magic'>(false);
  const [error, setError] = useState('');

  const emailOk = () => {
    const e = email.toLowerCase().trim();
    if (!e) { setError('Enter your email address'); return null; }
    return e;
  };

  const sendReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const normalizedEmail = emailOk();
    if (!normalizedEmail) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/mi-password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) { setError(data.error || 'Unable to send the reset link'); return; }
      setSent('reset');
    } catch {
      setError('Unable to send the reset link');
    } finally {
      setIsLoading(false);
    }
  };

  // Secondary: passwordless sign-in link ("just get me in"), for users who don't want to set a password.
  const sendMagic = async () => {
    setError('');
    const normalizedEmail = emailOk();
    if (!normalizedEmail) return;
    setMagicLoading(true);
    try {
      const response = await fetch('/api/auth/mindy-magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) { setError(data.error || 'Unable to send the sign-in link'); return; }
      setSent('magic');
    } catch {
      setError('Unable to send the sign-in link');
    } finally {
      setMagicLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-surface bg-ground/70 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <MindyLogo size={56} className="mx-auto mb-5" />
          <h1 className="text-2xl font-bold text-white">Reset your password</h1>
          <p className="mt-2 text-sm text-muted">
            Enter your email and we&apos;ll send a secure link to set a new password.
            Signed up with Google or a magic link? This is how you add a password too.
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
              {sent === 'reset'
                ? 'If that email has Mindy access, a link to set a new password is on the way. Check your inbox.'
                : 'If that email has Mindy access, a sign-in link is on the way.'}
            </div>
            <Link href="/app" className="font-medium text-emerald-400 hover:text-emerald-300">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={sendReset} className="space-y-5">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full rounded-lg border border-hairline bg-surface px-4 py-3 text-white outline-none transition-colors placeholder:text-faint focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              disabled={isLoading || magicLoading}
            />
            <button
              type="submit"
              disabled={isLoading || magicLoading}
              className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white transition-colors hover:bg-emerald-500 disabled:bg-input disabled:text-muted"
            >
              {isLoading ? 'Sending reset link…' : 'Email me a link to set a password'}
            </button>
            <div className="text-center text-sm text-muted">
              Just want in?{' '}
              <button
                type="button"
                onClick={sendMagic}
                disabled={isLoading || magicLoading}
                className="font-medium text-emerald-400 hover:text-emerald-300 disabled:text-muted"
              >
                {magicLoading ? 'Sending…' : 'Email me a one-time sign-in link'}
              </button>
            </div>
            <div className="text-center">
              <Link href="/app" className="text-sm font-medium text-muted hover:text-slate-200">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
