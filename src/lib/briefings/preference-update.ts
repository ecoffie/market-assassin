/**
 * The ONLY fields a user may change through POST /api/briefings/preferences (SEC-3, 2026-09-27).
 *
 * The route used to upsert `{ briefings_enabled: true, ...requestBody }` with no allowlist, so any
 * authenticated caller could write ANY column on their own user_notification_settings row —
 * treatment_type, paid_status, subscription_status, stripe_customer_id, alert/briefing toggles,
 * targeting, even user_email — and every call force-enabled briefings.
 *
 * Rules:
 *  - Explicit allowlist, validated per field. Anything else is REJECTED by name (400), never
 *    silently dropped: a caller must be able to tell that nothing it did not ask for happened.
 *  - SMS is not settable here. Enabling SMS requires the double opt-in (sms/verify/send →
 *    sms/verify/check, which sets phone_verified); disabling goes through sms/disable, which also
 *    clears verification. Accepting sms_enabled/phone_number here would bypass consent.
 *  - Nothing here can grant or restore an entitlement: briefings_enabled/alerts_enabled/tier
 *    fields are not settable.
 */

export const USER_SETTABLE_BRIEFING_FIELDS = ['timezone', 'email_frequency', 'preferred_delivery_hour'] as const;
type Field = (typeof USER_SETTABLE_BRIEFING_FIELDS)[number];

export type BriefingPreferencePatch = {
  timezone?: string;
  briefing_frequency?: 'daily' | 'weekly';
  preferred_delivery_hour?: number;
};

export type ParseResult =
  | { ok: true; patch: BriefingPreferencePatch }
  | { ok: false; error: string; rejected?: string[] };

function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** `body` is the request JSON minus `email` (identity is resolved server-side). */
export function parseBriefingPreferenceUpdate(body: Record<string, unknown>): ParseResult {
  const allowed = new Set<string>(USER_SETTABLE_BRIEFING_FIELDS);
  const rejected = Object.keys(body).filter((k) => !allowed.has(k));
  if (rejected.length) {
    return { ok: false, error: `These fields cannot be changed here: ${rejected.join(', ')}`, rejected };
  }

  const patch: BriefingPreferencePatch = {};
  for (const key of Object.keys(body) as Field[]) {
    const v = body[key];
    if (key === 'timezone') {
      if (typeof v !== 'string' || !isValidTimeZone(v)) return { ok: false, error: 'timezone must be a valid IANA time zone' };
      patch.timezone = v;
    } else if (key === 'email_frequency') {
      if (v !== 'daily' && v !== 'weekly') return { ok: false, error: "email_frequency must be 'daily' or 'weekly'" };
      patch.briefing_frequency = v;
    } else if (key === 'preferred_delivery_hour') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 23) {
        return { ok: false, error: 'preferred_delivery_hour must be an integer from 0 to 23' };
      }
      patch.preferred_delivery_hour = v;
    }
  }

  if (!Object.keys(patch).length) return { ok: false, error: 'No preference to update' };
  return { ok: true, patch };
}
