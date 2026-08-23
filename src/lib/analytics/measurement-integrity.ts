/**
 * MEASUREMENT INTEGRITY — can we trust the numbers we make decisions from?
 *
 * Eric, 2026-08-22, after /admin/feature-usage was found reporting zero:
 *
 *   "131 -> 129 tells you code debt is shrinking. But 1/30 verified tells you something much
 *    more important: how much of the product's decision-making instrumentation can you
 *    currently trust? That's the number I'd care about before making major product calls."
 *
 * WHY A QUERY AUDIT WAS NOT ENOUGH. feature-usage failed on THREE stacked layers and the
 * truncation finding predicted only one of them:
 *
 *   1. RUNS?         it selected `page_url`, a column that does not exist — PostgREST fails
 *                    the WHOLE query on a missing column, so 16,998 rows returned NULL
 *   2. COMPLETE?     the same query was unpaginated (the finding we actually had)
 *   3. CURRENT?      every path is now "/app" — the matcher hunted legacy URLs the product
 *                    stopped using when it consolidated to one route with a `panel` param
 *   4. HONEST?       the UI showed "some data may be incomplete" instead of "this measurement
 *                    is not working", so a broken query read as a mild data gap
 *
 * So a claim is VERIFIED only when all four hold. Anything less is `unverified` — never
 * "probably fine". This mirrors the rule Platform Health already enforces on itself: never
 * report a status we did not measure.
 */

export type IntegrityCheck = 'runs' | 'complete' | 'current' | 'honest';

export type ClaimStatus = 'verified' | 'unverified' | 'broken';

export interface ClaimRecord {
  /** Route that produces the number, e.g. 'admin/feature-usage'. */
  route: string;
  /** What a human reads off it. */
  claim: string;
  status: ClaimStatus;
  /** Which of the four were actually checked and passed. */
  passed: IntegrityCheck[];
  /** ISO date the verification was performed — a stale check is not a check. */
  verifiedOn?: string;
  /** What was found. Required when status is not 'verified'. */
  note?: string;
}

/**
 * THE LEDGER. Hand-maintained ON PURPOSE — a verification is a human act, not something a
 * script can assert. Adding a row means someone opened the route, ran the query against live
 * data, and confirmed all four properties.
 *
 * ⚠️ Do NOT mark a claim verified because its truncation finding was fixed. Pagination is one
 * of four checks. feature-usage would have passed a pagination-only review while still
 * reporting zero for every feature.
 */
export const CLAIM_LEDGER: ClaimRecord[] = [
  {
    route: 'admin/feature-usage',
    claim: 'Feature adoption — views and unique users per product surface',
    status: 'verified',
    passed: ['runs', 'complete', 'current', 'honest'],
    verifiedOn: '2026-08-22',
    note:
      'Was reporting 0 for every feature on three stacked causes (missing page_url column ' +
      'failed the whole query; unpaginated; matcher hunting legacy URLs). Now reads ' +
      'metadata->>panel + path, paginated. Live: 2,920 views / 432 unique users.',
  },
  {
    route: 'admin/competition-health',
    claim: 'Competition depth — average bidders and single-bid rate per buyer',
    status: 'verified',
    passed: ['runs', 'complete', 'current', 'honest'],
    verifiedOn: '2026-08-22',
    note:
      'Sample raised 60 -> 100 (48 -> 85 awards with offer counts). Headline is now a plain ' +
      'band with n and margin beneath; Exact vs Sampled is labelled per metric so one thin ' +
      'sample cannot discredit four exact head-counts beside it.',
  },
  {
    route: 'admin/mcp-cohorts',
    claim: 'MCP activation and retention — new users, D1/D3/D7/D30, second session',
    status: 'verified',
    passed: ['runs', 'complete', 'current', 'honest'],
    verifiedOn: '2026-08-22',
    note:
      'Paginates the full 1,779-row call log (an unranged read reported "24 accounts, 0 new" ' +
      'when the truth was 59 and 23). Refuses to report a retention window that has not ' +
      'elapsed — "too early" rather than a derived 0%.',
  },
  {
    route: 'admin/onboarding-funnel',
    claim: 'Onboarding funnel — signup -> profile -> email sent -> opened -> active',
    status: 'verified',
    passed: ['runs', 'complete', 'current', 'honest'],
    verifiedOn: '2026-08-22',
    note:
      'Stages 1-2 were exact head-counts; stages 3-5 built DISTINCT-USER Sets from ' +
      'unpaginated reads of 56,499 / 43,079 / 73,928 rows, so every stage after signup was ' +
      'understated and drop-off looked worse than it is. Now paginated.',
  },
  {
    route: 'admin/dashboard',
    claim: 'Bootcamp rollout — configured vs needs-setup (the reignite audience)',
    status: 'verified',
    passed: ['runs', 'complete', 'current', 'honest'],
    verifiedOn: '2026-08-22',
    note:
      'Fallback path derived the audience from 1,000 of 8,802 rows. Now paginated; verified ' +
      'the paginated total matches the exact head-count.',
  },
];

/**
 * TWO BUCKETS, not one list (Eric, 2026-08-22): "that avoids overstating the trust problem
 * while still keeping the real risk visible."
 *
 * The 30 P1 findings collapse into 18 routes, and half of those are backfills — truncation
 * still matters there, but a backfill does not PRESENT a claim. Mixing them inflates the
 * apparent trust problem and buries the routes that can steer a product decision today.
 */

/** Bucket 1: pure reads that render a count, percentage, cohort or benchmark someone acts on. */
export const CLAIM_ROUTES_UNVERIFIED: string[] = [
  'admin/user-breakdown',
  'admin/signup-health',
  'admin/partner-referrals',
  'admin/list-leads',
  'admin/debug-coach-clients',
];

/**
 * Bucket 2: backfills, syncs and maintenance jobs. Truncation here mutates the wrong
 * population — real, but it does not put a wrong number in front of a human, so it queues
 * behind bucket 1.
 */
export const OPERATIONAL_TRUNCATION_RISKS = 10;

export interface IntegritySummary {
  verified: number;
  total: number;
  label: string;
  claims: ClaimRecord[];
  unverified: string[];
  operationalRisks: number;
  note: string;
}

export function getMeasurementIntegrity(): IntegritySummary {
  const verified = CLAIM_LEDGER.filter((c) => c.status === 'verified').length;
  const total = CLAIM_LEDGER.length + CLAIM_ROUTES_UNVERIFIED.length;
  return {
    verified,
    total,
    label: `${verified} / ${total}`,
    claims: CLAIM_LEDGER,
    unverified: CLAIM_ROUTES_UNVERIFIED,
    operationalRisks: OPERATIONAL_TRUNCATION_RISKS,
    note:
      'How much of the decision-making instrumentation is trustworthy. A claim counts as ' +
      'verified only when all four hold: the query RUNS, returns the COMPLETE population, its ' +
      'classification still matches the CURRENT product, and the UI reports failure HONESTLY ' +
      'as unknown/broken rather than silently showing zero. Fixing a pagination finding alone ' +
      'does NOT verify a claim — feature-usage would have passed that review while reporting ' +
      'zero for every feature.',
  };
}
