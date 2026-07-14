'use client';

/**
 * CapabilityNudge — dismissible in-app prompt for THIN profiles.
 *
 * WHY: ~530 real users onboarded through the manual NAICS wizard with only default
 * generic codes and never described their business, so their keywords are all
 * NAICS-title filler (no distinctive signal). Matching still runs on NAICS, but a
 * one-line capability description would give them real keywords AND sharper matches
 * — and no backfill can conjure that signal (it was never captured). So we ask.
 *
 * Reuses the exact describe→commit path onboarding's "auto" door uses:
 *   /api/app/profile-from-text  (the 98%-accurate extractor — the user's own words)
 *   /api/mindy/profile          (commit: tight/precise NAICS + real keywords)
 *
 * Shows ONLY when the profile is set up (has NAICS) but has zero distinctive
 * keywords. Never shows for brand-new/no-profile users (that's onboarding's job).
 * A nudge must never break the dashboard: every failure path is swallowed to hidden.
 */
import { useCallback, useEffect, useState } from 'react';
import { authedFetch } from './authHeaders';
import { distinctiveKeywords } from '@/lib/market/keyword-sanitize';

type Props = { email: string | null; onUpdated?: () => void };

const dismissKey = (email: string) => `capnudge-dismissed:${email}`;

export default function CapabilityNudge({ email, onUpdated }: Props) {
  const [show, setShow] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    if (!email) return;
    if (typeof window !== 'undefined' && localStorage.getItem(dismissKey(email))) return;
    try {
      const res = await authedFetch(`/api/app/workspace?email=${encodeURIComponent(email)}`, email);
      const d = await res.json().catch(() => null);
      const notif = d?.profile?.notification;
      if (!notif) return; // no profile yet → onboarding handles that, not this nudge
      const kw = Array.isArray(notif.keywords) ? notif.keywords : [];
      const naics = Array.isArray(notif.naics_codes) ? notif.naics_codes : [];
      // Thin = a real, set-up profile (has NAICS) with NO distinctive keywords.
      setShow(naics.length > 0 && distinctiveKeywords(kw).length === 0);
    } catch {
      /* silent: a nudge must never surface an error on the dashboard */
    }
  }, [email]);

  useEffect(() => { void check(); }, [check]);

  async function submit() {
    const t = text.trim();
    if (t.length < 4) { setError('Name the service + where — e.g. "commercial HVAC in Georgia".'); return; }
    if (!email) return;
    setSaving(true); setError('');
    try {
      // 1) Extract a grounded profile from the user's own words (the 98% engine).
      const exRes = await authedFetch('/api/app/profile-from-text', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, text: t }),
      });
      const ex = await exRes.json().catch(() => null);
      if (!exRes.ok || !ex?.success || !(ex?.profile?.naics?.length)) {
        setError(ex?.error || 'Couldn’t read that — try naming the service + state.');
        return;
      }
      // 2) Commit exactly like onboarding's describe path (tight/precise codes + real keywords).
      const saveRes = await authedFetch('/api/mindy/profile', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          businessDescription: t,
          naicsCodes: ex.profile.naics || [],
          precise: true,
          keywords: ex.profile.keywords || [],
        }),
      });
      const sd = await saveRes.json().catch(() => null);
      if (!saveRes.ok || (sd && sd.error)) {
        setError(sd?.error || 'Read that, but couldn’t update your profile — try again.');
        return;
      }
      if (typeof window !== 'undefined') localStorage.setItem(dismissKey(email), '1');
      setShow(false);
      onUpdated?.();
    } catch {
      setError('Something went wrong — try again.');
    } finally {
      setSaving(false);
    }
  }

  function dismiss() {
    if (email && typeof window !== 'undefined') localStorage.setItem(dismissKey(email), '1');
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      role="region"
      aria-label="Sharpen your matches"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        background: 'linear-gradient(135deg, rgba(16,185,129,0.10) 0%, rgba(59,130,246,0.10) 100%)',
        border: '1px solid rgba(16,185,129,0.30)',
        borderRadius: 12,
        padding: '12px 16px',
        margin: '0 0 12px',
      }}
    >
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--foreground, #fff)' }}>✨ Sharpen your matches</div>
        <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>
          You’re on generic codes. Tell Mindy in one line what you do → better-matched opportunities.
        </div>
        {error && <div style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>{error}</div>}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !saving) void submit(); }}
        disabled={saving}
        placeholder='e.g. "commercial HVAC in Georgia"'
        aria-label="Describe what your business does"
        style={{
          flex: '2 1 240px',
          minWidth: 180,
          padding: '9px 12px',
          borderRadius: 8,
          border: '1px solid rgba(148,163,184,0.35)',
          background: 'rgba(2,6,23,0.35)',
          color: 'var(--foreground, #fff)',
          fontSize: 14,
        }}
      />
      <button
        onClick={() => void submit()}
        disabled={saving || text.trim().length < 4}
        style={{
          padding: '9px 18px',
          borderRadius: 8,
          border: 'none',
          background: saving || text.trim().length < 4 ? 'rgba(16,185,129,0.5)' : '#10b981',
          color: '#fff',
          fontWeight: 600,
          fontSize: 14,
          cursor: saving || text.trim().length < 4 ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {saving ? 'Updating…' : 'Update matches'}
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        title="Dismiss"
        style={{ background: 'transparent', border: 'none', color: 'inherit', opacity: 0.6, cursor: 'pointer', fontSize: 16, padding: 4 }}
      >
        ✕
      </button>
    </div>
  );
}
