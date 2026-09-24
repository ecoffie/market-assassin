/**
 * Writes one recompete_compute_once_log row per request while the rollout mode is not 'off'
 * (migration 20260924_recompete_compute_once_log.sql). Best-effort: a logging failure is printed and
 * never affects the response (it runs in the route's after()).
 */
import type { ComparedField } from './recompete-map-paths';

export interface ComputeOnceLogRow {
  mode: string;
  served: 'old' | 'new' | 'fallback';
  forced: boolean;
  compared: boolean;
  outcome: 'identical' | 'churn' | 'mismatch' | 'new_error' | 'old_error' | 'new_busy' | 'skipped_busy' | 'old_degraded' | null;
  mismatch_fields?: ComparedField[] | null;
  params: Record<string, string>;
  bbox: { west: number; south: number; east: number; north: number };
  plan_status?: string | null;
  plan_via?: string | null;
  old_ms?: number | null;
  new_ms?: number | null;
  market_total?: number | null;
  in_view?: number | null;
  pins?: number | null;
  follow_ons?: number | null;
  error?: string | null;
}

/** The recompete-map params that define a request (the log's replay key). */
export const RECOMPETE_PARAM_KEYS = ['q', 'search', 'agency', 'naics', 'psc', 'state', 'setAside', 'subAgency', 'minValue', 'maxValue', 'sap', 'likelihood', 'leadMax'] as const;
export function recompeteParams(get: (k: string) => string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of RECOMPETE_PARAM_KEYS) { const v = get(k); if (v != null && v !== '') out[k] = v.slice(0, 300); }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeComputeOnceLog(db: { from: (t: string) => any }, row: ComputeOnceLogRow): Promise<void> {
  try {
    const { error } = await db.from('recompete_compute_once_log').insert({
      ...row,
      mismatch_fields: row.mismatch_fields && row.mismatch_fields.length ? row.mismatch_fields : null,
      error: row.error ? String(row.error).slice(0, 500) : null,
      deployment: process.env.VERCEL_GIT_COMMIT_SHA || null,
    });
    if (error) console.error('[compute-once] log insert failed:', error.message);
  } catch (e) {
    console.error('[compute-once] log insert threw:', (e as Error).message);
  }
}
