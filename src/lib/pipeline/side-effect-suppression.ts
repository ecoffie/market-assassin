/**
 * Downstream side-effect suppression for scanner-created pipeline rows (hotfix 2026-10-06).
 *
 * Before #1845 the daily alert's save link was a GET that inserted a pursuit, so mail link scanners
 * created pursuits nobody chose. The high-confidence ones (T1: < 120 s after the alert AND a ±1 s
 * burst, see migration 20261006_pipeline_side_effect_suppressions.sql) are recorded, with reason
 * and evidence, in `pipeline_side_effect_suppressions`.
 *
 * This module only answers "should this DOWNSTREAM side effect be skipped for these pursuits?".
 * It never hides, edits or deletes a pipeline row.
 *
 * FAIL OPEN: any lookup error returns "nothing suppressed", so a real user's pursuit is never
 * silenced by an outage. A suppressed alert is a lesser loss than a missed one.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type SuppressedSideEffect = 'change_notifications' | 'doc_fetch';

const COLUMN: Record<SuppressedSideEffect, string> = {
  change_notifications: 'suppress_change_notifications',
  doc_fetch: 'suppress_doc_fetch',
};

/** `.in()` lists are chunked so a large batch never builds an oversized request URL. */
const CHUNK = 200;

export async function suppressedPipelineIds(
  sb: SupabaseClient,
  pipelineIds: string[],
  effect: SuppressedSideEffect,
): Promise<{ ids: Set<string>; error: string | null }> {
  const ids = new Set<string>();
  const unique = Array.from(new Set(pipelineIds.filter(Boolean)));
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from('pipeline_side_effect_suppressions')
      .select('pipeline_id')
      .in('pipeline_id', chunk)
      .eq(COLUMN[effect], true);
    if (error) {
      console.error(`[side-effect-suppression] lookup failed, failing OPEN (${effect}):`, error.message);
      return { ids: new Set(), error: error.message };
    }
    for (const r of (data || []) as { pipeline_id: string }[]) ids.add(r.pipeline_id);
  }
  return { ids, error: null };
}

export async function isSideEffectSuppressed(
  sb: SupabaseClient,
  pipelineId: string,
  effect: SuppressedSideEffect,
): Promise<boolean> {
  const { ids } = await suppressedPipelineIds(sb, [pipelineId], effect);
  return ids.has(pipelineId);
}

/**
 * Remove suppressed pursuits from per-owner notification digests, in place. An owner whose every
 * changed pursuit is suppressed is removed entirely (no email, no SMS). Returns how many pursuit
 * entries were dropped. Ordinary pursuits are never touched.
 */
export function dropSuppressedFromDigests<T extends { pursuitId: string }>(
  digests: Map<string, T[]>,
  suppressed: Set<string>,
): number {
  if (!suppressed.size) return 0;
  let dropped = 0;
  for (const [owner, items] of Array.from(digests.entries())) {
    const kept = items.filter((it) => !suppressed.has(it.pursuitId));
    dropped += items.length - kept.length;
    if (kept.length) digests.set(owner, kept);
    else digests.delete(owner);
  }
  return dropped;
}

