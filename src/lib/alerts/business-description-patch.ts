import { deriveBusinessDescriptionFromKeywords } from '@/lib/alerts/profile-setup';

/**
 * The `user_business_profiles.business_description` write that the alert
 * settings routes (POST /api/alerts/preferences, POST /api/alerts/save-profile)
 * perform.
 *
 * INVARIANT: a partial update changes only explicitly submitted fields.
 *
 * Both routes are PARTIAL updates. The Settings panel, TargetingCard, the
 * Opportunity Map drawer and the "delete my profile" reset all send `keywords`
 * WITHOUT `businessDescription`. The previous write ran whenever `keywords` was
 * present and set `business_description` to a keywords-derived sentence
 * ("Federal contractor: a, b.") — overwriting whatever the user had written —
 * or to NULL when `keywords: []` was sent. save-profile likewise nulled the
 * description whenever the signup form's (never pre-filled) box was empty.
 *
 * Rules (mirroring src/lib/profile/business-profile-patch.ts for /api/app/profile):
 *  - A non-blank `businessDescription` string is the user's own text → written.
 *  - A blank/null/omitted description is NOT a clear. No caller of these routes
 *    offers "clear my description"; forms send `text.trim() || null` for an
 *    untouched box, and the reset's copy says it clears "codes, keywords, and
 *    agencies" — not the description.
 *  - A keywords-derived description only ever FILLS: it is written when the
 *    stored description is empty, or when the stored description is exactly
 *    the derivation of the PREVIOUS keywords (i.e. it was itself auto-filled, so
 *    refreshing it replaces nothing the user wrote). It never overwrites text a
 *    user wrote.
 */

export function cleanBusinessDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export interface BusinessDescriptionWriteInput {
  /** Raw `businessDescription` body field (undefined when omitted). */
  businessDescription: unknown;
  /** Raw `keywords` body field (undefined when omitted). */
  keywords: unknown;
  /** The currently stored user_business_profiles.business_description. */
  storedDescription: string | null | undefined;
  /** The user's keywords BEFORE this save (user_notification_settings.keywords). */
  previousKeywords: unknown;
}

function asKeywordList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : [];
}

/** True when a derived description could be written — i.e. the stored row must be read first. */
export function mayDeriveBusinessDescription(input: Pick<BusinessDescriptionWriteInput, 'businessDescription' | 'keywords'>): boolean {
  return !cleanBusinessDescription(input.businessDescription)
    && deriveBusinessDescriptionFromKeywords(asKeywordList(input.keywords)) !== null;
}

/**
 * The description to write, or null when this save must leave
 * business_description untouched.
 */
export function resolveBusinessDescriptionWrite(input: BusinessDescriptionWriteInput): string | null {
  const written = cleanBusinessDescription(input.businessDescription);
  if (written) return written;

  const derived = deriveBusinessDescriptionFromKeywords(asKeywordList(input.keywords));
  if (!derived) return null;

  const stored = cleanBusinessDescription(input.storedDescription);
  if (!stored) return derived;
  if (stored === derived) return null;

  const previousDerived = deriveBusinessDescriptionFromKeywords(asKeywordList(input.previousKeywords));
  if (previousDerived && stored === previousDerived) return derived;

  // The stored description is the user's own text — never overwrite it.
  return null;
}
