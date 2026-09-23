/**
 * Sanitized baseline + post-apply verification for bq-awards-ingest apply_incremental.
 *
 * Output is counts, dates, classifications, and booleans only — never row-level award or
 * contractor data, credentials, or secret values.
 *
 * IMPORTANT: A post-apply verification failure marks the workflow failed but does NOT roll
 * back an already completed MERGE, recipients rebuild, or clock stamp. Operators must treat
 * a red verify step as a manual follow-up signal, not an automatic undo.
 */
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';
import {
  classifyFreshness,
  decodeAwardsIngestClocks,
  type AwardsIngestClocks,
} from './clocks';
import { INGEST_BASELINE_PATH } from './workflow-control';
import {
  AWARDS_COLUMNS,
  awardsColumnsQuery,
  classifyAwardsSchema,
  IDV_IDENTITY_REQUIRED,
} from './awards-schema';

export { INGEST_BASELINE_PATH };

/** Sanitized snapshot — no row-level payloads. */
export interface AwardsIngestSanitizedSnapshot {
  capturedAt: string;
  awardsMaxActionDate: string | null;
  awardsRowCount: number | null;
  recipientsMaxLastActionDate: string | null;
  recipientsRollupMergedMaxLastActionDate: string | null;
  dataSourcesLastBuilt: string | null;
  hasV1ClockBlock: boolean;
  mergedAt: string | null;
  recipientsRebuiltAt: string | null;
  freshnessStatus: string | null;
  freshnessLegacyUnmeasured: boolean;
  /**
   * Live `awards` schema (INFORMATION_SCHEMA.COLUMNS). Optional so baselines captured before
   * 2026-09-23 still parse; absent on `current` = unmeasured.
   */
  awardsColumnCount?: number | null;
  awardsIdvIdentityMode?: 'present' | 'absent' | 'partial' | null;
  /** classifyAwardsSchema().ok — false on a type mismatch, a missing legacy column or a partial DDL. */
  awardsSchemaOk?: boolean | null;
  /** IDV rows (award_or_idv_flag='IDV') in the trailing 90 days of action_date — only when present. */
  idvRecentRows?: number | null;
  idvRecentOrderingEndFilled?: number | null;
}

/** Share of recent IDV rows that must carry ordering_period_end_date (staging measured 100%). */
export const IDV_ORDERING_END_MIN_FILL = 0.95;

export interface PostApplyCheckResult {
  awardsMaxActionDateNonRegressing: boolean;
  awardsRowCountNonDecreasing: boolean;
  recipientsLastActionDateNonRegressing: boolean;
  recipientsRollupMergedLastActionDateNonRegressing: boolean;
  hasV1ClockBlock: boolean;
  mergedAtPopulated: boolean;
  recipientsRebuiltAtPopulated: boolean;
  freshnessNotLegacyUnmeasured: boolean;
  freshnessStatus: string | null;
  /** ≥ 58 columns — enforced only when IDV_IDENTITY_REQUIRED; otherwise reported. */
  awardsColumnCountOk: boolean;
  /** No type mismatch / missing legacy column / partial IDV DDL (unmeasured = pass unless required). */
  awardsSchemaTypesOk: boolean;
  /** When the IDV columns are present: recent IDV rows carry ordering_period_end_date. */
  idvOrderingEndFillOk: boolean;
}

export interface PostApplyVerificationResult {
  ok: boolean;
  baseline: AwardsIngestSanitizedSnapshot;
  current: AwardsIngestSanitizedSnapshot;
  checks: PostApplyCheckResult;
  failures: string[];
}

/** Gold-master parent rollup rebuilt by rebuild-recipients-from-awards.sql §2c. */
export const AUTHORITATIVE_RECIPIENTS_ROLLUP_TABLE = 'recipients_rollup_merged' as const;

/** Fully-qualified BQ FROM target for the merged rollup watermark query. */
export function recipientsRollupMergedQueryFrom(): string {
  return BQ_TABLES.recipientsRollup;
}

function parseCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateNonRegressing(baseline: string | null, current: string | null): boolean {
  if (baseline === null) return current !== null;
  if (current === null) return false;
  return Date.parse(current) >= Date.parse(baseline);
}

