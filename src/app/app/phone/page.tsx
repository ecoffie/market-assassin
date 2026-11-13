'use client';

/**
 * /app/phone — the screen the Mindy phone app (mobile/, Capacitor) opens.
 *
 * The phone app is deliberately NOT the website: it signs you in, then shows two
 * tabs only — "Mindy" (the Mindy app, /app) and "Map" (the Opportunity Map), each
 * in a frame without the website's top bar (src/lib/app/phone-shell.ts). The native
 * shell keeps the app on this page, /app and the map and
 * opens every other link (pricing, forgot password, blog, outside sites) in the
 * phone's browser — see mobile/ios/App/App/AppDelegate.swift (PhoneNavPlugin) and
 * mobile/android/.../PhoneNavPlugin.java.
 *
 * Auth reuses the web app's stored session exactly (same localStorage keys as
 * /app), so the Map tab — same origin, in an iframe — is signed in too.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { storedMIEmail } from '@/components/app/authHeaders';
import { markPhoneShell } from '@/lib/app/phone-shell';

const AUTH_TOKEN_KEY = 'mi_beta_auth_token';
const TWO_FACTOR_TOKEN_KEY = 'mi_beta_2fa_token';
const APP_PATH = '/app';
const MAP_PATH = '/opportunity-map';

const noopSubscribe = () => () => {};
// /app's light theme (mi-light.css) forces a serif, regular-weight h1; the phone screen keeps the sans bold.
const H1_STYLE = { fontFamily: 'inherit', fontWeight: 700 } as const;

type Tab = 'mindy' | 'map';
type Step = 'credentials' | 'code';

function storeSession(token: string, at: string | undefined, email: string) {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem('mi_beta_authenticated_at', at || new Date().toISOString());
    localStorage.setItem('mi_beta_email', email);
  } catch { /* storage blocked — the session simply won't persist */ }
}

