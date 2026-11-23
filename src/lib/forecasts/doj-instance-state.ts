/**
 * Control-plane `source_state` for a FAILED DOJ forecast run.
 *
 * Uses only the states data_source_instances already allows
 * (supabase/migrations/20260913_data_source_instances.sql, ManualSourceState in
 * src/lib/data-core/manual-source-ops.ts):
 *
 *   unreachable    we could not read the source at all — no validated workbook
 *                  (HTTP error, transport error, empty body, not an XLSX)
 *   content_stale  the workbook WAS read (a fingerprint exists) but Mindy did not
 *                  take it in — header drift, accounting/semantic gate, or a
 *                  failed insert/update. Upstream state is known; held is behind.
 *
 * THE BUG (2026-11-23): the route stamped `unreachable` whenever a fingerprint
 * existed — i.e. precisely when the source HAD been reached — and `unmeasured`
 * when it had not. A daily insert failure therefore read as a dead DOJ website,
 * sending anyone triaging it to the wrong layer. Same rule as the Gateway watch
 * (gateway-watch-state.ts): reading the source at all is not "unreachable".
 */
export type DojFailureSourceState = 'unreachable' | 'content_stale';

export function dojFailureSourceState(r: { fingerprint: string | null }): DojFailureSourceState {
  return r.fingerprint ? 'content_stale' : 'unreachable';
}