function countNonDecreasing(baseline: number | null, current: number | null): boolean {
  if (baseline === null || current === null) return false;
  return current >= baseline;
}

function freshnessFromNotes(
  notes: string | null,
): Pick<
  AwardsIngestSanitizedSnapshot,
  'freshnessStatus' | 'freshnessLegacyUnmeasured' | 'mergedAt' | 'recipientsRebuiltAt' | 'hasV1ClockBlock'
> {
  const decoded = decodeAwardsIngestClocks(notes);
  const hasV1ClockBlock = decoded !== null;
  const clocks: AwardsIngestClocks | null = decoded;
  const freshness = classifyFreshness({ clocks });
  const legacyUnmeasured = !hasV1ClockBlock
    || freshness.status === 'unmeasured';
  return {
    hasV1ClockBlock,
    mergedAt: decoded?.mergedAt ?? null,
    recipientsRebuiltAt: decoded?.recipientsRebuiltAt ?? null,
    freshnessStatus: freshness.status,
    freshnessLegacyUnmeasured: legacyUnmeasured,
  };
}

async function readSupabaseDataSources(): Promise<{ lastBuilt: string | null; notes: string | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('post_apply_verify: Supabase env missing');
  }
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key);
  const { data, error } = await sb
    .from('data_sources')
    .select('last_built, notes')
    .eq('key', 'bq_awards')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`post_apply_verify: data_sources read failed: ${error.message}`);
  return {
    lastBuilt: data?.last_built ?? null,
    notes: data?.notes ?? null,
  };
}

export async function captureSanitizedSnapshot(): Promise<AwardsIngestSanitizedSnapshot> {
  const [awardsRow] = await bqQuery<{
    max_action_date?: string;
    row_count?: number | string;
  }>({
    query: `
      SELECT
        CAST(MAX(action_date) AS STRING) AS max_action_date,
        COUNT(*) AS row_count
      FROM ${BQ_TABLES.awards}
      WHERE fiscal_year >= 2025
    `,
    bulkJob: 'awards-ingest-post-apply-baseline',
  });

  const [recipientsRow] = await bqQuery<{ max_last_action_date?: string }>({
    query: `SELECT CAST(MAX(last_action_date) AS STRING) AS max_last_action_date FROM ${BQ_TABLES.recipients}`,
    bulkJob: 'awards-ingest-post-apply-baseline',
  });

  const [rollupMergedRow] = await bqQuery<{ max_last_action_date?: string }>({
    query: `SELECT CAST(MAX(last_action_date) AS STRING) AS max_last_action_date FROM ${recipientsRollupMergedQueryFrom()}`,
    bulkJob: 'awards-ingest-post-apply-baseline',
  });

  const dataSources = await readSupabaseDataSources();
  const freshness = freshnessFromNotes(dataSources.notes);
  const schema = await captureAwardsSchemaState();

  return {
    capturedAt: new Date().toISOString(),
    awardsMaxActionDate: awardsRow?.max_action_date ?? null,
    awardsRowCount: parseCount(awardsRow?.row_count),
    recipientsMaxLastActionDate: recipientsRow?.max_last_action_date ?? null,
    recipientsRollupMergedMaxLastActionDate: rollupMergedRow?.max_last_action_date ?? null,
    dataSourcesLastBuilt: dataSources.lastBuilt,
    ...freshness,
    ...schema,
  };
}

