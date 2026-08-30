/** GitHub Actions dispatch contract for bq-awards-ingest.yml (Checkpoint B2). */
export const BQ_AWARDS_APPLY_CONFIRMATION = 'APPLY_INCREMENTAL_100_DAY_CORRECTION' as const;

export const VALIDATE_DISPATCH_SCRIPT = 'scripts/validate-bq-awards-ingest-dispatch.ts' as const;
export const POST_APPLY_VERIFY_SCRIPT = 'scripts/bq-awards-post-apply-verify.ts' as const;
export const INGEST_BASELINE_PATH = '/tmp/bq-awards-ingest-baseline.json' as const;
export const LOCAL_TSX_BIN = './node_modules/.bin/tsx' as const;

/** GitHub Actions job timeout — must cover acquisition poll + post-acquisition buffer. */
export const BQ_AWARDS_WORKFLOW_JOB_TIMEOUT_MINUTES = 180 as const;

/** Minutes reserved after acquisition for download → MERGE → rebuild → stamp → verify. */
export const BQ_AWARDS_MIN_POST_ACQUISITION_BUFFER_MINUTES = 60 as const;

/**
 * Production acquisition poll budget (run 33277315965: ~51.25 min completion → 90 min).
 * Set on the apply_incremental workflow step only — not a dispatch input.
 */
export const BQ_AWARDS_WORKFLOW_ACQUISITION_POLL_MINUTES = 90 as const;

/** Sunday 14:00 UTC — weekly cadence aligned with the 10-day freshness SLA. */
export const BQ_AWARDS_WEEKLY_SCHEDULE_CRON = '0 14 * * 0' as const;

export type BqAwardsIngestMode = 'plan' | 'apply_incremental';
export type GithubWorkflowEventName = 'schedule' | 'workflow_dispatch' | string;

const MODES: ReadonlySet<string> = new Set(['plan', 'apply_incremental']);

export function isBqAwardsIngestMode(value: string): value is BqAwardsIngestMode {
  return MODES.has(value);
}

/** Fail-closed before acquisition when apply mode lacks the exact confirmation string. */
export function assertApplyConfirmation(mode: string, confirmation: string | undefined): void {
  if (mode !== 'apply_incremental') return;
  if (confirmation !== BQ_AWARDS_APPLY_CONFIRMATION) {
    throw new Error(
      'apply confirmation rejected — exact match required before acquisition',
    );
  }
}

export interface WorkflowDispatchInput {
  mode: string;
  confirmation?: string;
  hasGcpSaJson: boolean;
  hasSupabaseUrl: boolean;
  hasSupabaseServiceKey: boolean;
}

export interface WorkflowDispatchResult {
  mode: BqAwardsIngestMode;
  confirmationAccepted: boolean;
  requiredSecretNames: string[];
}

/**
 * Single source of truth for the workflow dispatch gate.
 * Never logs confirmation or secret values — only mode, secret names, and booleans.
 */
export function validateWorkflowDispatch(input: WorkflowDispatchInput): WorkflowDispatchResult {
  if (!isBqAwardsIngestMode(input.mode)) {
    throw new Error(`unsupported mode: ${input.mode}`);
  }

  if (input.mode === 'apply_incremental') {
    assertApplyConfirmation(input.mode, input.confirmation);
  }

  const missing: string[] = [];
  if (!input.hasGcpSaJson) missing.push('GCP_SA_JSON');
  if (input.mode === 'apply_incremental') {
    if (!input.hasSupabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!input.hasSupabaseServiceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required GitHub secret names: ${missing.join(', ')}`);
  }

  return {
    mode: input.mode,
    confirmationAccepted: input.mode === 'apply_incremental',
    requiredSecretNames: requiredSecretNames(input.mode),
  };
}

export function npmScriptForMode(mode: string): 'ingest:awards' | 'ingest:awards:apply' {
  if (mode === 'apply_incremental') return 'ingest:awards:apply';
  return 'ingest:awards';
}

export function requiredSecretNames(mode: string): string[] {
  if (mode === 'apply_incremental') {
    return ['GCP_SA_JSON', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  }
  return ['GCP_SA_JSON'];
}

export function parseSecretPresence(value: string | undefined): boolean {
  return value === 'true';
}

/** Scheduled runs always apply incrementally; manual dispatch keeps the typed choice. */
export function resolveIngestModeForEvent(
  eventName: GithubWorkflowEventName,
  dispatchMode: string | undefined,
): string {
  if (eventName === 'schedule') return 'apply_incremental';
  return dispatchMode ?? '';
}

/**
 * Scheduled runs supply the exact apply confirmation in workflow env — same string
 * as a guarded manual apply, without exposing it as a dispatch input.
 */
export function resolveConfirmationForEvent(
  eventName: GithubWorkflowEventName,
  dispatchConfirmation: string | undefined,
): string | undefined {
  if (eventName === 'schedule') return BQ_AWARDS_APPLY_CONFIRMATION;
  return dispatchConfirmation;
}

export function isApplyIncrementalRun(
  eventName: GithubWorkflowEventName,
  dispatchMode: string | undefined,
): boolean {
  return resolveIngestModeForEvent(eventName, dispatchMode) === 'apply_incremental';
}
