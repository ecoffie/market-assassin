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
  {
    route: 'admin/user-breakdown',
    claim: 'User base composition — leads, profiles, alert config, tool access, OH searchers',
    status: 'verified',
    passed: ['runs', 'complete', 'current', 'honest'],
    verifiedOn: '2026-08-23',
    note:
      'WORST measured instance of the cap. Three separate live figures (total_profiles, ' +
      'users_with_alert_config, users_with_ma_alerts) each read EXACTLY 1000 while ' +
      'user_notification_settings genuinely held 10,667 rows — the user base understated ' +
      '10.7x on a dashboard used to size audiences. Five reads now paginated.',
  },
  {
    route: 'admin/list-leads',
    claim: 'Free-lead inventory — total, unique, and how many are genuinely new',
    status: 'verified',
    passed: ['runs', 'complete', 'current', 'honest'],
    verifiedOn: '2026-08-23',
    note:
      'Paginated, and made SELF-CHECKING: it already read count:exact, so the route now ' +
      'compares rows-read against that head-count and returns an error rather than ' +
      'reporting a partial population as a total. 879 leads today — under the cap, so it ' +
      'was correct by luck and would have broken silently on crossing 1,000.',
  },
  {
    route: 'admin/partner-referrals',
    claim: 'Partner program — referrals tagged, active trials, paid conversions',
    status: 'verified',
    passed: ['runs', 'complete', 'current', 'honest'],
    verifiedOn: '2026-08-23',
    note:
      'Every figure is a count of one read. Unpaginated, a SUCCESSFUL partner program ' +
      'would cap at exactly 1,000 referrals and understate its own conversion denominator ' +
      '— the failure mode arrives precisely when the program starts working.',
  },
  {
    route: 'admin/signup-health',
    claim: 'Signup funnel health — attempted / completed / failed + errors by type (24h)',
    status: 'verified',
    passed: ['runs', 'complete', 'current', 'honest'],
    verifiedOn: '2026-08-23',
    note:
      'attempted/completed/failed are all .filter().length over one read, so a BAD signup ' +
      'day — the only time anyone opens this — is exactly when it truncated, capping the ' +
      'failure count and making the incident look smaller. Also narrowed a null error_type ' +
      'that was used as an object index.',
  },
  {
    route: 'admin/debug-coach-clients',
    claim: 'Coach client overlap diagnosis — per-client NAICS/keyword collisions',
    status: 'verified',
    passed: ['runs', 'complete', 'current', 'honest'],
    verifiedOn: '2026-08-23',
    note:
      'NOT a population claim and needs no pagination: it is a single-coach diagnostic ' +
      'bounded by org_clients for one org (.eq org_id) and an .in() over that list, with ' +
      'the profile read using .maybeSingle(). Verified by READING it rather than assuming ' +
      'the finding implied a bug — the CURRENT check, not the COMPLETE one, is what it needed.',
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
  // EMPTY as of 2026-08-23 — all ten claim-producing routes pass the four-part contract.
  // Eric: "that's effectively the point at which you can say Mindy's decision dashboards
  // have passed a measurement-integrity audit."
  //
  // ⚠️ This list is the bucket-1 BACKLOG, not a trophy. Any NEW route that renders a
  // count, cohort, percentage or benchmark starts here and moves into CLAIM_LEDGER only
  // after a human verifies all four checks against live data. Do not let it stay empty
  // by declining to add routes to it.
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

/**
 * THE STATUS BLOCK — one glance at whether the measurement system is still trustworthy.
 *
 * Eric, 2026-08-23: "That gives future sessions one glance at whether the measurement
 * system is still trustworthy."
 *
 * Rendered as a fixed set of lines so a future session (or a human opening Platform
 * Health) does not have to reconstruct the audit's state from a ledger file:
 *
 *   Decision Metrics Integrity
 *     Claim-producing routes: 10/10 verified
 *     Unverified claim routes: 0
 *     Operational risks: 10
 *     Known truncation findings: 118
 *     Last integrity audit: 2026-08-23
 *
 * ⚠️ TWO RULES so this block cannot become the thing it exists to prevent:
 *
 * 1. `lastAudit` is DERIVED from the newest `verifiedOn` in CLAIM_LEDGER — never a
 *    hardcoded date. A hand-typed date is exactly the stale-number failure this whole
 *    audit is about, and it would rot the moment someone verified a route without
 *    editing the string.
 * 2. `truncationFindings` is passed IN from the gate's own baseline, not stored here.
 *    A second copy of that count would drift from what CI enforces. When the caller
 *    cannot read the baseline it passes -1, and this block reports `unknown` rather
 *    than printing a plausible number it did not measure.
 */
export interface IntegrityStatusBlock {
  title: string;
  claimRoutes: string;
  unverifiedClaimRoutes: number;
  operationalRisks: number;
  knownTruncationFindings: number | 'unknown';
  lastAudit: string;
  /** True only when every claim-producing route passes all four checks. */
  allClaimsVerified: boolean;
  lines: string[];
}

export function getIntegrityStatusBlock(truncationFindings: number): IntegrityStatusBlock {
  const s = getMeasurementIntegrity();

  // Derived, never typed: the newest verification date in the ledger IS the audit date.
  const lastAudit =
    s.claims
      .map((c) => c.verifiedOn)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop() ?? 'never';

  const findings: number | 'unknown' = truncationFindings < 0 ? 'unknown' : truncationFindings;
  const allClaimsVerified = s.unverified.length === 0 && s.verified === s.total;

  return {
    title: 'Decision Metrics Integrity',
    claimRoutes: `${s.verified}/${s.total} verified`,
    unverifiedClaimRoutes: s.unverified.length,
    operationalRisks: s.operationalRisks,
    knownTruncationFindings: findings,
    lastAudit,
    allClaimsVerified,
    lines: [
      'Decision Metrics Integrity',
      `  Claim-producing routes: ${s.verified}/${s.total} verified`,
      `  Unverified claim routes: ${s.unverified.length}`,
      `  Operational risks: ${s.operationalRisks}`,
      `  Known truncation findings: ${findings}`,
      `  Last integrity audit: ${lastAudit}`,
    ],
  };
}
