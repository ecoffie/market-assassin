'use client';

import { useCallback, useEffect, useState } from 'react';
import { signInWithGoogle, signInWithMicrosoft } from '@/lib/supabase/auth';
import { oauthCallbackUrl, MINDY_OAUTH_NEXT_KEY } from '@/lib/mindy/oauth-callback';
import { postSignupPath } from '@/lib/mindy/post-signup-destination';
import { MI_AUTH_TOKEN_KEY } from '@/lib/mindy/stored-app-auth';

function oauthCallback(next: string) {
  try {
    sessionStorage.setItem(MINDY_OAUTH_NEXT_KEY, next);
  } catch { /* private mode */ }
  const dest = oauthCallbackUrl(window.location.origin, {
    next,
    intent: next.startsWith('/mcp') ? 'mcp' : null,
  });
  if (!dest.includes('/auth/callback') || dest.includes('/app')) {
    throw new Error('OAuth redirectTo must be /auth/callback');
  }
  return dest;
}

export default function SignInClient({
  next,
  initialEmail,
  startSignup,
  startMfa,
  startOauth,
  startForgot,
  startSetup,
}: {
  next: string;
  initialEmail: string;
  startSignup: boolean;
  startMfa: boolean;
  startOauth: 'google' | 'microsoft' | null;
  startForgot: boolean;
  startSetup: boolean;
}) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'mfa'>(startMfa ? 'mfa' : startSignup ? 'signup' : 'signin');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<'google' | 'microsoft' | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    if (startForgot) {
      window.location.href = `/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`;
    }
  }, [startForgot, email]);

  useEffect(() => {
    if (startSetup) {
      window.location.href = `/setup-account${email ? `?email=${encodeURIComponent(email)}` : ''}`;
    }
  }, [startSetup, email]);

  const startOAuth = useCallback(async (provider: 'google' | 'microsoft') => {
    setOauthBusy(provider);
    setError(null);
    const result = provider === 'google'
      ? await signInWithGoogle(oauthCallback(next))
      : await signInWithMicrosoft(oauthCallback(next));
    if (!result.success) {
      setError(result.error || 'Could not connect');
      setOauthBusy(null);
    }
  }, [next]);

  useEffect(() => {
    if (startOauth) void startOAuth(startOauth);
  }, [startOauth, startOAuth]);

  async function afterSession(sessionEmail: string, token: string, authenticatedAt?: string) {
    try {
      localStorage.setItem(MI_AUTH_TOKEN_KEY, token);
      if (authenticatedAt) localStorage.setItem('mi_beta_authenticated_at', authenticatedAt);
      localStorage.setItem('mi_beta_email', sessionEmail);
    } catch { /* private mode */ }
    let dest = next;
    try {
      const res = await fetch(`/api/access/check?email=${encodeURIComponent(sessionEmail)}`, {
        headers: { 'x-mi-auth-token': token },
      });
      const j = await res.json().catch(() => null);
      if (j?.needsOnboarding) {
        dest = postSignupPath({ next, intent: next.startsWith('/mcp') ? 'mcp' : null });
      }
    } catch { /* keep next */ }
    window.location.href = dest;
  }

  async function onPasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNeedsSetup(false);
    try {
      const res = await fetch('/api/auth/mindy-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.success) {
        setNeedsSetup(Boolean(d?.needsAccountSetup));
        setError(d?.error || 'Could not sign in');
        return;
      }
      if (d.mfaRequired) {
        setMode('mfa');
        setMessage(`For your security, we sent a verification code to ${email.trim().toLowerCase()}`);
        return;
      }
      if (!d.sessionToken) {
        setError('Sign-in succeeded but no session was issued. Try again.');
        return;
      }
      await afterSession(d.email || email.trim().toLowerCase(), d.sessionToken, d.authenticatedAt);
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyMfa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/two-factor/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.replace(/\D/g, '') }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.success || !d.sessionToken) {
        setError(d?.error || 'Invalid verification code');
        return;
      }
      await afterSession(d.email || email.trim().toLowerCase(), d.sessionToken, d.verifiedAt);
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mindy-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), name: name.trim(), next }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.success) {
        setError(d?.error || 'Could not create your account');
        return;
      }
      setMessage('Check your email for a secure setup link. When you finish, you will return here.');
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#0a0f1e] px-6 text-slate-100 [color-scheme:dark]">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-400 text-lg font-bold text-[#0a0f1e]">M</div>
          <h1 className="text-xl font-semibold">
            {mode === 'signup' ? 'Create your free Mindy account' : mode === 'mfa' ? 'Enter verification code' : 'Sign in to Mindy'}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            One Mindy account. After this you can connect Claude or ChatGPT without signing in again.
          </p>
        </div>

        {mode === 'signin' && (
          <form onSubmit={onPasswordSignIn} className="space-y-3">
            <label className="block text-[12px] font-semibold text-slate-400">Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required className="mt-1 w-full rounded-xl border border-white/10 bg-[#0b1120] px-3 py-2.5 text-sm text-slate-100" />
            </label>
            <label className="block text-[12px] font-semibold text-slate-400">Password
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required className="mt-1 w-full rounded-xl border border-white/10 bg-[#0b1120] px-3 py-2.5 text-sm text-slate-100" />
            </label>
            {error && <p className="text-sm text-rose-300">{error}</p>}
            {needsSetup && (
              <a href={`/setup-account?email=${encodeURIComponent(email)}`} className="block text-sm text-emerald-300 underline">Set up my account</a>
            )}
            <button disabled={busy} type="submit" className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400 disabled:opacity-60">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <a href={`/forgot-password?email=${encodeURIComponent(email)}`} className="block text-center text-[12px] text-slate-400 hover:text-slate-200">Forgot password?</a>
            <button type="button" onClick={() => { setMode('signup'); setError(null); }} className="block w-full text-center text-[13px] text-slate-300">
              New to Mindy? Create a free account
            </button>
          </form>
        )}

        {mode === 'mfa' && (
          <form onSubmit={onVerifyMfa} className="space-y-3">
            {message && <p className="text-sm text-emerald-200">{message}</p>}
            <label className="block text-[12px] font-semibold text-slate-400">6-digit code
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required className="mt-1 w-full rounded-xl border border-white/10 bg-[#0b1120] px-3 py-2.5 text-sm text-slate-100" />
            </label>
            {error && <p className="text-sm text-rose-300">{error}</p>}
            <button disabled={busy} type="submit" className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400 disabled:opacity-60">
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={onSignup} className="space-y-3">
            <label className="block text-[12px] font-semibold text-slate-400">Name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1 w-full rounded-xl border border-white/10 bg-[#0b1120] px-3 py-2.5 text-sm text-slate-100" />
            </label>
            <label className="block text-[12px] font-semibold text-slate-400">Work email
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required className="mt-1 w-full rounded-xl border border-white/10 bg-[#0b1120] px-3 py-2.5 text-sm text-slate-100" />
            </label>
            {error && <p className="text-sm text-rose-300">{error}</p>}
            {message && <p className="text-sm text-emerald-200">{message}</p>}
            <button disabled={busy} type="submit" className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400 disabled:opacity-60">
              {busy ? 'Creating…' : 'Create free account'}
            </button>
            <button type="button" onClick={() => { setMode('signin'); setError(null); }} className="block w-full text-center text-[13px] text-slate-300">
              Already have an account? Sign in
            </button>
          </form>
        )}

        {mode !== 'mfa' && (
          <div className="mt-5 space-y-2">
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-500">
              <span className="h-px flex-1 bg-white/10" />or<span className="h-px flex-1 bg-white/10" />
            </div>
            <button type="button" disabled={!!oauthBusy} onClick={() => void startOAuth('google')} className="w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-white/5">
              {oauthBusy === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </button>
            <button type="button" disabled={!!oauthBusy} onClick={() => void startOAuth('microsoft')} className="w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-white/5">
              {oauthBusy === 'microsoft' ? 'Redirecting…' : 'Continue with Microsoft'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
