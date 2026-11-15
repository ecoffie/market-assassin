/**
 * CACHED OPEN-NOTICE RETRIEVAL (Agent 3, RC2; Eric approved for DEVELOPMENT 2026-11-14 — not wired, not deployed;
 * deployment needs Agent 5's integration review and Eric's approval). Design: tasks/search-stabilization-2026-11-14/
 * LONG-QUERY-DESIGN.md.
 *
 * Why: a long paragraph builds 50–65 word-boundary regex clauses that Postgres re-runs (re-reading TOASTed description
 * and SOW text) on every open row: 4–5 s for the count alone, past the ~8.3 s statement timeout with the page query.
 *
 * How (exact by construction, never stale):
 *   1. SNAPSHOT: every active open row's text columns, built only when COMPLETE (rows === exact count, count stable).
 *   2. CANDIDATES: the plan's own open ops (PostgREST logic trees, parsed by discovery/sql.ts's closed grammar, which
 *      throws on anything unknown) are evaluated in memory on the snapshot. Nothing is re-interpreted.
 *   3. LIVE VERIFY: the database applies the remaining structured filters (applyMapFilters: status, deadline window,
 *      states, set-aside, codes) to the candidate ids, excluding rows changed since the snapshot. Rows, identity and
 *      freshness therefore come from the database, never from the snapshot.
 *   4. DELTA: rows changed since the snapshot (synced_at / description_checked_at / sow_checked_at / updated_at newer
 *      than built_at) are evaluated by the normal SQL path, so a new or edited notice is never missed.
 *   5. REFUSE, never substitute: no snapshot, an over-age snapshot, or a delta above DELTA_MAX returns
 *      `cache_unavailable` with a reason; the caller then runs today's SQL path (which reports "too long" on a timeout).
 *      A genuine zero is `ok` with count 0.
 */
import { parseLogicList } from '@/lib/discovery/sql';
import { applyOpenPlan } from '@/lib/discovery/apply';
import { parseMapFilters, applyMapFilters } from '@/lib/opportunities/map-filters';
import type { DiscoveryPlan, Op } from '@/lib/discovery';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const SNAPSHOT_COLS = ['notice_id', 'title', 'description', 'sow_text', 'department', 'sub_tier', 'solicitation_number', 'naics_code', 'psc_code', 'set_aside_code', 'set_aside_description', 'response_deadline'] as const;
export type SnapshotRow = Record<(typeof SNAPSHOT_COLS)[number], string | null>;
export interface OpenSnapshot { builtAt: string; rows: SnapshotRow[]; count: number }

/** Change markers: every enabled writer of a text column stamps one of these (audited 2026-11-14). */
export const CHANGE_COLS = ['synced_at', 'description_checked_at', 'sow_checked_at', 'updated_at'] as const;
export const SNAPSHOT_MAX_AGE_MS = 6 * 3600_000;
export const DELTA_MAX = 1500;
const ID_CHUNK = 150;

/** Build a COMPLETE snapshot or throw. Read-only. */
export async function buildOpenSnapshot(client: any, now = new Date()): Promise<OpenSnapshot> {
  const builtAt = now.toISOString();
  const head = async () => {
    const { count, error } = await client.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }).eq('active', true).gt('response_deadline', builtAt);
    if (error || count == null) throw new Error(`snapshot: count unavailable (${error?.message ?? 'null'})`);
    return count as number;
  };
  const before = await head();
  const rows: SnapshotRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('sam_opportunities').select(SNAPSHOT_COLS.join(',')).eq('active', true).gt('response_deadline', builtAt).order('notice_id').range(from, from + 999);
    if (error) throw new Error(`snapshot: read failed at ${from} (${error.message})`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const after = await head();
  if (rows.length !== before || before !== after) throw new Error(`snapshot: incomplete (${rows.length} rows, count ${before} → ${after}); refused`);
  return { builtAt, rows, count: rows.length };
}

