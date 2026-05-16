'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase/client';

export default function MISetupPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasSetupSession, setHasSetupSession] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (window.location.hostname !== 'getmindy.ai' && window.location.hostname !== 'localhost') {
      window.location.replace(`https://getmindy.ai/app/setup-password${window.location.search}${window.location.hash}`);
      return;
    }

    const supabase = getSupabase();
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setHasSetupSession(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setHasSetupSession(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!password || !confirmPassword) {
      setError('Enter and confirm your password');
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
      setError('Account setup is not configured yet');
      return;
    }

    setIsLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('Password created, but we could not verify your session. Please sign in to continue.');
        return;
      }

      const completeRes = await fetch('/api/auth/mindy-complete-signup', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!completeRes.ok) {
        setError('Password created, but we could not finish account setup. Please sign in to continue.');
        return;
      }

      localStorage.removeItem('mi_beta_email');
      localStorage.removeItem('mi_beta_2fa_verified_at');
      localStorage.removeItem('mi_beta_2fa_token');

      setSuccess(true);
      setTimeout(() => router.push('/app/onboarding?setup=success'), 1000);
    } catch {
      setError('Unable to set password. Please request a new setup link.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 text-xl font-bold text-white">
            M
          </div>
          <h1 className="text-2xl font-bold text-white">Create your Mindy password</h1>
          <p className="mt-2 text-sm text-slate-400">
            After this, finish your profile so Mindy can tailor your opportunities.
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {success ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-center text-sm text-emerald-200">
            Password created. Taking you to onboarding...
          </div>
        ) : !hasSetupSession ? (
          <div className="text-center">
            <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              Loading your setup session. If this does not change, request a new setup link.
            </div>
            <Link href="/setup-account" className="font-medium text-emerald-400 hover:text-emerald-300">
              Request new setup link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none transition-colors placeholder:text-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              disabled={isLoading}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none transition-colors placeholder:text-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white transition-colors hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400"
            >
              {isLoading ? 'Creating password...' : 'Create password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
