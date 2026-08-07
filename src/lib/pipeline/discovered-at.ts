/**
 * resolveDiscoveredAt — the ONE shared resolver both pipeline save paths call, so the crown-jewel
 * decision-time metric (#122, the Procurement Intelligence Report) is stamped identically no matter
 * how an opportunity is saved (the app POST /api/pipeline or the email GET /api/actions/add-to-pipeline).
 * Keeping it in one lib avoids the lib-duplicate-drift class (memory: lib_duplicate_drift_class).
 *
 * WHAT it returns: the moment this user first DISCOVERED this opportunity —
 *   • the user's EARLIEST logged `user_engagement` event that carries this notice_id, if one exists;
 *   • else NOW() as an honest floor (a same-visit save = 0 decision-days).
 * Frozen on the row at save time; decision_time = created_at − discovered_at, reliable forward with
 * NO fragile cross-corpus join (memory: decision_time_notice_id_mismatch).
 *
 * HONESTY: the lookup can only pull discovered_at EARLIER than now(), so the metric only ever
 * UNDERstates decision time — it never fabricates days. Any lookup error → floor to nowIso (a save
 * must never fail because the discovery lookup hiccupped); the caller passes an explicit `nowIso`
 * so the value is deterministic and testable.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Match a user_engagement event to a notice via any of the keys the emitters actually use. */
const NOTICE_KEYS = ['notice_id', 'noticeId', 'opportunity_id'] as const;

export async function resolveDiscoveredAt(
  supabase: SupabaseClient,
  opts: { userEmail: string; noticeId?: string | null; nowIso: string },
): Promise<string> {
  const { userEmail, noticeId, nowIso } = opts;
  // No notice id or no user → we can't look up a prior view; the save moment IS the discovery floor.
  if (!noticeId || !userEmail) return nowIso;

  try {
    // Earliest event by this user whose metadata carries this notice id under any known key.
    // ILIKE on the serialized metadata is a cheap, index-free way to catch all key spellings without
    // three separate OR'd jsonb path filters; the user_email + created_at ordering does the work.
    const orExpr = NOTICE_KEYS.map((k) => `metadata->>${k}.eq.${noticeId}`).join(',');
    const { data, error } = await supabase
      .from('user_engagement')
      .select('created_at')
      .eq('user_email', userEmail)
      .or(orExpr)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    // Surface the error but NEVER fail the save — floor to now() (honest: no earlier view found).
    if (error) {
      console.warn('[discovered-at] earliest-view lookup failed (flooring to now):', error.message);
      return nowIso;
    }
    const seen = data?.created_at ? new Date(data.created_at) : null;
    if (seen && !Number.isNaN(seen.getTime()) && seen.getTime() < new Date(nowIso).getTime()) {
      return seen.toISOString(); // a genuine earlier discovery → real decision-time gap
    }
    return nowIso; // no earlier view (or somehow not-earlier) → the save is the floor
  } catch (e) {
    console.warn('[discovered-at] lookup threw (flooring to now):', e instanceof Error ? e.message : String(e));
    return nowIso;
  }
}
