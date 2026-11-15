// Route parity check for the holdout runner (Agent 3, 2026-11-15; requested by Agent 5 after Agent 4's validation).
//
// Question: does the runner's emulation equal what the REAL find_opportunities tool returns? The runner reproduces
// eval.mts; this script calls the product code path itself, findOpportunities() from the --src tag (the function the
// MCP tool `find_opportunities` wraps: src/mcp/tools/find-opportunities.ts), in-process, with:
//   - a fake Supabase client that answers from the same snapshot file (no network, no production calls, no credits);
//   - time frozen at the cutoff (the route's own date filters see the same "now" as the runner);
//   - only the Open now horizon requested (Coming back / Coming soon read other tables and are out of scope).
// It then compares, per phrasing: the route's total count vs the runner's matched_count, the route's 500-row deadline
// window vs the runner's, and the route's top 20 (order, class) vs the runner's.
//
// The fake client evaluates PostgREST filters in memory with its own tag-independent parser. Postgres regex (~*) is
// approximated by JS regex with \m/\M → \b, the same translation production's jsRegex uses. A filter on a column the
// snapshot does not carry is answered with an ERROR (never guessed); the route then treats that count as unknown.
//
// usage (from INSIDE the tag checkout): npx tsx <runner>/route-parity.mts --src . --snapshot <file> \
//   --phrasings <runner>/fixtures/queries_v4.json --cutoff <ISO> --runner-result <runner run output> [--out parity.json]
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const die = (m: string): never => { console.error(`route-parity: ${m}`); process.exit(2); };
const o: Record<string, string> = {};
{ const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1]?.startsWith('--') ? 'true' : (a[++i] ?? 'true'); }
const src = path.resolve(o.src || die('--src required'));
const cutoff = new Date(o.cutoff || die('--cutoff required')).toISOString();
const raw = fs.readFileSync(o.snapshot || die('--snapshot required'));
const snap = JSON.parse((o.snapshot.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8')) as { rows: Row[] };
const runnerOut = JSON.parse(fs.readFileSync(o['runner-result'] || die('--runner-result required'), 'utf8'));
const phr = JSON.parse(fs.readFileSync(o.phrasings || die('--phrasings required'), 'utf8'));
const commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (runnerOut.src?.commit !== commit) die(`runner result is for ${runnerOut.src?.commit}, checkout is ${commit}`);

// Same open-at-cutoff rule as runner.mts.
const iso = (s: unknown) => new Date(String(s)).toISOString();
const rows = snap.rows.filter((r) => r.active !== false && r.response_deadline && iso(r.response_deadline) > cutoff
  && (!r.posted_date || iso(r.posted_date) <= cutoff) && (!r.created_at || iso(r.created_at) <= cutoff));
const COLS = new Set(Object.keys(rows[0] || {}));

// ── Freeze time at the cutoff (the route computes "today" and deadline bounds from new Date()). ──
const RealDate = Date; const T = new RealDate(cutoff).getTime();
class FrozenDate extends RealDate {
  constructor(...a: any[]) { if (a.length) super(...(a as [])); else super(T); } // eslint-disable-line @typescript-eslint/no-explicit-any
  static now() { return T; }
}
globalThis.Date = FrozenDate as DateConstructor;
globalThis.fetch = (() => { throw new Error('route-parity is offline: network access attempted'); }) as typeof fetch;

// ── PostgREST logic-tree parser (and/or nesting, col.[not.]op.value, quoted values, in.(…)). ──
type Leaf = { col: string; not: boolean; op: string; val: string }; type Node = Leaf | { lg: 'and' | 'or'; items: Node[] };
function parseList(s: string, i = 0): [Node[], number] {
  const items: Node[] = [];
  for (;;) { const [n, j] = parseItem(s, i); items.push(n); i = j; if (s[i] === ',') { i++; continue; } return [items, i]; }
}
function parseItem(s: string, i: number): [Node, number] {
  for (const lg of ['and', 'or'] as const) if (s.startsWith(lg + '(', i)) {
    const [items, j] = parseList(s, i + lg.length + 1); if (s[j] !== ')') throw new Error(`unbalanced at ${i}`); return [{ lg, items }, j + 1];
  }
  const c = /^[a-z_][a-z0-9_>\-]*/.exec(s.slice(i)); if (!c) throw new Error(`bad column at ${i}: ${s.slice(i, i + 30)}`);
  let j = i + c[0].length + 1; let not = false;
  if (s.startsWith('not.', j)) { not = true; j += 4; }
  const op = /^[a-z]+/.exec(s.slice(j))![0]; j += op.length + 1;
  let val = '';
  if (s[j] === '(') { const k = s.indexOf(')', j); val = s.slice(j, k + 1); j = k + 1; }
  else if (s[j] === '"') { j++; while (j < s.length && s[j] !== '"') { if (s[j] === '\\') { val += s[j + 1]; j += 2; } else val += s[j++]; } j++; }
  else while (j < s.length && s[j] !== ',' && s[j] !== ')') val += s[j++];
  return [{ col: c[0], not, op, val }, j];
}
const reCache = new Map<string, RegExp>();
const rx = (p: string, flags: string) => { const k = flags + p; let r = reCache.get(k); if (!r) { r = new RegExp(p.replace(/\\m/g, '\\b').replace(/\\M/g, '\\b'), flags); reCache.set(k, r); } return r; };
const like = (p: string, ci: boolean) => rx('^' + p.split(/[*%]/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', ci ? 'is' : 's');
const cmp = (a: unknown, b: string) => { const da = Date.parse(String(a)), db = Date.parse(b); return !isNaN(da) && !isNaN(db) && /\d{4}-\d{2}/.test(b) ? da - db : String(a).localeCompare(b); };
class MissingColumn extends Error {}
function leaf(n: Leaf, r: Row): boolean {
  const col = n.col.split('->')[0];
  if (!COLS.has(col)) throw new MissingColumn(col);
  const v = r[col];
  let hit: boolean;
  switch (n.op) {
    case 'is': hit = n.val === 'null' ? v == null : String(v) === n.val; break;
    case 'eq': hit = v != null && String(v) === n.val; break;
    case 'neq': hit = v != null && String(v) !== n.val; break;
    case 'gt': hit = v != null && cmp(v, n.val) > 0; break;
    case 'gte': hit = v != null && cmp(v, n.val) >= 0; break;
    case 'lt': hit = v != null && cmp(v, n.val) < 0; break;
    case 'lte': hit = v != null && cmp(v, n.val) <= 0; break;
    case 'like': hit = v != null && like(n.val, false).test(String(v)); break;
    case 'ilike': hit = v != null && like(n.val, true).test(String(v)); break;
    case 'match': hit = v != null && rx(n.val, 's').test(String(v)); break;
    case 'imatch': hit = v != null && rx(n.val, 'is').test(String(v)); break;
    case 'in': hit = v != null && n.val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v)); break;
    default: throw new Error(`unsupported operator ${n.op}`);
  }
  // SQL three-valued logic: NOT on a NULL column is not true either.
  return n.not ? (v != null && !hit) : hit;
}
const node = (n: Node, r: Row): boolean => ('lg' in n ? (n.lg === 'and' ? n.items.every((x) => node(x, r)) : n.items.some((x) => node(x, r))) : leaf(n, r));

// ── Fake Supabase client over the snapshot. Records the deadline window each phrasing's route reads. ──
let captured: { window: string[] | null; count: number | null } = { window: null, count: null };
function fakeClient() {
  return {
    from(table: string) {
      const preds: Array<(r: Row) => boolean> = []; let head = false; let wantCount = false; let order: { col: string; asc: boolean } | null = null; let lim: number | null = null;
      const q: Row = {};
      const add = (f: (r: Row) => boolean) => { preds.push(f); return q; };
      q.select = (_c: string, opts?: { count?: string; head?: boolean }) => { head = !!opts?.head; wantCount = opts?.count === 'exact'; return q; };
      q.or = (expr: string) => { const t = parseList(expr)[0]; return add((r) => t.some((n) => node(n, r))); };
      for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'match', 'imatch'])
        q[op] = (col: string, val: unknown) => add((r) => leaf({ col, not: false, op, val: val === null ? 'null' : String(val) }, r));
      q.in = (col: string, vals: unknown[]) => add((r) => leaf({ col, not: false, op: 'in', val: `(${vals.join(',')})` }, r));
      q.not = (col: string, op: string, val: unknown) => add((r) => leaf({ col, not: true, op, val: val === null ? 'null' : String(val) }, r));
      q.filter = (col: string, op: string, val: unknown) => add((r) => leaf({ col, not: false, op, val: String(val) }, r));
      q.order = (col: string, opts?: { ascending?: boolean }) => { order = { col, asc: opts?.ascending !== false }; return q; };
      q.limit = (n: number) => { lim = n; return q; };
      q.range = (a: number, b: number) => { lim = b - a + 1; return q; };
      q.single = q.maybeSingle = () => q;
      q.then = (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
        try {
          if (table !== 'sam_opportunities') return res({ data: [], count: 0, error: null });
          let out = rows.filter((r) => preds.every((p) => p(r)));
          const count = out.length;
          if (order) {
            const { col, asc } = order;
            out = [...out].sort((a, b) => (a[col] == null ? 1 : b[col] == null ? -1 : (asc ? 1 : -1) * String(a[col]).localeCompare(String(b[col]))) || String(a.notice_id).localeCompare(String(b.notice_id)));
          }
          if (lim != null) out = out.slice(0, lim);
          if (!head && order?.col === 'response_deadline' && lim && lim >= 500 && captured.window === null) captured = { window: out.map((r) => String(r.notice_id)), count };
          return res({ data: head ? null : out, count: wantCount ? count : null, error: null });
        } catch (e) {
          if (e instanceof MissingColumn) return res({ data: null, count: null, error: { message: `column ${e.message} not in snapshot`, code: 'PARITY_MISSING_COLUMN' } });
          return rej ? rej(e) : res({ data: null, count: null, error: { message: String(e) } });
        }
      };
      return q;
    },
  };
}

