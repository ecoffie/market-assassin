/**
 * The ONE way a free-side code path establishes a user_notification_settings row (P0-H, 2026-09-27).
 *
 * 665 of 2,760 signed-up users (24.1%) had no settings row, and every path that needed one either
 * refused (opportunities/save 404), silently did nothing (bare .update() matching 0 rows), or
 * created one with its OWN defaults — most of them leaving the DB defaults (briefings_enabled TRUE,
 * treatment_type 'alerts') on a free user (P1-G).
 *
 * Invariants (each pinned by ensure-free-settings-row.unit.test.ts):
 *  - missing  → created with the canonical Free defaults (freeNotificationSettingsInsert);
 *  - existing → NEVER touched. This helper only inserts (ON CONFLICT (user_email) DO NOTHING); a
 *               caller that needs to change fields does its own explicit, counted update afterwards;
 *  - concurrent calls are safe: the unique key on user_email decides, and both callers report the
 *               row as present;
 *  - it can never upgrade an entitlement or (re-)enable alerts/briefings: the only create-time
 *               option is `paused`, which can only turn alerts OFF;
 *  - no silent success: every outcome is 'created' | 'existed' | 'failed', and 'existed' is
 *               confirmed by a read, never assumed from an empty insert.
 *
 * It is deliberately NOT called on sign-in: a Free-default row has alerts ON, so healing every
 * signed-in user would opt 665 people into daily alert email they never asked for. Rows are
 * created lazily, only by an explicit user action that needs one (setup, an authenticated
 * unsubscribe).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { freeNotificationSettingsInsert } from './free-notification-defaults';

export type EnsureFreeSettingsOutcome =
  | { outcome: 'created' }
  | { outcome: 'existed' }
  | { outcome: 'failed'; error: string };

export interface EnsureFreeSettingsOptions {
  /** Create the row with alerts paused (an unsubscribe before any row existed). Has no effect on an existing row. */
  paused?: boolean;
}

export async function ensureFreeSettingsRow(
  sb: SupabaseClient,
  rawEmail: string,
  opts: EnsureFreeSettingsOptions = {},
): Promise<EnsureFreeSettingsOutcome> {
  const email = String(rawEmail || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return { outcome: 'failed', error: 'invalid email' };

  const row: Record<string, unknown> = { ...freeNotificationSettingsInsert(email), updated_at: new Date().toISOString() };
  if (opts.paused) {
    row.alerts_enabled = false;
    row.alert_frequency = 'paused';
  }

  const { count, error } = await sb
    .from('user_notification_settings')
    .upsert(row, { onConflict: 'user_email', ignoreDuplicates: true, count: 'exact' });
  if (error) return { outcome: 'failed', error: error.message };
  if (count === 1) return { outcome: 'created' };

  // 0 (a row already existed) or NULL (unknown): confirm by reading — never assume.
  const { count: present, error: readErr } = await sb
    .from('user_notification_settings')
    .select('user_email', { count: 'exact', head: true })
    .eq('user_email', email);
  if (readErr) return { outcome: 'failed', error: readErr.message };
  if (present === 1) return { outcome: 'existed' };
  return { outcome: 'failed', error: 'settings row could not be established' };
}
