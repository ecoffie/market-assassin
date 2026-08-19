/**
 * Create the row that makes a paying customer REACHABLE — and prove it landed.
 *
 * `user_notification_settings` is what every send path reads. No row means no
 * alerts, no briefings, no email, ever (see lib/onboarding/unonboarded-payers.ts).
 *
 * WHY THIS EXISTS AS A SHARED FUNCTION
 * The row was created inline in exactly ONE place — the checkout webhook's
 * AUTO-ENROLL block — with three defects that stranded 38 paying customers
 * ($34,855) as of 2026-08-19:
 *
 *   1. THE INSERT'S ERROR WAS NEVER READ. `await supabase.from(...).insert(...)`
 *      discarded `{ error }` and then logged "✅ Auto-enrolled" unconditionally,
 *      so a failed insert printed a SUCCESS line. 15 customers had a checkout
 *      session recorded and no settings row — a failure no log could show.
 *   2. IT RAN AFTER AN EARLY RETURN. The purchases-dedup guard returns
 *      `{received:true, duplicate:true}` BEFORE reaching auto-enroll, so a
 *      retried or already-recorded session skips enrollment entirely.
 *   3. ONLY ONE OF THE TWO STRIPE WEBHOOKS DID IT. /api/webhooks/stripe handles
 *      charge.succeeded and subscriptions but has no checkout.session.completed
 *      handler, so purchases arriving that way never got a row — 6 stranded
 *      customers had no stripe_session_id at all.
 *
 * So: one function, error surfaced, idempotent, callable from every path.
 *
 * IDEMPOTENT BY DESIGN — safe to call on every webhook delivery, including
 * retries and duplicates. An existing row is UPDATED (paid state refreshed),
 * never duplicated, and existing targeting is never overwritten.
 *
 * A ROW IS NOT ONBOARDING. This makes the customer reachable; it does not give
 * them NAICS/keywords, and a briefing with no targeting is generic — worse than
 * silence for someone who paid. `needsTargeting` in the result says so
 * explicitly, so callers can route the customer to real onboarding.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface EnsureSettingsResult {
  /** 'created' | 'updated' | 'failed' — what actually happened in the DB. */
  outcome: 'created' | 'updated' | 'failed';
  /** Present only when outcome === 'failed'. Never swallowed. */
  error?: string;
  /** True when the row exists but carries no NAICS/keywords/agencies. */
  needsTargeting: boolean;
}

function countTargeting(row: {
  naics_codes?: unknown[] | null;
  keywords?: unknown[] | null;
  agencies?: unknown[] | null;
} | null | undefined): number {
  if (!row) return 0;
  const n = (v: unknown[] | null | undefined) => (Array.isArray(v) ? v.length : 0);
  return n(row.naics_codes) + n(row.keywords) + n(row.agencies);
}

/**
 * Ensure the settings row exists for a paying customer.
 *
 * @param sb               service-role client
 * @param rawEmail         customer email (normalised here — the table keys on lowercase)
 * @param stripeCustomerId stamped onto the row so paid_status/stripe_customer_id
 *                         reflect reality (they historically drifted null for ~37 payers)
 */
export async function ensureNotificationSettings(
  sb: SupabaseClient,
  rawEmail: string,
  stripeCustomerId: string | null = null,
): Promise<EnsureSettingsResult> {
  const email = String(rawEmail || '').toLowerCase().trim();
  if (!email) return { outcome: 'failed', error: 'empty email', needsTargeting: true };

  // Read first so we can report targeting AND avoid clobbering an existing profile.
  const { data: existing, error: readErr } = await sb
    .from('user_notification_settings')
    .select('user_email, naics_codes, keywords, agencies')
    .eq('user_email', email)
    .limit(1);

  if (readErr) {
    // Surface it. Treating a failed read as "no row" would insert a duplicate;
    // treating it as "row exists" would strand the customer. Neither is safe.
    return { outcome: 'failed', error: `read failed: ${readErr.message}`, needsTargeting: true };
  }

  const now = new Date().toISOString();

  if (!existing || existing.length === 0) {
    const { error: insErr } = await sb.from('user_notification_settings').insert({
      user_email: email,
      alerts_enabled: true,
      briefings_enabled: true,
      alert_frequency: 'daily',
      is_active: true,
      subscription_status: 'beta',
      paid_status: true,
      stripe_customer_id: stripeCustomerId,
      created_at: now,
      updated_at: now,
    });
    if (insErr) {
      // A concurrent delivery may have inserted between our read and write.
      // That is success, not failure — re-read rather than reporting a false alarm.
      const { data: raced } = await sb
        .from('user_notification_settings')
        .select('user_email, naics_codes, keywords, agencies')
        .eq('user_email', email)
        .limit(1);
      if (raced && raced.length > 0) {
        return { outcome: 'updated', needsTargeting: countTargeting(raced[0]) === 0 };
      }
      return { outcome: 'failed', error: `insert failed: ${insErr.message}`, needsTargeting: true };
    }
    // A brand-new row never has targeting.
    return { outcome: 'created', needsTargeting: true };
  }

  // Row exists — refresh paid state only. Targeting is the customer's own data.
  const { error: updErr } = await sb
    .from('user_notification_settings')
    .update({
      alerts_enabled: true,
      briefings_enabled: true,
      is_active: true,
      paid_status: true,
      stripe_customer_id: stripeCustomerId,
      updated_at: now,
    })
    .eq('user_email', email);

  if (updErr) return { outcome: 'failed', error: `update failed: ${updErr.message}`, needsTargeting: countTargeting(existing[0]) === 0 };

  return { outcome: 'updated', needsTargeting: countTargeting(existing[0]) === 0 };
}