const { findOpportunities } = await import(path.join(src, 'src/lib/opportunities/find-opportunities.ts'));
const list: Array<{ business: string; phrasing: number; query: string }> = Object.entries<Row>(phr).flatMap(([business, c]) => (c.q as string[]).map((query, phrasing) => ({ business, phrasing, query })));
const report: Row[] = [];
let diffs = 0;
for (const { business, phrasing, query } of list) {
  captured = { window: null, count: null };
  const res = await findOpportunities({ query, limit_per_horizon: 25, horizons: { open_now: true, coming_back: false, coming_soon: false } }, { client: fakeClient() as never });
  const h = res.horizons.open_now;
  const rr = (runnerOut.results as Row[]).find((x) => x.business === business && x.phrasing === phrasing)!;
  // Runner window: its matched set ordered by deadline, ties by notice_id, first 500.
  const byId = new Map(rows.map((r) => [String(r.notice_id), r]));
  const rWin = (rr.matched as string[]).map((id) => byId.get(id)!).sort((a, b) => String(a.response_deadline || '9999').localeCompare(String(b.response_deadline || '9999')) || String(a.notice_id).localeCompare(String(b.notice_id))).slice(0, 500).map((r) => String(r.notice_id));
  const routeTop = ((h.items || []) as Row[]).slice(0, 20).map((it) => String(it.notice_id));
  const runTop = (rr.top20 as Row[]).map((t) => t.notice_id);
  const routeCls = ((h.items || []) as Row[]).slice(0, 20).map((it) => it.evidence_class ?? 'WEAK_NON_MARKET');
  const runCls = (rr.top20 as Row[]).map((t) => t.cls);
  const winSame = !!captured.window && captured.window.length === rWin.length && captured.window.every((x, i) => x === rWin[i]);
  const winOverlap = captured.window ? captured.window.filter((x) => new Set(rWin).has(x)).length : 0;
  const r = {
    business, phrasing, status: h.status, route_count: captured.count ?? h.count ?? null, runner_matched: rr.matched_count,
    count_same: (captured.count ?? null) === rr.matched_count,
    window_same: winSame, window_overlap: winOverlap, window_sizes: [captured.window?.length ?? null, rWin.length],
    top20_same_order: routeTop.length === runTop.length && routeTop.every((x, i) => x === runTop[i]),
    top20_overlap: routeTop.filter((x) => runTop.includes(x)).length,
    classes_same: routeCls.length === runCls.length && routeCls.every((x, i) => x === runCls[i]),
    route_error: h.error ?? null,
  };
  if (!r.count_same || !r.window_same || !r.top20_same_order) diffs++;
  report.push(r);
  console.log(`${(business + '#' + phrasing).padEnd(14)} count ${r.count_same ? 'SAME' : `DIFF ${r.route_count} vs ${r.runner_matched}`}  window ${r.window_same ? 'SAME' : `DIFF overlap ${winOverlap}`}  top20 ${r.top20_same_order ? 'SAME' : `DIFF overlap ${r.top20_overlap}/20`}  classes ${r.classes_same ? 'SAME' : 'DIFF'}${h.error ? '  route error: ' + JSON.stringify(h.error) : ''}`);
}
console.log(diffs ? `DIFFERENCES in ${diffs} of ${list.length} phrasings` : `PARITY: ${list.length} of ${list.length} phrasings identical (count, window, top 20)`);
if (o.out) fs.writeFileSync(o.out, JSON.stringify({ src: { commit }, cutoff, rows_open_at_cutoff: rows.length, results: report }, null, 1) + '\n');
process.exit(diffs ? 1 : 0);
