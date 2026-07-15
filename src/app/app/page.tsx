'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import UnifiedSidebar, { type AppPanel, type AppTier } from '@/components/app/UnifiedSidebar';
import GlobalLookup from '@/components/app/GlobalLookup';
import ProductTour from '@/components/app/ProductTour';
import PanelContainer from '@/components/app/panels';
import ClientWorkspaceBanner from '@/components/app/ClientWorkspaceBanner';
import CapabilityNudge from '@/components/app/CapabilityNudge';
import { reconcileActiveWorkspace, getActiveWorkspace } from '@/components/app/activeWorkspace';
import VoiceCaptureModal from '@/components/app/voice/VoiceCaptureModal';
import { Mic, Menu } from 'lucide-react';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import { ToastHost } from '@/components/app/Toast';
import { getSupabase } from '@/lib/supabase/client';
import { isGatedMindyApi, skipAuthRecovery } from '@/lib/app/auth-recovery';
import { getStoredPartnerRef } from '@/lib/mindy/partner-referral-client';
import { signInWithGoogle, signInWithMicrosoft } from '@/lib/supabase/auth';

const TWO_FACTOR_SESSION_MS = 12 * 60 * 60 * 1000;
const TWO_FACTOR_TOKEN_KEY = 'mi_beta_2fa_token';
const MI_AUTH_TOKEN_KEY = 'mi_beta_auth_token';

function clearStoredAppAuth() {
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
    <div className="min-h-screen bg-ground-deep flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Loading Mindy...</p>
      </div>
    </div>
  );
}

// Panels that may be deep-linked via ?panel=<id>. Keep in sync with AppPanel.
const KNOWN_PANELS = new Set<AppPanel>([
  'chat', 'dashboard', 'alerts', 'market-intel', 'research', 'forecasts',
  'recompetes', 'contractors', 'decision-makers', 'pipeline', 'contacts',
  'team', 'settings', 'vault', 'library', 'knowledge-base', 'coach',
  'pricing', 'proposals', 'target-list', 'grants', 'dibbs',
]);

// Wrap in Suspense for useSearchParams
export default function AppPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      {/* Wraps the whole /app tree so any panel can call useToast() to
          surface action confirmations (Track in Pipeline, Saved, etc).
          Same pattern Linear / Vercel / Notion use — fixed-position
          bottom-right stack with auto-dismiss + optional Undo. */}
      <ToastHost>
        <AppDashboard />
      </ToastHost>
    </Suspense>
  );
}

