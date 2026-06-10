/**
 * resolveAccess — the single source of truth for "what access does this email have."
 *
 * Precedence (PRD-trial-vs-paid-access.md §3):
 *   1. Full paid?  (existing briefings entitlement — KV `briefings:` + Supabase
 *      access_briefings + lifetime/bundle)               → 'pro' (permanent)
 *   2. Trial active? (trial_ends_at > now AND the global MINDY_TRIAL_OPEN switch is ON)
 *                                                          → 'pro' (temporary)
 *   3. Else                                               → 'free'
 *
 * THE SCAR (CLAUDE.md): a hardcoded global BETA_END_DATE once collapsed sends 922→1.
 * So: the date is PER-USER (never a global calendar gate in code); the switch is an
 * ENV flag; and EVERY failure path falls open to 'free' (alerts still work), NEVER to
 * broken/no-access.
 */

import { createClient } from '@supabase/supabase-js';
import { hasBriefingsAccess } from '@/lib/briefings/access';

export type AccessLevel = 'pro' | 'free';
export type AccessSource = 'stripe' | 'lifetime' | 'trial' | 'free';

export interface AccessResult {
  level: AccessLevel;
  source: AccessSource;
  trialEndsAt: string | null; // ISO, when source === 'trial'
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Is the global trial window open? Defaults to ON unless explicitly turned off. */
export function isTrialOpen(): boolean {
  const flag = (process.env.MINDY_TRIAL_OPEN || '').trim().toLowerCase();
  // Treat 'off' / 'false' / '0' as closed; anything else (incl. unset) = open.
  return !['off', 'false', '0', 'no'].includes(flag);
}

export async function resolveAccess(email: string): Promise<AccessResult> {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) return { level: 'free', source: 'free', trialEndsAt: null };

  // 1) Full paid — reuse the existing entitlement gate (KV briefings: + Supabase
  //    access_briefings + expiry). This is the permanent Pro signal.
  try {
    if (await hasBriefingsAccess(normalized)) {
      return { level: 'pro', source: 'stripe', trialEndsAt: null };
    }
  } catch (err) {
    // Fail OPEN to the trial/free check — never block on an entitlement error.
    console.warn(`[resolveAccess] paid check failed for ${normalized}; continuing`, err);
  }

  // 2) Trial — per-user trial_ends_at, gated by the global switch.
  // The date can live on EITHER table: user_profiles (once a user logs in + creates a
  // profile) OR user_notification_settings (email-only beta users who haven't logged
  // into v1.0 yet — the seed cohort lives here). Check both; earliest-existing wins.
  if (isTrialOpen()) {
    try {
      const sb = getSupabase();
      if (sb) {
        const [profileRes, notifRes] = await Promise.all([
          sb.from('user_profiles').select('trial_ends_at').eq('email', normalized).maybeSingle(),
          sb.from('user_notification_settings').select('trial_ends_at').eq('user_email', normalized).maybeSingle(),
        ]);
        const ends =
          profileRes.data?.trial_ends_at ||
          notifRes.data?.trial_ends_at ||
          null;
        if (ends && new Date(ends).getTime() >= Date.now()) {
          return { level: 'pro', source: 'trial', trialEndsAt: ends };
        }
      }
    } catch (err) {
      // Fail OPEN to free — an expired/missing/errored trial drops cleanly to free.
      console.warn(`[resolveAccess] trial check failed for ${normalized}; → free`, err);
    }
  }

  // 3) Free — the safe default. Alerts + limited research still work.
  return { level: 'free', source: 'free', trialEndsAt: null };
}

/** Convenience: does this email get Pro-level access right now? */
export async function hasProAccess(email: string): Promise<boolean> {
  return (await resolveAccess(email)).level === 'pro';
}
