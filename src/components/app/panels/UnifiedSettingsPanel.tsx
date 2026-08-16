'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Check, Plus, Compass } from 'lucide-react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders, authedFetch } from '../authHeaders';
import { useAppTracker } from '../track';
import { useToast } from '../Toast';
import { NaicsPicker } from '@/components/codes/NaicsPicker';
import { getPsc } from '@/lib/codes/lookup';
import TargetingCard from './TargetingCard';
import { pscStatus } from '@/lib/codes/psc-status';

interface UnifiedSettingsPanelProps {
  email: string | null;
  tier: AppTier;
}

interface SettingsForm {
  company_name: string;
  display_name: string;
  role_title: string;
  naics_codes: string;
  psc_codes: string;
  keywords: string;
  target_agencies: string;
  email_frequency: string;
  onboarding_completed: boolean;
  // States the user wants opportunities scoped to. Empty = national.
  location_states: string[];
  // Coach Mode only: the client's real inbox for daily/weekly alerts (else they
  // send to the synthetic {workspaceId}@clients.getmindy.ai address and bounce).
  alert_recipient_email: string;
}

export default function UnifiedSettingsPanel({ email, tier }: UnifiedSettingsPanelProps) {
  const [form, setForm] = useState<SettingsForm>({
    company_name: '',
    display_name: '',
    role_title: '',
    naics_codes: '',
    psc_codes: '',
    keywords: '',
    target_agencies: '',
    email_frequency: 'daily',
    onboarding_completed: false,
    location_states: [],
    alert_recipient_email: '',
  });
  // True when these Settings are for a coach-managed CLIENT (synthetic
  // @clients.getmindy.ai profile) — gates the "Client alert email" field.
  const [isClientProfile, setIsClientProfile] = useState(false);
  // SMS opt-in (pursuit amendment/change alerts). Separate from the targeting
  // form — lives on user_notification_settings via /api/briefings/preferences.
  // SMS double opt-in flow. phoneVerified drives whether we show the verified
  // badge (done) or the "Send code → enter code" handshake (not yet).
  const [smsPhone, setSmsPhone] = useState('');
  const [smsVerified, setSmsVerified] = useState(false);
  const [smsCode, setSmsCode] = useState('');
  const [smsStage, setSmsStage] = useState<'idle' | 'code_sent'>('idle'); // idle = enter phone; code_sent = enter code
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsMsg, setSmsMsg] = useState<string | null>(null);
  // Styled "Start over?" confirm (replaces native window.confirm).
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // Type-to-confirm gate for the destructive reset — the user must type the exact
  // phrase before "Start over" enables (GitHub/Stripe destructive-action convention).
  const [resetConfirmText, setResetConfirmText] = useState('');
  const RESET_CONFIRM_PHRASE = 'delete my profile';
  // Change-email flow. Sends a verify link to the NEW address; the change only
  // applies when that link is clicked (mandatory verify-click). 'sent' = the
  // link is out and the current email keeps working until confirmed.
  const [newEmail, setNewEmail] = useState('');
  const [changeEmailStage, setChangeEmailStage] = useState<'idle' | 'sent'>('idle');
  const [changeEmailBusy, setChangeEmailBusy] = useState(false);
  const [changeEmailMsg, setChangeEmailMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  // Change password — Settings had Session + Change email but no way to SET or
  // change a password (Eric, 2026-07-27). That matters beyond convenience: an
  // account created via Google/Microsoft OAuth has no password, and the MCP
  // connector flow needs one, so those users had no in-app path to create it.
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  // Unified "describe what you do → codes" box (the Market Research pattern):
  // one input → suggest NAICS + PSC together, tap to add. So users never have to
  // know which box (NAICS vs PSC) a thing goes in. The manual fields collapse
  // below for power users. (Eric, Jun 25: "1 search box gives all results".)
  const [describeText, setDescribeText] = useState('');
  const [describing, setDescribing] = useState(false);
  const [describeNaics, setDescribeNaics] = useState<Array<{ code: string; name: string }>>([]);
  const [describePsc, setDescribePsc] = useState<Array<{ code: string; name: string }>>([]);
  const [showManualCodes, setShowManualCodes] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('Workspace');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetingRefreshKey, setTargetingRefreshKey] = useState(0);
  // Count of saved BD targets (user_target_list) — used so "Agencies selected" in
  // setup progress reflects the My Target List, not just the alert-agencies field
  // (Eric QC 2026-06-17: had 23 targets but the checkmark was blank — they live in
  // a DIFFERENT table than user_notification_settings.agencies).
  const [targetListCount, setTargetListCount] = useState(0);
  // Top PSC codes for the user's market — one-tap "add" so they don't have to guess
  // the correct PSC (Eric QC 2026-06-17: "how do I know I have the right PSC?").
  const [pscSuggestions, setPscSuggestions] = useState<Array<{ code: string; name: string }>>([]);
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);
  const track = useAppTracker(email);
  const { showToast } = useToast();
  const matchingSectionRef = useRef<HTMLElement | null>(null);

  const loadSettings = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError(null);

    try {
      // Workspace endpoint has Profile fields (display_name, company, role,
      // naics, agencies). The canonical email frequency lives on
      // user_notification_settings.alert_frequency, surfaced via the alerts
      // preferences endpoint — read it there too so the dropdown reflects
      // the value that actually controls the daily-alerts cron.
      const [workspaceRes, prefsRes, targetsRes, briefingPrefsRes] = await Promise.all([
        authedFetch(`/api/app/workspace?email=${encodeURIComponent(email)}`, email),
        fetch(`/api/alerts/preferences?email=${encodeURIComponent(email)}`, {
          headers: getAuthHeaders(),
        }),
        // Saved BD targets (My Target List) — counts toward "Agencies selected".
        authedFetch(`/api/app/target-list?email=${encodeURIComponent(email)}`, email).catch(() => null),
        // SMS opt-in state (sms_enabled + phone_number).
        fetch(`/api/briefings/preferences?email=${encodeURIComponent(email)}`, {
          headers: getAuthHeaders(),
        }).catch(() => null),
      ]);
      try {
        const tj = targetsRes && targetsRes.ok ? await targetsRes.json() : null;
        setTargetListCount(Number(tj?.count) || (Array.isArray(tj?.targets) ? tj.targets.length : 0));
      } catch { /* non-fatal */ }
      try {
        const bj = briefingPrefsRes && briefingPrefsRes.ok ? await briefingPrefsRes.json() : null;
        // Verified = the number completed double opt-in. phone_verified is the
        // durable flag (set by /sms/verify/check, never cleared by a toggle).
        // Do NOT AND with sms_enabled: that's an independent on/off preference the
        // preferences POST mutates without un-verifying, so AND-ing it made a
        // genuinely-verified number show as unverified after a reload.
        setSmsVerified(Boolean(bj?.phone_verified));
        setSmsPhone(bj?.preferences?.phone_number || '');
      } catch { /* non-fatal */ }

      const data = await workspaceRes.json();
      if (!data.success) {
        setError(data.error || 'Failed to load settings');
        return;
      }

      const prefs = prefsRes.ok ? await prefsRes.json().catch(() => null) : null;
      const realAlertFrequency: string | undefined = prefs?.data?.frequency;
      const realLocationStates: string[] = Array.isArray(prefs?.data?.locationStates)
        ? prefs.data.locationStates
        : [];
      // Coach Mode: the prefs row email is the client's synthetic address when
      // managing a client. That's the signal to surface the "Client alert email" field.
      const prefsEmail: string = typeof prefs?.data?.email === 'string' ? prefs.data.email : '';
      setIsClientProfile(prefsEmail.endsWith('@clients.getmindy.ai'));

      const settings = data.settings || {};
      // TARGETING (naics/keywords/agencies) lives in user_notification_settings —
      // the single source of truth alerts/feed/briefings read (memory:
      // profile_table_source_of_truth). data.settings is mi_beta_user_settings, a
      // separate per-user row that's EMPTY for alerts-path users → the form showed
      // blank NAICS/keywords despite a real profile (Eric QC 2026-06-16). Read
      // targeting from profile.notification; keep display_name/role/company (which
      // legitimately live on mi_beta_user_settings) from settings.
      const notif = data.profile?.notification || {};
      setWorkspaceName(data.workspace?.name || 'Workspace');
      setForm({
        company_name: settings.company_name || notif.company_name || '',
        display_name: settings.display_name || '',
        role_title: settings.role_title || '',
        // Targeting comes ONLY from notification (user_notification_settings = the
        // source of truth alerts read). No fallback to settings (mi_beta) — that
        // could show a stale profile different from what drives alerts (launch
        // consistency pass, Eric QC 2026-06-16).
        naics_codes: (notif.naics_codes || []).join(', '),
        psc_codes: (notif.psc_codes || []).join(', '),
        keywords: (notif.keywords || []).join(', '),
        target_agencies: (notif.agencies || []).join(', '),
        // Prefer the canonical alert_frequency (drives actual emails)
        // over the legacy mi_beta_user_settings.email_frequency value.
        email_frequency: realAlertFrequency || settings.email_frequency || 'daily',
        onboarding_completed: Boolean(settings.onboarding_completed),
        // Canonical store for states is user_notification_settings,
        // surfaced via the alerts preferences endpoint.
        location_states: realLocationStates.map((s) => String(s || '').toUpperCase()),
        alert_recipient_email: prefs?.data?.alertRecipientEmail || '',
      });
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [email, getAuthHeaders]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Fetch top PSC codes for the user's primary keyword so they can pick the right
  // one instead of guessing a free-text code. Re-runs when keywords change.
  useEffect(() => {
    const primary = parseList(form.keywords)[0];
    if (!primary || !email) { setPscSuggestions([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch(`/api/app/keyword-coverage?keyword=${encodeURIComponent(primary)}`, email);
        if (!res.ok) return;
        const j = await res.json();
        const psc = (j?.coverage?.topPsc || []) as Array<{ code: string; name: string }>;
        if (!cancelled) setPscSuggestions(psc.slice(0, 5));
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
  }, [form.keywords, email, getAuthHeaders]);

  // TOGGLE: clicking an added PSC chip REMOVES it; an un-added one adds it. So the
  // suggestion chips work as on/off, not add-only (Eric QC 2026-06-17: "doesn't help
  // me unclick").
  function togglePscSuggestion(code: string) {
    const cur = parseList(form.psc_codes);
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    setForm((f) => ({ ...f, psc_codes: next.join(', ') }));
  }

  // Unified describe → suggest NAICS + PSC together (one box, the MR pattern).
  async function runDescribeSuggest() {
    const text = describeText.trim();
    if (!text || describing) return;
    setDescribing(true);
    setDescribeNaics([]); setDescribePsc([]);
    try {
      const res = await fetch('/api/suggest-codes', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ description: text, maxResults: 6 }),
      });
      const d = await res.json().catch(() => null);
      setDescribeNaics((d?.naicsSuggestions || []).map((s: { code: string; name: string }) => ({ code: s.code, name: s.name })));
      setDescribePsc((d?.pscSuggestions || []).map((s: { code: string; name: string }) => ({ code: s.code, name: s.name })));
      // Also seed the keyword so alerts catch the work the codes miss.
      const kws = parseList(form.keywords);
      if (!kws.includes(text)) setForm((f) => ({ ...f, keywords: [...kws, text].join(', ') }));
    } catch { /* leave chips empty; user can fine-tune manually */ }
    finally { setDescribing(false); }
  }

  // Toggle a NAICS suggestion into/out of the naics_codes field.
  function toggleNaicsCode(code: string) {
    const cur = parseList(form.naics_codes);
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    setForm((f) => ({ ...f, naics_codes: next.join(', ') }));
  }

  // SMS double opt-in (its own flow, decoupled from the targeting save):
  //   sendSmsCode → texts a 6-digit code via GHL → verifySmsCode activates.
  // Only a verified number is ever texted (pursuit-changes gates on phone_verified).
  const sendSmsCode = async () => {
    if (!email) return;
    const phone = smsPhone.trim();
    if (!phone) { setSmsMsg('Enter your phone number first.'); return; }
    setSmsBusy(true);
    setSmsMsg(null);
    try {
      const res = await authedFetch('/api/app/sms/verify/send', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setSmsStage('code_sent');
        setSmsMsg('We texted you a 6-digit code. Enter it below to confirm.');
      } else {
        setSmsMsg(data?.error || 'Could not send the code. Check the number.');
      }
    } catch {
      setSmsMsg('Could not send the code.');
    } finally {
      setSmsBusy(false);
    }
  };

  const verifySmsCode = async () => {
    if (!email) return;
    const code = smsCode.trim();
    if (!/^\d{6}$/.test(code)) { setSmsMsg('Enter the 6-digit code.'); return; }
    setSmsBusy(true);
    setSmsMsg(null);
    try {
      const res = await authedFetch('/api/app/sms/verify/check', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setSmsVerified(true);
        setSmsStage('idle');
        setSmsCode('');
        setSmsMsg('✓ Verified — you’ll get a text when a tracked pursuit changes.');
      } else {
        setSmsMsg(data?.error || 'Incorrect code.');
      }
    } catch {
      setSmsMsg('Could not verify the code.');
    } finally {
      setSmsBusy(false);
    }
  };

  const disableSms = async () => {
    if (!email) return;
    setSmsBusy(true);
    setSmsMsg(null);
    try {
      const res = await authedFetch('/api/app/sms/disable', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setSmsVerified(false);
        setSmsStage('idle');
        setSmsCode('');
        setSmsMsg('SMS alerts turned off.');
      } else {
        setSmsMsg('Could not turn off SMS.');
      }
    } catch {
      setSmsMsg('Could not turn off SMS.');
    } finally {
      setSmsBusy(false);
    }
  };

  // Change email — sends a confirmation link to the NEW address. Nothing moves
  // until that link is clicked (the /confirm route runs the actual re-key).
  /**
   * Send a password set/reset link to the signed-in address. Reuses the SAME
   * endpoint /app/forgot-password calls (mi-password-reset/request) rather than a
   * new one — the email, link expiry and reset page are already built and tested.
   * Deliberately email-link based, not an in-place "type a new password" form:
   * changing a credential should require possession of the inbox.
   */
  const requestPasswordReset = async () => {
    if (!email || pwBusy) return;
    setPwBusy(true);
    setPwMsg(null);
    try {
      const res = await fetch('/api/auth/mi-password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setPwMsg({ text: data?.error || 'Could not send the link. Try again.', kind: 'err' });
        return;
      }
      setPwMsg({ text: `Link sent to ${email}. Check your inbox.`, kind: 'ok' });
    } catch {
      setPwMsg({ text: 'Could not send the link. Try again.', kind: 'err' });
    } finally {
      setPwBusy(false);
    }
  };

  const requestEmailChange = async () => {
    if (!email) return;
    const target = newEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) {
      setChangeEmailMsg({ text: 'Enter a valid email address.', kind: 'err' });
      return;
    }
    if (target === email.toLowerCase()) {
      setChangeEmailMsg({ text: 'That is already your email.', kind: 'err' });
      return;
    }
    setChangeEmailBusy(true);
    setChangeEmailMsg(null);
    try {
      const res = await authedFetch('/api/app/change-email/request', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, newEmail: target }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setChangeEmailStage('sent');
        setChangeEmailMsg({ text: data.message || `Confirmation link sent to ${target}.`, kind: 'ok' });
      } else if (data?.collision) {
        setChangeEmailMsg({ text: data.error || 'That email already has a Mindy account. Contact support to merge them.', kind: 'err' });
      } else {
        setChangeEmailMsg({ text: data?.error || 'Could not start the email change. Please try again.', kind: 'err' });
      }
    } catch {
      setChangeEmailMsg({ text: 'Could not start the email change. Please try again.', kind: 'err' });
    } finally {
      setChangeEmailBusy(false);
    }
  };

  const saveSettings = async (markComplete = form.onboarding_completed) => {
    if (!email) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      // TARGETING (naics/keywords/agencies/states/frequency) MUST land in
      // user_notification_settings — the single source of truth alerts/feed read
      // (memory: profile_table_source_of_truth). So it goes through the alerts
      // preferences endpoint, which writes that table. The workspace PATCH keeps
      // only the display fields (name/role/company) that live on
      // mi_beta_user_settings. Previously NAICS+agencies went ONLY to the
      // workspace endpoint → saved to mi_beta_user_settings → alerts never saw
      // them (Eric QC 2026-06-16).
      // Auth-resilient fetch: on a 401 (the MI session token expired — 30-day TTL),
      // refresh the token and retry ONCE. Without this, an active user who hits the
      // token cliff silently can't save anything — the save just 401s forever (the
      // root cause of "I save but it never persists"; eric@govcongiants.com's profile
      // was stuck 10 days). Eric QC / launch hardening 2026-06-16.
      const authedFetch = async (url: string, init: RequestInit): Promise<Response> => {
        let res = await fetch(url, { ...init, headers: getAuthHeaders((init.headers as HeadersInit) || { 'Content-Type': 'application/json' }) });
        if (res.status === 401) {
          try {
            const refresh = await fetch('/api/auth/refresh-mi-session', {
              method: 'POST',
              headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            });
            if (refresh.ok) {
              const j = await refresh.json().catch(() => null);
              if (j?.sessionToken && typeof window !== 'undefined') {
                window.localStorage.setItem('mi_beta_auth_token', j.sessionToken);
              }
              res = await fetch(url, { ...init, headers: getAuthHeaders((init.headers as HeadersInit) || { 'Content-Type': 'application/json' }) });
            }
          } catch { /* fall through with the original 401 */ }
        }
        return res;
      };

      const [workspaceRes, prefsRes] = await Promise.all([
        authedFetch('/api/app/workspace', {
          method: 'PATCH',
          body: JSON.stringify({
            email,
            // DISPLAY FIELDS ONLY — targeting goes through the preferences call below
            // (user_notification_settings, the source of truth). We no longer mirror
            // NAICS/agencies here: the second copy could go stale and disagree with
            // alerts (launch consistency pass, Eric QC 2026-06-16).
            company_name: form.company_name,
            display_name: form.display_name,
            role_title: form.role_title,
            email_frequency: form.email_frequency,
            onboarding_completed: markComplete,
          }),
        }),
        authedFetch('/api/alerts/preferences', {
          method: 'POST',
          body: JSON.stringify({
            email,
            frequency: form.email_frequency,
            locationStates: form.location_states,
            keywords: parseList(form.keywords),
            // Authoritative targeting write → user_notification_settings.
            naicsCodes: parseList(form.naics_codes),
            pscCodes: parseList(form.psc_codes),
            targetAgencies: parseList(form.target_agencies),
            // Coach Mode: only send when editing a client profile, so normal saves
            // never touch the alert_recipient_email column.
            ...(isClientProfile ? { alertRecipientEmail: form.alert_recipient_email.trim() } : {}),
          }),
        }),
      ]);

      const data = await workspaceRes.json();

      if (!data.success) {
        showToast({ message: data.error || 'Could not save settings', variant: 'error' });
        return;
      }

      // The preferences call carries the TARGETING (naics/psc/keywords/agencies/
      // states/frequency) → user_notification_settings, the table alerts read. A
      // failure here means the user's codes/keywords DID NOT SAVE — treat it as a
      // HARD error, not a soft "saved" (Eric QC 2026-06-16: a failed targeting save
      // was disguised as an "email frequency" info toast → users thought it saved
      // when it didn't). Surface the real error.
      if (!prefsRes.ok) {
        const prefsErr = await prefsRes.json().catch(() => null);
        console.error('Targeting save failed:', prefsRes.status, prefsErr);
        showToast({
          message: prefsRes.status === 401
            ? 'Your session expired — please sign out and back in, then save again.'
            : prefsErr?.error
              ? `Codes/keywords did NOT save: ${prefsErr.error}`
              : 'Your codes/keywords did NOT save — please try again.',
          variant: 'error',
        });
        return;
      }
      showToast({
        message: markComplete ? 'Onboarding marked complete' : 'Settings saved',
        variant: 'success',
      });

      setForm(prev => ({ ...prev, onboarding_completed: markComplete }));
      setTargetingRefreshKey(prev => prev + 1);
      // Notify any OTHER open surface (the dashboard TargetingCard, the top drawer)
      // that targeting changed so it re-fetches without a tab-away/back — keeps all
      // settings views in sync (Eric QC 2026-07-02).
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mindy:settings-saved'));
      }
      // profile_update is an activation signal — users tweaking their
      // profile are engaged. Capture which fields are non-empty so the
      // Launch Command Center can see what's being tuned.
      track('profile_update', 'settings', {
        has_company: !!form.company_name,
        has_display_name: !!form.display_name,
        has_role: !!form.role_title,
        naics_count: parseList(form.naics_codes).length,
        agency_count: parseList(form.target_agencies).length,
        state_count: form.location_states.length,
        email_frequency: form.email_frequency,
        marked_onboarding_complete: markComplete,
      });
    } catch (err) {
      console.error('Failed to save settings:', err);
      showToast({ message: 'Network error — settings not saved', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Reset profile — wipe targeting (NAICS/PSC/keywords/agencies/states) so the user
  // can rebuild from scratch (Eric QC 2026-06-17: no in-product "start over"; you
  // could only delete codes one by one). Clears the form, persists the empty state
  // to user_notification_settings (the source of truth), refreshes the card.
  // Open the styled in-app confirm (replaces the native window.confirm, which
  // didn't match Mindy's UI). The actual reset runs in confirmResetProfile().
  const resetProfile = () => {
    if (!email) return;
    setShowResetConfirm(true);
  };

  const confirmResetProfile = async () => {
    if (!email) return;
    // Guard: the type-to-confirm phrase must match (belt-and-suspenders — the
    // button is also disabled until it matches).
    if (resetConfirmText.trim().toLowerCase() !== RESET_CONFIRM_PHRASE) return;
    setShowResetConfirm(false);
    setResetConfirmText('');
    setSaving(true); setError(null); setMessage(null);
    try {
      const res = await fetch('/api/alerts/preferences', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          email,
          naicsCodes: [], pscCodes: [], keywords: [], targetAgencies: [], locationStates: [],
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        showToast({ message: e?.error ? `Couldn't reset: ${e.error}` : 'Reset failed — try again', variant: 'error' });
        return;
      }
      // Send the user back through the GUIDED onboarding sequence to rebuild — it's
      // the smart tool (describe "demolition" → real codes via keyword-coverage),
      // vs the Settings NAICS picker which only title-searches and misses colloquial
      // terms like "demolition" (Eric, Jun 2026). Codes are now cleared, so
      // onboarding shows the wizard (it only skips for users who already have codes).
      showToast({ message: 'Profile cleared — taking you to guided setup…', variant: 'success' });
      window.location.href = `/app/onboarding?email=${encodeURIComponent(email)}`;
    } catch {
      showToast({ message: 'Network error — reset not saved', variant: 'error' });
      setSaving(false);
    }
  };

  const focusOpportunityMatching = useCallback(() => {
    matchingSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      const firstField = matchingSectionRef.current?.querySelector<HTMLElement>('input, textarea, button, select');
      firstField?.focus();
    }, 250);
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface rounded w-64" />
          <div className="h-96 bg-surface rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Styled "Start over?" confirm — replaces the native window.confirm so it
          matches Mindy's dark UI. */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => { setShowResetConfirm(false); setResetConfirmText(''); }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-hairline bg-ground p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white">Start over?</h3>
            <p className="mt-2 text-sm text-muted">
              This clears your codes, keywords, and agencies, then walks you back through guided setup to rebuild your
              profile. Your saved pursuits and target list aren&apos;t touched.
            </p>
            <label className="mt-4 block text-sm text-ink-soft">
              Type <span className="font-semibold text-white">{RESET_CONFIRM_PHRASE}</span> to confirm:
              <input
                type="text"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                autoFocus
                autoComplete="off"
                placeholder={RESET_CONFIRM_PHRASE}
                className="mt-1.5 w-full rounded-lg border border-hairline bg-input px-3 py-2 text-sm text-white placeholder:text-muted/60 focus:border-purple-500 focus:outline-none"
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => { setShowResetConfirm(false); setResetConfirmText(''); }}
                className="rounded-lg border border-hairline px-4 py-2 text-sm font-medium text-ink-soft hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={confirmResetProfile}
                disabled={resetConfirmText.trim().toLowerCase() !== RESET_CONFIRM_PHRASE}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-600"
              >
                Start over
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-muted mt-1">{workspaceName} • {tierLabel(tier)}</p>
      </div>

      {message && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">{message}</div>}
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error}</div>}

      {/* Coverage readout — shows how the codes/keywords below stack up against the
          real USASpending market + flags missing high-value codes. `key` bumps after
          save so the card re-fetches the canonical targeting settings. */}
      <TargetingCard key={`targeting-${targetingRefreshKey}`} email={email} variant="full" surface="settings" onEdit={focusOpportunityMatching} onReset={resetProfile} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-5">
          <section className="bg-ground border border-surface rounded-xl p-6 space-y-5">
            <SectionTitle title="Profile" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Display Name" value={form.display_name} onChange={(value) => setForm({ ...form, display_name: value })} placeholder="John Doe" />
              <Field label="Role / Title" value={form.role_title} onChange={(value) => setForm({ ...form, role_title: value })} placeholder="Founder, BD Lead..." />
              <Field label="Company" value={form.company_name} onChange={(value) => setForm({ ...form, company_name: value })} placeholder="Company name" />
              <label className="block">
                <span className="block text-sm text-muted mb-1">Email Frequency</span>
                <select
                  value={form.email_frequency}
                  onChange={(e) => setForm({ ...form, email_frequency: e.target.value })}
                  className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white outline-none focus:border-emerald-500"
                >
                  <option value="daily">Daily</option>
                  <option value="mwf">Mon / Wed / Fri</option>
                  <option value="tth">Tue / Thu</option>
                  <option value="weekly">Weekly</option>
                  <option value="paused">Paused</option>
                </select>
              </label>

              {/* SMS alerts — time-sensitive pursuit changes (amendments,
                  deadline moves, cancels). Double opt-in: verify the number by
                  code before it's ever texted (TCPA/CTIA + carrier A2P). */}
              <div className="md:col-span-2 rounded-lg border border-hairline bg-surface/40 p-4">
                <div className="flex items-start gap-3">
                  <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-muted" strokeWidth={2} />
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-white">
                      Text me when a tracked pursuit changes
                      {smsVerified && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 align-middle"><Check className="h-3 w-3 shrink-0" strokeWidth={2.5} /> VERIFIED</span>
                      )}
                    </span>
                    <span className="block text-xs text-muted mt-0.5">
                      Amendments, deadline moves, cancellations — the time-sensitive stuff. You still get the full email digest.
                    </span>

                    {smsVerified ? (
                      // Verified state — show the number + turn-off.
                      <div className="mt-3 flex items-center gap-3">
                        <span className="text-sm text-slate-200">{smsPhone}</span>
                        <button
                          type="button"
                          onClick={disableSms}
                          disabled={smsBusy}
                          className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-ink-soft hover:bg-surface disabled:opacity-50"
                        >
                          {smsBusy ? '…' : 'Turn off'}
                        </button>
                      </div>
                    ) : (
                      // Not verified — the send-code → enter-code handshake.
                      <div className="mt-3 space-y-2">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="tel"
                            value={smsPhone}
                            onChange={(e) => { setSmsPhone(e.target.value); setSmsMsg(null); }}
                            placeholder="(555) 123-4567"
                            disabled={smsStage === 'code_sent'}
                            className="flex-1 px-3 py-2 bg-ground border border-hairline rounded-lg text-white outline-none focus:border-emerald-500 disabled:opacity-60"
                          />
                          <button
                            type="button"
                            onClick={sendSmsCode}
                            disabled={smsBusy}
                            className="px-3 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50 whitespace-nowrap"
                          >
                            {smsBusy && smsStage === 'idle' ? 'Sending…' : smsStage === 'code_sent' ? 'Resend code' : 'Send code'}
                          </button>
                        </div>
                        {smsStage === 'code_sent' && (
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={smsCode}
                              onChange={(e) => { setSmsCode(e.target.value.replace(/\D/g, '')); setSmsMsg(null); }}
                              placeholder="6-digit code"
                              className="flex-1 px-3 py-2 bg-ground border border-hairline rounded-lg text-white tracking-widest outline-none focus:border-emerald-500"
                            />
                            <button
                              type="button"
                              onClick={verifySmsCode}
                              disabled={smsBusy}
                              className="px-3 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50 whitespace-nowrap"
                            >
                              {smsBusy ? 'Verifying…' : 'Verify'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {smsMsg && <p className="mt-2 text-xs text-ink-soft">{smsMsg}</p>}

                    {/* TCPA / CTIA consent + carrier disclosure. Required for A2P. */}
                    <p className="mt-3 text-[11px] leading-4 text-faint">
                      By verifying your number you agree to receive automated alert texts from Mindy about
                      pursuits you track. Message frequency varies. Msg &amp; data rates may apply. Reply STOP
                      to cancel, HELP for help. Consent is not a condition of purchase. See our{' '}
                      <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-muted underline">Terms</a>{' '}
                      and{' '}
                      <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-muted underline">Privacy Policy</a>.
                    </p>
                  </div>
                </div>
              </div>

              {isClientProfile && (
                <label className="block md:col-span-2">
                  <span className="block text-sm text-muted mb-1">Client Alert Email</span>
                  <input
                    type="email"
                    value={form.alert_recipient_email}
                    onChange={(e) => setForm({ ...form, alert_recipient_email: e.target.value })}
                    placeholder="client@company.com"
                    className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white outline-none focus:border-emerald-500"
                  />
                  <span className="block text-xs text-faint mt-1">
                    Daily/weekly alerts for this client go here. Leave blank and they fall back to your inbox.
                  </span>
                </label>
              )}
            </div>
          </section>

          <section ref={matchingSectionRef} className="scroll-mt-24 bg-ground border border-surface rounded-xl p-6 space-y-5">
            <div>
              <SectionTitle title="Opportunity Matching" />
              <p className="mt-2 text-sm text-muted">
                These preferences control what Mindy <span className="text-ink-soft">watches for</span> in alerts,
                briefings, and forecasts. The company identity Mindy <span className="text-ink-soft">writes into proposals</span>
                {' '}(legal name, UEI, certifications, past performance, point of contact) lives in
                {' '}<span className="text-ink-soft">My Vault → Identity</span>.
              </p>
            </div>

            {/* UNIFIED describe → codes. One box; Mindy finds the NAICS + PSC so
                users never have to know which is which. (Manual fields below.) */}
            <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
              <label className="block text-sm font-medium text-white mb-1">Not sure of the codes? Describe what you do</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={describeText}
                  onChange={(e) => setDescribeText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runDescribeSuggest(); } }}
                  placeholder='e.g. "drone repair", "demolition", "IT cybersecurity"'
                  className="h-10 flex-1 rounded-lg border border-hairline bg-ground px-3 text-sm text-white placeholder-faint focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={runDescribeSuggest}
                  disabled={describing || !describeText.trim()}
                  className="h-10 shrink-0 rounded-lg bg-purple-600 px-5 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  {describing ? 'Finding…' : 'Suggest codes'}
                </button>
              </div>
              {(describeNaics.length > 0 || describePsc.length > 0) && (
                <div className="mt-3 space-y-2">
                  {describeNaics.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-faint mb-1">NAICS — tap to add</div>
                      <div className="flex flex-wrap gap-1.5">
                        {describeNaics.map((s) => {
                          const added = parseList(form.naics_codes).includes(s.code);
                          return (
                            <button key={s.code} onClick={() => toggleNaicsCode(s.code)} title={s.name}
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${added ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200' : 'border-slate-600 bg-surface text-slate-200 hover:bg-input'}`}>
                              {added ? <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} /> : <Plus className="h-3 w-3 shrink-0" strokeWidth={2.5} />} {s.code} <span className="max-w-[150px] truncate opacity-70">{s.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {describePsc.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-faint mb-1">PSC — what the gov actually buys — tap to add</div>
                      <div className="flex flex-wrap gap-1.5">
                        {describePsc.map((s) => {
                          const added = parseList(form.psc_codes).includes(s.code);
                          return (
                            <button key={s.code} onClick={() => togglePscSuggestion(s.code)} title={s.name}
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${added ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200' : 'border-purple-500/40 bg-purple-500/10 text-purple-200 hover:bg-purple-500/20'}`}>
                              {added ? <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} /> : <Plus className="h-3 w-3 shrink-0" strokeWidth={2.5} />} {s.code} <span className="max-w-[150px] truncate opacity-70">{s.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* PSC-ADOPTION NUDGE (Eric 2026-07-02). Only 0.4% of users have PSC codes,
                yet PSC is the most precise targeting signal ("what the gov actually buys").
                The one-tap PSC picker lived buried inside the collapsed "Fine-tune" section,
                so nobody found it. Surface a proactive callout when the user has NO PSC but
                we have suggestions for their market — one tap adds the tightest signal. */}
            {parseList(form.psc_codes).length === 0 && pscSuggestions.length > 0 && (
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-3">
                <p className="text-sm text-purple-100">
                  <b>Sharpen your matches with PSC codes.</b> NAICS is your industry; PSC is
                  exactly <i>what the government buys</i> — the most precise signal Mindy can match on.
                </p>
                <div className="mt-2 text-[11px] uppercase tracking-wide text-faint">Top codes for your market — tap to add:</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {pscSuggestions.slice(0, 6).map((p) => (
                    <button
                      key={p.code}
                      onClick={() => togglePscSuggestion(p.code)}
                      title={p.name}
                      className="inline-flex items-center gap-1 rounded-full border border-purple-500/40 bg-purple-500/10 px-2.5 py-1 text-xs text-purple-200 hover:bg-purple-500/20 transition-colors"
                    >
                      + {p.code} <span className="max-w-[150px] truncate opacity-70">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Manual fine-tune — collapsed by default so most users just use the
                describe box above. Power users expand to paste/edit codes directly. */}
            <button
              onClick={() => setShowManualCodes((v) => !v)}
              className="flex items-center gap-1.5 text-sm text-muted hover:text-slate-200"
            >
              <span className={`transition-transform ${showManualCodes ? 'rotate-90' : ''}`}>▸</span>
              Fine-tune codes manually
              {(parseList(form.naics_codes).length > 0 || parseList(form.psc_codes).length > 0) && (
                <span className="text-xs text-faint">({parseList(form.naics_codes).length} NAICS · {parseList(form.psc_codes).length} PSC)</span>
              )}
            </button>

            {showManualCodes && (
            <div className="space-y-5 rounded-xl border border-surface bg-ground-deep/30 p-4">
            <div>
              <label className="block text-sm font-medium text-ink-soft mb-1">NAICS Codes</label>
              <NaicsPicker
                value={parseList(form.naics_codes)}
                onChange={(codes) => setForm({ ...form, naics_codes: codes.join(', ') })}
                placeholder='Search by description (e.g. "consulting") or paste a code'
              />
            </div>
            <div>
              <Field
                label="PSC Codes"
                value={form.psc_codes}
                onChange={(value) => setForm({ ...form, psc_codes: value })}
                placeholder="e.g. R425, 1550, P500"
              />
              <p className="mt-1 text-xs text-faint">
                Product/Service codes — <b>what the government actually buys</b> (more precise than NAICS). Comma-separated.
              </p>
              {/* Labeled chips for the codes already entered — hover shows the full
                  PSC title (restores the "hover tells you the code" behavior the
                  plain text field lost). Read-only; edit in the field above. */}
              {parseList(form.psc_codes).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {parseList(form.psc_codes).map((code) => {
                    // Say what we actually KNOW. "Unknown PSC" asserted the code
                    // was not real; what we knew was "not in our reference file"
                    // — a statement about US. D314 was real, 9% of the user's
                    // market, and recommended by our own coverage hint (Robert
                    // Parks, 2026-08-15). He believed the label and swapped in a
                    // code that added nothing.
                    const verdict = pscStatus(code);
                    const entry = verdict.status === 'valid' ? getPsc(code) : null;
                    const title = `${verdict.code} — ${verdict.label}`;
                    return (
                      <span
                        key={code}
                        title={title}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                          verdict.status === 'valid'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                            : verdict.status === 'malformed'
                              ? 'border-red-500/40 bg-red-500/10 text-red-200'
                              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                        }`}
                      >
                        <span className="font-medium">{entry?.code || verdict.code}</span>
                        <span className="max-w-[220px] truncate opacity-70">{verdict.label}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              {pscSuggestions.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] uppercase tracking-wide text-faint mb-1">Top codes for your market — tap to add or remove:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {pscSuggestions.map((p) => {
                      const added = parseList(form.psc_codes).includes(p.code);
                      return (
                        <button
                          key={p.code}
                          onClick={() => togglePscSuggestion(p.code)}
                          title={added ? `Click to remove ${p.code}` : p.name}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${added ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25' : 'border-purple-500/40 bg-purple-500/10 text-purple-200 hover:bg-purple-500/20'}`}
                        >
                          {added ? <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} /> : <Plus className="h-3 w-3 shrink-0" strokeWidth={2.5} />} {p.code} <span className="max-w-[150px] truncate opacity-70">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div>
              <Field
                label="Keywords"
                value={form.keywords}
                onChange={(value) => setForm({ ...form, keywords: value })}
                placeholder="e.g. drone repair, cybersecurity, base operations"
              />
              <p className="mt-1 text-xs text-faint">
                What Mindy searches for in the opportunity TEXT — catches the work your NAICS codes miss.
                Comma-separated. Tip: run a <span className="text-purple-300">Market Research</span> and click
                &ldquo;Save this market to my profile&rdquo; to fill these automatically.
              </p>
            </div>
            </div>
            )}
            <Field label="Target Agencies" value={form.target_agencies} onChange={(value) => setForm({ ...form, target_agencies: value })} placeholder="VA, DHS, Army, GSA" />

            <StatesField
              value={form.location_states}
              onChange={(states) => setForm({ ...form, location_states: states })}
            />
            {/* "Start over" moved to the top "Your targeting" card header (next to
                Edit) where it's discoverable — Eric QC 2026-06-17. */}
          </section>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => saveSettings(false)}
              disabled={saving}
              className="px-5 py-2 bg-surface hover:bg-input disabled:opacity-60 text-slate-200 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              onClick={() => saveSettings(true)}
              disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-lg font-medium transition-colors"
            >
              Mark Onboarding Complete
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <BillingCard email={email} tier={tier} getAuthHeaders={getAuthHeaders} />

          {/* Solo -> Team upgrade. Shown to paid (pro) solo users; free users
              upgrade to Pro first via the Billing card above. */}
          {tier === 'pro' && <TeamUpgradeCard email={email} getAuthHeaders={getAuthHeaders} />}

          <div className="bg-ground border border-surface rounded-xl p-5">
            <h2 className="font-semibold text-white">Getting started</h2>
            {/* The guided product tour is NEW-USER onboarding — hide it in Coach
                Mode (a coach operating inside a client workspace). Eric, Jun 23
                2026: "coach mode should not require a tour on clients." The setup
                progress below still helps a coach finish the client's profile. */}
            {!isClientProfile && (
              <>
                <p className="text-sm text-muted mt-1">New to Mindy? Take the 2-minute guided tour of the core workflow.</p>
                {/* PRIMARY action: launch the tour (Eric: this card should let you
                    TAKE the tour, not mark it complete). */}
                <button
                  onClick={() => window.dispatchEvent(new Event('mindy:start-tour'))}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
                >
                  <Compass className="h-4 w-4 shrink-0" strokeWidth={2} /> Take the product tour
                </button>
              </>
            )}
            {/* Quiet setup-progress underneath (informational, not the CTA). */}
            <div className="mt-4 pt-4 border-t border-surface space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-faint">Setup progress</p>
              <ChecklistItem label="Profile saved" done={Boolean(form.display_name || form.company_name)} />
              <ChecklistItem label="NAICS selected" done={parseList(form.naics_codes).length > 0} />
              <ChecklistItem label="Agencies selected" done={parseList(form.target_agencies).length > 0 || targetListCount > 0} />
            </div>
          </div>

          <div className="bg-ground border border-surface rounded-xl p-5">
            <h2 className="font-semibold text-white mb-2">Session</h2>
            <p className="text-sm text-muted">
              Your session is protected by a signed two-factor token and expires after 30 days.
            </p>
          </div>

          {/* Change email — moves the whole account (plan, saved work, settings)
              to a new address. A confirmation link goes to the NEW email; nothing
              changes until it's clicked, and the current email keeps working. */}
          <div className="bg-ground border border-surface rounded-xl p-5">
            <h2 className="font-semibold text-white mb-2">Change email</h2>
            <p className="text-sm text-muted mb-3">
              Your current email is <span className="text-white">{email}</span>. We&apos;ll send a
              confirmation link to your new address — your plan and saved work move with you, and
              your current email keeps working until you confirm.
            </p>
            {changeEmailStage === 'sent' ? (
              <div className="text-sm text-emerald-400">
                {changeEmailMsg?.text}
                <button
                  onClick={() => { setChangeEmailStage('idle'); setChangeEmailMsg(null); setNewEmail(''); }}
                  className="ml-2 text-muted underline hover:text-white"
                >
                  Use a different email
                </button>
              </div>
            ) : (
              // STACKED, not sm:flex-row. This card lives in a NARROW right-hand
              // column, so side-by-side put a whitespace-nowrap button next to a
              // flex-1 input and the button overflowed the card — "Send confirmatio…"
              // clipped at the edge (Eric's screenshot, 2026-07-27). The sm: breakpoint
              // refers to the VIEWPORT, not this column, so it fired even though the
              // column stayed narrow.
              <div className="flex flex-col gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="new@email.com"
                  className="w-full min-w-0 bg-surface border border-surface rounded-lg px-3 py-2 text-white text-sm placeholder:text-faint focus:outline-none focus:border-accent"
                />
                <button
                  onClick={requestEmailChange}
                  disabled={changeEmailBusy || !newEmail.trim()}
                  className="w-full bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  {changeEmailBusy ? 'Sending…' : 'Send confirmation'}
                </button>
              </div>
            )}
            {changeEmailStage === 'idle' && changeEmailMsg && (
              <p className={`text-sm mt-2 ${changeEmailMsg.kind === 'err' ? 'text-red-400' : 'text-emerald-400'}`}>
                {changeEmailMsg.text}
              </p>
            )}
          </div>

          {/* Change password — Settings previously had Session + Change email but no
              password control at all. An account created through Google/Microsoft
              OAuth has NO password, and the MCP connector flow needs one, so those
              users had no in-app way to create it (they had to guess at
              /app/forgot-password). Sends the same reset link that page does. */}
          <div className="bg-ground border border-surface rounded-xl p-5">
            <h2 className="font-semibold text-white mb-2">Change password</h2>
            <p className="text-sm text-muted">
              We&apos;ll email a secure link to <span className="text-ink-soft">{email}</span> to set a new
              password. Use this to add a password if you signed up with Google or Microsoft.
            </p>
            <button
              onClick={requestPasswordReset}
              disabled={pwBusy || !email}
              className="mt-3 w-full bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {pwBusy ? 'Sending…' : 'Email me a password link'}
            </button>
            {pwMsg && (
              <p className={`text-sm mt-2 ${pwMsg.kind === 'err' ? 'text-red-400' : 'text-emerald-400'}`}>
                {pwMsg.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wider text-faint">{title}</h2>;
}

interface BillingState {
  hasSubscription: boolean;
  /** Which email the plan was actually found on — differs from the signed-in address when it
   *  came from a verified linked email. */
  resolvedVia?: string;
  subscription?: {
    status: string;
    planName: string;
    amount: number | null;
    currency: string;
    interval: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
}


/**
 * Connect another email address — self-serve fix for "bought with one email, signed in with
 * another" (Eric, 2026-07-29: that pattern is a STANDARD, not a bug).
 *
 * Flow: user enters the address they checked out with -> a 6-digit code is mailed TO THAT
 * ADDRESS -> they enter it -> the link is stored verified, and /api/app/billing + the Stripe
 * portal start including that address when resolving their plan.
 *
 * The link is user-asserted and OTP-proven, never inferred: nothing in our data connects two
 * addresses, so auto-linking would be a guess and a wrong guess would expose one customer's
 * billing to another.
 */
function LinkEmailControl({
  email,
  getAuthHeaders,
}: {
  email: string | null;
  getAuthHeaders: (init?: HeadersInit) => HeadersInit;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'enter' | 'code' | 'done'>('enter');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [linked, setLinked] = useState<string[]>([]);

  useEffect(() => {
    if (!email || !open) return;
    (async () => {
      try {
        const r = await authedFetch(`/api/app/linked-emails?email=${encodeURIComponent(email)}`, email);
        const d = await r.json();
        if (d?.success) setLinked(d.linked || []);
      } catch { /* non-fatal */ }
    })();
  }, [email, open, getAuthHeaders]);

  const send = useCallback(async () => {
    if (!email || !target.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await authedFetch('/api/app/linked-emails', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, targetEmail: target.trim() }),
      });
      const d = await r.json();
      if (d?.success) { setStage('code'); setMsg(d.message); } else setErr(d?.error || 'Could not send the code.');
    } catch { setErr('Could not send the code.'); }
    finally { setBusy(false); }
  }, [email, target, getAuthHeaders]);

  const confirm = useCallback(async () => {
    if (!email || !code.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await authedFetch('/api/app/linked-emails', email, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, targetEmail: target.trim(), code: code.trim() }),
      });
      const d = await r.json();
      if (d?.success) {
        setStage('done');
        setMsg(d.message);
        // Reload so Billing re-resolves and the newly-linked plan appears.
        setTimeout(() => window.location.reload(), 1400);
      } else setErr(d?.error || 'Could not confirm that code.');
    } catch { setErr('Could not confirm that code.'); }
    finally { setBusy(false); }
  }, [email, target, code, getAuthHeaders]);

  if (!open) {
    return (
      <p className="text-[11px] text-faint">
        Plan missing or not the one you expected?{' '}
        <button type="button" onClick={() => setOpen(true)} className="underline underline-offset-2 hover:text-ink-soft">
          Connect the email you checked out with
        </button>
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-hairline bg-surface/40 p-3 space-y-2">
      <p className="text-[11px] text-ink-soft">
        If you paid using a different email, connect it here and its subscription will show up in
        your billing — including the option to cancel.
      </p>

      {linked.length > 0 && (
        <p className="text-[11px] text-faint">
          Connected: {linked.join(', ')}
        </p>
      )}

      {stage === 'enter' && (
        <div className="flex gap-2">
          <input
            type="email"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="email you checked out with"
            className="flex-1 rounded-md border border-hairline bg-input px-2 py-1.5 text-xs text-white placeholder:text-faint"
          />
          <button
            type="button" onClick={send} disabled={busy || !target.trim()}
            className="rounded-md bg-surface border border-hairline px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </div>
      )}

      {stage === 'code' && (
        <div className="flex gap-2">
          <input
            inputMode="numeric" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && confirm()}
            placeholder="6-digit code"
            className="flex-1 rounded-md border border-hairline bg-input px-2 py-1.5 text-xs tracking-widest text-white placeholder:text-faint"
          />
          <button
            type="button" onClick={confirm} disabled={busy || code.length < 6}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      )}

      {msg && <p className="text-[11px] text-emerald-300">{msg}</p>}
      {err && <p className="text-[11px] text-red-300">{err}</p>}
    </div>
  );
}

// Billing card — current plan + a single "Manage Billing" button that opens
// Stripe's hosted Billing Portal (change plan, cancel, update card, download
// invoices, payment history). All subscription mutations + PCI handled by
// Stripe; we only read the current state for display.
function BillingCard({
  email,
  tier,
  getAuthHeaders,
}: {
  email: string | null;
  tier: AppTier;
  getAuthHeaders: (init?: HeadersInit) => HeadersInit;
}) {
  const [state, setState] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!email) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch(`/api/app/billing?email=${encodeURIComponent(email)}`, email);
        const data = await res.json();
        if (!cancelled && data?.success) {
          setState({ hasSubscription: !!data.hasSubscription, subscription: data.subscription, resolvedVia: data.resolvedVia });
        }
      } catch { /* non-fatal — card shows the upgrade fallback */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [email, getAuthHeaders]);

  const openPortal = useCallback(async () => {
    if (!email) return;
    setOpening(true);
    setErr(null);
    try {
      const res = await authedFetch('/api/app/billing/portal', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, returnUrl: window.location.href }),
      });
      const data = await res.json();
      if (data?.success && data.url) {
        window.location.href = data.url;
        return;
      }
      setErr(data?.error || 'Could not open billing.');
    } catch {
      setErr('Could not open billing.');
    } finally {
      setOpening(false);
    }
  }, [email, getAuthHeaders]);

  const sub = state?.subscription;
  const renews = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const priceLabel = sub && sub.amount != null
    ? `$${sub.amount}${sub.interval ? `/${sub.interval}` : ''}`
    : null;

  return (
    <div className="bg-ground border border-surface rounded-xl p-5">
      <h2 className="font-semibold text-white mb-3">Billing</h2>

      {loading ? (
        <div className="h-12 rounded-lg bg-surface/60 animate-pulse" />
      ) : (tier !== 'free' && !(state?.hasSubscription && sub)) ? (
        // Already Pro+ but NO personal Stripe subscription — show the plan, NOT an
        // "Upgrade to Pro" CTA. Pro access is a UNION (bundle / comp / team / access
        // flag), so a real Pro user can have zero personal Stripe sub. The old code
        // only special-cased team/enterprise and fell a bundle/comp Pro through to
        // the free "Upgrade to Pro" button (Candice / Whitty-CAP: sidebar "Pro Plan"
        // + green "Upgrade to Pro", Jul 8 2026). Manage-billing needs a Stripe sub,
        // so we don't offer it here — there's nothing to manage.
        //
        // …but "nothing to manage" is not the same as "nowhere to go" (Eric, 2026-07-29:
        // "is there a cancellation option in settings"). This branch is the ONLY thing a
        // team member, comped account, bundle grant or legacy-flag user ever sees, and it
        // used to end in a description with no action — so a user wanting to cancel or
        // change plan had no next step from inside the product. Every path now names WHO
        // owns the billing and offers a way to reach a human.
        <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/15 p-3">
          <span className="text-sm font-medium text-emerald-200">{tierLabel(tier)}</span>
          <p className="text-xs text-muted mt-1">
            {tier === 'team'
              ? 'You have full Pro access through your team. Billing and cancellation are handled by the team owner.'
              : tier === 'enterprise'
                ? 'Enterprise — full access. Billing is handled through your enterprise agreement.'
                : 'You have full Pro access with no personal subscription attached, so there is nothing to cancel here. Your access came from a bundle, a comped grant, or a plan billed elsewhere.'}
          </p>
          <a
            href={`mailto:support@getmindy.ai?subject=${encodeURIComponent(`Billing question — ${tierLabel(tier)}`)}&body=${encodeURIComponent(`Account: ${email || ''}\nPlan shown: ${tierLabel(tier)}\n\nWhat I need help with:\n`)}`}
            className="mt-2 inline-block text-xs font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
          >
            Need to change or cancel? Contact support →
          </a>
        </div>
      ) : state?.hasSubscription && sub ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-surface bg-surface/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white">{sub.planName}</span>
              {priceLabel && <span className="text-sm text-ink-soft">{priceLabel}</span>}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                sub.status === 'active' || sub.status === 'trialing'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-amber-500/15 text-amber-300'
              }`}>
                {sub.status === 'trialing' ? 'Trial' : sub.status === 'past_due' ? 'Past due' : sub.status === 'active' ? 'Active' : sub.status}
              </span>
              {renews && (
                <span className="text-faint">
                  {sub.cancelAtPeriodEnd ? `Cancels ${renews}` : `Renews ${renews}`}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={openPortal}
            disabled={opening}
            className="w-full px-3 py-2 text-sm font-medium text-white bg-surface hover:bg-input border border-hairline rounded-lg transition-colors disabled:opacity-50"
          >
            {opening ? 'Opening…' : 'Manage billing'}
          </button>
          <p className="text-[11px] text-faint">
            Change plan, update your card, cancel, or download invoices — handled securely by Stripe.
          </p>
          {/* Buying with one email and signing in with another is NORMAL user behaviour
              (Eric, 2026-07-29: "our users do this all the time... this is a standard, not a
              bug"). /api/app/billing now fans out over VERIFIED linked addresses, so if the
              plan below was found on a different address we say so — and if the user's plan is
              still missing, they can connect that address themselves rather than emailing
              support. Alisha Martin's case: signed in on an old $99 coaching sub while her live
              $149 Mindy sub sat on another address, no cancel button anywhere. */}
          {state?.resolvedVia && email && state.resolvedVia !== email.toLowerCase() && (
            <p className="text-[11px] text-amber-300/90">
              This plan is billed to <span className="font-medium">{state.resolvedVia}</span>, a
              connected email.
            </p>
          )}
          <LinkEmailControl email={email} getAuthHeaders={getAuthHeaders} />
        </div>
      ) : (
        // No active subscription — free user. Show plan + upgrade CTA.
        <div className="space-y-3">
          <div className="rounded-lg border border-surface bg-surface/40 p-3">
            <span className="text-sm font-medium text-white">{tierLabel(tier)}</span>
            <p className="text-xs text-faint mt-1">No active paid subscription.</p>
          </div>
          <a
            href="/market-intelligence"
            className="block w-full px-3 py-2 text-center text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
          >
            Upgrade to Pro
          </a>
          {/* The one genuinely dangerous case: a user who DID pay but whose subscription
              didn't resolve (wrong Stripe customer record, checkout email ≠ login email,
              webhook lag). Without this they are told "no active subscription" and shown a
              button to buy what they already own, with no way to reach a human. Measured
              2026-07-29: 13% of live emails have 2+ Stripe customer records, so the lookup
              CAN miss a real subscriber — that is exactly what /api/app/billing's
              duplicate-safe resolver was added to reduce. */}
          <p className="text-[11px] text-faint">
            Already subscribed?{' '}
            <a
              href={`mailto:support@getmindy.ai?subject=${encodeURIComponent('I subscribed but Mindy shows no plan')}&body=${encodeURIComponent(`Account: ${email || ''}\nIf you checked out with a different email, please tell us which one.\n\n`)}`}
              className="underline underline-offset-2 hover:text-ink-soft"
            >
              Tell us — you may have checked out with a different email.
            </a>
          </p>
        </div>
      )}

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
    </div>
  );
}

// Solo -> Team upgrade card. Pro users see "Upgrade to Team": they go to the
// Team Stripe checkout, and on return (?team_upgraded=1) we finish provisioning
// the team workspace (which also migrates their personal pipeline/contacts).
function TeamUpgradeCard({
  email,
  getAuthHeaders,
}: {
  email: string | null;
  getAuthHeaders: (init?: HeadersInit) => HeadersInit;
}) {
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [hasTeam, setHasTeam] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;

    (async () => {
      // Returning from Team checkout? Finish provisioning the workspace.
      const params = new URLSearchParams(window.location.search);
      if (params.get('team_upgraded') === '1') {
        setProvisioning(true);
        try {
          const res = await authedFetch('/api/app/team/upgrade', email, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          const data = await res.json();
          if (!cancelled) {
            if (data?.success) setDone(true);
            else setErr(data?.error || 'Could not finish team setup.');
          }
        } catch {
          if (!cancelled) setErr('Could not finish team setup.');
        } finally {
          if (!cancelled) setProvisioning(false);
        }
      }

      // Load upgrade availability + checkout URL.
      try {
        const res = await authedFetch(`/api/app/team/upgrade?email=${encodeURIComponent(email)}`, email);
        const data = await res.json();
        if (!cancelled && data?.success) {
          setHasTeam(!!data.hasTeam);
          setCheckoutUrl(data.checkoutUrl || null);
          setConfigured(!!data.configured);
        }
      } catch { /* non-fatal */ }
    })();

    return () => { cancelled = true; };
  }, [email, getAuthHeaders]);

  // Already on a team — nothing to upsell.
  if (hasTeam || done) {
    if (!done) return null;
    return (
      <div className="bg-ground border border-emerald-500/30 rounded-xl p-5">
        <h2 className="font-semibold text-white mb-1">You&apos;re on a team 🎉</h2>
        <p className="text-sm text-muted">
          Your team workspace is ready and your pursuits moved over. Invite teammates from Team Access.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-ground border border-surface rounded-xl p-5">
      <h2 className="font-semibold text-white mb-1">Work as a team</h2>
      <p className="text-sm text-muted mb-3">
        Add teammates, share your pipeline and contacts, and manage pursuits together.
        Your existing work comes with you.
      </p>
      <ul className="text-xs text-faint space-y-1 mb-4">
        <li>• Up to 5 seats</li>
        <li>• Shared pipeline, contacts &amp; target list</li>
        <li>• Roles: owner, admin, member, viewer</li>
      </ul>

      {provisioning ? (
        <div className="w-full px-3 py-2 text-center text-sm text-ink-soft bg-surface rounded-lg">
          Setting up your team…
        </div>
      ) : checkoutUrl ? (
        <a
          href={checkoutUrl}
          className="block w-full px-3 py-2 text-center text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
        >
          Upgrade to Team
        </a>
      ) : (
        <div className="w-full px-3 py-2 text-center text-sm text-muted bg-surface rounded-lg">
          {configured ? 'Team upgrade unavailable right now.' : 'Team plan coming soon — contact us to get set up.'}
        </div>
      )}

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-sm text-muted mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint outline-none focus:border-emerald-500"
      />
    </label>
  );
}

// Region presets — expand to underlying USPS state abbreviations.
// Mirrors src/lib/utils/state-expansion.ts REGIONS. Kept inline here so
// the panel doesn't need a server round-trip for the lookup.
const REGION_PRESETS: Array<{ label: string; states: string[] }> = [
  { label: 'Northeast', states: ['CT', 'MA', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'] },
  { label: 'Southeast', states: ['AL', 'FL', 'GA', 'KY', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV'] },
  { label: 'Midwest',  states: ['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI'] },
  { label: 'Southwest', states: ['AZ', 'NM', 'OK', 'TX'] },
  { label: 'Mountain',  states: ['CO', 'ID', 'MT', 'UT', 'WY'] },
  { label: 'Pacific',   states: ['AK', 'CA', 'HI', 'OR', 'WA', 'NV'] },
  { label: 'DC Metro',  states: ['DC', 'MD', 'VA'] },
];

const ALL_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY','DC','PR',
];

function StatesField({ value, onChange }: { value: string[]; onChange: (states: string[]) => void }) {
  const selected = new Set(value.map((s) => s.toUpperCase()));
  const toggleState = (state: string) => {
    const next = new Set(selected);
    if (next.has(state)) next.delete(state); else next.add(state);
    onChange(Array.from(next).sort());
  };
  const applyRegion = (states: string[]) => {
    const next = new Set(selected);
    states.forEach((s) => next.add(s));
    onChange(Array.from(next).sort());
  };
  const clearAll = () => onChange([]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="block text-sm text-muted">
          States{' '}
          <span className="text-xs text-faint">
            ({selected.size === 0 ? 'all states / national' : `${selected.size} selected`})
          </span>
        </span>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-faint hover:text-ink-soft underline"
          >
            Clear (national)
          </button>
        )}
      </div>

      {/* Region presets — additive: clicking adds the region's states
          to the current selection so users can build "Southeast + DC". */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {REGION_PRESETS.map((region) => (
          <button
            key={region.label}
            type="button"
            onClick={() => applyRegion(region.states)}
            className="px-2.5 py-1 text-xs rounded-md border border-hairline bg-surface/60 text-ink-soft hover:border-emerald-500 hover:text-emerald-300 transition-colors"
          >
            + {region.label}
            <span className="text-faint ml-1">({region.states.length})</span>
          </button>
        ))}
      </div>

      {/* Per-state toggle grid */}
      <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-13 gap-1 rounded-lg border border-surface bg-ground/60 p-2 max-h-48 overflow-y-auto">
        {ALL_STATES.map((state) => {
          const on = selected.has(state);
          return (
            <button
              key={state}
              type="button"
              onClick={() => toggleState(state)}
              className={`px-1.5 py-1 text-xs rounded font-medium transition-colors ${
                on
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-surface/40 text-muted hover:bg-surface hover:text-slate-200'
              }`}
            >
              {state}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-faint mt-2">
        Opportunities will be scoped to selected states only. Leave empty for a national feed.
      </p>
    </div>
  );
}

function ChecklistItem({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`h-5 w-5 rounded-full flex items-center justify-center ${done ? 'bg-emerald-500 text-white' : 'bg-surface text-faint'}`}>
        {done && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className={done ? 'text-slate-200' : 'text-faint'}>{label}</span>
    </div>
  );
}

/**
 * Split a free-text list field into entries.
 *
 * Splits on newline/semicolon/tab/pipe as well as comma. The label says
 * "Comma-separated", but people paste capability lists straight out of a doc —
 * newline- or bullet-separated — and a comma-only split stored the ENTIRE paste
 * as one entry. That produced a 1,604-character "keyword" for one customer,
 * which matches almost nothing (they reported the tool as broken). 17 such
 * entries existed across 10 accounts before this fix.
 *
 * NOT split on space — multi-word entries are legitimate ("base operations
 * support"), and splitting on spaces would shred them.
 */
function parseList(value: string) {
  return value.split(/[,;\n\r\t|•·]+/).map(item => item.trim()).filter(Boolean);
}

function tierLabel(tier: AppTier) {
  return tier === 'free' ? 'Free plan' : tier === 'pro' ? 'Pro plan' : tier === 'team' ? 'Team plan' : 'Enterprise plan';
}
