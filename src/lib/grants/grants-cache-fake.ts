/**
 * TEST-ONLY in-memory stand-in for the Supabase client over grants_cache / grants_ingest_runs.
 * Implements exactly the PostgREST surface the grants ingest, reconcile, confirmation, map reader and
 * grants-map route use — and can simulate the reconcile migration NOT being applied (unknown columns /
 * table → the same error codes PostgREST returns), so the migration-missing path is tested for real.
 */
type Row = Record<string, unknown>;
const RECONCILE_COLS = ['last_seen_at', 'absent_since', 'source_status', 'source_checked_at', 'superseded_by'];

export interface FakeDb {
  tables: { grants_cache: Row[]; grants_ingest_runs: Row[] };
  schema: { columns: boolean; runsTable: boolean };
  from(table: string): unknown;
}

function splitTop(expr: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function term(row: Row, t: string): boolean {
  const [col, op, ...rest] = t.split('.');
  const v = rest.join('.');
  const x = row[col];
  if (op === 'is') return v === 'null' ? x == null : false;
  if (op === 'eq') return String(x) === v;
  if (op === 'gte') return x != null && String(x) >= v;
  if (op === 'in') return v.replace(/[()]/g, '').split(',').includes(String(x));
  throw new Error(`fake: unsupported or-term ${t}`);
}

export function makeFakeDb(seed: Row[] = [], schema = { columns: true, runsTable: true }): FakeDb {
  const db: FakeDb = { tables: { grants_cache: seed.map((r) => ({ ...r })), grants_ingest_runs: [] }, schema, from: () => null };

  const missing = (msg: string) => ({ code: '42703', message: msg });
  const colsMissingIn = (s: string) => !db.schema.columns && RECONCILE_COLS.some((c) => s.includes(c));

  db.from = (table: string) => {
    if (table === 'grants_ingest_runs' && !db.schema.runsTable) {
      const err = { code: 'PGRST205', message: "Could not find the table 'public.grants_ingest_runs' in the schema cache" };
      const dead: Record<string, unknown> = {};
      for (const m of ['select', 'limit', 'insert', 'eq', 'order']) dead[m] = () => dead;
      dead.then = (res: (v: unknown) => void) => res({ data: null, error: err, count: null });
      return dead;
    }
    const rows = (db.tables as Record<string, Row[]>)[table];
    const filters: Array<(r: Row) => boolean> = [];
    let mode: 'select' | 'update' | 'upsert' | 'insert' = 'select';
    let payload: Row | Row[] | null = null;
    let err: { code: string; message: string } | null = null;
    let head = false; let wantCount = false;
    let sortCol: string | null = null; let asc = true; let lim = Infinity; let from = 0;
    const b: Record<string, unknown> = {};
    b.select = (cols = '*', opts?: { count?: string; head?: boolean }) => {
      if (colsMissingIn(cols)) err = missing(`column grants_cache.${RECONCILE_COLS.find((c) => cols.includes(c))} does not exist`);
      head = !!opts?.head; wantCount = !!opts?.count; return b;
    };
    b.eq = (c: string, v: unknown) => { if (colsMissingIn(c)) err = missing(`column ${c} does not exist`); filters.push((r) => r[c] === v); return b; };
    b.in = (c: string, vs: unknown[]) => { if (colsMissingIn(c)) err = missing(`column ${c} does not exist`); filters.push((r) => vs.includes(r[c])); return b; };
    b.is = (c: string, v: null) => { if (colsMissingIn(c)) err = missing(`column ${c} does not exist`); filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; };
    b.not = (c: string, op: string, v: unknown) => {
      if (colsMissingIn(c)) err = missing(`column ${c} does not exist`);
      if (op === 'is' && v === null) filters.push((r) => r[c] != null); else throw new Error('fake: unsupported not');
      return b;
    };
    b.gte = (c: string, v: number) => { filters.push((r) => (r[c] as number) >= v); return b; };
    b.lte = (c: string, v: number) => { filters.push((r) => (r[c] as number) <= v); return b; };
    b.or = (expr: string) => {
      if (colsMissingIn(expr)) err = missing('column grants_cache.absent_since does not exist');
      const terms = splitTop(expr); filters.push((r) => terms.some((t) => term(r, t))); return b;
    };
    b.order = (c: string, o?: { ascending?: boolean }) => { sortCol = c; asc = o?.ascending !== false; return b; };
    b.limit = (n: number) => { lim = n; return b; };
    b.range = (a: number, z: number) => { from = a; lim = z - a + 1; return b; };
    b.upsert = (p: Row[]) => {
      mode = 'upsert'; payload = p;
      if (!db.schema.columns && p.some((r) => RECONCILE_COLS.some((c) => c in r))) err = { code: 'PGRST204', message: "Could not find the 'absent_since' column of 'grants_cache' in the schema cache" };
      return b;
    };
    b.update = (p: Row) => {
      mode = 'update'; payload = p;
      if (!db.schema.columns && RECONCILE_COLS.some((c) => c in p)) err = { code: 'PGRST204', message: "Could not find the 'absent_since' column" };
      return b;
    };
    b.insert = (p: Row) => { mode = 'insert'; payload = p; return b; };
    b.then = (res: (v: unknown) => void) => {
      if (err) return res({ data: null, error: err, count: null });
      if (mode === 'upsert') {
        for (const r of payload as Row[]) {
          const i = rows.findIndex((x) => x.opp_number === r.opp_number);
          if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ ...r });
        }
        return res({ data: null, error: null });
      }
      if (mode === 'insert') { rows.push({ ...(payload as Row) }); return res({ data: null, error: null }); }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === 'update') { for (const r of matched) Object.assign(r, payload); return res({ data: null, error: null }); }
      let out = [...matched];
      if (sortCol) out.sort((x, y) => (String(x[sortCol!] ?? '') < String(y[sortCol!] ?? '') ? -1 : 1) * (asc ? 1 : -1));
      const count = out.length;
      out = out.slice(from, from + lim);
      return res({ data: head ? null : out, error: null, count: wantCount ? count : null });
    };
    return b;
  };
  return db;
}
