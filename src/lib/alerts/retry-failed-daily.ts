/**
 * Daily-alert RETRY path — extracted from `cron/daily-alerts/route.ts` so its
 * contract can be tested (deliverability P0, 2026-09-23).
 *
 * The retry must never resurrect a recipient the normal path would not mail:
 *   1. PRODUCT PREFERENCE — the user row must still exist with alerts_enabled and
 *      is_active. The old loop read the row and never looked at either flag, so a
 *      user who turned alerts off after a failed send was mailed anyway.
 *   2. MAILBOX SUPPRESSION — the actual recipient (alert_recipient_email || user_email,
 *      exactly what the send uses) must not be in email_suppressions. sendEmail's guard
 *      would also block it; checking here first records WHY the row was retired.
 *   3. TRUTHFUL OUTCOME — a send that returns false (guard-blocked) is recorded as
 *      skipped, never as 'sent'. The old loop ignored the boolean and stamped 'sent'.
 *
 * Retired rows are moved to delivery_status='skipped' with a reason, so they leave
 * the failed-and-retryable set for good instead of being re-examined for three days.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = { from: (table: string) => any };

export interface RetryUserRow {
  user_email: string;
  alert_recipient_email?: string | null;
  alerts_enabled?: boolean | null;
  is_active?: boolean | null;
  [key: string]: unknown;
}

export interface FailedAlertRow {
  id: string | number;
  user_email: string;
  retry_count?: number | null;
  opportunities_data?: unknown[] | null;
}

export type RetryDecision =
  | { send: true; recipient: string }
  | { send: false; reason: 'no_user' | 'no_payload' | 'alerts_disabled' | 'inactive' | 'suppressed' };

/** Pure: may this failed row be re-sent at all? Suppression is checked by the caller. */
export function retryPreflight(alert: FailedAlertRow, user: RetryUserRow | null): RetryDecision {
  if (!user) return { send: false, reason: 'no_user' };
  if (!Array.isArray(alert.opportunities_data) || alert.opportunities_data.length === 0) {
    return { send: false, reason: 'no_payload' };
  }
  if (user.alerts_enabled !== true) return { send: false, reason: 'alerts_disabled' };
  if (user.is_active === false) return { send: false, reason: 'inactive' };
  const recipient = String(user.alert_recipient_email || user.user_email || alert.user_email).trim().toLowerCase();
  return { send: true, recipient };
}

export interface RetryDeps {
  supabase: SupabaseLike;
  /** Re-send one alert; must return sendEmail's boolean (false = guard-blocked). */
  send: (alert: FailedAlertRow, user: RetryUserRow) => Promise<boolean>;
  isSuppressed: (recipient: string) => Promise<boolean>;
  today?: string; // YYYY-MM-DD, injectable for tests
}

export interface RetryResult {
  retried: number;
  succeeded: number;
  skipped: number;
  failed: number;
  skipReasons: Record<string, number>;
}

export async function retryFailedDailyAlerts(deps: RetryDeps): Promise<RetryResult> {
  const { supabase, send, isSuppressed } = deps;
  const result: RetryResult = { retried: 0, succeeded: 0, skipped: 0, failed: 0, skipReasons: {} };

  const today = deps.today || new Date().toISOString().split('T')[0];
  const threeDaysAgo = new Date(`${today}T00:00:00Z`);
  threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3);

  const { data: failedAlerts, error } = await supabase
    .from('alert_log')
    .select('id, user_email, retry_count, opportunities_data')
    .eq('alert_type', 'daily')
    .eq('delivery_status', 'failed')
    .lt('retry_count', 3)
    .gte('alert_date', threeDaysAgo.toISOString().split('T')[0])
    .lt('alert_date', today);
  if (error) {
    console.error('[Daily Alerts] retry query failed (no retries this run):', error.message);
    return result;
  }
  if (!failedAlerts || failedAlerts.length === 0) return result;

  const retire = async (alert: FailedAlertRow, reason: string) => {
    result.skipped++;
    result.skipReasons[reason] = (result.skipReasons[reason] || 0) + 1;
    const { error: upErr } = await supabase
      .from('alert_log')
      .update({ delivery_status: 'skipped', error_message: `retry_skipped:${reason}` })
      .eq('id', alert.id);
    if (upErr) console.error(`[Daily Alerts] could not retire retry row ${alert.id}:`, upErr.message);
  };

  for (const alert of failedAlerts as FailedAlertRow[]) {
    result.retried++;
    try {
      const { data: user, error: userErr } = await supabase
        .from('user_notification_settings')
        .select('*')
        .eq('user_email', alert.user_email)
        .maybeSingle();
      if (userErr) throw new Error(`user lookup failed: ${userErr.message}`);

      const pre = retryPreflight(alert, (user as RetryUserRow) || null);
      if (!pre.send) {
        await retire(alert, pre.reason);
        continue;
      }
      if (await isSuppressed(pre.recipient)) {
        await retire(alert, 'suppressed');
        continue;
      }

      const delivered = await send(alert, user as RetryUserRow);
      if (!delivered) {
        await retire(alert, 'send_guard_blocked');
        continue;
      }

      await supabase
        .from('alert_log')
        .update({ delivery_status: 'sent', sent_at: new Date().toISOString(), error_message: null })
        .eq('id', alert.id);
      result.succeeded++;
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from('alert_log')
        .update({ retry_count: (alert.retry_count || 0) + 1, error_message: message })
        .eq('id', alert.id);
      console.error(`[Daily Alerts] Retry failed for ${alert.user_email}:`, message);
    }
  }

  return result;
}
