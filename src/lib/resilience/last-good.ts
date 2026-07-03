import { kv } from '@vercel/kv';

/**
 * Last-good snapshot cache — graceful degradation for read routes.
 *
 * WHY: When the primary database (Supabase) is unreachable — e.g. the
 * multi-region compute incident of 2026-06-30 — hot read routes (recompete,
 * market-intel) would 500 / time out and render an empty panel. This layer
 * lets a route serve its most recent SUCCESSFUL payload with an honest
 * "as of {time}" banner instead of an error, so a users keeps a usable
 * (if slightly stale) view through an outage.
 *
 * DESIGN:
 *  - The snapshot is stored in Vercel KV (Upstash) — a SEPARATE service from
 *    Supabase, so it survives a Supabase outage. It must NOT live in the DB
 *    that is the thing going down.
 *  - A per-lambda in-memory copy is kept as a fast path so the happy path
 *    doesn't pay a KV round-trip on every request; KV is the durable,
 *    cross-lambda source of truth during an outage (warm OR cold lambdas).
 *  - All KV ops are wrapped in try/catch and degrade to null (per the
 *    project KV-resilience rule) — a KV quota/outage never breaks the route.
 *
 * CONTRACT (see withLastGood): success → store + return {_fresh:true};
 * upstream failure with a snapshot → return {_fresh:false, _degraded:true,
 * _servedAt} at HTTP 200; failure with no snapshot → the caller's own error.
 */

const KEY_PREFIX = 'lastgood:';
// Snapshots are only useful while the primary is down; keep them a day so a
// stale panel can't silently persist for weeks after an incident is resolved.
const TTL_SECONDS = 60 * 60 * 24;

export interface Snapshot<T = unknown> {
  data: T;
  savedAt: string; // ISO timestamp of the successful response
}

// Per-lambda memory cache. Keyed the same as KV. Lost on cold start (that's
// fine — KV backs it), avoids a KV read on the warm happy path.
const memory = new Map<string, Snapshot>();

function keyFor(name: string): string {
  return `${KEY_PREFIX}${name}`;
}

/**
 * Persist a successful payload as the new last-good snapshot for `name`.
 * Fire-and-forget: never throws, never blocks the response on KV.
 */
export async function saveSnapshot<T>(name: string, data: T): Promise<void> {
  const snap: Snapshot<T> = { data, savedAt: new Date().toISOString() };
  memory.set(keyFor(name), snap as Snapshot);
  try {
    await kv.set(keyFor(name), snap, { ex: TTL_SECONDS });
  } catch (err) {
    // KV quota exceeded / unavailable — memory copy still serves warm lambdas.
    console.warn(`[last-good] KV write failed for ${name}:`, (err as Error)?.message);
  }
}

/**
 * Read the last-good snapshot for `name`. Prefers the in-memory copy (this
 * lambda served a success recently), falls back to KV (durable, cross-lambda).
 * Returns null if no snapshot exists anywhere.
 */
export async function readSnapshot<T>(name: string): Promise<Snapshot<T> | null> {
  const mem = memory.get(keyFor(name));
  if (mem) return mem as Snapshot<T>;
  try {
    const kvSnap = await kv.get<Snapshot<T>>(keyFor(name));
    if (kvSnap) {
      memory.set(keyFor(name), kvSnap as Snapshot); // warm the lambda for next time
      return kvSnap;
    }
  } catch (err) {
    console.warn(`[last-good] KV read failed for ${name}:`, (err as Error)?.message);
  }
  return null;
}

/**
 * The degradation-aware envelope fields merged into every response. A route's
 * client reads `_degraded` + `_servedAt` to show the "as of {time}" banner.
 */
export interface DegradationMeta {
  _fresh: boolean;
  _degraded: boolean;
  _servedAt: string | null; // ISO time the served data was actually captured
}

export function freshMeta(): DegradationMeta {
  return { _fresh: true, _degraded: false, _servedAt: new Date().toISOString() };
}

export function degradedMeta(savedAt: string): DegradationMeta {
  return { _fresh: false, _degraded: true, _servedAt: savedAt };
}
