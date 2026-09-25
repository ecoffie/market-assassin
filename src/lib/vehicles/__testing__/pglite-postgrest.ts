/**
 * TEST HARNESS — a real Postgres (PGlite, in-process) holding a `recompete_opportunities` table, and a
 * PostgREST-shaped query builder that EXECUTES the same method chain the production code calls
 * (`.select/.or/.is/.eq/.gte/.lte/.ilike/.like/.in/.not/.filter/.order/.range/.limit`, head counts).
 *
 * Why: the scoped task-order search, the Map's PostgREST path (readOld) and the Map's SQL twin
 * (recompeteOnePassSql) must return the SAME orders. Asserting the SHAPE of a query cannot catch a
 * filter that is built but never applied, or a cap that hides rows — executing it against real rows can.
 *
 * `or()` logic lists go through discovery/sql.ts's own translator (the closed grammar the SQL twin
 * uses), so this harness cannot accept an expression the SQL twin would reject.
 */
import { PGlite } from '@electric-sql/pglite';
import { SqlParams, opSql, type SqlType } from '@/lib/discovery/sql';
import { RECOMPETE_COLUMN_TYPES } from '@/lib/recompete/maps-recompete-sql';

const TYPES = RECOMPETE_COLUMN_TYPES as Record<string, SqlType>;
const q = (c: string) => { if (!TYPES[c]) throw new Error(`harness: unknown column ${c}`); return `"${c}"`; };
const PG_TYPE: Record<SqlType, string> = { text: 'text', date: 'date', numeric: 'numeric', float8: 'float8', int8: 'int8' };

export type Row = Partial<Record<keyof typeof RECOMPETE_COLUMN_TYPES, string | number | null>>;

export async function createRecompeteDb(rows: Row[]): Promise<PGlite> {
  const pg = new PGlite();
  const cols = Object.keys(TYPES);
  await pg.exec(`CREATE TABLE public.recompete_opportunities (${cols.map((c) => `"${c}" ${PG_TYPE[TYPES[c]]}`).join(', ')}, UNIQUE ("contract_id"))`);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values: unknown[] = [];
    const tuples = chunk.map((r) => `(${cols.map((c) => { values.push(r[c as keyof Row] ?? null); return `$${values.length}::${PG_TYPE[TYPES[c]]}`; }).join(', ')})`);
    await pg.query(`INSERT INTO public.recompete_opportunities (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${tuples.join(', ')}`, values);
  }
  return pg;
}

type Result = { data: Record<string, unknown>[] | null; count: number | null; error: { message: string } | null };

class Builder implements PromiseLike<Result> {
  private where: string[] = [];
  private p = new SqlParams('positional');
  private cols = '*';
  private countExact = false;
  private head = false;
  private orders: string[] = [];
  private lim: number | null = null;
  private off = 0;
  constructor(private pg: PGlite, private table: string) {}

  select(cols = '*', opts: { count?: string; head?: boolean } = {}) {
    this.cols = cols.trim() === '*' ? '*' : cols.split(',').map((c) => q(c.trim())).join(', ');
    this.countExact = opts.count === 'exact'; this.head = !!opts.head; return this;
  }
  or(expr: string) { this.where.push(opSql({ op: 'or', expr }, TYPES, this.p)); return this; }
  is(col: string, v: null) { if (v !== null) throw new Error('harness: is() only supports null'); this.where.push(`${q(col)} IS NULL`); return this; }
  eq(col: string, v: string | number) { this.where.push(`${q(col)} = ${this.p.bind(String(v), TYPES[col])}`); return this; }
  gte(col: string, v: string | number) { this.where.push(`${q(col)} >= ${this.p.bind(String(v), TYPES[col])}`); return this; }
  lte(col: string, v: string | number) { this.where.push(`${q(col)} <= ${this.p.bind(String(v), TYPES[col])}`); return this; }
  like(col: string, v: string) { this.where.push(`${q(col)} LIKE ${this.p.bind(v.replace(/\*/g, '%'), 'text')}`); return this; }
  ilike(col: string, v: string) { this.where.push(`${q(col)} ILIKE ${this.p.bind(v.replace(/\*/g, '%'), 'text')}`); return this; }
  in(col: string, vals: (string | number)[]) { this.where.push(`${q(col)} IN (${vals.map((v) => this.p.bind(String(v), TYPES[col])).join(', ')})`); return this; }
  not(col: string, op: string, v: string | null) {
    if (op === 'is' && v === null) this.where.push(`${q(col)} IS NOT NULL`);
    else if (op === 'like') this.where.push(`${q(col)} NOT LIKE ${this.p.bind(String(v).replace(/\*/g, '%'), 'text')}`);
    else throw new Error(`harness: not(${op}) unsupported`);
    return this;
  }
  filter(col: string, op: string, v: string) {
    const sqlOp = ({ match: '~', imatch: '~*', like: 'LIKE', ilike: 'ILIKE', eq: '=' } as Record<string, string>)[op];
    if (!sqlOp) throw new Error(`harness: filter(${op}) unsupported`);
    const val = op === 'like' || op === 'ilike' ? v.replace(/\*/g, '%') : v;
    this.where.push(`${q(col)} ${sqlOp} ${this.p.bind(val, op === 'eq' ? TYPES[col] : 'text')}`); return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push(`${q(col)} ${o.ascending === false ? 'DESC' : 'ASC'}`); return this; }
  range(a: number, b: number) { this.off = a; this.lim = b - a + 1; return this; }
  limit(n: number) { this.lim = n; return this; }

  private async run(): Promise<Result> {
    try {
      const where = this.where.length ? ` WHERE ${this.where.join(' AND ')}` : '';
      const from = ` FROM public.${this.table}${where}`;
      let count: number | null = null;
      if (this.countExact) count = Number((await this.pg.query<{ n: string }>(`SELECT count(*) AS n${from}`, this.p.values)).rows[0].n);
      if (this.head) return { data: null, count, error: null };
      const order = this.orders.length ? ` ORDER BY ${this.orders.join(', ')}` : '';
      const page = `${this.lim != null ? ` LIMIT ${this.lim}` : ''}${this.off ? ` OFFSET ${this.off}` : ''}`;
      const res = await this.pg.query<Record<string, unknown>>(`SELECT ${this.cols}${from}${order}${page}`, this.p.values);
      return { data: res.rows, count, error: null };
    } catch (e) {
      return { data: null, count: null, error: { message: (e as Error).message } };
    }
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(ok, bad);
  }
}

/** A `{ from(table) }` client over PGlite — drop-in for the service-role Supabase client in these reads. */
export function postgrestOver(pg: PGlite) {
  return { from: (table: string) => new Builder(pg, table) };
}
