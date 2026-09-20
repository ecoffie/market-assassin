/**
 * BigQuery contract for get_keyword_coverage.
 *
 * Primary market (v1): federal contract ACTIONS in the latest COMPLETE fiscal year
 * whose BASE AWARD DESCRIPTION contains the keyword (word-boundary / phrase).
 *
 * Dollars: SUM(obligation_amount) at txn_id grain — never award-level snapshots.
 * NAICS/PSC titles are taxonomy ABOUT the matched work, not the search surface.
 *
 * Industry-title and product/PSC senses are named here so Senses v2 can compute
 * them later. v1 does not run those predicates.
 */
import { BQ_TABLES, bqJobOptions, bqQuery } from '@/lib/bigquery/client';
import { latestCompleteFiscalYear } from '@/lib/utils/fiscal-year';
import {
  descriptionMatchPattern,
  senseMatchSql,
} from './keyword-coverage-contract';

export {
  KEYWORD_COVERAGE_SOURCE,
  KEYWORD_COVERAGE_PRIMARY_SENSE,
  KEYWORD_COVERAGE_SENSES_AVAILABLE,
  KeywordCoverageNotEstablishedError,
  escapeRe2Literal,
  descriptionMatchPattern,
  senseMatchSql,
  type KeywordCoverageSense,
  type CoverageEvidenceStatus,
} from './keyword-coverage-contract';

export function buildKeywordCoverageSql(opts?: { awardIdPrefix?: string }): string {
  const prefixFilter = opts?.awardIdPrefix
    ? 'AND STARTS_WITH(award_id, @awardPrefix)'
    : '';
  // MATCHED CTE is the market. Titles are selected for distribution labels only.
  return `
WITH matched AS (
  SELECT
    txn_id,
    award_id,
    obligation_amount,
    naics_code,
    naics_description,
    psc_code,
    psc_description,
    awarding_agency,
    action_date
  FROM ${BQ_TABLES.awards}
  WHERE fiscal_year = @fy
    AND ${senseMatchSql('work_text', 'description')}
    ${prefixFilter}
)
SELECT
  (SELECT COUNT(*) FROM matched) AS transaction_count,
  (SELECT COUNT(DISTINCT award_id) FROM matched) AS unique_award_count,
  (SELECT SUM(IFNULL(obligation_amount, 0)) FROM matched) AS total_market,
  (SELECT CAST(MAX(action_date) AS STRING) FROM matched) AS max_action_date,
  ARRAY(
    SELECT AS STRUCT
      naics_code AS code,
      ANY_VALUE(naics_description) AS name,
      SUM(IFNULL(obligation_amount, 0)) AS amount
    FROM matched
    WHERE naics_code IS NOT NULL AND TRIM(naics_code) != ''
    GROUP BY naics_code
    ORDER BY amount DESC
    LIMIT 200
  ) AS naics,
  ARRAY(
    SELECT AS STRUCT
      psc_code AS code,
      ANY_VALUE(psc_description) AS name,
      SUM(IFNULL(obligation_amount, 0)) AS amount
    FROM matched
    WHERE psc_code IS NOT NULL AND TRIM(psc_code) != ''
    GROUP BY psc_code
    ORDER BY amount DESC
    LIMIT 200
  ) AS psc,
  ARRAY(
    SELECT AS STRUCT
      awarding_agency AS name,
      SUM(IFNULL(obligation_amount, 0)) AS amount
    FROM matched
    WHERE awarding_agency IS NOT NULL AND TRIM(awarding_agency) != ''
    GROUP BY awarding_agency
    ORDER BY amount DESC
    LIMIT 200
  ) AS agencies
`;
}

/** Lock the dollar grain: action obligation only. Used by unit tests. */
export function assertActionObligationGrain(sql: string): void {
  if (!/SUM\(IFNULL\(obligation_amount,\s*0\)\)/.test(sql)) {
    throw new Error('keyword-coverage SQL must SUM(obligation_amount)');
  }
  if (/SUM\([^)]*total_obligated/.test(sql) || /SUM\([^)]*current_award_value/.test(sql) || /SUM\([^)]*potential_award_value/.test(sql)) {
    throw new Error('keyword-coverage SQL must not sum award-level snapshots');
  }
}

