'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import { getSupabase } from '@/lib/supabase/client';

export default function MIResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [hashError, setHashError] = useState('');

  useEffect(() => {
      // Canonical is getmindy.ai. Allow getmindy.ai + mi.govcongiants.com (overlap
      // window — links sent on either host must complete) + localhost. Only a truly
      // foreign host gets redirected, now to getmindy.ai.
      const okHosts = ['getmindy.ai', 'mi.govcongiants.com', 'localhost'];
      if (!okHosts.includes(window.location.hostname)) {
        window.location.replace(`https://getmindy.ai/app/reset-password${window.location.search}${window.location.hash}`);
      return;
    }

    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : '';
    if (hash) {
      const params = new URLSearchParams(hash);
      const linkError =
        params.get('error_description') ||
        (params.get('error_code') === 'otp_expired'
          ? 'This reset link has expired. Request a new one or sign in with your password.'
          : null) ||
        params.get('error');
      if (linkError) {
        setHashError(linkError.replace(/\+/g, ' '));
        return;
      }
    }

    const supabase = getSupabase();
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setHasRecoverySession(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setHasRecoverySession(true);
      }
    });

    const loadTimeout = window.setTimeout(() => {
      setHashError((current) =>
        current ||
        'Reset session did not load. The link may have expired — request a new one or sign in at /app.'
      );
    }, 8000);

    return () => {
      window.clearTimeout(loadTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!password || !confirmPassword) {
      setError('Enter and confirm your new password');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setError('Password reset is not configured yet');
      return;
    }

    setIsLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      await supabase.auth.signOut();
      localStorage.removeItem('mi_beta_email');
      localStorage.removeItem('mi_beta_2fa_verified_at');
      localStorage.removeItem('mi_beta_2fa_token');

      setSuccess(true);
      setTimeout(() => router.push('/app?reset=success'), 1800);
    } catch {
      setError('Unable to update password. Please request a new reset link.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <MindyLogo size={56} className="mx-auto mb-5" />
          <h1 className="text-2xl font-bold text-white">Choose a new password</h1>
          <p className="mt-2 text-sm text-slate-400">
            After this, sign in again with 2FA to access Mindy.
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {success ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-center text-sm text-emerald-200">
            Password updated. Returning you to sign in...
          </div>
        ) : hashError ? (
          <div className="text-center space-y-4">
            <div className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              {hashError}
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <Link href="/app" className="font-medium text-emerald-400 hover:text-emerald-300">
                Sign in with your password instead
              </Link>
              <Link href="/forgot-password" className="text-slate-400 hover:text-slate-300">
                Request new reset link
              </Link>
            </div>
          </div>
        ) : !hasRecoverySession ? (
          <div className="text-center">
            <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              Loading your reset session...
            </div>
            <Link href="/forgot-password" className="font-medium text-emerald-400 hover:text-emerald-300">
              Request new reset link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none transition-colors placeholder:text-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              disabled={isLoading}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none transition-colors placeholder:text-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white transition-colors hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400"
            >
              {isLoading ? 'Updating password...' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