/** Live column count / IDV mode / (when present) recent IDV ordering_period_end_date fill. */
async function captureAwardsSchemaState(): Promise<Pick<AwardsIngestSanitizedSnapshot,
  'awardsColumnCount' | 'awardsIdvIdentityMode' | 'awardsSchemaOk' | 'idvRecentRows' | 'idvRecentOrderingEndFilled'>> {
  const cols = await bqQuery<{ column_name: string; data_type: string }>({
    query: awardsColumnsQuery(),
    bulkJob: 'awards-ingest-post-apply-baseline',
  });
  // Never classify with the IDV requirement here — verifyPostApply applies it, so a baseline
  // capture never throws. Unknown/mismatch detail stays out of the snapshot (counts only).
  const state = classifyAwardsSchema(
    cols.map((c) => ({ name: c.column_name, dataType: c.data_type })),
    { required: false },
  );
  let idvRecentRows: number | null = null;
  let idvRecentOrderingEndFilled: number | null = null;
  if (state.idvMode === 'present') {
    const [fill] = await bqQuery<{ idv_rows?: number | string; filled?: number | string }>({
      query: `
        SELECT
          COUNTIF(award_or_idv_flag = 'IDV') AS idv_rows,
          COUNTIF(award_or_idv_flag = 'IDV' AND ordering_period_end_date IS NOT NULL) AS filled
        FROM ${BQ_TABLES.awards}
        WHERE fiscal_year >= EXTRACT(YEAR FROM CURRENT_DATE()) - 1
          AND action_date >= DATE_SUB(
            (SELECT MAX(action_date) FROM ${BQ_TABLES.awards} WHERE fiscal_year >= EXTRACT(YEAR FROM CURRENT_DATE()) - 1),
            INTERVAL 90 DAY)
      `,
      bulkJob: 'awards-ingest-post-apply-baseline',
    });
    idvRecentRows = parseCount(fill?.idv_rows);
    idvRecentOrderingEndFilled = parseCount(fill?.filled);
  }
  return {
    awardsColumnCount: cols.length,
    awardsIdvIdentityMode: state.idvMode,
    awardsSchemaOk: state.ok,
    idvRecentRows,
    idvRecentOrderingEndFilled,
  };
}

export function verifyPostApply(
  baseline: AwardsIngestSanitizedSnapshot,
  current: AwardsIngestSanitizedSnapshot,
  opts: { idvRequired?: boolean } = {},
): PostApplyVerificationResult {
  const idvRequired = opts.idvRequired ?? IDV_IDENTITY_REQUIRED;
  const colCount = current.awardsColumnCount ?? null;
  const mode = current.awardsIdvIdentityMode ?? null;
  const idvRows = current.idvRecentRows ?? null;
  const idvFilled = current.idvRecentOrderingEndFilled ?? null;
  const checks: PostApplyCheckResult = {
    awardsMaxActionDateNonRegressing: dateNonRegressing(
      baseline.awardsMaxActionDate,
      current.awardsMaxActionDate,
    ),
    awardsRowCountNonDecreasing: countNonDecreasing(
      baseline.awardsRowCount,
      current.awardsRowCount,
    ),
    recipientsLastActionDateNonRegressing: dateNonRegressing(
      baseline.recipientsMaxLastActionDate,
      current.recipientsMaxLastActionDate,
    ),
    recipientsRollupMergedLastActionDateNonRegressing: dateNonRegressing(
      baseline.recipientsRollupMergedMaxLastActionDate,
      current.recipientsRollupMergedMaxLastActionDate,
    ),
    hasV1ClockBlock: current.hasV1ClockBlock,
    mergedAtPopulated: Boolean(current.mergedAt),
    recipientsRebuiltAtPopulated: Boolean(current.recipientsRebuiltAt),
    freshnessNotLegacyUnmeasured: !current.freshnessLegacyUnmeasured,
    freshnessStatus: current.freshnessStatus,
    // Unmeasured (null) never passes once the columns are required — unknown is not "58".
    awardsColumnCountOk: idvRequired ? colCount !== null && colCount >= AWARDS_COLUMNS.length : true,
    awardsSchemaTypesOk: current.awardsSchemaOk === false
      ? false
      : idvRequired ? current.awardsSchemaOk === true && mode === 'present' : true,
    idvOrderingEndFillOk: mode === 'present'
      ? idvRows !== null && idvFilled !== null && idvRows > 0 && idvFilled / idvRows >= IDV_ORDERING_END_MIN_FILL
      : !idvRequired,
  };

  const failures: string[] = [];
  if (!checks.awardsMaxActionDateNonRegressing) {
    failures.push('awards MAX(action_date) regressed');
  }
  if (!checks.awardsRowCountNonDecreasing) {
    failures.push('awards row count decreased unexpectedly');
  }
  if (!checks.recipientsLastActionDateNonRegressing) {
    failures.push('recipients MAX(last_action_date) regressed');
  }
  if (!checks.recipientsRollupMergedLastActionDateNonRegressing) {
    failures.push('recipients_rollup_merged MAX(last_action_date) regressed');
  }
  if (!checks.hasV1ClockBlock) {
    failures.push('four-clock v1 block missing from data_sources[bq_awards].notes');
  }
  if (!checks.mergedAtPopulated) {
    failures.push('mergedAt not populated in v1 clock block');
  }
  if (!checks.recipientsRebuiltAtPopulated) {
    failures.push('recipientsRebuiltAt not populated in v1 clock block');
  }
  if (!checks.freshnessNotLegacyUnmeasured) {
    failures.push('freshness remains legacy unmeasured');
  }
  if (!checks.awardsColumnCountOk) {
    failures.push(`awards has ${colCount ?? 'UNMEASURED'} columns; ≥ ${AWARDS_COLUMNS.length} required (IDV_IDENTITY_REQUIRED)`);
  }
  if (!checks.awardsSchemaTypesOk) {
    failures.push(`awards schema refused (idv mode ${mode ?? 'UNMEASURED'}; a type mismatch, missing legacy column or partial IDV DDL)`);
  }
  if (!checks.idvOrderingEndFillOk) {
    failures.push(`recent IDV rows missing ordering_period_end_date (${idvFilled ?? '?'}/${idvRows ?? '?'}; need ≥ ${IDV_ORDERING_END_MIN_FILL * 100}%)`);
  }

  return {
    ok: failures.length === 0,
    baseline,
    current,
    checks,
    failures,
  };
}

