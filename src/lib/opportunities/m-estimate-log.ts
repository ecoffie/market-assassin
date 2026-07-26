/**
 * M-Estimate learning loop — Phase 0: append-only capture.
 *
 * logMEstimate() snapshots ONE computed M-Estimate (the branded contract-value
 * range on the opportunity map / detail drawer) the moment it's produced for a
 * user-facing surface. It is a pure SIDE EFFECT: best-effort, never throws, and
 * MUST NOT affect whether the estimate itself renders.
 *
 * WHY THIS EXISTS NOW, BEFORE any harvest/scoring machinery (Phases 1-3 — see
 * docs/strategy/PRD-m-estimate-self-improving-loop.md): this history cannot be
 * backfilled. If a prediction isn't recorded the moment it's made, the exact
 * comparable-award sample and range we showed the user that day is gone forever
 * (same lesson as recompete_changes — "the moat now counts itself"). The clock
 * on measurable accuracy starts the day this ships, not the day Phase 1/2 land.
 *
 * APPEND-ONLY: every call INSERTs a new row, never an UPDATE. Re-computing the
 * same notice_id (drawer re-opened, model_version bumped, comparable sample
 * changed) is a NEW data point, not a correction — that evolution IS the moat.
 *
 * Do NOT call this on every keystroke/poll — once per real detail fetch that
 * actually produced a value range is the intended cadence. De-duping is
 * deliberately NOT done here (append-only means duplicates across separate
 * opens are real history, not noise).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Bump when the estimate model/methodology changes materially (e.g. new
// percentile bands, new comparable-award source, new narrowing logic) so
// Phase 2 can segment error measurement by which model version produced the
// logged range.
export const M_ESTIMATE_MODEL_VERSION = 'v1';

export interface MEstimateLogRow {
  noticeId: string | null;
  solicitationNumber?: string | null;
  naics?: string | null;
  agency?: string | null;
  subAgency?: string | null;
  ourLow: number | null;
  ourMedian: number | null;
  ourHigh: number | null;
  comparableN?: number | null;
  source?: string | null;
  modelVersion?: string;
}

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

/**
 * Best-effort append-only log of one computed M-Estimate. NEVER throws — a
 * logging failure must not block or degrade the estimate the user sees. Errors
 * are surfaced to console.error (not swallowed silently) so they're visible in
 * server logs / the silent-failure gate's spirit, without propagating to the
 * caller.
 */
export async function logMEstimate(row: MEstimateLogRow): Promise<void> {
  try {
    const db = getSupabase();
    if (!db) {
      console.error('[m-estimate-log] Supabase env vars missing — skipping log');
      return;
    }
    const { error } = await db.from('m_estimate_log').insert({
      notice_id: row.noticeId,
      solicitation_number: row.solicitationNumber ?? null,
      naics: row.naics ?? null,
      agency: row.agency ?? null,
      sub_agency: row.subAgency ?? null,
      our_low: row.ourLow,
      our_median: row.ourMedian,
      our_high: row.ourHigh,
      comparable_n: row.comparableN ?? null,
      source: row.source ?? null,
      model_version: row.modelVersion ?? M_ESTIMATE_MODEL_VERSION,
    });
    if (error) {
      // Best-effort side-effect — log and continue. Common pre-migration cause:
      // the m_estimate_log table doesn't exist yet (42P01), which is expected
      // until the hand-run migration lands. Never throw into the caller.
      console.error('[m-estimate-log] insert failed:', error.message);
    }
  } catch (err) {
    console.error('[m-estimate-log] unexpected error:', err instanceof Error ? err.message : err);
  }
}
