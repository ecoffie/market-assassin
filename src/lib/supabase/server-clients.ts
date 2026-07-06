import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client factory with an optional READ REPLICA split
 * (Resilience Roadmap Phase 1 — see docs/PRD-read-replica.md).
 *
 * WHY: heavy read jobs (daily-alerts reads sam_opportunities for 150 users ×
 * 4/day, briefing precompute, forecast/recompete list reads) run on the SAME
 * primary instance that serves live users. Moving that bulk read load to a
 * read-only replica keeps analytics from competing with live traffic and lets
 * reads survive a primary hiccup — the single most "HigherGov-tier" step.
 *
 * SAFE-BY-DEFAULT: getReadClient() points at SUPABASE_REPLICA_URL *only when it
 * is set*; otherwise it transparently returns a primary client. So this file is
 * a NO-OP until a replica is provisioned and the env var added — shipping it
 * changes nothing. Writes ALWAYS go to the primary via getWriteClient().
 *
 * USAGE:
 *   const db = getReadClient();   // heavy read-only paths (crons, dashboards)
 *   const db = getWriteClient();  // anything that writes, OR reads-its-own-write
 *
 * READ-AFTER-WRITE CAVEAT: a replica lags the primary (usually <1s, more under
 * load). A path that writes then immediately reads that same row MUST use
 * getWriteClient() (the primary) for the read, or it may not see its own write.
 * Only migrate a path to getReadClient() after confirming it's a pure read of
 * already-synced data (the alert/briefing crons qualify).
 */

const PRIMARY_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// The replica has the SAME keys as the primary — only the host differs.
const REPLICA_URL = process.env.SUPABASE_REPLICA_URL;

// Reuse clients per-lambda so we don't spin up a new connection pool per call.
let _write: SupabaseClient | null = null;
let _read: SupabaseClient | null = null;

/**
 * The PRIMARY service-role client. All WRITES and any read-after-write go here.
 * This is the drop-in equivalent of the ad-hoc createClient(URL, SERVICE_KEY)
 * calls scattered across the codebase.
 */
export function getWriteClient(): SupabaseClient {
  if (!_write) _write = createClient(PRIMARY_URL, SERVICE_KEY);
  return _write;
}

/**
 * A client for HEAVY, READ-ONLY paths. Points at the replica when
 * SUPABASE_REPLICA_URL is set; otherwise falls back to the primary (so callers
 * are safe before a replica exists, and in preview/local where there is none).
 * NEVER use this for writes — a replica rejects them.
 */
export function getReadClient(): SupabaseClient {
  if (!REPLICA_URL) return getWriteClient(); // no replica configured → primary
  if (!_read) _read = createClient(REPLICA_URL, SERVICE_KEY);
  return _read;
}

/** True when a replica is actually configured (for diagnostics / logging). */
export function isReplicaConfigured(): boolean {
  return !!REPLICA_URL;
}
