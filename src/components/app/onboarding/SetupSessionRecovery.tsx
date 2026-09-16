'use client';

import { useState } from 'react';

/**
 * Shown when Complete Setup fails because the session is missing, expired, or
 * not an MI session ("Invalid two-factor session"). Entered fields stay on the
 * parent page. This signs the user in again and hands the NEW session token
 * back — it never resubmits a consumed login code as the session.
 */
export function SetupSessionRecovery({
  email,
  message,
  onRecovered,
  onUseGoogle,
}: {
  email: string;
  message: string;
  onRecovered: (sessionToken: string) => void;
  onUseGoogle?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      const res = await fetch('/api/auth/mindy-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) {
        setLocalError(data?.error || 'Could not sign in');
        return;
      }
      if (data.mfaRequired) {
        setNeedCode(true);
        setLocalError(null);
        return;
      }
      if (!data.sessionToken) {
        setLocalError('Signed in, but no session was created. Request a new code.');
        return;
      }
      onRecovered(data.sessionToken);
    } catch {
      setLocalError('Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      const res = await fetch('/api/auth/two-factor/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success || !data.sessionToken) {
        setLocalError(data?.error || 'Invalid verification code');
        return;
      }
      onRecovered(data.sessionToken);
    } catch {
      setLocalError('Could not verify that code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-50" role="alert">
      <p className="font-semibold">Your sign-in expired</p>
      <p className="mt-1 text-amber-100/90">{message}</p>
      <p className="mt-2 text-amber-100/80">
        What you entered is still on this page. Sign in again as <span className="font-medium text-white">{email}</span> and we&apos;ll save it. The code you already used cannot be reused as the session.
      </p>
      {needCode ? (
        <form onSubmit={verifyCode} className="mt-3 space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-amber-200" htmlFor="setup-recovery-code">
            Email code
          </label>
          <input
            id="setup-recovery-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(ev) => setCode(ev.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white"
            placeholder="6-digit code"
          />
          <button type="submit" disabled={busy || code.length !== 6} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">
            {busy ? 'Checking…' : 'Verify code and save'}
          </button>
        </form>
      ) : (
        <form onSubmit={signIn} className="mt-3 space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-amber-200" htmlFor="setup-recovery-password">
            Password for {email}
          </label>
          <input
            id="setup-recovery-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white"
          />
          <button type="submit" disabled={busy || !password} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">
            {busy ? 'Signing in…' : 'Sign in again to save this setup'}
          </button>
        </form>
      )}
      {onUseGoogle && (
        <button
          type="button"
          onClick={onUseGoogle}
          className="mt-3 text-sm font-medium text-white underline underline-offset-4"
        >
          Continue with Google instead
        </button>
      )}
      {localError && <p className="mt-2 text-red-200">{localError}</p>}
    </div>
  );
}