function AppDashboard() {
  const [email, setEmail] = useState<string | null>(null);
  const [tier, setTier] = useState<AppTier>('free');
  const [coachModeAllowed, setCoachModeAllowed] = useState(false);
  // Internal staff (govcongiants / getmindy team). Kept for staff-only treatment;
  // no longer gates the prototype demo tabs.
  const [isStaff, setIsStaff] = useState(false);
  // On the MINDY_PROTOTYPE_EMAILS allowlist → may see the demo/case-study prototype
  // tabs (Vehicle Expiry Watch, SMB Market Research, Market Research Report). Off by
  // default for everyone — incl. staff & demo accounts — so they get the clean view.
  const [canSeePrototypes, setCanSeePrototypes] = useState(false);
  const [activePanel, setActivePanel] = useState<AppPanel>('dashboard');
  // Optional context the previous panel can pass to the next (e.g.
  // PipelinePanel sets { pursuit_id } when user clicks 'Draft Proposal'
  // so ProposalsPanel knows which pursuit to auto-load docs for).
  // Clears the next time the user manually navigates so a context
  // doesn't persist across unrelated panel switches.
  const [panelContext, setPanelContext] = useState<Record<string, unknown> | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // Interactive product tour (PRD-interactive-product-tour). Auto-starts once
  // for a new user; replayable from Settings via the 'mindy:start-tour' event.
  const [runTour, setRunTour] = useState(false);
  const [tourRunId, setTourRunId] = useState(0);
  // Voice capture FAB state — mobile-first surface, also reachable
  // via the in-panel button on Pipeline. Single mount so the modal
  // doesn't double up when Pipeline is also showing one.
  const [isVoiceCaptureOpen, setIsVoiceCaptureOpen] = useState(false);
  // Mobile sidebar drawer state. Desktop ignores this.
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [showSignInPassword, setShowSignInPassword] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [authStep, setAuthStep] = useState<'credentials' | 'code'>('credentials');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  // When sign-in fails because the email has NO account yet (email-only beta user),
  // show a one-click "Set up my account" instead of a dead-end "forgot password".
  const [needsSetup, setNeedsSetup] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [usePasswordSignIn, setUsePasswordSignIn] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'microsoft' | 'apple' | null>(null);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpSent, setSignUpSent] = useState(false);

  const handleGoogleSignIn = useCallback(async () => {
    setOauthLoading('google');
    setAuthError(null);
    const result = await signInWithGoogle();
    if (!result.success) {
      setAuthError(result.error || 'Could not connect with Google');
      setOauthLoading(null);
    }
    // success path: Supabase redirects to Google → /app/onboarding → /app
  }, []);

  const handleMicrosoftSignIn = useCallback(async () => {
    setOauthLoading('microsoft');
    setAuthError(null);
    const result = await signInWithMicrosoft();
    if (!result.success) {
      setAuthError(result.error || 'Could not connect with Microsoft');
      setOauthLoading(null);
    }
  }, []);
  // Apple sign-in disabled until Apple OAuth provider is connected — handler removed;
  // restore it + signInWithApple import + the button when configured.
  const activePanelRef = useRef<AppPanel>('dashboard');
  // Single-flight guards so a burst of concurrent 401s triggers ONE recovery,
  // and so the proactive refresh only runs once per app load.
  // Holds the in-flight token-refresh promise so concurrent 401s share ONE
  // recovery (and all learn its success/failure to retry). null when idle.
  const sessionRecoveryPromiseRef = useRef<Promise<boolean> | null>(null);
  const refreshAttemptedRef = useRef(false);
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
      navigator.sendBeacon('/api/mindy/engagement', new Blob([payload], { type: 'application/json' }));
      return;
    }

    fetch('/api/mindy/engagement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: options.keepalive,
    }).catch(() => {});
  }, [email]);

  const flushPanelTime = useCallback((panel: AppPanel, options: { keepalive?: boolean; beacon?: boolean } = {}) => {
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
      // Fetch access level. This is the FIRST gated call on load and runs before
      // the global fetch-recovery wrapper is installed, so it does its OWN silent
      // token-refresh-and-retry on a 401 — otherwise a recoverable (near-expiry)
      // token here bounces the user straight to sign-in, the #1 "Invalid 2FA
      // session" complaint. Only a refresh that genuinely fails signs them out.
      let accessRes = await fetch(`/api/access/check?email=${encodeURIComponent(userEmail)}`, {
        headers: getTwoFactorHeaders(),
      });
      if (accessRes.status === 401) {
        const token = localStorage.getItem(MI_AUTH_TOKEN_KEY);
        if (token) {
          try {
            const rf = await fetch('/api/auth/refresh-mi-session', {
              method: 'POST',
              headers: { 'x-mi-auth-token': token },
            });
            const rfData = await rf.json().catch(() => null);
            if (rf.ok && rfData?.success && rfData.sessionToken) {
              localStorage.setItem(MI_AUTH_TOKEN_KEY, rfData.sessionToken);
              localStorage.setItem('mi_beta_authenticated_at', rfData.authenticatedAt || new Date().toISOString());
              accessRes = await fetch(`/api/access/check?email=${encodeURIComponent(userEmail)}`, {
                headers: getTwoFactorHeaders(),
              });
            }
          } catch {
            /* fall through — treated as unrecoverable below */
          }
        }
      }
      const accessData = await accessRes.json().catch(() => null);

      if (!accessRes.ok || !accessData?.success) {
        if (accessRes.status === 401) {
          clearStoredAppAuth();
          setEmail(null);
          setTier('free');
          setPendingEmail(userEmail);
          setAuthError('Your Mindy session expired. Sign in again to restore Pro access.');
          return;
        }

        throw new Error(accessData?.error || 'Could not verify Mindy access');
      }

      // Determine tier from the unified Mindy entitlement first.
      let userTier: AppTier = 'free';
      if (['free', 'pro', 'team', 'enterprise'].includes(accessData?.tier)) {
        userTier = accessData.tier as AppTier;
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
      setCoachModeAllowed(!!accessData?.coachMode?.allowed);
      setIsStaff(!!accessData?.isStaff);
      setCanSeePrototypes(!!accessData?.canSeePrototypes);

      // New-user gate: a signed-in user with NO saved profile belongs in the
      // onboarding slurpee, not the bare dashboard. `needsOnboarding` comes from the
      // already-authed access/check call above (no extra fetch, no fragile session
      // flag). OAuth already redirects to onboarding; this covers password/session
      // logins. Loop-safe: a profiled user is never needsOnboarding, and onboarding
      // only bounces PROFILED users back to /app (Eric Jun 25: "wire the routing").
      if (
        accessData?.needsOnboarding
        && typeof window !== 'undefined'
        && !window.location.pathname.startsWith('/app/onboarding')
      ) {
        // Stamp the email FIRST + only redirect when the MI token is present — the
        // onboarding page needs BOTH in localStorage to auth a password/session
        // login. The gate previously redirected before loadUserProfile wrote
        // mi_beta_email (~20 lines below), so onboarding couldn't find the session
        // and bounced to /signup → a login loop (Eric Jun 25). No token → stay on
        // the dashboard rather than loop.
        const miTok = localStorage.getItem('mi_beta_auth_token');
        if (miTok) {
          try { localStorage.setItem('mi_beta_email', userEmail); } catch { /* */ }
          window.location.href = '/app/onboarding';
          return;
        }
      }

      // If the currently-active panel is gated for this tier, swap to the
      // first accessible one. Default panel is 'dashboard' (AI briefings) —
      // gated to Pro+, so free users would otherwise land on a locked screen.
      // For free users we surface 'alerts' (Source Feed = their Daily Alerts).
      if (userTier === 'free' && activePanelRef.current === 'dashboard') {
        activePanelRef.current = 'alerts';
        setActivePanel('alerts');
      }
      if (
        activePanelRef.current === 'coach'
        && !accessData?.coachMode?.allowed
        && userTier !== 'team'
        && userTier !== 'enterprise'
      ) {
        activePanelRef.current = 'dashboard';
        setActivePanel(userTier === 'free' ? 'alerts' : 'dashboard');
      }

      // Store email in localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('mi_beta_email', userEmail);
        localStorage.setItem('mi_beta_authenticated_at', new Date().toISOString());
        // SAFETY: drop any Coach Mode active-workspace that a DIFFERENT login set
        // (or a legacy key with no owner stamp), so this session can never start
        // silently operating as someone else's client.
        reconcileActiveWorkspace(userEmail);
      }
    } catch (error) {
      console.error('Failed to load user profile:', error);
    } finally {
      setIsLoading(false);
    }
  }, [getTwoFactorHeaders]);

  // Peek the live Supabase (OAuth) session email WITHOUT doing the full bootstrap
  // (no network call, no localStorage writes). Used at mount to decide whether a
  // cached MI session is stale — the live OAuth session is the source of truth for
  // identity, so a stored localStorage email that disagrees with it must be dropped.
  const peekSupabaseSessionEmail = useCallback(async (): Promise<string | null> => {
    const supabase = getSupabase();
    if (!supabase) return null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const sessionEmail = session?.user?.email?.toLowerCase().trim();
      return session?.access_token && sessionEmail ? sessionEmail : null;
    } catch {
      return null;
    }
  }, []);

  const bootstrapFromSupabaseSession = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      console.warn('[Mindy bootstrap] Supabase client not configured');
      return false;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const sessionEmail = session?.user?.email?.toLowerCase().trim();
    if (!session?.access_token || !sessionEmail) {
      console.info('[Mindy bootstrap] No Supabase session in storage');
      return false;
    }

    let res: Response;
    try {
      res = await fetch('/api/auth/mindy-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
    } catch (err) {
      console.error('[Mindy bootstrap] /api/auth/mindy-session fetch failed:', err);
      return false;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.sessionToken) {
      console.error('[Mindy bootstrap] mindy-session returned non-success:', res.status, data);
      return false;
    }

    localStorage.setItem(MI_AUTH_TOKEN_KEY, data.sessionToken);
    localStorage.setItem('mi_beta_authenticated_at', data.authenticatedAt || new Date().toISOString());
    localStorage.setItem('mi_beta_email', sessionEmail);
    await loadUserProfile(sessionEmail);
    return true;
  }, [loadUserProfile]);

  // Proactively renew the MI token so an active user never hits the 30-day
  // expiry cliff. Runs once per app load: if the stored token is older than ~23
  // days (i.e. within a week of its 30-day TTL), exchange it for a fresh one.
  // Cheap no-op for fresh tokens; silent on failure (recovery handles real death).
  const maybeRefreshMIToken = useCallback(async () => {
    if (refreshAttemptedRef.current) return;
    refreshAttemptedRef.current = true;
    if (typeof window === 'undefined') return;

    const token = localStorage.getItem(MI_AUTH_TOKEN_KEY);
    const authedAt = localStorage.getItem('mi_beta_authenticated_at');
    if (!token || !authedAt) return;

    const ageMs = Date.now() - new Date(authedAt).getTime();
    const REFRESH_AFTER_MS = 23 * 24 * 60 * 60 * 1000; // 7 days before the 30-day TTL
    if (!Number.isFinite(ageMs) || ageMs < REFRESH_AFTER_MS) return;

    try {
      const res = await fetch('/api/auth/refresh-mi-session', {
        method: 'POST',
        headers: { 'x-mi-auth-token': token },
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.sessionToken) {
        localStorage.setItem(MI_AUTH_TOKEN_KEY, data.sessionToken);
        localStorage.setItem('mi_beta_authenticated_at', data.authenticatedAt || new Date().toISOString());
      }
    } catch {
      /* non-fatal: token still valid until TTL; recovery covers real expiry */
    }
  }, []);

  // Global recovery when an /api/app/* call returns 401 (token expired, missing,
  // or no longer verifies). Try ONE silent refresh from the stored token; if it
  // can't be renewed, clear auth and show a clear "sign in again" prompt instead
  // of leaving the user on a blank, broken-looking panel. Single-flight guarded.
  // Returns true if the token was silently refreshed (caller can retry the
  // original request), false if the user was genuinely signed out.
  const handleAppSessionExpired = useCallback(async (): Promise<boolean> => {
    // Single-flight: concurrent 401s share ONE in-flight refresh instead of
    // firing a storm of refresh calls. Each caller awaits the same promise and
    // learns whether recovery succeeded, so every one of them can retry.
    if (sessionRecoveryPromiseRef.current) return sessionRecoveryPromiseRef.current;

    const run = (async (): Promise<boolean> => {
      const token = typeof window !== 'undefined' ? localStorage.getItem(MI_AUTH_TOKEN_KEY) : null;
      if (token) {
        try {
          const res = await fetch('/api/auth/refresh-mi-session', {
            method: 'POST',
            headers: { 'x-mi-auth-token': token },
          });
          const data = await res.json().catch(() => null);
          if (res.ok && data?.success && data.sessionToken) {
            localStorage.setItem(MI_AUTH_TOKEN_KEY, data.sessionToken);
            localStorage.setItem('mi_beta_authenticated_at', data.authenticatedAt || new Date().toISOString());
            return true;
          }
        } catch {
          /* fall through to hard sign-out */
        }
      }
      // Could not refresh → genuinely signed out. Surface it clearly.
      clearStoredAppAuth();
      setEmail(null);
      setAuthError('Your session expired. Sign in again to restore access.');
      setAuthStep('credentials');
      return false;
    })();

    sessionRecoveryPromiseRef.current = run;
    try {
      return await run;
    } finally {
      // Release the single-flight guard shortly after so a genuinely-new later
      // expiry can recover again, but a burst collapses into one refresh.
      window.setTimeout(() => { sessionRecoveryPromiseRef.current = null; }, 3000);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const supabase = getSupabase();
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.warn('Failed to sign out of Supabase session:', error);
    } finally {
      clearStoredAppAuth();
      setEmail(null);
      setTier('free');
      setCurrentWorkspaceId(null);
      setPendingEmail('');
      setSignInPassword('');
      setVerificationCode('');
      setAuthStep('credentials');
      setIsSignUpMode(false);
      setSignUpEmail('');
      setSignUpSent(false);
      setIsLoading(false);
      setAuthLoading(false);

      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', '/app');
      }
    }
  }, []);

  // Switch Account = sign out, but land the user directly on the sign-in
  // form with a clear message, rather than silently doing the exact same
  // thing as "Sign out" (which read as "it just logged me out"). Runs
  // handleSignOut, then surfaces a switch-account prompt.
  const handleSwitchAccount = useCallback(async () => {
    await handleSignOut();
    setAuthStep('credentials');
    setIsSignUpMode(false);
    setAuthMessage('Signed out. Enter a different account to switch.');
  }, [handleSignOut]);

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
  }, [email, activePanel, tier, trackEngagement, flushPanelTime]);

  // Tour: opt-in from Settings. It used to auto-start once for new users, but a
  // hidden driver.js overlay can swallow clicks if the tour layer initializes
  // poorly after a deploy/session restore. Keep the guided tour replayable while
  // never blocking the app on page load.
  useEffect(() => {
    const replay = () => {
      // Coach Mode: never run the client onboarding tour while operating inside
      // a client's workspace (Eric, Jun 23 2026 — "coach mode should not require
      // a tour on clients"). The tour highlights new-user onboarding panels that
      // are irrelevant (and broke) when a coach is working as a client.
      if (getActiveWorkspace()) return;
      localStorage.removeItem('mindy_tour_completed');
      setTourRunId((n) => n + 1);   // force a fresh remount
      setRunTour(true);
    };
    window.addEventListener('mindy:start-tour', replay);
    return () => window.removeEventListener('mindy:start-tour', replay);
  }, []);

  // Auto-start the tour ONCE for genuinely new users — gated to the ?onboarded=1
  // redirect from onboarding, NOT every load. The old always-on auto-start swallowed
  // clicks when the overlay initialized too early on a deploy/session-restore;
  // ?onboarded=1 only fires on the deliberate post-onboarding hop, and a short delay
  // lets the shell + first panel mount before the overlay opens. Coach mode + the
  // completion flag still apply.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('onboarded') !== '1') return;
    if (getActiveWorkspace()) return;
    if (localStorage.getItem('mindy_tour_completed') === '1') return;
    const t = setTimeout(() => { setTourRunId((n) => n + 1); setRunTour(true); }, 1200);
    return () => clearTimeout(t);
  }, []);

  const finishTour = useCallback(() => {
    setRunTour(false);
    if (typeof window !== 'undefined') localStorage.setItem('mindy_tour_completed', '1');
  }, []);

  /** Keep the address bar aligned with the active panel so refresh doesn't resurrect stale ?panel= params. */
  const syncAppUrl = useCallback((panel: AppPanel, context?: Record<string, unknown>) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams();
    if (panel !== 'dashboard') params.set('panel', panel);
    if (panel === 'research' && context?.keyword) {
      params.set('keyword', String(context.keyword));
    }
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `/app?${qs}` : '/app');
  }, []);

  const handlePanelChange = useCallback((nextPanel: AppPanel, context?: Record<string, unknown>) => {
    if (nextPanel === activePanelRef.current && !context) return;
    flushPanelTime(activePanelRef.current, { keepalive: true });
    activePanelRef.current = nextPanel;
    panelStartedAtRef.current = Date.now();
    setActivePanel(nextPanel);
    // Context is set by the previous panel via the optional 2nd arg.
    // Clearing to undefined when no context was passed prevents stale
    // context from a previous navigation from leaking into the next panel.
    setPanelContext(context);
    syncAppUrl(nextPanel, context);
    trackEngagement('page_view', { panel: nextPanel, tier });
  }, [flushPanelTime, tier, trackEngagement, syncAppUrl]);

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
      const res = await fetch('/api/auth/mindy-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      const data = await res.json();

      if (!data.success) {
        setAuthError(data.error || 'Failed to sign in');
        // No account yet → surface the "Set up my account" path (not forgot-password).
        setNeedsSetup(Boolean(data.needsAccountSetup));
        return;
      }
      setNeedsSetup(false);

      // Paid-MFA gate: the server verified the password but requires a second
      // factor for this paid account. It ALREADY emailed the code, so we just
      // switch to the code step (no re-request → no double-send/throttle). The
      // "Resend code" button reuses signInPassword if they need another.
      if (data.mfaRequired) {
        setPendingEmail(normalizedEmail);
        setAuthStep('code');
        setVerificationCode('');
        setAuthMessage(`For your security, we sent a verification code to ${normalizedEmail}`);
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

  const requestMagicLinkSignIn = useCallback(async (userEmail: string) => {
    const normalizedEmail = userEmail.toLowerCase().trim();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setAuthError('Enter your email address');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthMessage(null);
    setMagicLinkSent(false);
    setNeedsSetup(false);

    try {
      const res = await fetch('/api/auth/mindy-magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setAuthError(data.error || 'Unable to send sign-in link');
        return;
      }

      if (data.entitled === false) {
        setAuthError(null);
        setAuthMessage(data.message || "We couldn't find Mindy access for that email.");
        setIsSignUpMode(true);
        setPendingEmail(normalizedEmail);
        return;
      }

      setPendingEmail(normalizedEmail);
      setMagicLinkSent(true);
      setAuthMessage(data.message || 'Check your inbox — click the link to open Mindy.');
    } catch (error) {
      console.error('Failed to send magic link:', error);
      setAuthError('Unable to send sign-in link');
    } finally {
      setAuthLoading(false);
    }
  }, []);

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

    window.fetch = async (input, init = {}) => {
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

      const res = await originalFetch(input, { ...init, headers });

      // Global session-recovery: a 401 from ANY gated Mindy route means the MI
      // token expired / is missing / no longer verifies. Without this, the panel
      // renders blank ("the feature is broken") or the user is bounced to sign-in
      // for a token that could have been silently renewed. So: try ONE silent
      // refresh from the stored token and, on success, REPLAY the original
      // request with the fresh token so the caller gets its data — recovery is
      // transparent. If the refresh fails, auth is cleared and a clear "sign in
      // again" prompt is shown instead of a dead screen. Single-flight guarded so
      // a burst of concurrent 401s shares one refresh.
      //
      // Covers not just /api/app/* but the other MI-token-gated routes that fire
      // early or often — /api/access/check (the FIRST call on load), /api/pipeline,
      // /api/teaming, /api/pain-points, /api/mindy/*, /api/alerts/* — which were
      // previously excluded and forced a hard re-sign-in on a recoverable token.
      if (res.status === 401 && isGatedMindyApi(url) && !skipAuthRecovery(init)) {
        const recovered = await handleAppSessionExpired();
        if (recovered) {
          const freshToken = localStorage.getItem(MI_AUTH_TOKEN_KEY);
          const retryHeaders = new Headers(headers);
          if (freshToken) retryHeaders.set('x-mi-auth-token', freshToken);
          const freshTwoFactor = localStorage.getItem(TWO_FACTOR_TOKEN_KEY);
          if (freshTwoFactor) retryHeaders.set('x-mi-2fa-token', freshTwoFactor);
          // Mark the retry so a still-401 response doesn't loop back into recovery.
          const retryInit: RequestInit & { __miAuthRetry?: boolean } = {
            ...init,
            headers: retryHeaders,
            __miAuthRetry: true,
          };
          return originalFetch(input, retryInit);
        }
      }

      return res;
    };

    return () => {
      window.fetch = originalFetch;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link to a specific panel via ?panel=<id> (e.g. onboarding lands the user
  // on the Vault: /app?panel=vault). Hard refresh always returns to Today's Intel
  // so stale ?panel=research from an old search doesn't stick around.
  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const isReload = nav?.type === 'reload';

    if (isReload) {
      setActivePanel('dashboard');
      activePanelRef.current = 'dashboard';
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', '/app');
      }
      return;
    }

    const panelParam = searchParams.get('panel');
    if (panelParam && KNOWN_PANELS.has(panelParam as AppPanel)) {
      setActivePanel(panelParam as AppPanel);
      activePanelRef.current = panelParam as AppPanel;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load user profile on mount
  useEffect(() => {
    const emailParam = searchParams.get('email')?.toLowerCase().trim() || null;

    // Pre-fill the sign-in form regardless — if we end up needing to show it,
    // the email field will already be populated.
    if (emailParam) {
      setPendingEmail(emailParam);
    }

    // Existing cached MI session (localStorage fast-path).
    const storedEmail = typeof window !== 'undefined'
      ? localStorage.getItem('mi_beta_email')?.toLowerCase().trim() || null
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
    const hasCachedSession = Boolean(storedEmail && verifiedRecently && hasStoredToken);

    // IDENTITY SOURCE OF TRUTH: the live Supabase (OAuth) session — NEVER the
    // cached localStorage email and NEVER the ?email= URL param. A stale cached
    // session (a different account signed in earlier on this browser) or a stale
    // ?email= link must not silently render you as someone else. So: peek the live
    // OAuth session first; the cached fast-path is only trusted when it MATCHES the
    // live session, or when there is no live session at all (pure password users).
    (async () => {
      const liveEmail = await peekSupabaseSessionEmail();

      // A live OAuth session that DISAGREES with the cached email → the cache is
      // stale. Drop it and re-establish identity from the live session.
      if (liveEmail && hasCachedSession && liveEmail !== storedEmail) {
        console.warn(`[Mindy auth] cached session (${storedEmail}) != live OAuth session (${liveEmail}); using live session`);
        clearStoredAppAuth();
        // Also strip a stale ?email= that disagrees with who's really signed in,
        // so a refresh/bookmark stops showing the misleading param.
        if (typeof window !== 'undefined' && emailParam && emailParam !== liveEmail) {
          const url = new URL(window.location.href);
          url.searchParams.delete('email');
          window.history.replaceState(null, '', url.pathname + url.search);
        }
        const ok = await bootstrapFromSupabaseSession();
        if (!ok) { clearStoredAppAuth(); setIsLoading(false); }
        return;
      }

      // Cached session present and consistent (or no live session to contradict it)
      // → fast-path in, no network round-trip.
      if (hasCachedSession) {
        loadUserProfile(storedEmail!);
        // Renew the MI token in the background if it's nearing its 30-day TTL so
        // active users never get silently logged out mid-session.
        maybeRefreshMIToken();
        return;
      }

      // No usable cache → bootstrap from the Supabase session. Covers the OAuth
      // sign-up → onboarding → /app flow (valid Supabase session, no MI token yet).
      const bootstrapped = await bootstrapFromSupabaseSession();
      if (!bootstrapped) {
        clearStoredAppAuth();
        setIsLoading(false);
      }
    })();

    const supabase = getSupabase();
    const hasAuthHash = typeof window !== 'undefined' && window.location.hash.includes('access_token');
    if (!supabase || !hasAuthHash) {
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user?.email) {
        const ok = await bootstrapFromSupabaseSession();
        if (ok && typeof window !== 'undefined') {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        } else if (!ok) {
          clearStoredAppAuth();
          setIsLoading(false);
        }
        subscription.unsubscribe();
      }
    });

    return () => subscription.unsubscribe();
  }, [searchParams, loadUserProfile, bootstrapFromSupabaseSession, peekSupabaseSessionEmail, maybeRefreshMIToken]);

  // Loading state
  if (isLoading) {
    return <DashboardLoading />;
  }

  // Not logged in state
  if (!email) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
        {/* py-8 (was py-16) + tighter header margin so the Beta-setup + sign-in
            card sit ABOVE the fold on a laptop — the buttons used to require a
            scroll. */}
        <div className="max-w-4xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="text-center mb-6">
            <MindyLogo size={56} className="mx-auto mb-4" />
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
              Meet Mindy
            </h1>
            <p className="text-base md:text-lg text-gray-400 max-w-2xl mx-auto">
              Your AI-powered federal market intelligence partner. Daily briefings, market research,
              forecasts, pipeline tracking, and more.
            </p>
          </div>

          {/* Email Entry — magic-link-first sign-in / create-account */}
          <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-8 max-w-md mx-auto">
            {/* Sign-in / Sign-up toggle */}
            {!signUpSent && authStep === 'credentials' && (
              <div className="flex rounded-lg bg-gray-800 p-1 mb-6">
                <button
                  onClick={() => { setIsSignUpMode(false); setAuthError(null); setAuthMessage(null); setMagicLinkSent(false); setUsePasswordSignIn(false); }}
                  className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                    !isSignUpMode ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Sign in
                </button>
                <button
                  onClick={() => { setIsSignUpMode(true); setAuthError(null); setAuthMessage(null); }}
                  className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                    isSignUpMode ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Create free account
                </button>
              </div>
            )}

            <h2 className="text-lg font-semibold text-white mb-4 text-center">
              {signUpSent
                ? 'Check your email'
                : magicLinkSent && !isSignUpMode
                  ? 'Check your email'
                  : isSignUpMode
                    ? 'Create your free account'
                    : authStep === 'credentials'
                      ? (usePasswordSignIn ? 'Sign in with password' : 'Sign in to Mindy')
                      : 'Enter verification code'}
            </h2>

            {resetSuccess && authStep === 'credentials' && !isSignUpMode && (
              <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
                Password updated. Sign in with your new password, then complete 2FA.
              </div>
            )}
            {setupSuccess && authStep === 'credentials' && !isSignUpMode && (
              <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
                Account password created. Sign in, then complete 2FA.
              </div>
            )}

            {/* OAuth — shown for both Sign in and Create free account modes,
                hidden during 2FA step + after sign-up confirmation. */}
            {!signUpSent && authStep === 'credentials' && (
              <>
                <div className="space-y-3 mb-4">
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={oauthLoading !== null || authLoading}
                    className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 text-slate-800 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {oauthLoading === 'google' ? (
                      <span className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
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
                    onClick={handleMicrosoftSignIn}
                    disabled={oauthLoading !== null || authLoading}
                    className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 bg-ground hover:bg-surface text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-hairline"
                  >
                    {oauthLoading === 'microsoft' ? (
                      <span className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
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
                  {/* Apple sign-in hidden until Apple OAuth provider is connected. Re-enable
                      the button here + the handler/import once configured. */}
                </div>

                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-700"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-3 bg-gray-900 text-gray-500 text-xs">or with email</span>
                  </div>
                </div>
              </>
            )}

            {/* Sign-up success state */}
            {signUpSent ? (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-gray-300">
                  We sent a setup link to <span className="text-white font-medium">{signUpEmail}</span>
                </p>
                <p className="text-gray-500 text-sm">
                  Click the link in the email to set your password and start using Mindy.
                </p>
                <button
                  onClick={() => {
                    setSignUpSent(false);
                    setSignUpEmail('');
                    setIsSignUpMode(false);
                  }}
                  className="text-emerald-400 hover:text-emerald-300 text-sm font-medium"
                >
                  Back to sign in
                </button>
              </div>
            ) : isSignUpMode && authStep === 'credentials' ? (
              /* Sign-up form */
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const emailValue = (formData.get('signup_email') as string).toLowerCase().trim();

                  if (!emailValue) {
                    setAuthError('Enter your email address');
                    return;
                  }

                  setAuthLoading(true);
                  setAuthError(null);

                  try {
                    const res = await fetch('/api/auth/mindy-signup', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        email: emailValue,
                        referralCode: getStoredPartnerRef() || undefined,
                      }),
                    });
                    const data = await res.json();

                    if (!res.ok || !data.success) {
                      setAuthError(data.error || 'Unable to create account');
                      return;
                    }

                    setSignUpEmail(emailValue);
                    setSignUpSent(true);
                  } catch {
                    setAuthError('Unable to create account');
                  } finally {
                    setAuthLoading(false);
                  }
                }}
                className="space-y-4"
              >
                <div className="text-center text-gray-400 text-sm mb-4">
                  Get started with a free Mindy account. No credit card required.
                </div>
                <input
                  type="email"
                  name="signup_email"
                  placeholder="your@email.com"
                  required
                  autoComplete="email"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-400 text-white font-medium rounded-lg transition-colors"
                >
                  {authLoading ? 'Creating account...' : 'Create free account'}
                </button>
                <div className="text-center text-gray-500 text-xs">
                  Free includes: Daily alerts, market research (4 reports), opportunity search
                </div>
              </form>
            ) : authStep === 'credentials' && magicLinkSent && !isSignUpMode ? (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
                  <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-gray-300">
                  We sent a sign-in link to <span className="text-white font-medium">{pendingEmail}</span>
                </p>
                <p className="text-gray-500 text-sm">
                  Click the link in your email to open Mindy. No password needed. If it expired, request a fresh one below.
                </p>
                <button
                  type="button"
                  onClick={() => requestMagicLinkSignIn(pendingEmail)}
                  disabled={authLoading}
                  className="text-emerald-400 hover:text-emerald-300 text-sm font-medium disabled:text-gray-600"
                >
                  {authLoading ? 'Sending…' : 'Send a fresh link'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMagicLinkSent(false);
                    setAuthMessage(null);
                    setUsePasswordSignIn(true);
                  }}
                  className="block w-full text-sm text-gray-500 hover:text-gray-300"
                >
                  Sign in with password instead
                </button>
              </div>
            ) : authStep === 'credentials' && !isSignUpMode && !usePasswordSignIn ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const emailValue = formData.get('magic_email') as string;
                  requestMagicLinkSignIn(emailValue);
                }}
                className="space-y-4"
              >
                <p className="text-center text-gray-400 text-sm">
                  Enter your email — we&apos;ll send a secure link. Click it to open Mindy. No password to remember.
                </p>
                <input
                  type="email"
                  name="magic_email"
                  value={pendingEmail}
                  onChange={(e) => setPendingEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  autoComplete="email"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={authLoading || !pendingEmail.trim().includes('@')}
                  className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-400 text-white font-medium rounded-lg transition-colors"
                >
                  {authLoading ? 'Sending link…' : 'Email me a sign-in link'}
                </button>
                {/* Give the password path equal visual weight so it's discoverable
                    — the old gray text link was unfindable (Eric Jun 25). */}
                <div className="flex items-center gap-3 py-1" aria-hidden="true">
                  <div className="h-px flex-1 bg-gray-700" />
                  <span className="text-xs text-gray-500">or</span>
                  <div className="h-px flex-1 bg-gray-700" />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAuthError(null);
                    setAuthMessage(null);
                    setUsePasswordSignIn(true);
                  }}
                  className="w-full px-4 py-3 border border-gray-600 hover:border-emerald-500 bg-gray-800/40 hover:bg-gray-800 text-gray-100 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  🔑 Sign in with a password
                </button>
              </form>
            ) : authStep === 'credentials' ? (
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
                <div className="relative">
                  <input
                    type={showSignInPassword ? 'text' : 'password'}
                    name="password"
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                    placeholder="Password"
                    required
                    autoComplete="current-password"
                    className="w-full px-4 py-3 pr-16 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignInPassword(v => !v)}
                    className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-gray-400 hover:text-gray-200"
                    aria-label={showSignInPassword ? 'Hide password' : 'Show password'}
                  >
                    {showSignInPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div className="flex items-center justify-end text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setAuthMessage(null);
                      setNeedsSetup(false);
                      setUsePasswordSignIn(false);
                      setMagicLinkSent(false);
                    }}
                    className="font-medium text-emerald-400 hover:text-emerald-300"
                  >
                    Email me a sign-in link instead
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={authLoading || !pendingEmail.trim() || !signInPassword}
                  className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-400 text-white font-medium rounded-lg transition-colors"
                >
                  {authLoading ? 'Signing in...' : 'Sign in'}
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
            {needsSetup && (
              <button
                type="button"
                onClick={() => requestMagicLinkSignIn(pendingEmail)}
                disabled={authLoading || !pendingEmail.includes('@')}
                className="mt-3 w-full rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-3 text-sm font-semibold text-white hover:from-blue-500 hover:to-purple-500 disabled:opacity-60"
              >
                Email me a sign-in link →
              </button>
            )}
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
    <div className="min-h-screen bg-ground-deep flex">
      {/* Interactive product tour — drives the app for new users. */}
      <ProductTour key={tourRunId} run={runTour} onPanelChange={handlePanelChange} onFinish={finishTour} />
      {/* Sidebar */}
      <UnifiedSidebar
        activePanel={activePanel}
        onPanelChange={handlePanelChange}
        userTier={tier}
        coachModeAllowed={coachModeAllowed}
        isStaff={isStaff}
        canSeePrototypes={canSeePrototypes}
        userEmail={email}
        currentWorkspaceId={currentWorkspaceId}
        onWorkspaceChange={setCurrentWorkspaceId}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileOpen={isMobileSidebarOpen}
        onMobileClose={() => setIsMobileSidebarOpen(false)}
        onSignOut={handleSignOut}
        onSwitchAccount={handleSwitchAccount}
      />


      {/* Main Content */}
      <main className="flex-1 min-h-screen overflow-y-auto overflow-x-hidden pb-24 md:pb-0 w-full min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-ground-deep/90 backdrop-blur border-b border-surface px-4 md:px-6 py-3 md:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {/* Mobile hamburger — opens the sidebar drawer */}
              <button
                onClick={() => setIsMobileSidebarOpen(true)}
                className="md:hidden p-2 -ml-2 text-muted hover:text-white hover:bg-surface rounded-lg transition-colors"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" strokeWidth={1.75} />
              </button>
              <span className="hidden lg:inline text-sm text-muted truncate">
                Logged in as <span className="text-white">{email}</span>
              </span>
            </div>
            {/* Global lookup — type a contract number → award detail (enterprise
                "search-an-identifier" convention). Members-only header tool. */}
            <div className="flex-1 flex justify-center min-w-0 px-2">
              <GlobalLookup email={email} />
            </div>
            <div className="flex items-center gap-2 md:gap-3 shrink-0">
              <span className={`
                hidden sm:inline px-2 py-1 text-xs rounded
                ${tier === 'free' ? 'bg-input text-ink-soft' : 'bg-emerald-500/20 text-emerald-400'}
              `}>
                {tier === 'free' ? 'Free' : tier === 'team' ? 'Team' : tier === 'enterprise' ? 'Enterprise' : 'Pro'} Plan
              </span>
              {/* Settings lives in ONE place — the sidebar footer 'Settings'
                  (UnifiedSettingsPanel). The old top-right gear opened a SECOND,
                  legacy settings slide-out (briefings/SettingsPanel) — two settings
                  surfaces confused users, so the header gear was removed (Eric,
                  2026-07-11). Switch Account + Sign out live in the sidebar account
                  menu (Slack/Linear/Vercel convention). */}
            </div>
          </div>
        </header>

        <ClientWorkspaceBanner
          email={email}
          coachModeAllowed={coachModeAllowed}
          onPanelChange={handlePanelChange}
          activePanel={activePanel}
        />

        {/* Thin-profile nudge: users on generic-only codes get a one-line describe
            prompt → real keywords + sharper matches (reuses onboarding's describe path). */}
        <CapabilityNudge email={email} />

        {/* Panel Content */}
        <PanelContainer
          activePanel={activePanel}
          email={email}
          tier={tier}
          onPanelChange={handlePanelChange}
          panelContext={panelContext}
        />
      </main>

      {/* Mobile-first voice capture FAB. Visible on small screens
          only — desktop users use the in-panel "Add by voice" button
          on PipelinePanel (#119). Always-accessible because field
          captures shouldn't require panel-hunting. */}
      {email && (
        <>
          <button
            onClick={() => setIsVoiceCaptureOpen(true)}
            className="md:hidden fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-purple-600 hover:bg-purple-500 text-white shadow-2xl shadow-black/60 ring-4 ring-slate-950/70 flex items-center justify-center transition-transform active:scale-95"
            aria-label="Voice capture"
            title="Voice capture"
          >
            <Mic className="w-6 h-6" strokeWidth={1.75} />
          </button>
          <VoiceCaptureModal
            email={email}
            isOpen={isVoiceCaptureOpen}
            onClose={() => setIsVoiceCaptureOpen(false)}
            onSaved={() => {
              // Reload current panel data by switching to pipeline so
              // the new row is visible immediately.
              handlePanelChange('pipeline');
            }}
            onPivotToChat={(seedMessage) => {
              // Stash the transcript so MindyChatPanel can pick it up
              // on mount and auto-send. Survives the panel swap without
              // needing a top-level shared state.
              try {
                sessionStorage.setItem('mindy_chat_seed', seedMessage);
              } catch {
                // sessionStorage can throw in private mode — fall
                // through; the chat panel will just open empty.
              }
              handlePanelChange('chat');
            }}
          />
        </>
      )}
    </div>
  );
}
