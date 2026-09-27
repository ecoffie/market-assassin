/**
 * In-memory Supabase for keyword-save tests: serves reads from STORE and RECORDS every write
 * (insert / update / upsert / delete) in WRITES, applying it to STORE so later reads see it.
 * Test-only. Filters other than .eq are ignored — these tests seed one user row.
 */
export type Row = Record<string, unknown>;
export type Write = { table: string; op: 'insert' | 'update' | 'upsert' | 'delete'; payload: unknown };

export const STORE: Record<string, Row[]> = {};
export const WRITES: Write[] = [];

export function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let pendingWrite: Write | null = null;
      const rows = () => (STORE[table] || []).filter((r) => filters.every(([k, v]) => r[k] === v));
      const result = () => {
        if (pendingWrite) {
          WRITES.push(pendingWrite);
          const w = pendingWrite as Write;
          const payload = (Array.isArray(w.payload) ? w.payload : [w.payload]) as Row[];
          if (w.op === 'update') for (const r of rows()) Object.assign(r, payload[0]);
          if (w.op === 'insert' || w.op === 'upsert') {
            STORE[table] = STORE[table] || [];
            for (const p of payload) {
              const hit = STORE[table].find((r) => r.user_email === p.user_email);
              if (hit && w.op === 'upsert') Object.assign(hit, p); else STORE[table].push({ ...p });
            }
          }
          return { data: payload, error: null, count: payload.length };
        }
        const r = rows();
        return { data: r, error: null, count: r.length };
      };
      const b: Record<string, unknown> = {};
      const self = () => b;
      for (const m of ['select', 'order', 'limit', 'range', 'in', 'neq', 'gte', 'lte', 'or', 'ilike', 'like', 'is', 'not', 'contains']) b[m] = self;
      b.eq = (k: string, v: unknown) => { filters.push([k, v]); return b; };
      for (const op of ['insert', 'update', 'upsert', 'delete'] as const) {
        b[op] = (payload?: unknown) => { pendingWrite = { table, op, payload }; return b; };
      }
      b.maybeSingle = async () => { const r = result(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null }; };
      b.single = b.maybeSingle;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: null, error: null }) } },
  };
}

