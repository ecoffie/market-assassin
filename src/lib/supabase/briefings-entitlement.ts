/**
 * Briefings entitlement ↔ delivery reconciliation.
 *
 * THE BUG THIS EXISTS TO PREVENT
 *
 * Briefings need TWO flags in TWO tables to agree:
 *   user_profiles.access_briefings            — "they are entitled"
 *   user_notification_settings.briefings_enabled — "the cron will send to them"
 *
 * `precompute-briefings` builds its audience with
 * `.eq('briefings_enabled', true)`. So entitlement alone delivers nothing.
 *
 * `briefings_enabled` defaults to FALSE on profile creation (app/profile,
 * free-profile, bootcamp-rollout, batch-enroll-alerts). The Stripe webhook sets
 * it true — but ONLY on that path. Every other way of granting access
 * (admin grant, FHC sync, MI onboarding, bundle purchase applied by hand,
 * user-audit) writes `access_briefings` in user_profiles and never touches the
 * settings row.
 *
 * Result, found 2026-08-05: 27 active accounts entitled to briefings with
 * delivery switched off — 14 of them with purchases totalling $7,202. They had
 * real targeting and were receiving alerts, so nothing looked broken. They had
 * simply never received a briefing they paid for.
 *
 * Rather than patch a dozen grant sites (which is how this drifted in the first
 * place — the next new grant path would miss it too), grant paths call
 * `enableBriefingsDelivery()` and a watchdog re-checks the invariant daily.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isBriefingEntitled } from '@/lib/briefings/delivery/rollout';

export interface EnableBriefingsResult {
  ok: boolean;
  /** true when this call actually flipped the flag (false = already on, or skipped) */
  changed: boolean;
  /** set when we deliberately did nothing */
  skipped?: 'opted_out' | 'no_settings_row';
  error?: string;
}

/**
 * Turn on briefing DELIVERY for someone who has just been granted access.
 *
 * Call this anywhere `user_profiles.access_briefings` is set to true.
 * Safe to call repeatedly — it no-ops when delivery is already enabled.
 *
 * Deliberately does NOT create a settings row: without NAICS or keywords a
 * briefing is generic, and inventing targeting is worse than sending nothing.
 * The absence is reported so the caller can route them to onboarding.
 *
 * NEVER re-enables someone with `is_active = false` — that is an explicit
 * opt-out and an entitlement does not override it.
 */
export async function enableBriefingsDelivery(
  supabase: SupabaseClient,
  email: string,
): Promise<EnableBriefingsResult> {
  const userEmail = String(email || '').toLowerCase().trim();
  if (!userEmail) return { ok: false, changed: false, error: 'no email' };

  const { data: settings, error: readErr } = await supabase
    .from('user_notification_settings')
    .select('user_email, briefings_enabled, is_active')
    .eq('user_email', userEmail)
    .maybeSingle();

  if (readErr) return { ok: false, changed: false, error: readErr.message };

  // No settings row — they have no targeting, so a briefing would be generic.
  // Report it instead of fabricating one.
  if (!settings) return { ok: true, changed: false, skipped: 'no_settings_row' };

  // An explicit opt-out outranks an entitlement.
  if (settings.is_active === false) return { ok: true, changed: false, skipped: 'opted_out' };

  if (settings.briefings_enabled === true) return { ok: true, changed: false };

  const { error: writeErr } = await supabase
    .from('user_notification_settings')
    .update({ briefings_enabled: true, updated_at: new Date().toISOString() })
    .eq('user_email', userEmail);

  if (writeErr) return { ok: false, changed: false, error: writeErr.message };
  return { ok: true, changed: true };
}

export interface DriftRow {
  user_email: string;
  naics_count: number;
  keyword_count: number;
  paid_status: boolean | null;
  /**
   * Does this account pass customer_classifications — the gate the SENDER
   * enforces? When false, setting briefings_enabled=true delivers nothing:
   * the account just moves from being skipped at one gate to the next.
   */
  entitlement_ok: boolean;
  /** Current briefings_access, or null when there is no classification row. */
  briefings_access: string | null;
}

/**
 * Find accounts entitled to briefings whose delivery is switched off — the
 * invariant `access_briefings = true` ⇒ `briefings_enabled = true`.
 *
 * Read-only. Excludes opt-outs (`is_active = false`) and accounts with no
 * targeting at all, since a briefing for those would be generic — both are
 * legitimately off, not drift.
 */
export async function findBriefingsDrift(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; rows: DriftRow[]; error?: string }> {
  const { data: entitled, error: profErr } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('access_briefings', true);

  if (profErr) return { ok: false, rows: [], error: profErr.message };

  const emails = (entitled || [])
    .map(r => String((r as { email?: string }).email || '').toLowerCase().trim())
    .filter(Boolean);
  if (emails.length === 0) return { ok: true, rows: [] };

  const rows: DriftRow[] = [];
  // Chunked so a large entitled population doesn't blow the URL length.
  const CHUNK = 200;
  for (let i = 0; i < emails.length; i += CHUNK) {
    const slice = emails.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, paid_status')
      .in('user_email', slice)
      .eq('briefings_enabled', false)
      .eq('is_active', true);

    if (error) return { ok: false, rows: [], error: error.message };

    // The gate the sender actually enforces. Without it this monitor reported
    // "fix: set briefings_enabled=true" for accounts where that is a NO-OP
    // (2026-08-14: all 18 it named were blocked here instead).
    const { data: classRows, error: classErr } = await supabase
      .from('customer_classifications')
      .select('email, briefings_access, briefings_expiry')
      .in('email', slice);
    if (classErr) return { ok: false, rows: [], error: classErr.message };

    const byEmail = new Map<string, { briefings_access: string | null; briefings_expiry: string | null }>();
    for (const c of classRows || []) {
      const cr = c as { email: string; briefings_access?: string | null; briefings_expiry?: string | null };
      byEmail.set(String(cr.email).toLowerCase().trim(), {
        briefings_access: cr.briefings_access ?? null,
        briefings_expiry: cr.briefings_expiry ?? null,
      });
    }

    for (const r of data || []) {
      const row = r as { user_email: string; naics_codes?: unknown[] | null; keywords?: unknown[] | null; paid_status?: boolean | null };
      const naics = (row.naics_codes || []).length;
      const kw = (row.keywords || []).length;
      // No targeting at all → a briefing would be generic. Not drift.
      if (naics === 0 && kw === 0) continue;
      const key = String(row.user_email).toLowerCase().trim();
      const cls = byEmail.get(key);
      rows.push({
        user_email: row.user_email,
        naics_count: naics,
        keyword_count: kw,
        paid_status: row.paid_status ?? null,
        entitlement_ok: cls ? isBriefingEntitled({ email: key, ...cls }) : false,
        briefings_access: cls ? cls.briefings_access : null,
      });
    }
  }

  return { ok: true, rows };
}
