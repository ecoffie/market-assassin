/**
 * Client-safe contract for keyword coverage — constants, types, and pure
 * helpers. No BigQuery / Node builtins. The warehouse runner lives in
 * `keyword-coverage-bq.ts` and must never be statically imported from a
 * Client Component graph.
 */

export const KEYWORD_COVERAGE_SOURCE = 'bigquery_usaspending_awards' as const;
export const KEYWORD_COVERAGE_PRIMARY_SENSE = 'work_text' as const;
export const KEYWORD_COVERAGE_SENSES_AVAILABLE = [
  'work_text',
  'industry_title',
  'product_psc',
] as const;

/**
 * Phase 0 semantic split (Owned Evidence Architecture).
 *
 * Keyword coverage answers a DIFFERENT question than Market Research
 * "Relevant spending" / fpds-top-n / spend-query:
 *   - coverage = description-matched obligations in ONE complete FY
 *   - market size dashboards = MARKET_SPEND_WINDOW (3 FYs, category/code scope)
 *
 * Never present coverage.totalMarket as interchangeable with 3-FY market $.
 */
export const KEYWORD_COVERAGE_WINDOW_KIND = 'latest_complete_fy' as const;
export const KEYWORD_COVERAGE_QUESTION =
  'description_matched_fy_distribution' as const;

export function keywordCoverageWindowLabel(fiscalYear: number): string {
  return `FY${fiscalYear} (1 complete fiscal year · description match)`;
}

export type KeywordCoverageSense = (typeof KEYWORD_COVERAGE_SENSES_AVAILABLE)[number];

export type CoverageEvidenceStatus =
  | 'MARKET_EVIDENCE_FOUND'
  | 'NO_MATCHES_MEASURED'
  | 'NOT_ESTABLISHED';

export class KeywordCoverageNotEstablishedError extends Error {
  readonly status = 'NOT_ESTABLISHED' as const;
  constructor(message = 'keyword coverage is not established') {
    super(message);
    this.name = 'KeywordCoverageNotEstablishedError';
  }
}

/** RE2-escape a user keyword so it is a literal, not a regex. */
export function escapeRe2Literal(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary / phrase pattern against LOWER(description).
 * "patrol boat" stays a phrase — it is not expanded to patrol OR boat.
 */
export function descriptionMatchPattern(keyword: string): string | null {
  const trimmed = keyword.trim().toLowerCase();
  if (trimmed.length < 2) return null;
  return `\\b${escapeRe2Literal(trimmed)}\\b`;
}

/**
 * Future Senses v2 predicates. v1 uses description only.
 * Do not wire industry_title / product_psc into the primary WHERE.
 */
export function senseMatchSql(sense: KeywordCoverageSense, columnExpr = 'description'): string {
  if (sense === 'industry_title') {
    return `REGEXP_CONTAINS(LOWER(IFNULL(naics_description, '')), @pattern)`;
  }
  if (sense === 'product_psc') {
    return `REGEXP_CONTAINS(LOWER(IFNULL(psc_description, '')), @pattern)`;
  }
  return `REGEXP_CONTAINS(LOWER(IFNULL(${columnExpr}, '')), @pattern)`;
}
