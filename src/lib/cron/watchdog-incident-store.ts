/**
 * Supabase-backed IncidentStore for the cron watchdog (table: ops_incidents,
 * migration 20261005_ops_incidents.sql).
 *
 * Atomic primitives only — the overlap guarantee in watchdog-incidents.ts depends on them:
 *   insertIfAbsent → INSERT ... ON CONFLICT (incident_key) DO NOTHING RETURNING
 *   compareAndSet  → UPDATE ... WHERE incident_key = $1 AND version = $2 (count: exact)
 *
 * A missing table or a failed read makes list() throw, which runWatchdogIncidents reports
 * as storeAvailable=false so the watchdog falls back to its legacy alert. A NULL count is
 * UNKNOWN and treated as a lost claim (never as success), so a broken write can only cause a
 * missed dedupe-claimed post on that pass — the incident is retried next pass.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IncidentRow, IncidentStore } from './watchdog-incidents';

const TABLE = 'ops_incidents';

export function createSupabaseIncidentStore(sb: SupabaseClient): IncidentStore {
  return {
    async list(source) {
      const { data, error } = await sb.from(TABLE).select('*').eq('source', source);
      if (error) throw new Error(`ops_incidents read failed: ${error.code ?? ''} ${error.message}`);
      return (data ?? []) as IncidentRow[];
    },
    async insertIfAbsent(row) {
      // ON CONFLICT DO NOTHING: the exact count is 1 only for the caller whose INSERT landed.
      // Never inferred from a RETURNING payload (INT-005); a NULL count is a lost claim.
      const { count, error } = await sb
        .from(TABLE)
        .upsert(
          { ...row, updated_at: new Date().toISOString() },
          { onConflict: 'incident_key', ignoreDuplicates: true, count: 'exact' },
        );
      if (error || count == null) return false;
      return count === 1;
    },
    async compareAndSet(key, expectedVersion, patch) {
      const { count, error } = await sb
        .from(TABLE)
        .update({ ...patch, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('incident_key', key)
        .eq('version', expectedVersion);
      if (error || count == null) return false;
      return count === 1;
    },
  };
}
