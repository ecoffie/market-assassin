/**
 * A tiny in-memory PostgREST stand-in for the attribution lib tests. It evaluates the filters the
 * lib actually uses (eq / lte / in / ilike / is / order / limit, and `col->>key` JSON paths)
 * against plain row arrays, so the tests exercise the real query logic rather than stubbed
 * return values. Not a general Supabase mock — deliberately only what share-attribution.ts calls.
 */
type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

function get(r: Row, path: string): unknown {
  const m = path.match(/^(\w+)->>(\w+)$/);
  if (m) {
    const obj = r[m[1]] as Record<string, unknown> | null | undefined;
    const v = obj ? obj[m[2]] : undefined;
    return v == null ? null : String(v);
  }
  return r[path];
}

export function makeFakeDb(tables: Record<string, Row[]>) {
  let nextId = 1000;
  function from(table: string) {
    tables[table] ??= [];
    const preds: Pred[] = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let lim = Infinity;
    let mode: 'select' | 'update' | 'insert' = 'select';
    let patch: Row = {};
    let wantCount = false;
    const b = {
      select() { return b; },
      eq(c: string, v: unknown) { preds.push((r) => get(r, c) === v); return b; },
      lte(c: string, v: string) { preds.push((r) => Date.parse(String(get(r, c))) <= Date.parse(v)); return b; },
      in(c: string, vs: unknown[]) { preds.push((r) => vs.includes(get(r, c))); return b; },
      ilike(c: string, v: string) { preds.push((r) => String(get(r, c) ?? '').toLowerCase() === v.toLowerCase()); return b; },
      is(c: string, v: null) { preds.push((r) => (get(r, c) ?? null) === v); return b; },
      order(c: string, o: { ascending: boolean }) { orderBy = { col: c, asc: o.ascending }; return b; },
      limit(n: number) { lim = n; return b; },
      update(p: Row, o?: { count?: string }) { mode = 'update'; patch = p; wantCount = o?.count === 'exact'; return b; },
      async insert(row: Row) {
        tables[table].push({ id: nextId++, created_at: new Date().toISOString(), ...row });
        return { data: null, error: null };
      },
      then(res: (v: unknown) => void) {
        const rows = tables[table].filter((r) => preds.every((p) => p(r)));
        if (mode === 'update') {
          rows.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: null, error: null, count: wantCount ? rows.length : null }).then(res);
        }
        let out = [...rows];
        if (orderBy) {
          const { col, asc } = orderBy;
          out.sort((a, z) => (String(get(a, col)) < String(get(z, col)) ? -1 : 1) * (asc ? 1 : -1));
        }
        out = out.slice(0, lim);
        return Promise.resolve({ data: out, error: null }).then(res);
      },
    };
    return b;
  }
  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient;
}