// ── In-memory evaluation of the plan's own ops (same expressions PostgREST runs) ─────────────────────────────────
type Node = ReturnType<typeof parseLogicList>[number];
const reCache = new Map<string, RegExp>();
function pgRegex(pattern: string, ci: boolean): RegExp {
  const k = `${ci ? 'i' : 's'}:${pattern}`;
  let re = reCache.get(k);
  if (!re) { re = new RegExp(pattern.replace(/\\m/g, '\\b').replace(/\\M/g, '\\b'), ci ? 'i' : ''); reCache.set(k, re); }
  return re;
}
function likeRegex(pattern: string, ci: boolean): RegExp {
  const body = pattern.split(/[*%]/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return pgRegex(`^${body}$`, ci);
}
function leafHit(n: any, row: Record<string, unknown>): boolean {
  const v = row[n.col];
  let hit: boolean;
  if (n.op === 'is') hit = v == null;
  else if (v == null) return false; // SQL: NULL op x is NULL → not true, and NOT(NULL) is not true either
  else if (n.op === 'eq') hit = String(v) === n.val;
  else if (n.op === 'like') hit = likeRegex(n.val, false).test(String(v));
  else if (n.op === 'ilike') hit = likeRegex(n.val, true).test(String(v));
  else if (n.op === 'imatch') hit = pgRegex(n.val, true).test(String(v));
  else if (n.op === 'match') hit = pgRegex(n.val, false).test(String(v));
  else throw new Error(`open-cache: unsupported leaf op ${n.op}`);
  return n.not ? !hit : hit;
}
function nodeHit(n: Node, row: Record<string, unknown>): boolean {
  if ('lg' in n) return n.lg === 'and' ? n.items.every((x) => nodeHit(x, row)) : n.items.some((x) => nodeHit(x, row));
  return leafHit(n, row);
}
/** Parsed ops: `or` trees evaluated in memory; columns not in the snapshot make the plan uncacheable (throw). */
export function compileOps(ops: Op[]): (row: Record<string, unknown>) => boolean {
  const known = new Set<string>(SNAPSHOT_COLS);
  const checks = ops.map((o) => {
    if (o.op === 'or') {
      const nodes = parseLogicList(o.expr);
      const cols = new Set<string>(); const walk = (n: Node) => ('lg' in n ? n.items.forEach(walk) : cols.add((n as any).col)); nodes.forEach(walk);
      for (const c of cols) if (!known.has(c)) throw new Error(`open-cache: column ${c} not in snapshot`);
      return (r: Record<string, unknown>) => nodes.some((n) => nodeHit(n, r));
    }
    if (!known.has(o.col)) throw new Error(`open-cache: column ${o.col} not in snapshot`);
    if (o.op === 'is') return (r: Record<string, unknown>) => r[o.col] == null;
    if (o.op === 'eq') return (r: Record<string, unknown>) => r[o.col] != null && String(r[o.col]) === o.val;
    if (o.op === 'ilike') return (r: Record<string, unknown>) => r[o.col] != null && likeRegex(o.val, true).test(String(r[o.col]));
    if (o.op === 'gte') return (r: Record<string, unknown>) => r[o.col] != null && String(r[o.col]) >= o.val;
    if (o.op === 'lte') return (r: Record<string, unknown>) => r[o.col] != null && String(r[o.col]) <= o.val;
    throw new Error(`open-cache: unsupported op ${(o as Op).op}`);
  });
  return (row) => checks.every((c) => c(row));
}

const unchangedSince = (q: any, at: string) => CHANGE_COLS.reduce((acc, c) => acc.or(`${c}.lte.${at},${c}.is.null`), q);
const changedSinceExpr = (at: string) => CHANGE_COLS.map((c) => `${c}.gt.${at}`).join(',');
function structured(q: any, plan: DiscoveryPlan): any {
  const mf = plan.horizons.open.mapFilters;
  return applyMapFilters(q, parseMapFilters((k) => (k === 'q' || k === 'search' || k === 'agency' ? null : mf[k] ?? null)));
}

export type CachedOpenResult =
  | { status: 'ok'; count: number; rows: Array<Record<string, unknown>>; coverage: { snapshot_built_at: string; snapshot_age_ms: number; candidates: number; delta_rows: number } }
  | { status: 'cache_unavailable'; reason: string };

/**
 * Count + deadline-ordered window for one plan via the snapshot. `select` is the column list the caller needs.
 * Exact: the same set the SQL path returns at this moment (snapshot candidates re-verified live ∪ live delta).
 */
export async function cachedOpenRetrieval(args: {
  client: any; plan: DiscoveryPlan; snapshot: OpenSnapshot | null; select: string; windowLimit: number; now?: Date;
}): Promise<CachedOpenResult> {
  const { client, plan, snapshot, select, windowLimit } = args;
  const now = args.now ?? new Date();
  if (!snapshot) return { status: 'cache_unavailable', reason: 'no snapshot' };
  const age = now.getTime() - Date.parse(snapshot.builtAt);
  if (!(age >= 0) || age > SNAPSHOT_MAX_AGE_MS) return { status: 'cache_unavailable', reason: `snapshot age ${Math.round(age / 60000)} min` };
  let pass: (r: Record<string, unknown>) => boolean;
  try { pass = compileOps(plan.horizons.open.ops); } catch (e) { return { status: 'cache_unavailable', reason: (e as Error).message }; }
  const ids = snapshot.rows.filter(pass).map((r) => r.notice_id as string);
  const at = snapshot.builtAt;

  // Delta first: if too many rows changed, the snapshot is stale — refuse rather than run a slow, partial answer.
  const dHead = await applyOpenPlan(client.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }), plan).or(changedSinceExpr(at));
  const changedHead = await client.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }).eq('active', true).or(changedSinceExpr(at));
  if (changedHead.error || changedHead.count == null) return { status: 'cache_unavailable', reason: `changed-row count unavailable (${changedHead.error?.message ?? 'null'})` };
  if (changedHead.count > DELTA_MAX) return { status: 'cache_unavailable', reason: `${changedHead.count} rows changed since the snapshot (> ${DELTA_MAX})` };
  if (dHead.error || dHead.count == null) return { status: 'cache_unavailable', reason: `delta count unavailable (${dHead.error?.message ?? 'null'})` };
  const delta = await applyOpenPlan(client.from('sam_opportunities').select(select), plan).or(changedSinceExpr(at))
    .order('response_deadline', { ascending: true, nullsFirst: false }).limit(windowLimit);
  if (delta.error) return { status: 'cache_unavailable', reason: `delta read failed (${delta.error.message})` };

  // Live verification of snapshot candidates (unchanged rows only), chunked by id.
  let count = dHead.count as number;
  const rows: Array<Record<string, unknown>> = [...(delta.data || [])];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  const results = await Promise.all(chunks.map(async (c) => {
    const q = unchangedSince(structured(client.from('sam_opportunities').select(select, { count: 'exact' }), plan).in('notice_id', c), at);
    return q.order('response_deadline', { ascending: true, nullsFirst: false }).limit(windowLimit);
  }));
  for (const r of results) {
    if (r.error || r.count == null) return { status: 'cache_unavailable', reason: `verify failed (${r.error?.message ?? 'count null'})` };
    count += r.count; rows.push(...(r.data || []));
  }
  rows.sort((a, b) => String(a.response_deadline ?? '9999').localeCompare(String(b.response_deadline ?? '9999')));
  return { status: 'ok', count, rows: rows.slice(0, windowLimit), coverage: { snapshot_built_at: at, snapshot_age_ms: age, candidates: ids.length, delta_rows: dHead.count as number } };
}
