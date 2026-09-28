/**
 * Targeting fields written by POST /api/alerts/save-profile.
 *
 * INVARIANT: a partial update changes only explicitly submitted fields. Only an
 * explicitly user-selected business type may overwrite a stored business type.
 *
 * The route used to UPSERT the whole targeting row on every call —
 * `business_type: businessType || null`, `agencies: targetAgencies || []`,
 * `naics_codes: []`, `location_*: … || null/[]` — so any caller that sent a
 * defaulted value, or simply omitted a field, wiped what the user had stored:
 *   • Opportunity Hunter sent `businessFormation || 'Small Business'` and no
 *     agencies/locations on every search (74 of 80 OH emails already had a row).
 *   • generate-all (Market Research reports) forwarded the report's defaulted
 *     business type + the report's agency scope.
 *   • /briefings and /market-intelligence sent `naicsCodes: []` → NAICS wiped.
 *
 * Now, for an EXISTING row, a field is written only when the request carries a
 * real value for it: a non-blank string, or a non-empty array. Omitted, null,
 * blank and empty are "untouched" — this endpoint has no clear semantics; clears
 * go through /api/app/profile and /api/alerts/preferences.
 *
 * A NEW row keeps the previous defaults (null / []), because there is nothing
 * stored to protect.
 */

export interface SaveProfileTargetingInput {
  /** True when user_notification_settings already has a row for this email. */
  rowExists: boolean;
  /** NAICS after normalization (normalizeNAICSForPersist). Empty = none submitted. */
  expandedNaics: string[];
  businessType?: unknown;
  targetAgencies?: unknown;
  locationState?: unknown;
  locationStates?: unknown;
  locationZip?: unknown;
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.map(v => String(v ?? '').trim()).filter(Boolean);
  return out.length > 0 ? out : null;
}

export function buildSaveProfileTargetingPatch(input: SaveProfileTargetingInput): Record<string, unknown> {
  const businessType = cleanString(input.businessType);
  const agencies = cleanArray(input.targetAgencies);
  const locationState = cleanString(input.locationState);
  const locationStates = cleanArray(input.locationStates);
  const locationZip = cleanString(input.locationZip);
  const naics = input.expandedNaics.length > 0 ? input.expandedNaics : null;

  if (!input.rowExists) {
    return {
      naics_codes: naics ?? [],
      business_type: businessType,
      agencies: agencies ?? [],
      location_state: locationState,
      location_states: locationStates ?? [],
      location_zip: locationZip,
      capability_embedded_at: null,
    };
  }

  const patch: Record<string, unknown> = {};
  if (naics) {
    patch.naics_codes = naics;
    // NAICS changed → capability vector is stale; null the stamp so the
    // embed-user-capabilities cron re-embeds.
    patch.capability_embedded_at = null;
  }
  if (businessType) patch.business_type = businessType;
  if (agencies) patch.agencies = agencies;
  if (locationState) patch.location_state = locationState;
  if (locationStates) patch.location_states = locationStates;
  if (locationZip) patch.location_zip = locationZip;
  return patch;
}

/**
 * Client-side: the businessType field for a save-profile body. Returns the value
 * only when it is a real user selection (non-blank); never a default. Spread the
 * result into the body so an unselected type OMITS the key.
 */
export function explicitBusinessTypeField(selected: unknown): { businessType?: string } {
  const value = cleanString(selected);
  return value ? { businessType: value } : {};
}
