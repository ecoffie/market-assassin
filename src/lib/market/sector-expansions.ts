/**
 * Sector expansions (Eric, Jun 22 2026) — broad sector terms whose specialty
 * SUB-trades never surface under a literal keyword match. An electrical/plumbing
 * contractor's awards say "electrical" or "plumbing", NOT "construction", so a
 * USASpending `keyword=construction` exact-phrase search returns building +
 * heavy-civil + (legitimately) shipbuilding, but ZERO of the 238xxx specialty
 * trades. When a query hits a sector here we ALSO ground these sub-trade keywords
 * and merge — so "construction" surfaces 238210/238220/238160/238910… — still
 * award-backed (real USASpending $), not invented.
 *
 * Shared by both grounding paths so they stay in sync:
 *  - /api/suggest-codes (manual code lookup)
 *  - keywordCoverage()  (auto-onboarding profile-from-text)
 */
export const SECTOR_EXPANSIONS: { match: RegExp; keywords: string[] }[] = [
  {
    match: /\b(construction|contractor|contracting|building|builder|renovation|remodel(?:ing)?)\b/i,
    keywords: [
      'electrical contractor', 'plumbing heating air conditioning', 'roofing',
      'masonry', 'site preparation', 'concrete', 'painting', 'drywall',
      'framing carpentry', 'glass glazing', 'flooring',
    ],
  },
];

/** Sub-trade keywords to also ground for a broad sector term, or null if none. */
export function sectorSubTradeKeywords(keyword: string): string[] | null {
  const s = SECTOR_EXPANSIONS.find((e) => e.match.test(keyword));
  return s ? s.keywords : null;
}
