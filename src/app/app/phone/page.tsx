'use client';

/**
 * /app/phone — the screen the Mindy phone app (mobile/, Capacitor) opens.
 *
 * The phone app is deliberately NOT the website: it signs you in, then shows two
 * tabs only — "Mindy" (today's matches from your saved profile) and "Map" (the
 * Opportunity Map). The native shell keeps the app on this page and the map and
 * opens every other link (pricing, forgot password, blog, outside sites) in the
 * phone's browser — see mobile/ios/App/App/AppDelegate.swift (PhoneNavPlugin) and
 * mobile/android/.../PhoneNavPlugin.java.
 *
 * Auth reuses the web app's stored session exactly (same localStorage keys as
 * /app), so the Map tab — same origin, in an iframe — is signed in too.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getMIApiHeaders, storedMIEmail } from '@/components/app/authHeaders';

const AUTH_TOKEN_KEY = 'mi_beta_auth_token';
const TWO_FACTOR_TOKEN_KEY = 'mi_beta_2fa_token';
const MAP_PATH = '/opportunity-map';

const noopSubscribe = () => () => {};
// /app's light theme (mi-light.css) forces a serif, regular-weight h1; the phone screen keeps the sans bold.
const H1_STYLE = { fontFamily: 'inherit', fontWeight: 700 } as const;

type Tab = 'mindy' | 'map';
type Step = 'credentials' | 'code';

interface Opp {
  notice_id: string;
  title: string;
  department: string;
  sub_tier: string | null;
  notice_type: string | null;
  pop_city: string | null;
  pop_state: string | null;
  days_until_deadline: number | null;
}

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

function dueLabel(days: number | null): string {
  if (days === null || days === undefined) return 'No due date listed';
  if (days < 0) return 'Past due';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
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
  return <Signed email={email} onSignOut={() => { clearSession(); setEmail(null); }} />;
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

function Signed({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('mindy');
  const [mapSrc, setMapSrc] = useState(MAP_PATH);
  // The map iframe is created on first visit and then kept, so switching tabs never reloads it.
  const [mapOpened, setMapOpened] = useState(false);

  const openMap = useCallback((noticeId?: string) => {
    if (noticeId) setMapSrc(`${MAP_PATH}?opp=${encodeURIComponent(noticeId)}`);
    setMapOpened(true);
    setTab('map');
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-[#F1F5F9] font-sans text-[#0F172A]">
      <div className="relative min-h-0 flex-1">
        <div className={tab === 'mindy' ? 'h-full' : 'hidden'}>
          <MindyTab email={email} onOpenMap={openMap} onSignOut={onSignOut} />
        </div>
        {mapOpened && (
          <iframe
            title="Opportunity map"
            src={mapSrc}
            className={tab === 'map' ? 'h-full w-full border-0' : 'hidden'}
          />
        )}
      </div>

      <nav className="grid grid-cols-2 border-t border-[#E2E8F0] bg-[#FFFFFF] pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2" aria-label="Main">
        <TabButton label="Mindy" active={tab === 'mindy'} onClick={() => setTab('mindy')}
          icon={<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />} />
        <TabButton label="Map" active={tab === 'map'} onClick={() => openMap()}
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

function MindyTab({ email, onOpenMap, onSignOut }: { email: string; onOpenMap: (noticeId?: string) => void; onSignOut: () => void }) {
  const [opps, setOpps] = useState<Opp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closingSoon, setClosingSoon] = useState(false);

  const load = useCallback(async () => {
    setOpps(null); setError(null);
    const params = new URLSearchParams({ email, limit: '25', sort: 'soonest' });
    if (closingSoon) params.set('urgency', 'urgent');
    try {
      const res = await fetchWithTimeout(`/api/mi-dashboard?${params}`, { headers: getMIApiHeaders(email) });
      if (res.status === 401 || res.status === 403) { onSignOut(); return; }
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Could not load');
      setOpps(Array.isArray(data.opportunities) ? data.opportunities : []);
    } catch {
      // Unknown is not zero: say it failed, never show "0 matches".
      setError('Could not load your matches. Tap Retry.');
    }
  }, [email, closingSoon, onSignOut]);

  useEffect(() => { load(); }, [load]);

  const chip = (on: boolean) => `rounded-full px-3.5 py-2 text-[13px] ${on ? 'bg-[#1B3A6B] font-semibold text-[#FFFFFF]' : 'border border-[#CBD5E1] bg-[#FFFFFF] font-medium text-[#334155]'}`;

  return (
    <div className="h-full overflow-y-auto">
      <header className="bg-[#1B3A6B] px-5 pb-5 pt-[calc(env(safe-area-inset-top)+20px)] text-[#FFFFFF]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[26px]" style={H1_STYLE}>Today&apos;s matches</h1>
            <p className="text-sm text-[#C7D2E6]">Based on your saved profile</p>
          </div>
          <button type="button" onClick={onSignOut} className="mt-1 rounded-lg border border-[#FFFFFF4D] px-3 py-1.5 text-xs font-medium">
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex gap-2">
          <button type="button" onClick={() => setClosingSoon(false)} className={chip(!closingSoon)}>Open now</button>
          <button type="button" onClick={() => setClosingSoon(true)} className={chip(closingSoon)}>Closing soon</button>
        </div>

        {error && (
          <div className="rounded-xl bg-[#FFFFFF] p-4 text-sm text-[#334155]">
            <p>{error}</p>
            <button type="button" onClick={load} className="mt-3 h-10 rounded-lg bg-[#1B3A6B] px-4 font-semibold text-[#FFFFFF]">Retry</button>
          </div>
        )}
        {!error && opps === null && <p className="py-8 text-center text-sm text-[#64748B]">Loading your matches…</p>}
        {!error && opps?.length === 0 && (
          <p className="rounded-xl bg-[#FFFFFF] p-4 text-sm text-[#334155]">
            No open opportunities match your profile right now. Try the Map tab to search everything.
          </p>
        )}

        {opps?.map((o) => (
          <article key={o.notice_id} className="flex flex-col gap-2 rounded-2xl bg-[#FFFFFF] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold">
              <span className="rounded-md bg-[#ECFDF5] px-2 py-1 text-[#065F46]">{o.notice_type || 'Notice'}</span>
              <span className="text-[#92400E]">{dueLabel(o.days_until_deadline)}</span>
            </div>
            <h2 className="text-base font-semibold leading-snug">{o.title}</h2>
            <p className="text-[13px] text-[#475569]">
              {o.sub_tier || o.department}
              {o.pop_state ? ` · ${[o.pop_city, o.pop_state].filter(Boolean).join(', ')}` : ''}
            </p>
            <button type="button" onClick={() => onOpenMap(o.notice_id)}
              className="mt-1 h-11 rounded-xl bg-[#1B3A6B] text-sm font-semibold text-[#FFFFFF]">
              View details on map
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
