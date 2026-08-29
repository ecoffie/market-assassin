/** GitHub Actions dispatch contract for bq-awards-ingest.yml (Checkpoint B2). */
export const BQ_AWARDS_APPLY_CONFIRMATION = 'APPLY_INCREMENTAL_100_DAY_CORRECTION' as const;

export const VALIDATE_DISPATCH_SCRIPT = 'scripts/validate-bq-awards-ingest-dispatch.ts' as const;
export const POST_APPLY_VERIFY_SCRIPT = 'scripts/bq-awards-post-apply-verify.ts' as const;
export const INGEST_BASELINE_PATH = '/tmp/bq-awards-ingest-baseline.json' as const;
export const LOCAL_TSX_BIN = './node_modules/.bin/tsx' as const;

export type BqAwardsIngestMode = 'plan' | 'apply_incremental';

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
