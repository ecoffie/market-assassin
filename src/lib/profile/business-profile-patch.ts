/**
 * The `user_business_profiles` write that POST /api/app/profile performs.
 *
 * INVARIANT: updating one profile field must not erase unrelated stored
 * profile information. POST /api/app/profile is a PARTIAL update — Market
 * Research "save to profile", the Opportunity Map settings drawer and
 * CapabilityNudge all send a subset of fields. The previous write set
 * `business_description: businessDescription || null`,
 * `extracted_naics_codes: expandedNaicsCodes` and
 * `extracted_set_asides: safeSetAsides` UNCONDITIONALLY, so a codes-only save
 * wiped the stored description and set-asides, and a description-only save
 * wiped the stored codes.
 *
 * Rules (mirroring how the same route already writes user_notification_settings):
 *  - description: written only when a non-blank string is sent. There is no
 *    "clear my description" action on any caller; onboarding sends
 *    `text.trim() || null` for an untouched box, which is NOT a clear.
 *  - extracted_naics_codes: written only when codes were sent (same rule as
 *    naics_codes on user_notification_settings).
 *  - extracted_set_asides: written only when `setAsides` is an array — an
 *    explicit [] from onboarding is a real choice and still clears.
 */
export interface BusinessProfilePatchInput {
  businessDescription: unknown;
  /** Codes after persist-normalization; [] when the caller sent none. */
  expandedNaicsCodes: string[];
  /** The raw `setAsides` body field (undefined when omitted). */
  setAsides: unknown;
  /** setAsides after trimming/filtering. */
  safeSetAsides: string[];
  nowIso: string;
}

function cleanDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Columns to UPDATE on an existing row, or null when this save touches none of them. */
export function buildBusinessProfileUpdate(input: BusinessProfilePatchInput): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const description = cleanDescription(input.businessDescription);
  if (description) {
    patch.business_description = description;
    patch.business_description_updated_at = input.nowIso;
  }
  if (input.expandedNaicsCodes.length > 0) {
    patch.extracted_naics_codes = input.expandedNaicsCodes;
  }
  if (Array.isArray(input.setAsides)) {
    patch.extracted_set_asides = input.safeSetAsides;
  }
  if (Object.keys(patch).length === 0) return null;
  patch.updated_at = input.nowIso;
  return patch;
}

/** Full row for a NEW user_business_profiles record (nothing stored to protect). */
export function buildBusinessProfileInsert(
  input: BusinessProfilePatchInput,
): Record<string, unknown> {
  const description = cleanDescription(input.businessDescription);
  return {
    business_description: description,
    ...(description ? { business_description_updated_at: input.nowIso } : {}),
    extracted_naics_codes: input.expandedNaicsCodes,
    extracted_set_asides: input.safeSetAsides,
    created_at: input.nowIso,
    updated_at: input.nowIso,
  };
}
