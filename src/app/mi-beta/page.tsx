'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import UnifiedSidebarBeta, { type MIBetaPanel, type MIBetaTier } from '@/components/mi-beta/UnifiedSidebarBeta';
import PanelContainer from '@/components/mi-beta/panels';
import SettingsPanel from '@/components/briefings/SettingsPanel';

const TWO_FACTOR_SESSION_MS = 12 * 60 * 60 * 1000;
const TWO_FACTOR_TOKEN_KEY = 'mi_beta_2fa_token';
const MI_AUTH_TOKEN_KEY = 'mi_beta_auth_token';

function clearStoredMIBetaAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('mi_beta_email');
  localStorage.removeItem('mi_beta_authenticated_at');
  localStorage.removeItem('mi_beta_2fa_verified_at');
  localStorage.removeItem(MI_AUTH_TOKEN_KEY);
  localStorage.removeItem(TWO_FACTOR_TOKEN_KEY);
}

// Loading fallback
function DashboardLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Loading Mindy...</p>
      </div>
    </div>
  );
}

// Wrap in Suspense for useSearchParams
export default function MIBetaPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <MIBetaDashboard />
    </Suspense>
  );
}

function MIBetaDashboard() {
  const [email, setEmail] = useState<string | null>(null);
  const [tier, setTier] = useState<MIBetaTier>('free');
  const [activePanel, setActivePanel] = useState<MIBetaPanel>('dashboard');
  const [isLoading, setIsLoading] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [authStep, setAuthStep] = useState<'credentials' | 'code'>('credentials');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const activePanelRef = useRef<MIBetaPanel>('dashboard');
  const panelStartedAtRef = useRef<number>(Date.now());
  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const searchParams = useSearchParams();
  const resetSuccess = searchParams.get('reset') === 'success';
  const setupSuccess = searchParams.get('setup') === 'success';

  const getTwoFactorHeaders = useCallback((): Record<string, string> => {
    if (typeof window === 'undefined') return {};

    const authToken = localStorage.getItem(MI_AUTH_TOKEN_KEY);
    const twoFactorToken = localStorage.getItem(TWO_FACTOR_TOKEN_KEY);
    const headers: Record<string, string> = {};
    if (authToken) headers['x-mi-auth-token'] = authToken;
    if (twoFactorToken) headers['x-mi-2fa-token'] = twoFactorToken;
    return headers;
  }, []);

  const trackEngagement = useCallback((
    eventType: 'page_view' | 'tool_use' | 'login' | 'profile_update' | 'onboarding_step',
    metadata: Record<string, unknown>,
    options: { keepalive?: boolean; beacon?: boolean } = {}
  ) => {
    if (!email || typeof window === 'undefined') return;

    const payload = JSON.stringify({
      email,
      eventType,
      eventSource: 'market_intelligence',
      metadata: {
        ...metadata,
        session_id: sessionIdRef.current,
        path: window.location.pathname,
      },
    });

    if (options.beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/mi-beta/engagement', new Blob([payload], { type: 'application/json' }));
      return;
    }

    fetch('/api/mi-beta/engagement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: options.keepalive,
    }).catch(() => {});
  }, [email]);

  const flushPanelTime = useCallback((panel: MIBetaPanel, options: { keepalive?: boolean; beacon?: boolean } = {}) => {
    const now = Date.now();
    const durationMs = Math.max(now - panelStartedAtRef.current, 0);
    panelStartedAtRef.current = now;

    if (durationMs < 3000) return;

    trackEngagement('tool_use', {
      action: 'panel_time',
      panel,
      duration_ms: durationMs,
    }, options);
  }, [trackEngagement]);

  const loadUserProfile = useCallback(async (userEmail: string) => {
    setIsLoading(true);
    try {
      // Fetch access level
      const accessRes = await fetch(`/api/access/check?email=${encodeURIComponent(userEmail)}`, {
        headers: getTwoFactorHeaders(),
      });
      const accessData = await accessRes.json().catch(() => null);

      if (!accessRes.ok || !accessData?.success) {
        if (accessRes.status === 401) {
          clearStoredMIBetaAuth();
          setEmail(null);
          setTier('free');
          setPendingEmail(userEmail);
          setAuthError('Your MI session expired. Sign in again to restore Pro access.');
          return;
        }

        throw new Error(accessData?.error || 'Could not verify Market Intelligence access');
      }

      // Determine tier from the unified MI entitlement first.
      let userTier: MIBetaTier = 'free';
      if (['free', 'pro', 'team', 'enterprise'].includes(accessData?.tier)) {
        userTier = accessData.tier as MIBetaTier;
      } else if (accessData?.access) {
        const access = accessData.access;
        if (access.enterprise) {
          userTier = 'enterprise';
        } else if (access.team) {
          userTier = 'team';
        } else if (access.briefings || access.mi_pro) {
          userTier = 'pro';
        }
      }

      setEmail(userEmail);
      setTier(userTier);

      // Store email in localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('mi_beta_email', userEmail);
        localStorage.setItem('mi_beta_authenticated_at', new Date().toISOString());
      }
    } catch (error) {
      console.error('Failed to load user profile:', error);
    } finally {
      setIsLoading(false);
    }
  }, [getTwoFactorHeaders]);

  useEffect(() => {
    activePanelRef.current = activePanel;
  }, [activePanel]);

  useEffect(() => {
    if (!email) return;

    panelStartedAtRef.current = Date.now();
    trackEngagement('page_view', { panel: activePanel, tier });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPanelTime(activePanelRef.current, { beacon: true });
      } else {
        panelStartedAtRef.current = Date.now();
      }
    };
    const handleBeforeUnload = () => flushPanelTime(activePanelRef.current, { beacon: true });

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      flushPanelTime(activePanelRef.current, { keepalive: true });
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [email, tier, trackEngagement, flushPanelTime]);

  const handlePanelChange = useCallback((nextPanel: MIBetaPanel) => {
    if (nextPanel === activePanelRef.current) return;
    flushPanelTime(activePanelRef.current, { keepalive: true });
    activePanelRef.current = nextPanel;
    panelStartedAtRef.current = Date.now();
    setActivePanel(nextPanel);
    trackEngagement('page_view', { panel: nextPanel, tier });
  }, [flushPanelTime, tier, trackEngagement]);

  const loginWithPassword = useCallback(async (userEmail: string, password: string) => {
    const normalizedEmail = userEmail.toLowerCase().trim();
    if (!normalizedEmail || !password) {
      setAuthError('Enter your email and password');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const res = await fetch('/api/auth/mi-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      const data = await res.json();

      if (!data.success) {
        setAuthError(data.error || 'Failed to sign in');
        return;
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem(MI_AUTH_TOKEN_KEY, data.sessionToken);
        localStorage.setItem('mi_beta_authenticated_at', data.authenticatedAt);
      }

      await loadUserProfile(normalizedEmail);
    } catch (error) {
      console.error('Failed to sign in:', error);
      setAuthError('Failed to sign in');
    } finally {
      setAuthLoading(false);
    }
  }, [loadUserProfile]);

  const requestTwoFactorCode = useCallback(async (userEmail: string, password: string) => {
    const normalizedEmail = userEmail.toLowerCase().trim();
    if (!normalizedEmail || !password) {
      setAuthError('Enter your email and password');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const res = await fetch('/api/auth/two-factor/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      const data = await res.json();

      if (!data.success) {
        setAuthError(data.error || 'Failed to send verification code');
        return;
      }

      setPendingEmail(normalizedEmail);
      setAuthStep('code');
      setVerificationCode('');
      setAuthMessage(`Verification code sent to ${normalizedEmail}`);
    } catch (error) {
      console.error('Failed to request 2FA code:', error);
      setAuthError('Failed to send verification code');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const verifyTwoFactorCode = async () => {
    const normalizedEmail = pendingEmail.toLowerCase().trim();
    if (!normalizedEmail || verificationCode.length !== 6) {
      setAuthError('Enter the 6-digit verification code');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const res = await fetch('/api/auth/two-factor/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, code: verificationCode }),
      });
      const data = await res.json();

      if (!data.success) {
        setAuthError(data.error || 'Invalid verification code');
        return;
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem(TWO_FACTOR_TOKEN_KEY, data.sessionToken);
        localStorage.setItem(MI_AUTH_TOKEN_KEY, data.sessionToken);
        localStorage.setItem('mi_beta_2fa_verified_at', data.verifiedAt);
        localStorage.setItem('mi_beta_authenticated_at', data.verifiedAt);
      }

      await loadUserProfile(normalizedEmail);
    } catch (error) {
      console.error('Failed to verify 2FA code:', error);
      setAuthError('Failed to verify code');
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const isApiRequest = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
      const authToken = localStorage.getItem(MI_AUTH_TOKEN_KEY);
      const twoFactorToken = localStorage.getItem(TWO_FACTOR_TOKEN_KEY);

      if (!isApiRequest || (!authToken && !twoFactorToken)) {
        return originalFetch(input, init);
      }

      const headers = new Headers(init.headers || (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined));
      if (authToken && !headers.has('x-mi-auth-token')) {
        headers.set('x-mi-auth-token', authToken);
      }
      if (twoFactorToken && !headers.has('x-mi-2fa-token')) {
        headers.set('x-mi-2fa-token', twoFactorToken);
      }

      return originalFetch(input, { ...init, headers });
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // Load user profile on mount
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      setPendingEmail(emailParam.toLowerCase().trim());
      setIsLoading(false);
    } else {
      // Check localStorage
      const storedEmail = typeof window !== 'undefined'
        ? localStorage.getItem('mi_beta_email')
        : null;
      const verifiedAt = typeof window !== 'undefined'
        ? localStorage.getItem('mi_beta_authenticated_at') || localStorage.getItem('mi_beta_2fa_verified_at')
        : null;
      const verifiedRecently = verifiedAt
        ? Date.now() - new Date(verifiedAt).getTime() < TWO_FACTOR_SESSION_MS
        : false;
      const hasStoredToken = typeof window !== 'undefined'
        ? Boolean(localStorage.getItem(MI_AUTH_TOKEN_KEY) || localStorage.getItem(TWO_FACTOR_TOKEN_KEY))
        : false;

      if (storedEmail && verifiedRecently && hasStoredToken) {
        loadUserProfile(storedEmail);
      } else {
        clearStoredMIBetaAuth();
        setIsLoading(false);
      }
    }
  }, [searchParams, loadUserProfile]);

  // Loading state
  if (isLoading) {
    return <DashboardLoading />;
  }

  // Not logged in state
  if (!email) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
        <div className="max-w-4xl mx-auto px-6 py-16">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center mx-auto mb-6">
              <span className="text-white font-bold text-2xl">M</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Meet Mindy
            </h1>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Your AI-powered GovCon intelligence partner. Daily briefings, market research,
              forecasts, pipeline tracking, and more.
            </p>
          </div>

          {/* Email Entry */}
          <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-8 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-white mb-4 text-center">
              {authStep === 'credentials' ? 'Sign in to Mindy' : 'Enter verification code'}
            </h2>

            {resetSuccess && authStep === 'credentials' && (
              <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
                Password updated. Sign in with your new password, then complete 2FA.
              </div>
            )}
            {setupSuccess && authStep === 'credentials' && (
              <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
                Account password created. Sign in, then complete 2FA.
              </div>
            )}

            {authStep === 'credentials' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const emailValue = formData.get('email') as string;
                  const passwordValue = formData.get('password') as string;
                  loginWithPassword(emailValue, passwordValue);
                }}
                className="space-y-4"
              >
                <input
                  type="email"
                  name="email"
                  value={pendingEmail}
                  onChange={(e) => setPendingEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  autoComplete="email"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                />
                <input
                  type="password"
                  name="password"
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  placeholder="Password"
                  required
                  autoComplete="current-password"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                />
                <div className="flex items-center justify-between text-sm">
                  <Link href="/mi-beta/setup-account" className="font-medium text-slate-400 hover:text-slate-200">
                    Set up account
                  </Link>
                  <Link href="/mi-beta/forgot-password" className="text-sm font-medium text-emerald-400 hover:text-emerald-300">
                    Forgot password?
                  </Link>
                </div>
                <button
                  type="submit"
                  disabled={authLoading || !pendingEmail.trim() || !signInPassword}
                  className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-400 text-white font-medium rounded-lg transition-colors"
                >
                  {authLoading ? 'Signing in...' : 'Sign in'}
                </button>
                <button
                  type="button"
                  onClick={() => requestTwoFactorCode(pendingEmail, signInPassword)}
                  disabled={authLoading || !pendingEmail.trim() || !signInPassword}
                  className="w-full px-4 py-3 border border-slate-700 text-slate-300 hover:border-emerald-500 hover:text-emerald-300 disabled:border-slate-800 disabled:text-slate-600 font-medium rounded-lg transition-colors"
                >
                  Use optional 2FA instead
                </button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  verifyTwoFactorCode();
                }}
                className="space-y-4"
              >
                <div className="text-sm text-gray-400 text-center">
                  We sent a 6-digit code to <span className="text-white">{pendingEmail}</span>.
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  required
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-center text-2xl tracking-[0.35em] placeholder-gray-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={authLoading || verificationCode.length !== 6}
                  className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-400 text-white font-medium rounded-lg transition-colors"
                >
                  {authLoading ? 'Verifying...' : 'Verify & Access Dashboard'}
                </button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthStep('credentials');
                      setVerificationCode('');
                      setAuthError(null);
                      setAuthMessage(null);
                    }}
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Change email
                  </button>
                  <button
                    type="button"
                    onClick={() => requestTwoFactorCode(pendingEmail, signInPassword)}
                    disabled={authLoading || !signInPassword}
                    className="text-emerald-400 hover:text-emerald-300 disabled:text-gray-600 transition-colors"
                  >
                    Resend code
                  </button>
                </div>
              </form>
            )}

            {authMessage && (
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                {authMessage}
              </div>
            )}
            {authError && (
              <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {authError}
              </div>
            )}

            <p className="text-center text-gray-500 text-sm mt-4">
              Legacy dashboard:{' '}
              <a href="/briefings" className="text-emerald-400 hover:text-emerald-300">
                /briefings →
              </a>
            </p>
          </div>

          {/* Feature Preview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-16">
            {[
              { icon: '📊', title: 'AI Briefings', desc: 'Daily/Weekly/Pursuit' },
              { icon: '🎯', title: 'Market Research', desc: '10 reports' },
              { icon: '🔮', title: 'Forecasts', desc: '7,700+ opps' },
              { icon: '📈', title: 'Pipeline', desc: 'Track pursuits' },
            ].map((feature) => (
              <div
                key={feature.title}
                className="bg-gray-900/30 rounded-xl border border-gray-800 p-4 text-center"
              >
                <span className="text-2xl mb-2 block">{feature.icon}</span>
                <h3 className="text-white font-medium text-sm mb-0.5">{feature.title}</h3>
                <p className="text-gray-500 text-xs">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Logged in - show dashboard
  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Sidebar */}
      <UnifiedSidebarBeta
        activePanel={activePanel}
        onPanelChange={handlePanelChange}
        userTier={tier}
        userEmail={email}
        currentWorkspaceId={currentWorkspaceId}
        onWorkspaceChange={setCurrentWorkspaceId}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Settings Panel */}
      {email && (
        <SettingsPanel
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          email={email}
          mode={tier === 'free' ? 'alerts' : 'briefings'}
          onSaved={() => {
            loadUserProfile(email);
            setIsSettingsOpen(false);
          }}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 min-h-screen overflow-y-auto">
        {/* Top Bar */}
        <header className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">
                Logged in as <span className="text-white">{email}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`
                px-2 py-1 text-xs rounded
                ${tier === 'free' ? 'bg-slate-700 text-slate-300' : 'bg-emerald-500/20 text-emerald-400'}
              `}>
                {tier === 'free' ? 'Free' : 'Pro'} Plan
              </span>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                title="Settings & Preferences"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                onClick={() => {
                  clearStoredMIBetaAuth();
                  setEmail(null);
                  setPendingEmail('');
                  setSignInPassword('');
                  setVerificationCode('');
                  setAuthStep('credentials');
                }}
                className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Switch Account
              </button>
            </div>
          </div>
        </header>

        {/* Panel Content */}
        <PanelContainer
          activePanel={activePanel}
          email={email}
          tier={tier}
        />
      </main>
    </div>
  );
}
