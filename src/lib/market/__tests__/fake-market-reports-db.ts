/**
 * In-memory stand-in for the Supabase `market_reports` table, covering only the query shapes report-store
 * uses: insert; select().eq().eq().maybeSingle(); select().eq().order().limit(); update().eq().eq();
 * delete().eq().eq() (both with { count: 'exact' }). Set `missingLinkColumns` to simulate the database before the migration.
 */
export type Row = Record<string, unknown>;

export function fakeMarketReportsDb() {
  const rows: Row[] = [];
  const state = { missingLinkColumns: false, failNext: null as null | string };
  const LINK = ['expires_at', 'revoked_at'];
  const colErr = () => ({ code: '42703', message: 'column market_reports.expires_at does not exist' });

  function query() {
    const filters: Array<[string, unknown]> = [];
    let op: 'select' | 'update' | 'delete' = 'select';
    let cols = '*';
    let patch: Row = {};
    let lim = Infinity;
    const match = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
    const pick = (r: Row) => {
      if (cols === '*') { const c = { ...r }; if (state.missingLinkColumns) LINK.forEach((k) => delete c[k]); return c; }
      return Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, r[c] ?? null]));
    };
    const usesLink = () => cols !== '*' && LINK.some((k) => cols.includes(k));
    const run = () => {
      if (state.failNext) { const m = state.failNext; state.failNext = null; return { data: null, error: { message: m } }; }
      if (op === 'select') {
        if (state.missingLinkColumns && usesLink()) return { data: null, error: colErr() };
        return { data: match().slice(0, lim).map(pick), error: null };
      }
      if (op === 'update') {
        if (state.missingLinkColumns && Object.keys(patch).some((k) => LINK.includes(k))) return { data: null, error: colErr() };
        const hit = match(); hit.forEach((r) => Object.assign(r, patch));
        return { data: null, count: hit.length, error: null };
      }
      const hit = match(); hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return { data: null, count: hit.length, error: null };
    };
    const b = {
      select(c = '*') { if (op === 'select') cols = c; return b; },
      eq(k: string, v: unknown) { filters.push([k, v]); return b; },
      order(k: string, o: { ascending: boolean }) { rows.sort((x, y) => (String(x[k]) < String(y[k]) ? 1 : -1) * (o.ascending ? -1 : 1)); return b; },
      limit(n: number) { lim = n; return b; },
      update(p: Row) { op = 'update'; patch = p; return b; },
      delete() { op = 'delete'; return b; },
      maybeSingle() { const r = run(); const d = r.data as Row[] | null; return Promise.resolve({ data: d && d.length ? d[0] : null, error: r.error }); },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }

  const client = {
    from(table: string) {
      if (table !== 'market_reports') throw new Error(`unexpected table ${table}`);
      const q = query();
      return Object.assign(q, {
        insert(row: Row) {
          if (state.failNext) { const m = state.failNext; state.failNext = null; return Promise.resolve({ error: { message: m } }); }
          if (state.missingLinkColumns && LINK.some((k) => k in row)) return Promise.resolve({ error: colErr() });
          rows.push({ created_at: new Date().toISOString(), ...row });
          return Promise.resolve({ error: null });
        },
      });
    },
  };
  return { client, rows, state };
}
