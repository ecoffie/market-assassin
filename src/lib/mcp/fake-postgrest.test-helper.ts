/**
 * Minimal in-memory PostgREST query builder for unit tests of mcp_call_log readers.
 *
 * Evaluates the filters the readers actually use (eq, in, gt, gte, lte, or, range, limit,
 * count/head) against plain rows, with SQL NULL semantics: `neq` is false for a NULL column,
 * exactly as `channel <> 'app_chat'` is NULL (not true) in Postgres. That is what makes a
 * reader that forgot the `channel.is.null` branch fail its test.
 */
type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

function parseOrAlternative(expr: string): Pred {
  const [col, op, ...rest] = expr.split('.');
  const val = rest.join('.');
  if (op === 'is' && val === 'null') return (r) => r[col] == null;
  if (op === 'eq') return (r) => r[col] != null && String(r[col]) === val;
  if (op === 'neq') return (r) => r[col] != null && String(r[col]) !== val;
  throw new Error(`fake-postgrest: unsupported or() alternative ${expr}`);
}

export function fakeDb(tables: Record<string, Row[]>) {
  const orCalls: Array<{ table: string; expr: string }> = [];
  function from(table: string) {
    const preds: Pred[] = [];
    let head = false;
    let countExact = false;
    let range: [number, number] | null = null;
    let limit: number | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        head = !!opts?.head;
        countExact = opts?.count === 'exact';
        return b;
      },
      eq(c: string, v: unknown) { preds.push((r) => r[c] === v); return b; },
      neq(c: string, v: unknown) { preds.push((r) => r[c] != null && r[c] !== v); return b; },
      in(c: string, arr: unknown[]) { preds.push((r) => arr.includes(r[c])); return b; },
      gt(c: string, v: number | string) { preds.push((r) => (r[c] as number | string) > v); return b; },
      gte(c: string, v: number | string) { preds.push((r) => (r[c] as number | string) >= v); return b; },
      lte(c: string, v: number | string) { preds.push((r) => (r[c] as number | string) <= v); return b; },
      or(expr: string) {
        orCalls.push({ table, expr });
        const alts = expr.split(',').map(parseOrAlternative);
        preds.push((r) => alts.some((p) => p(r)));
        return b;
      },
      order() { return b; },
      limit(n: number) { limit = n; return b; },
      range(f: number, t: number) { range = [f, t]; return b; },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        let out = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        const count = out.length;
        if (range) out = out.slice(range[0], range[1] + 1);
        if (limit != null) out = out.slice(0, limit);
        return Promise.resolve({ data: head ? null : out, count: countExact ? count : null, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from, orCalls };
}