function clearSession() {
  try {
    for (const k of [AUTH_TOKEN_KEY, TWO_FACTOR_TOKEN_KEY, 'mi_beta_email', 'mi_beta_authenticated_at', 'mi_beta_2fa_verified_at']) {
      localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

/** fetch with a hard timeout, so a stalled request shows an error instead of spinning forever. */
async function fetchWithTimeout(input: string, init: RequestInit = {}, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export default function PhoneAppPage() {
  // false on the server and during hydration, true once in the browser — so the
  // stored session is only read where localStorage exists.
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [email, setEmail] = useState<string | null>(() => storedMIEmail());

  if (!ready) return <div className="min-h-dvh bg-[#1B3A6B]" />;
  if (!email) return <SignIn onSignedIn={setEmail} />;
  return <Signed onSignOut={() => { clearSession(); setEmail(null); }} />;
}

function SignIn({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const normalized = email.toLowerCase().trim();

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!normalized || !password || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const res = await fetchWithTimeout('/api/auth/mindy-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && data.mfaRequired) {
        setStep('code');
        setMessage(`We emailed a 6-digit code to ${normalized}.`);
        return;
      }
      if (data?.success && data.sessionToken) {
        storeSession(data.sessionToken, data.authenticatedAt, normalized);
        onSignedIn(normalized);
        return;
      }
      setError(data?.error || 'Could not sign in. Check your email and password.');
    } catch (err) {
      setError(err instanceof DOMException && err.name === 'AbortError'
        ? 'Sign-in is taking too long. Check your connection and try again.'
        : 'Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetchWithTimeout('/api/auth/two-factor/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized, code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && data.sessionToken) {
        try {
          localStorage.setItem(TWO_FACTOR_TOKEN_KEY, data.sessionToken);
          localStorage.setItem('mi_beta_2fa_verified_at', data.verifiedAt || new Date().toISOString());
        } catch { /* ignore */ }
        storeSession(data.sessionToken, data.verifiedAt, normalized);
        onSignedIn(normalized);
        return;
      }
      setError(data?.error || 'That code did not work. Try again.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const input = 'h-[50px] w-full rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] px-4 text-base text-[#0F172A] outline-none focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B]';
  const primary = 'h-[52px] w-full rounded-xl bg-[#047857] text-base font-semibold text-[#FFFFFF] disabled:bg-[#CBD5E1] disabled:text-[#64748B]';

  return (
    <main className="flex min-h-dvh flex-col bg-[#1B3A6B] font-sans">
      <div className="flex flex-col items-center justify-center gap-3 px-6 pb-10 pt-[calc(env(safe-area-inset-top)+56px)] text-[#FFFFFF]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mindy-logo-3d.png" alt="" className="h-[72px] w-[72px] rounded-2xl" />
        <h1 className="text-3xl tracking-tight" style={H1_STYLE}>Mindy</h1>
        <p className="text-[15px] text-[#C7D2E6]">Federal opportunities in your pocket</p>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 rounded-t-[28px] bg-[#FFFFFF] px-6 pb-[calc(env(safe-area-inset-bottom)+32px)] pt-7 text-[#0F172A]">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#F1F5F9] p-1" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'signin'}
            onClick={() => { setMode('signin'); setError(null); }}
            className={`h-11 rounded-lg text-[15px] ${mode === 'signin' ? 'bg-[#FFFFFF] font-semibold shadow-sm' : 'font-medium text-[#475569]'}`}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === 'create'}
            onClick={() => { setMode('create'); setError(null); }}
            className={`h-11 rounded-lg text-[15px] ${mode === 'create' ? 'bg-[#FFFFFF] font-semibold shadow-sm' : 'font-medium text-[#475569]'}`}>
            Create account
          </button>
        </div>

        {mode === 'create' ? (
          <div className="flex flex-col gap-4 pt-2">
            <p className="text-[15px] leading-relaxed text-[#334155]">
              New to Mindy? Start your account on our website. When you&apos;re set up, come back here and sign in
              with the same email and password.
            </p>
            {/* Outside /app/phone, so the phone app opens it in the browser. */}
            <a href="/pricing" className={`${primary} flex items-center justify-center`}>Create my account</a>
            <button type="button" onClick={() => setMode('signin')} className="text-sm font-medium text-[#1B3A6B]">
              I already have an account
            </button>
          </div>
        ) : step === 'code' ? (
          <form onSubmit={verifyCode} className="flex flex-col gap-3.5 pt-2">
            {message && <p className="text-sm text-[#334155]">{message}</p>}
            <label htmlFor="ph-code" className="text-[13px] font-semibold text-[#334155]">Verification code</label>
            <input id="ph-code" inputMode="numeric" autoComplete="one-time-code" value={code}
              onChange={(e) => setCode(e.target.value)} className={input} placeholder="123456" />
            {error && <p role="alert" className="text-sm text-[#B91C1C]">{error}</p>}
            <button type="submit" disabled={busy || !code.trim()} className={primary}>{busy ? 'Checking…' : 'Verify and sign in'}</button>
            <button type="button" onClick={() => { setStep('credentials'); setCode(''); setError(null); }}
              className="text-sm font-medium text-[#1B3A6B]">Back</button>
          </form>
        ) : (
          <form onSubmit={signIn} className="flex flex-col gap-3.5 pt-2">
            <label htmlFor="ph-email" className="text-[13px] font-semibold text-[#334155]">Email</label>
            <input id="ph-email" type="email" autoComplete="email" autoCapitalize="none" value={email}
              onChange={(e) => setEmail(e.target.value)} className={input} placeholder="you@company.com" />
            <label htmlFor="ph-pw" className="text-[13px] font-semibold text-[#334155]">Password</label>
            <input id="ph-pw" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} className={input} placeholder="Password" />
            {/* Outside /app/phone, so it opens in the browser; set the password there, then sign in here. */}
            <a href="/app/forgot-password" className="self-end text-sm font-medium text-[#1B3A6B]">Forgot password?</a>
            {error && <p role="alert" className="text-sm text-[#B91C1C]">{error}</p>}
            <button type="submit" disabled={busy || !normalized || !password} className={primary}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function Signed({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('mindy');
  // The map iframe is created on first visit and then kept, so switching tabs never reloads it.
  const [mapOpened, setMapOpened] = useState(false);

  // Tells /app and the map (in the frames below) to hide the website's top bar.
  useEffect(() => { markPhoneShell(); }, []);

  // Signing out inside the Mindy app (its sidebar menu) clears the stored session in a
  // frame; bring the whole phone app back to the sign-in screen when that happens.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || (e.key === AUTH_TOKEN_KEY && !e.newValue)) onSignOut();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [onSignOut]);

  return (
    <div className="flex h-dvh flex-col bg-[#FFFFFF] pt-[env(safe-area-inset-top)] font-sans text-[#0F172A]">
      <div className="relative min-h-0 flex-1">
        <iframe
          title="Mindy"
          src={APP_PATH}
          className={tab === 'mindy' ? 'h-full w-full border-0' : 'hidden'}
        />
        {mapOpened && (
          <iframe
            title="Opportunity map"
            src={MAP_PATH}
            className={tab === 'map' ? 'h-full w-full border-0' : 'hidden'}
          />
        )}
      </div>

      <nav className="grid grid-cols-2 border-t border-[#E2E8F0] bg-[#FFFFFF] pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2" aria-label="Main">
        <TabButton label="Mindy" active={tab === 'mindy'} onClick={() => setTab('mindy')}
          icon={<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />} />
        <TabButton label="Map" active={tab === 'map'} onClick={() => { setMapOpened(true); setTab('map'); }}
          icon={<><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></>} />
      </nav>
    </div>
  );
}

function TabButton({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`flex flex-col items-center gap-1 py-1.5 text-xs ${active ? 'font-semibold text-[#1B3A6B]' : 'font-medium text-[#64748B]'}`}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
      {label}
    </button>
  );
}
