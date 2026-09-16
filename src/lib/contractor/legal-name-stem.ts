/**
 * Search stem for a legal business name.
 *
 * "TANAQ SUPPORT SERVICES, LLC" and "Tanaq Support Services LLC" are the same
 * firm. A raw ILIKE of the typed string misses when the stored row has a comma
 * the query lacks (or the reverse) — measured on get_contractor_award_history
 * ("TANAQ SUPPORT SERVICES, LLC" → history null) and get_contractor_profile
 * ("Tanaq Global Solutions LLC" → found false) while lookup_sam_entity("Tanaq")
 * already returned the family.
 *
 * Strip the legal suffix and punctuation so the stem is a substring of either
 * form. Does NOT rewrite "&" → "and": the stored name may keep the ampersand,
 * and a rewritten stem would miss it.
 */
const LEGAL_SUFFIX_RE =
  /\b(incorporated|inc|l\.l\.c\.?|llc|corporation|corp|company|co|ltd|limited|lp|l\.l\.p\.?|llp|pllc|p\.c\.?|pc)\b/gi;

export function legalNameSearchStem(name: string): string {
  return name
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ILIKE pattern for a legal name. Falls back to the raw trim if the stem is empty. */
export function legalNameIlikePattern(name: string): string {
  const stem = legalNameSearchStem(name).replace(/[%_]/g, '').trim();
  const raw = name.replace(/[%_]/g, '').trim();
  const token = stem || raw;
  return `%${token}%`;
}

export function namesMatchLegalStem(query: string, legalName: string): 'exact' | 'contains' | 'none' {
  const q = legalNameSearchStem(query).toLowerCase();
  const n = legalNameSearchStem(legalName).toLowerCase();
  if (!q || !n) return 'none';
  if (q === n) return 'exact';
  if (n.includes(q) || q.includes(n)) return 'contains';
  return 'none';
}
