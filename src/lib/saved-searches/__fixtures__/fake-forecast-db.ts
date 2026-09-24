/**
 * In-memory stand-in for the PostgREST calls the Forecast watermark makes against agency_forecasts.
 *
 * It honours exactly the predicates newness depends on — created_at gt/lte, the publisher-floor `.or()`
 * groups (`and(source_agency.eq.X,created_at.gt.T)`), `source_agency.in.(…)` agency terms, `id.is.null`
 * (fail closed), ordering and range paging. Plan terms it cannot evaluate (FY clause, NAICS, text) are
 * treated as matching: every test row is built to match the plan, so they never decide a test.
 * The live replay proves the real SQL agrees with the JS mirror on production data.
 */
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
function term(row: FakeForecastRow, t: string): boolean | null {
  if (t.startsWith('and(') && t.endsWith(')')) return splitTop(t.slice(4, -1)).every((x) => term(row, x) !== false);
  if (t.startsWith('or(') && t.endsWith(')')) return splitTop(t.slice(3, -1)).some((x) => term(row, x) !== false);
  let m = /^source_agency\.eq\.(.+)$/.exec(t); if (m) return row.source_agency === unq(m[1]);
  m = /^source_agency\.in\.\((.*)\)$/.exec(t); if (m) return m[1].split(',').map(unq).includes(row.source_agency);
  m = /^created_at\.gt\.(.+)$/.exec(t); if (m) return new Date(row.created_at) > new Date(m[1]);
  if (t === 'id.is.null') return false;
  return null; // not modelled → does not decide
}
function orMatches(row: FakeForecastRow, expr: string): boolean {
  const parts = splitTop(expr).map((x) => term(row, x));
  if (parts.every((p) => p === null)) return true;
  return parts.some((p) => p === true);
}

/** Apply the recorded PostgREST ops to a row set (shared with the route-level fake). */
export function applyForecastOps(corpus: FakeForecastRow[], ops: Array<[string, unknown[]]>): FakeForecastRow[] {
  let rows = corpus.slice();
  for (const [m, a] of ops) {
    if (m === 'gt' && a[0] === 'created_at') rows = rows.filter((r) => new Date(r.created_at) > new Date(String(a[1])));
    if (m === 'lte' && a[0] === 'created_at') rows = rows.filter((r) => new Date(r.created_at) <= new Date(String(a[1])));
    if (m === 'or') rows = rows.filter((r) => orMatches(r, String(a[0])));
  }
  rows.sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : x.id < y.id ? -1 : 1));
  const rg = ops.find((o) => o[0] === 'range');
  return rg ? rows.slice(Number(rg[1][0]), Number(rg[1][1]) + 1) : rows;
}

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
      return Promise.resolve({ data: applyForecastOps(corpus(), ops), error: null }).then(resolve);
    };
    return q;
  };
  return { db: { from }, queries, calls: () => calls };
}
