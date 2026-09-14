/**
 * How USASpending's spending_by_award / spending_by_category agency filter
 * actually works for military departments.
 *
 * Lifted from agency-spending-detail.ts (FM-U09). The military departments
 * (Army / Navy / Air Force / Space Force) are NOT toptier agencies in
 * USASpending — the only toptier defense entity is Department of Defense (097).
 * Passing "Department of the Air Force" as tier:'toptier' returns empty; the
 * same name as tier:'subtier' returns the DAF slice.
 *
 * This is a SOURCE SCHEMA fact, not a product identity claim. USSF and DAF
 * remain distinct MarketScope dimensions. When the source can only express
 * USSF as DAF-subtier, the retrieval manifest must record that the service
 * dimension was unsupported as an independent awarding-agency filter.
 */
export const DOD_SUBTIER_ALIASES: Array<{ re: RegExp; subAgency: string }> = [
  { re: /\b(navy|department of the navy|\bdon\b|navsea|navair|navsup|navfac|navwar|spawar|usmc|marine corps)\b/i, subAgency: 'Department of the Navy' },
  { re: /\b(army|department of the army|\bdoa\b|usace|army corps of engineers|acc|tacom|amc|army materiel)\b/i, subAgency: 'Department of the Army' },
  { re: /\b(air force|department of the air force|\bdaf\b|\bacc\b|afmc|aflcmc|afimsc)\b/i, subAgency: 'Department of the Air Force' },
  { re: /\b(space force|ussf)\b/i, subAgency: 'Department of the Air Force' }, // Space Force reports under DAF in USASpending
];

export type UsaSpendingAwardingAgencyFilter = {
  type: 'awarding';
  tier: 'toptier' | 'subtier';
  name: string;
};

/**
 * Map a caller-supplied agency name onto the USASpending agencies[] filter.
 * Does not rewrite MarketScope identities. Callers that used a service name
 * (e.g. USSF) and received a DAF-subtier filter must put `service` on
 * unsupported_scope.
 */
export function usaSpendingAwardingAgencyFilter(
  agencyName: string,
): UsaSpendingAwardingAgencyFilter {
  const raw = agencyName.trim();
  const alias = DOD_SUBTIER_ALIASES.find((x) => x.re.test(raw));
  if (alias) {
    return { type: 'awarding', tier: 'subtier', name: alias.subAgency };
  }
  return { type: 'awarding', tier: 'toptier', name: raw };
}

/** True when the source rewrote a service/alias into a military-department subtier. */
export function usaSpendingSubtierRewrite(
  requestedName: string,
): { requested: string; consumedSubtier: string } | null {
  const raw = requestedName.trim();
  const alias = DOD_SUBTIER_ALIASES.find((x) => x.re.test(raw));
  if (!alias) return null;
  const same = raw.toLowerCase() === alias.subAgency.toLowerCase();
  if (same) return null;
  return { requested: raw, consumedSubtier: alias.subAgency };
}
