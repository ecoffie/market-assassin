'use client';

import { useState } from 'react';
import { signInWithGoogle, signInWithMicrosoft } from '@/lib/supabase/auth';

export function MindySignupForm() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [oauthLoading, setOauthLoading] = useState<'google' | 'microsoft' | null>(null);
  const [password, setPassword] = useState('');
  // Sign in vs. create account — a toggle right here so EXISTING users
  // can get back in from the landing page WITHOUT being re-routed.
  // Defaults to 'signup' (Create account). OAuth works for both modes.
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');

  // Inline email+password sign-in — no reroute. Logs in via mindy-login,
  // stores the session token, then lands the user directly in /app
  // (Today's Intel) already authenticated.
  async function handleEmailSignin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/mindy-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), password }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) {
        setError(data?.error || 'Invalid email or password.');
        return;
      }
      if (typeof window !== 'undefined' && data.sessionToken) {
        localStorage.setItem('mi_beta_auth_token', data.sessionToken);
        if (data.authenticatedAt) localStorage.setItem('mi_beta_authenticated_at', data.authenticatedAt);
        // Land authenticated on the app — no retyping.
        window.location.href = `/app?email=${encodeURIComponent(email.toLowerCase().trim())}`;
      } else {
        // No token returned (e.g. 2FA required) — continue on /app.
        window.location.href = `/app?email=${encodeURIComponent(email.toLowerCase().trim())}`;
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignup() {
    setOauthLoading('google');
    setError('');
    const result = await signInWithGoogle();
    if (!result.success) {
      setError(result.error || 'Could not connect with Google');
      setOauthLoading(null);
    }
  }

  async function handleMicrosoftSignup() {
    setOauthLoading('microsoft');
    setError('');
    const result = await signInWithMicrosoft();
    if (!result.success) {
      setError(result.error || 'Could not connect with Microsoft');
      setOauthLoading(null);
    }
  }

  async function handleFreeSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!email || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/auth/mindy-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (data.success) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="max-w-md mx-auto mb-8 bg-emerald-500/20 border border-emerald-500/50 rounded-xl p-6">
        <p className="text-emerald-400 font-semibold text-lg mb-2">Check your inbox!</p>
        <p className="text-slate-300">We sent a link to set up your password.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mb-8 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6 sm:p-8 shadow-2xl shadow-purple-900/20">
      {/* Sign in / Create account toggle — like the /app screen. */}
      <div className="flex gap-1 mb-5 p-1 rounded-lg bg-white/5 border border-white/10">
        <button
          type="button"
          onClick={() => { setMode('signin'); setError(''); }}
          className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${
            mode === 'signin' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => { setMode('signup'); setError(''); }}
          className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${
            mode === 'signup' ? 'bg-purple-600 text-white' : 'text-slate-300 hover:text-white'
          }`}
        >
          Create free account
        </button>
      </div>
      <div className="space-y-3">
        <button
          type="button"
          onClick={handleGoogleSignup}
          disabled={oauthLoading !== null || isSubmitting}
          className="w-full inline-flex items-center justify-center gap-3 px-5 py-3.5 bg-white hover:bg-slate-50 text-slate-800 rounded-xl font-medium text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {oauthLoading === 'google' ? (
            <span className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          )}
          Continue with Google
        </button>
        <button
          type="button"
          onClick={handleMicrosoftSignup}
          disabled={oauthLoading !== null || isSubmitting}
          className="w-full inline-flex items-center justify-center gap-3 px-5 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700"
        >
          {oauthLoading === 'microsoft' ? (
            <span className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 21 21">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
          )}
          Continue with Microsoft
        </button>
      </div>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10"></div>
        </div>
        <div className="relative flex justify-center">
          <span className="px-3 bg-transparent text-slate-500 text-xs">or</span>
        </div>
      </div>

      <form onSubmit={mode === 'signin' ? handleEmailSignin : handleFreeSignup} className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          aria-label="Email address"
          autoComplete="email"
          className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500/50 text-base"
        />
        {mode === 'signin' && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            aria-label="Password"
            autoComplete="current-password"
            className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500/50 text-base"
          />
        )}
        <button
          type="submit"
          disabled={isSubmitting || oauthLoading !== null}
          className={`w-full px-5 py-3.5 text-white rounded-xl font-semibold text-base shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            mode === 'signin'
              ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20'
              : 'bg-purple-600 hover:bg-purple-500 shadow-purple-500/20'
          }`}
        >
          {mode === 'signin'
            ? 'Sign in with email'
            : isSubmitting ? 'Creating your briefing…' : 'Get Your First Briefing Free'}
        </button>
        {error && (
          <p className="text-red-400 text-sm pt-1">{error}</p>
        )}
        {mode === 'signin' ? (
          <p className="text-slate-500 text-xs text-center pt-2">
            <a href="/app/forgot-password" className="text-emerald-400 hover:text-emerald-300">Forgot password?</a>
          </p>
        ) : (
          <p className="text-slate-500 text-xs text-center pt-2">
            Free forever · No credit card required
          </p>
        )}
      </form>
    </div>
  );
}
