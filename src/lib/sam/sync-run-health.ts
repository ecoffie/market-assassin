/**
 * SAM sync run health for sam-sync-watchdog (2026-11-25: the 09:00 resume and 13:00 delta runs failed with
 * 401 Invalid Credentials and fetched 0, yet the 15:00 watchdog reported SUCCESS — it counted only status='failed'
 * and scored cache AGE, which the 01:00 run had just refreshed).
 *
 * Reads what each run REPORTED (status, rows fetched, error text), not just that it ran:
 *   - credentialFailure: any of the latest runs names a rejected key (401/403/invalid credentials) → critical.
 *   - consecutiveUnproductive: newest-first runs that failed, or finished with an error and fetched nothing.
 */
export interface SamSyncRunRow {
  status: string | null;
  total_fetched?: number | null;
  error_message?: string | null;
}

const CREDENTIAL = /\b(401|403)\b|invalid credentials|api[_ ]?key[_ ]?invalid|every SAM key is unusable/i;

export function isCredentialError(message: string | null | undefined): boolean {
  return !!message && CREDENTIAL.test(message);
}

export function isUnproductiveRun(r: SamSyncRunRow): boolean {
  if (r.status === 'running') return false;
  if (r.status === 'failed') return true;
  return (r.total_fetched ?? 0) === 0 && !!(r.error_message && r.error_message.trim());
}

export function classifySamSyncRuns(runsNewestFirst: SamSyncRunRow[], lookback = 3): {
  credentialFailure: boolean;
  consecutiveUnproductive: number;
  credentialErrorSample: string | null;
} {
  const recent = runsNewestFirst.filter((r) => r.status !== 'running');
  const cred = recent.slice(0, lookback).find((r) => isCredentialError(r.error_message));
  let consecutiveUnproductive = 0;
  for (const r of recent) {
    if (isUnproductiveRun(r)) consecutiveUnproductive++;
    else break;
  }
  return {
    credentialFailure: !!cred,
    consecutiveUnproductive,
    credentialErrorSample: cred?.error_message ? cred.error_message.slice(0, 160) : null,
  };
}
