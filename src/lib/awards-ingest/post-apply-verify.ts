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
}

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

  return {
    capturedAt: new Date().toISOString(),
    awardsMaxActionDate: awardsRow?.max_action_date ?? null,
    awardsRowCount: parseCount(awardsRow?.row_count),
    recipientsMaxLastActionDate: recipientsRow?.max_last_action_date ?? null,
    recipientsRollupMergedMaxLastActionDate: rollupMergedRow?.max_last_action_date ?? null,
    dataSourcesLastBuilt: dataSources.lastBuilt,
    ...freshness,
  };
}

export function verifyPostApply(
  baseline: AwardsIngestSanitizedSnapshot,
  current: AwardsIngestSanitizedSnapshot,
): PostApplyVerificationResult {
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