export function coerceBqNumber(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'object' && v && 'value' in v) {
    return coerceBqNumber((v as { value: unknown }).value);
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface KeywordCoverageBqBucket {
  code: string;
  name: string;
  amount: number;
}

export interface KeywordCoverageBqAgency {
  name: string;
  amount: number;
}

/** Mapped warehouse row used by keywordCoverage. Snake_case BQ fields never leak. */
export interface KeywordCoverageBqRow {
  keyword: string;
  fiscalYear: number;
  transactionCount: number;
  uniqueAwardCount: number;
  totalMarket: number;
  maxActionDate: string | null;
  naics: KeywordCoverageBqBucket[];
  pscs: KeywordCoverageBqBucket[];
  agencies: KeywordCoverageBqAgency[];
  naicsCount: number;
  pscCount: number;
}

interface KeywordCoverageBqRawRow {
  transaction_count?: unknown;
  unique_award_count?: unknown;
  total_market?: unknown;
  max_action_date?: unknown;
  naics?: Array<{ code?: unknown; name?: unknown; amount?: unknown }>;
  psc?: Array<{ code?: unknown; name?: unknown; amount?: unknown }>;
  agencies?: Array<{ name?: unknown; amount?: unknown }>;
}

export function mapKeywordCoverageBqRow(
  raw: KeywordCoverageBqRawRow | undefined,
  input: { keyword: string; fiscalYear: number },
): KeywordCoverageBqRow {
  if (!raw) {
    throw new Error('keyword-coverage BQ returned no row');
  }
  const naics = (raw.naics ?? [])
    .map((n) => ({
      code: String(n.code ?? '').trim(),
      name: String(n.name ?? '').trim() || String(n.code ?? '').trim(),
      amount: coerceBqNumber(n.amount),
    }))
    .filter((n) => n.code);
  const pscs = (raw.psc ?? [])
    .map((p) => ({
      code: String(p.code ?? '').trim(),
      name: String(p.name ?? '').trim() || String(p.code ?? '').trim(),
      amount: coerceBqNumber(p.amount),
    }))
    .filter((p) => p.code);
  const agencies = (raw.agencies ?? [])
    .map((a) => ({
      name: String(a.name ?? '').trim(),
      amount: coerceBqNumber(a.amount),
    }))
    .filter((a) => a.name);
  const maxRaw = raw.max_action_date == null ? '' : String(raw.max_action_date).trim();
  return {
    keyword: input.keyword,
    fiscalYear: input.fiscalYear,
    transactionCount: Math.round(coerceBqNumber(raw.transaction_count)),
    uniqueAwardCount: Math.round(coerceBqNumber(raw.unique_award_count)),
    totalMarket: coerceBqNumber(raw.total_market),
    maxActionDate: maxRaw || null,
    naics,
    pscs,
    agencies,
    naicsCount: naics.length,
    pscCount: pscs.length,
  };
}

export interface RunKeywordCoverageBqInput {
  keyword: string;
  fiscalYear?: number;
  /** Test / audit only. Production default is the full warehouse corpus (incl. IDVs). */
  awardIdPrefix?: string;
  signal?: AbortSignal;
}

async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    throw err;
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export async function runKeywordCoverageBq(
  input: RunKeywordCoverageBqInput,
): Promise<KeywordCoverageBqRow> {
  const pattern = descriptionMatchPattern(input.keyword);
  if (!pattern) {
    throw new Error('keyword too short for description match');
  }
  const fy = input.fiscalYear ?? latestCompleteFiscalYear();
  const sql = buildKeywordCoverageSql(
    input.awardIdPrefix ? { awardIdPrefix: input.awardIdPrefix } : undefined,
  );
  assertActionObligationGrain(sql);
  const params: Record<string, unknown> = { fy, pattern };
  if (input.awardIdPrefix) params.awardPrefix = input.awardIdPrefix;
  const rows = await withAbort(
    bqQuery<KeywordCoverageBqRawRow>({
      query: sql,
      params,
      ...bqJobOptions({
        feature: 'keyword-coverage',
        tool: 'get_keyword_coverage',
        queryFamily: 'description-match-fy',
      }),
    }),
    input.signal,
  );
  return mapKeywordCoverageBqRow(rows[0], { keyword: input.keyword.trim(), fiscalYear: fy });
}