export function formatVerificationReport(result: PostApplyVerificationResult): string {
  const lines = [
    'post_apply_verify: sanitized result',
    `ok=${result.ok}`,
    `baseline_captured_at=${result.baseline.capturedAt}`,
    `current_captured_at=${result.current.capturedAt}`,
    `awards_max_action_date baseline=${result.baseline.awardsMaxActionDate} current=${result.current.awardsMaxActionDate} non_regressing=${result.checks.awardsMaxActionDateNonRegressing}`,
    `awards_row_count baseline=${result.baseline.awardsRowCount} current=${result.current.awardsRowCount} non_decreasing=${result.checks.awardsRowCountNonDecreasing}`,
    `recipients_max_last_action_date baseline=${result.baseline.recipientsMaxLastActionDate} current=${result.current.recipientsMaxLastActionDate} non_regressing=${result.checks.recipientsLastActionDateNonRegressing}`,
    `recipients_rollup_merged_max_last_action_date baseline=${result.baseline.recipientsRollupMergedMaxLastActionDate} current=${result.current.recipientsRollupMergedMaxLastActionDate} non_regressing=${result.checks.recipientsRollupMergedLastActionDateNonRegressing}`,
    `has_v1_clock_block=${result.checks.hasV1ClockBlock}`,
    `merged_at_populated=${result.checks.mergedAtPopulated}`,
    `recipients_rebuilt_at_populated=${result.checks.recipientsRebuiltAtPopulated}`,
    `freshness_status=${result.checks.freshnessStatus}`,
    `freshness_not_legacy_unmeasured=${result.checks.freshnessNotLegacyUnmeasured}`,
    `awards_column_count=${result.current.awardsColumnCount ?? 'unmeasured'} idv_mode=${result.current.awardsIdvIdentityMode ?? 'unmeasured'} column_count_ok=${result.checks.awardsColumnCountOk} schema_types_ok=${result.checks.awardsSchemaTypesOk}`,
    `idv_recent_ordering_end_filled=${result.current.idvRecentOrderingEndFilled ?? 'n/a'}/${result.current.idvRecentRows ?? 'n/a'} fill_ok=${result.checks.idvOrderingEndFillOk}`,
  ];
  if (result.failures.length > 0) {
    lines.push(`failures=${result.failures.join('; ')}`);
    lines.push(
      'NOTE: verification failure does not roll back a completed MERGE — manual follow-up required',
    );
  }
  return lines.join('\n');
}

export function snapshotContainsNoRowLevelFields(snapshot: AwardsIngestSanitizedSnapshot): boolean {
  const json = JSON.stringify(snapshot);
  const forbidden = ['recipient_uei', 'recipient_name', 'award_id', 'txn_id', 'private_key', 'token'];
  return !forbidden.some((field) => json.includes(field));
}
