/**
 * Canonical PROVEN PLAYERS dataset — one row per (6-digit NAICS, UEI) derived from awards.
 *
 * DEFINITION (Eric, 2026-10-04): a Proven Player for NAICS X is a unique UEI with actual federal
 * award history under X. Geography is the firm's HQ (the canonical `recipients` row), and it is a
 * FILTER applied BEFORE any ranking:
 *
 *     awards → UEI → NAICS → HQ geography → FILTER → RANK
 *
 * NEVER national rank → geography filter. That is exactly what Maps Players did by reading
 * `top_contractors_by_dimension` (rank <= 50, built for the /top/* SEO listicles) as if it were the
 * whole population: 541512 in Texas showed 0 Players against 327 real awardees, and 19,696 of
 * 42,924 NAICS×state cells (45.9%) rendered a false zero. Audit:
 * tasks/players-naics-coverage-audit-2026-10-04.md.
 *
 * This table has NO rank cap. `top_contractors_by_dimension` stays as-is for /top/* only.
 *
 * Registered Players (SAM registration NAICS) are a DIFFERENT population and do not belong here —
 * a firm registered for X that has never won under X is not a Proven Player.
 *
 * The watermark travels WITH the data: every row carries the awards `source_action_max` and
 * `built_at` of the build that produced it, so a reader can state how current the answer is
 * without a second store.
 */

export const PLAYERS_TABLE_NAME = 'players_naics_recipients' as const;

/** Bump when the row shape or derivation changes — part of every Players cache key. */
export const PLAYERS_DATASET_VERSION = 'pv1' as const;

/** A valid 6-digit NAICS. Shorter codes in awards are legacy noise and never a Players key. */
export const SIX_DIGIT_NAICS_RE = '^[0-9]{6}$';

/**
 * The CREATE statement. Pure (no client) so it can be unit-tested and dry-run.
 * Tables are passed fully-qualified with backticks, the same form BQ_TABLES uses.
 */
export function buildPlayersDatasetSql(t: { awards: string; recipients: string; target: string }): string {
  return `
CREATE OR REPLACE TABLE ${t.target}
CLUSTER BY naics_code, state
AS
WITH watermark AS (
  SELECT MAX(action_date) AS source_action_max FROM ${t.awards}
),
per_naics_uei AS (
  SELECT
    naics_code,
    recipient_uei,
    ANY_VALUE(recipient_name)       AS award_recipient_name,
    SUM(obligation_amount)          AS total_obligated,
    COUNT(DISTINCT award_id)        AS award_count,
    COUNT(*)                        AS transaction_count,
    MIN(action_date)                AS first_action_date,
    MAX(action_date)                AS last_action_date,
    COUNT(DISTINCT awarding_agency) AS distinct_agency_count
  FROM ${t.awards}
  WHERE recipient_uei IS NOT NULL
    AND REGEXP_CONTAINS(IFNULL(naics_code, ''), r'${SIX_DIGIT_NAICS_RE}')
  GROUP BY naics_code, recipient_uei
)
SELECT
  p.naics_code,
  p.recipient_uei,
  COALESCE(r.recipient_name, p.award_recipient_name) AS recipient_name,
  r.city AS city,
  -- HQ geography: a real 2-letter code or NULL. NULL rows still count as Proven Players
  -- nationally; they can never be placed on a state map and are disclosed, never fabricated.
  IF(REGEXP_CONTAINS(IFNULL(r.state, ''), r'^[A-Z]{2}$'), r.state, NULL) AS state,
  r.country AS country,
  p.total_obligated,
  p.award_count,
  p.transaction_count,
  p.first_action_date,
  p.last_action_date,
  p.distinct_agency_count,
  w.source_action_max,
  CURRENT_TIMESTAMP() AS built_at,
  '${PLAYERS_DATASET_VERSION}' AS dataset_version
FROM per_naics_uei p
LEFT JOIN ${t.recipients} r USING (recipient_uei)
CROSS JOIN watermark w
`;
}

/**
 * Ground truth for reconciliation: distinct awardee UEIs per (NAICS, HQ state), computed straight
 * from awards + recipients — independent of the Players table, so a Players defect cannot hide
 * itself. One scan for all requested cells.
 */
export function buildPlayersTruthSql(t: { awards: string; recipients: string }, scope: 'all' | 'naics' = 'naics'): string {
  const naicsCond = scope === 'naics'
    ? 'naics_code IN UNNEST(@naics)'
    : `REGEXP_CONTAINS(IFNULL(naics_code, ''), r'${SIX_DIGIT_NAICS_RE}')`;
  return `
WITH pairs AS (
  SELECT DISTINCT naics_code, recipient_uei
  FROM ${t.awards}
  WHERE recipient_uei IS NOT NULL AND ${naicsCond}
)
SELECT p.naics_code AS naics_code,
  IF(REGEXP_CONTAINS(IFNULL(r.state, ''), r'^[A-Z]{2}$'), r.state, NULL) AS state,
  COUNT(*) AS proven_players
FROM pairs p
LEFT JOIN ${t.recipients} r USING (recipient_uei)
GROUP BY 1, 2
`;
}
