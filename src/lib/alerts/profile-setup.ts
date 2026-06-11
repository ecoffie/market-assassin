export const DEFAULT_PROFILE_NAICS = ['541512', '541611', '541330', '541990', '561210'];

export interface AlertProfileFields {
  naics_codes?: string[] | null;
  keywords?: string[] | null;
  business_description?: string | null;
}

/** True when the user is still on generic/default filters (no keywords, etc.). */
export function userNeedsMindySetup(user: AlertProfileFields): boolean {
  const hasKeywords = (user.keywords?.length ?? 0) > 0;
  const hasDescription = Boolean(user.business_description?.trim());
  const naics = user.naics_codes || [];
  const hasOnlyDefaults =
    naics.length === 0 ||
    (naics.length <= DEFAULT_PROFILE_NAICS.length &&
      naics.every(code => DEFAULT_PROFILE_NAICS.includes(code)));
  return !hasKeywords || !hasDescription || hasOnlyDefaults;
}
