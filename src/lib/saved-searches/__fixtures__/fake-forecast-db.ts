/**
 * In-memory stand-in for the PostgREST calls the Forecast watermark makes against agency_forecasts.
 *
 * It honours exactly the predicates newness depends on — created_at gt/lte (microsecond-exact), the publisher-floor
 * `.or()` groups (`and(source_agency.eq.X,created_at.gt.T)`), the keyset `.or()` (`created_at.gt.T,and(created_at.eq.T,
 * id.gt.I)`), `source_agency.in.(…)` agency terms, `id.is.null` (fail closed), `.in('id', …)`, ordering by
 * (created_at, id) and `limit`. Plan terms it cannot evaluate (FY clause, NAICS, text) are treated as matching: every
 * test row is built to match the plan, so they never decide a test. The live replay proves the real SQL agrees with
 * the JS mirror on production data.
 */
import { tsMicros } from '../forecast-watermark';

export type FakeForecastRow = {
  id: string; external_id: string; source_agency: string; created_at: string; last_synced_at: string;
  title?: string; fiscal_year?: string | null;
};

function splitTop(expr: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const unq = (v: string) => v.replace(/^"|"$/g, '');
const MICROS = new WeakMap<FakeForecastRow, bigint>();
const mu = (r: FakeForecastRow) => { let v = MICROS.get(r); if (v === undefined) { v = tsMicros(r.created_at); MICROS.set(r, v); } return v; };
const litCache = new Map<string, bigint>();
const lit = (s: string) => { let v = litCache.get(s); if (v === undefined) { v = tsMicros(s); litCache.set(s, v); } return v; };
function term(row: FakeForecastRow, t: string): boolean | null {
  if (t.startsWith('and(') && t.endsWith(')')) {
    const parts = splitTop(t.slice(4, -1)).map((x) => term(row, x));
    return parts.every((p) => p !== false);
  }
  if (t.startsWith('or(') && t.endsWith(')')) return splitTop(t.slice(3, -1)).some((x) => term(row, x) !== false);
  let m = /^source_agency\.eq\.(.+)$/.exec(t); if (m) return row.source_agency === unq(m[1]);
  m = /^source_agency\.in\.\((.*)\)$/.exec(t); if (m) return m[1].split(',').map(unq).includes(row.source_agency);
  m = /^created_at\.gt\.(.+)$/.exec(t); if (m) return mu(row) > lit(m[1]);
  m = /^created_at\.eq\.(.+)$/.exec(t); if (m) return mu(row) === lit(m[1]);
  m = /^id\.gt\.(.+)$/.exec(t); if (m) return row.id > m[1];
  if (t === 'id.is.null') return false;
  return null; // not modelled → does not decide
}
function orMatches(row: FakeForecastRow, expr: string): boolean {
  const parts = splitTop(expr).map((x) => term(row, x));
  if (parts.every((p) => p === null)) return true;
  return parts.some((p) => p === true);
}
/** Compile an .or() body once into closures — per-row parsing made the 100k-row tests crawl. */
type Pred = (r: FakeForecastRow) => boolean | null;
function compileTerm(t: string): Pred {
  if (t.startsWith('and(') && t.endsWith(')')) {
    const ps = splitTop(t.slice(4, -1)).map(compileTerm);
    return (r) => ps.every((p) => p(r) !== false);
  }
  if (t.startsWith('or(') && t.endsWith(')')) {
    const ps = splitTop(t.slice(3, -1)).map(compileTerm);
    return (r) => ps.some((p) => p(r) !== false);
  }
  let m = /^source_agency\.eq\.(.+)$/.exec(t); if (m) { const v = unq(m[1]); return (r) => r.source_agency === v; }
  m = /^source_agency\.in\.\((.*)\)$/.exec(t); if (m) { const set = new Set(m[1].split(',').map(unq)); return (r) => set.has(r.source_agency); }
  m = /^created_at\.gt\.(.+)$/.exec(t); if (m) { const b = lit(m[1]); return (r) => mu(r) > b; }
  m = /^created_at\.eq\.(.+)$/.exec(t); if (m) { const b = lit(m[1]); return (r) => mu(r) === b; }
  m = /^id\.gt\.(.+)$/.exec(t); if (m) { const v = m[1]; return (r) => r.id > v; }
  if (t === 'id.is.null') return () => false;
  return () => null;
}
const compiled = new Map<string, (r: FakeForecastRow) => boolean>();
function compileOr(expr: string): (r: FakeForecastRow) => boolean {
  const hit = compiled.get(expr); if (hit) return hit;
  const ps = splitTop(expr).map(compileTerm);
  const fn = (r: FakeForecastRow) => {
    let any = false;
    for (const p of ps) { const v = p(r); if (v === true) return true; if (v === false) any = true; }
    return !any; // every term unmodelled → does not decide
  };
  compiled.set(expr, fn);
  return fn;
}

/** Apply the recorded PostgREST ops to a row set (shared with the route-level fake). */
export function applyForecastOps(corpus: FakeForecastRow[], ops: Array<[string, unknown[]]>): FakeForecastRow[] {
  let rows = corpus.slice();
  for (const [m, a] of ops) {
    if (m === 'gt' && a[0] === 'created_at') { const b = lit(String(a[1])); rows = rows.filter((r) => mu(r) > b); }
    if (m === 'lte' && a[0] === 'created_at') { const b = lit(String(a[1])); rows = rows.filter((r) => mu(r) <= b); }
    if (m === 'or') { const f = compileOr(String(a[0])); rows = rows.filter(f); }
    if (m === 'in' && a[0] === 'id') { const set = new Set(a[1] as string[]); rows = rows.filter((r) => set.has(r.id)); }
  }
  rows.sort((x, y) => {
    const d = mu(x) - mu(y);
    return d < BigInt(0) ? -1 : d > BigInt(0) ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  const lim = ops.find((o) => o[0] === 'limit');
  const rg = ops.find((o) => o[0] === 'range');
  if (rg) return rows.slice(Number(rg[1][0]), Number(rg[1][1]) + 1);
  return lim ? rows.slice(0, Number(lim[1][0])) : rows;
}

/** PostgREST's max-rows: every response is capped at 1,000 rows whatever `limit` asks for (as in production). */
export const FAKE_SERVER_ROW_CAP = 1000;

export function fakeForecastDb(corpus: () => FakeForecastRow[], opts: { failOn?: (call: number) => boolean } = {}) {
  let calls = 0;
  const queries: Array<Array<[string, unknown[]]>> = [];
  const from = (table: string) => {
    const ops: Array<[string, unknown[]]> = [];
    queries.push(ops);
    const q: Record<string, unknown> = {};
    const chain = (name: string) => (...a: unknown[]) => { ops.push([name, a]); return q; };
    for (const m of ['select', 'limit', 'eq', 'is', 'ilike', 'order', 'range', 'gt', 'lte', 'or', 'in', 'not', 'gte']) q[m] = chain(m);
    q.then = (resolve: (v: unknown) => unknown) => {
      calls++;
      if (table !== 'agency_forecasts') return Promise.resolve({ data: [], error: null }).then(resolve);
      if (opts.failOn?.(calls)) return Promise.resolve({ data: null, error: { message: 'simulated statement timeout' } }).then(resolve);
      return Promise.resolve({ data: applyForecastOps(corpus(), ops).slice(0, FAKE_SERVER_ROW_CAP), error: null }).then(resolve);
    };
    return q;
  };
  return { db: { from }, queries, calls: () => calls };
}
