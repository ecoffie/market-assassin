/**
 * Body for "Save this market to my profile" (MarketResearchPanel → POST /api/app/profile).
 *
 * INVARIANT: a partial update changes only explicitly submitted fields.
 *
 * `businessType` is NOT part of "this market" — it is the user's certification
 * (8(a), SDVOSB, WOSB …), stored in user_notification_settings.business_type and
 * read by alert set-aside eligibility. The panel's formData.businessType is usually
 * NOT the user's choice: it is filled by lossy normalization of the stored value
 * (normalizeBusinessType) or by a hardcoded 'Small Business' default in several
 * code paths. Sending it (formerly `formData.businessType || 'Small Business'`)
 * overwrote a stored certification with plain Small Business on every save.
 *
 * So the field is included ONLY when the user explicitly picked a value in the
 * business-type control during this session. The route leaves business_type
 * untouched when the key is absent.
 */
export interface SaveResearchProfileInput {
  email: string;
  naicsCodes: string[];
  pscCodes: string[];
  keyword: string;
  /** Current value of the panel's business-type select. */
  businessType: string;
  /** True only if the user changed the business-type select themselves. */
  businessTypeChosenByUser: boolean;
}

export function buildSaveResearchProfilePayload(input: SaveResearchProfileInput): Record<string, unknown> {
  const keywords = input.keyword.trim() ? [input.keyword.trim()] : [];
  const body: Record<string, unknown> = {
    email: input.email,
    naicsCodes: input.naicsCodes, // REPLACES the profile's NAICS (the route sets, not appends)
    pscCodes: input.pscCodes, // PSC = what was bought; OR'd into alert matching
    keywords,
  };
  if (input.businessTypeChosenByUser && input.businessType.trim()) {
    body.businessType = input.businessType.trim();
  }
  return body;
}
