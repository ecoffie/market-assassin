/**
 * Why sendEmail()'s global send guard blocked a send — classified for alert_log + monitoring.
 *
 * sendEmail() returns `false` ONLY when its guard blocks, and hands the exact reason to the
 * caller's `onBlocked` callback (src/lib/send-email.ts, emailGuardBlock). The reasons it can
 * produce are:
 *   - `suppressed:<reason>`       mailbox suppression (unsubscribe, bounce, complaint) — the
 *                                 guard HONORING the recipient, not a delivery failure;
 *   - `suppression_check_failed`  the suppression lookup errored, so the guard failed CLOSED —
 *                                 a processing failure (the recipient was probably fine);
 *   - `synthetic_client_address`  a Coach-Mode `@clients.getmindy.ai` placeholder recipient —
 *                                 a setup action item (no real inbox configured);
 *   - `daily_cap:` / `daily_cap_promo_yield:` the per-recipient daily cap. STRUCTURALLY
 *                                 impossible for `daily_alert` / `weekly_alert`: both are in
 *                                 CAP_EXEMPT_TYPES, so the cap branch returns null for them.
 *
 * The alert crons keep `error_message = 'send_guard_blocked'` (watch-key-accounts and
 * throughput-digest match on that exact string) and store the raw reason as `guard_reason` in
 * the row's `opportunities_data` context object. A row without one (written before this field
 * existed, or by a path that does not capture it) classifies as `unknown` — never as suppressed.
 */

export type GuardBlockClass = 'suppressed' | 'synthetic' | 'check_failed' | 'daily_cap' | 'unknown';

export const GUARD_BLOCK_CLASSES: readonly GuardBlockClass[] = ['suppressed', 'synthetic', 'check_failed', 'daily_cap', 'unknown'];

export function classifyGuardReason(reason: unknown): GuardBlockClass {
  if (typeof reason !== 'string' || reason.length === 0) return 'unknown';
  if (reason.startsWith('suppressed:')) return 'suppressed';
  if (reason === 'suppression_check_failed') return 'check_failed';
  if (reason === 'synthetic_client_address') return 'synthetic';
  if (reason.startsWith('daily_cap')) return 'daily_cap';
  return 'unknown';
}

/** The `guard_reason` stored in an alert_log row's opportunities_data context, if any. */
export function guardReasonFromOpportunitiesData(data: unknown): string | null {
  if (!Array.isArray(data)) return null;
  for (const entry of data) {
    if (entry && typeof entry === 'object' && typeof (entry as { guard_reason?: unknown }).guard_reason === 'string') {
      return (entry as { guard_reason: string }).guard_reason;
    }
  }
  return null;
}

export type GuardBlockBreakdown = Record<GuardBlockClass, number>;

export function summarizeGuardBlocks(rows: { opportunities_data: unknown }[]): GuardBlockBreakdown {
  const out: GuardBlockBreakdown = { suppressed: 0, synthetic: 0, check_failed: 0, daily_cap: 0, unknown: 0 };
  for (const r of rows) out[classifyGuardReason(guardReasonFromOpportunitiesData(r.opportunities_data))]++;
  return out;
}

/**
 * Blocks that mean an alert the user should have received did NOT go out for a reason other
 * than the recipient's own suppression. Suppression is the guard honoring an unsubscribe or a
 * bounce and is reported separately, never as a delivery failure. `unknown` counts here: an
 * unclassified block cannot be assumed benign.
 */
export function nonSuppressionBlocks(b: GuardBlockBreakdown): number {
  return b.check_failed + b.synthetic + b.daily_cap + b.unknown;
}

/**
 * The throughput-digest "Send guard" reading for one window of `send_guard_blocked` alert_log
 * rows. Suppression is reported but never counts against `maxLost`.
 */
export function sendGuardCheckFromRows(
  rows: { opportunities_data: unknown }[],
  maxLost: number,
): { detail: string; value: string; ok: boolean; breakdown: GuardBlockBreakdown; lost: number } {
  const b = summarizeGuardBlocks(rows);
  const lost = nonSuppressionBlocks(b);
  const parts: string[] = [];
  if (b.check_failed) parts.push(`${b.check_failed} suppression lookup failed (fail-closed)`);
  if (b.synthetic) parts.push(`${b.synthetic} synthetic client address (no real inbox set)`);
  if (b.daily_cap) parts.push(`${b.daily_cap} daily cap (should be 0: alerts are cap-exempt)`);
  if (b.unknown) parts.push(`${b.unknown} reason not recorded`);
  const suppressedNote = b.suppressed
    ? `${b.suppressed} honored recipient suppression (unsubscribe/bounce — not a delivery failure)`
    : 'no recipient suppressions';
  return {
    detail: rows.length === 0
      ? 'no alerts blocked'
      : `${lost === 0 ? 'no alerts lost to processing' : `${lost} alert(s) not sent: ${parts.join(', ')}`}; ${suppressedNote}`,
    value: `${lost} lost · ${b.suppressed} suppressed`,
    ok: lost <= maxLost,
    breakdown: b,
    lost,
  };
}
