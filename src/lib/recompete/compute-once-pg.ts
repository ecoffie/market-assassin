/**
 * Server-side execution of the Recompete compute-once statement (Gate 2, 2026-09-24).
 *
 * - The statement is built ONLY by recompeteOnePassSql() from the Canonical Discovery plan + the shared
 *   surface spec; nothing from the client reaches this module except bound parameter VALUES.
 * - Connection: the Supabase **transaction** pooler (Supavisor :6543). Serverless instances must not pin
 *   session-pooler connections. RECOMPETE_PG_URL wins; otherwise DATABASE_URL's pooler host is used with
 *   the transaction port. Anything that is not a Supabase pooler host is refused (no direct DB from edge).
 * - Every execution is a READ ONLY transaction with a server-side statement_timeout, so a runaway query
 *   is cancelled by Postgres itself, and nothing can write even if the SQL builder were wrong.
 * - A small per-instance pool (default 2) keeps warm connections; failures surface to the caller, which
 *   falls back to the PostgREST path — this module never decides what the user sees.
 */
import { Pool, type PoolClient } from 'pg';
import { recompeteOnePassSql, type OnePassOptions } from './maps-recompete-sql';
import type { MapsRecompeteRequest } from './maps-recompete-discovery';

export function computeOnceDbUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.RECOMPETE_PG_URL || env.DATABASE_URL || '';
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!/\.pooler\.supabase\.com$/i.test(u.hostname)) return null;
  if (!env.RECOMPETE_PG_URL && u.port === '5432') u.port = '6543';          // session → transaction pooler
  return u.toString();
}

/**
 * Thrown when this instance's pool has no free connection. We never QUEUE behind a busy slot: the shadow
 * sample (2026-09-24) showed two concurrent broad-market statements (~5 s each) holding both slots, and
 * the next four requests waiting the full connect timeout before failing. Serving a user means falling
 * back to PostgREST immediately instead; comparing means skipping. Bounded DB concurrency is the point.
 */
export class ComputeOnceBusy extends Error {
  constructor() { super('compute-once: pool busy'); this.name = 'ComputeOnceBusy'; }
}
/** By name, not instanceof: a bundler or a test's module reset can hand the caller a different class copy. */
export const isComputeOnceBusy = (e: unknown) => (e as { name?: string } | null)?.name === 'ComputeOnceBusy';

let pool: Pool | null = null;
let poolMax = 2;
function getPool(): Pool {
  if (pool) return pool;
  const url = computeOnceDbUrl();
  if (!url) throw new Error('compute-once: no Supabase pooler URL configured');
  poolMax = Math.max(1, Number(process.env.RECOMPETE_PG_POOL_MAX) || 2);
  pool = new Pool({
    connectionString: url,
    max: poolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    ssl: { rejectUnauthorized: false },
    application_name: 'recompete-compute-once',
  });
  pool.on('error', (e) => console.error('[compute-once] idle client error:', e.message));
  return pool;
}

export interface ComputeOnceResult {
  total: number;
  unmapped: number;
  inView: number;
  pins: Array<Record<string, unknown>>;
  followOns: Array<Record<string, unknown>>;
  ms: number;
}

/** Throws on any failure — including a plan op the serializer does not recognize (fail closed). */
export async function runComputeOnce(req: MapsRecompeteRequest, opts: OnePassOptions, timeoutMs = 8_000): Promise<ComputeOnceResult> {
  const t0 = Date.now();
  const { text, values } = recompeteOnePassSql(req, opts);   // throws BEFORE any I/O on an unknown op
  let client: PoolClient | null = null;
  let broken: Error | undefined;
  try {
    const p = getPool();
    if (p.totalCount >= poolMax && p.idleCount === 0) throw new ComputeOnceBusy();
    client = await p.connect();
    await client.query(`BEGIN READ ONLY; SET LOCAL statement_timeout = '${Math.max(500, Math.floor(timeoutMs))}ms';`);
    const r = await client.query(text, values);
    await client.query('COMMIT');
    const row = r.rows[0];
    return {
      total: Number(row.total), unmapped: Number(row.unmapped), inView: Number(row.in_view),
      pins: row.pins || [], followOns: row.follow_ons || [], ms: Date.now() - t0,
    };
  } catch (e) {
    broken = e as Error;
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    // a connection that errored mid-transaction is destroyed, never returned to the pool
    if (client) client.release(broken);
  }
}
