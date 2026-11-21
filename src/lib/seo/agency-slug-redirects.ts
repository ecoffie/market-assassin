/**
 * Short public URLs for agencies customers type by abbreviation.
 * Each target is the canonical /agencies/[slug] page. Nothing is invented:
 * the long slugs are the ones the directory already serves.
 */
export const AGENCY_SHORT_SLUGS = {
  va: 'department-of-veterans-affairs',
  cpsc: 'consumer-product-safety-commission',
  fdic: 'federal-deposit-insurance-corporation',
  treasury: 'department-of-the-treasury',
} as const;

export type AgencyShortSlug = keyof typeof AGENCY_SHORT_SLUGS;

/** Canonical slug when `slug` is a known short alias. Null for every other token. */
export function canonicalAgencySlug(slug: string): string | null {
  const key = slug.trim().toLowerCase();
  if (!key || key.includes('/')) return null;
  return AGENCY_SHORT_SLUGS[key as AgencyShortSlug] ?? null;
}

/** Permanent redirects for next.config. One entry per short slug. */
export function agencySlugRedirects(): Array<{ source: string; destination: string; permanent: true }> {
  return (Object.entries(AGENCY_SHORT_SLUGS) as Array<[AgencyShortSlug, string]>).map(
    ([short, canonical]) => ({
      source: `/agencies/${short}`,
      destination: `/agencies/${canonical}`,
      permanent: true,
    }),
  );
}
