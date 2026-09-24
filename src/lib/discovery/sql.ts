/**
 * Plan → parameterized SQL. The SQL twin of apply.ts (Recompete Gate 2, 2026-09-24).
 *
 * MECHANICAL ONLY — the same contract as apply.ts ("Plan → Supabase query. Mechanical only; every
 * semantic decision was made in plan.ts"). This file makes NO search decision: it serializes the
 * canonical plan's ops, and the PostgREST logic-tree strings inside them, into the predicate
 * PostgREST itself would have built. It exists so one server-side statement can evaluate the
 * Recompete market ONCE and derive total / unmapped / pins / follow-ons from that single evaluation.
 *
 * Grammar (closed — anything else THROWS rather than guessing, so a new plan operator can never be
 * silently mistranslated):
 *   top-level Op : or(expr) · eq · is(null) · gte · lte · ilike
 *   expr         : and(…) · or(…) · col.[not.]op.value
 *   leaf op      : eq · like · ilike · imatch · match · is.null · not.imatch · not.match
 * Values: PostgREST quoting ("…" with \\ and \" escapes). like/ilike use * as the % wildcard, as
 * PostgREST does. Every value is a bind parameter — user text never enters the SQL string — and
 * every column must be on the caller's whitelist (which also supplies its type for the cast a
 * text[]-parameter RPC needs).
 *
 * Parity with the PostgREST path is not assumed: scripts/recompete-parity.ts compares both on the full
 * fixture suite, byte for byte.
 */
import type { Op } from './plan';

export type SqlType = 'text' | 'date' | 'numeric' | 'float8' | 'int8';
export type ColumnTypes = Readonly<Record<string, SqlType>>;

/** Accumulates bind parameters; `$n` placeholders are 1-based and never reused across uses. */
export class SqlParams {
  readonly values: string[] = [];
  constructor(private readonly style: 'positional' | 'array' = 'positional') {}
  /** `$n` (node-pg) or `$1[n]` (a single text[] argument, the RPC shape), cast to the column type. */
  bind(value: string, type: SqlType): string {
    this.values.push(value);
    const ref = this.style === 'array' ? `$1[${this.values.length}]` : `$${this.values.length}`;
    return type === 'text' ? `${ref}::text` : `${ref}::${type}`;
  }
}

type Leaf = { col: string; not: boolean; op: string; val: string };
type Node = { lg: 'and' | 'or'; items: Node[] } | Leaf;

const LEAF_OPS = new Set(['eq', 'like', 'ilike', 'imatch', 'match', 'is']);

/** Parse a PostgREST logic-tree list (the body of `or=(…)` / `.or('…')`). */
export function parseLogicList(s: string): Node[] {
  const [items, end] = list(s, 0);
  if (end !== s.length) throw new Error(`discovery/sql: trailing input at ${end} in ${s.slice(0, 80)}`);
  return items;
}
function list(s: string, i: number): [Node[], number] {
  const items: Node[] = [];
  for (;;) {
    const [n, j] = item(s, i);
    items.push(n); i = j;
    if (s[i] === ',') { i++; continue; }
    return [items, i];
  }
}
function item(s: string, i: number): [Node, number] {
  for (const lg of ['and', 'or'] as const) {
    if (s.startsWith(lg + '(', i)) {
      const [items, j] = list(s, i + lg.length + 1);
      if (s[j] !== ')') throw new Error(`discovery/sql: unbalanced '(' at ${i}`);
      return [{ lg, items }, j + 1];
    }
  }
  const col = /^[a-z_][a-z0-9_]*/.exec(s.slice(i));
  if (!col || s[i + col[0].length] !== '.') throw new Error(`discovery/sql: bad column at ${i}: ${s.slice(i, i + 40)}`);
  let j = i + col[0].length + 1;
  let not = false;
  if (s.startsWith('not.', j)) { not = true; j += 4; }
  const opm = /^[a-z]+/.exec(s.slice(j));
  if (!opm || !LEAF_OPS.has(opm[0]) || s[j + opm[0].length] !== '.') throw new Error(`discovery/sql: unsupported operator at ${j}: ${s.slice(j, j + 20)}`);
  j += opm[0].length + 1;
  let val = '';
  if (s[j] === '"') {
    j++;
    while (j < s.length && s[j] !== '"') {
      if (s[j] === '\\') { val += s[j + 1]; j += 2; } else val += s[j++];
    }
    if (s[j] !== '"') throw new Error('discovery/sql: unterminated quoted value');
    j++;
  } else {
    while (j < s.length && s[j] !== ',' && s[j] !== ')') val += s[j++];
  }
  return [{ col: col[0], not, op: opm[0], val }, j];
}

function column(col: string, types: ColumnTypes): SqlType {
  const t = types[col];
  if (!t) throw new Error(`discovery/sql: column not on the whitelist: ${col}`);
  return t;
}
const ident = (col: string) => `"${col}"`;

function leafSql(n: Leaf, types: ColumnTypes, p: SqlParams): string {
  const t = column(n.col, types);
  const c = ident(n.col);
  if (n.op === 'is') {
    if (n.val !== 'null') throw new Error(`discovery/sql: only is.null is supported (got is.${n.val})`);
    return n.not ? `${c} IS NOT NULL` : `${c} IS NULL`;
  }
  const v = n.op === 'like' || n.op === 'ilike' ? n.val.replace(/\*/g, '%') : n.val;
  const sqlOp = ({ eq: '=', like: 'LIKE', ilike: 'ILIKE', imatch: '~*', match: '~' } as Record<string, string>)[n.op];
  const expr = `${c} ${sqlOp} ${p.bind(v, (n.op === 'eq') ? t : 'text')}`;
  return n.not ? `NOT (${expr})` : expr;
}
function nodeSql(n: Node, types: ColumnTypes, p: SqlParams): string {
  if ('lg' in n) return '(' + n.items.map((x) => nodeSql(x, types, p)).join(n.lg === 'and' ? ' AND ' : ' OR ') + ')';
  return leafSql(n, types, p);
}

/** One canonical plan op → SQL. */
export function opSql(o: Op, types: ColumnTypes, p: SqlParams): string {
  switch (o.op) {
    case 'or': return '(' + parseLogicList(o.expr).map((n) => nodeSql(n, types, p)).join(' OR ') + ')';
    case 'is': return `${ident(o.col)} IS NULL`;
    case 'eq': return `${ident(o.col)} = ${p.bind(o.val, column(o.col, types))}`;
    case 'gte': return `${ident(o.col)} >= ${p.bind(o.val, column(o.col, types))}`;
    case 'lte': return `${ident(o.col)} <= ${p.bind(o.val, column(o.col, types))}`;
    case 'ilike': column(o.col, types); return `${ident(o.col)} ILIKE ${p.bind(o.val.replace(/\*/g, '%'), 'text')}`;
    default: throw new Error(`discovery/sql: unsupported op ${(o as { op: string }).op}`);
  }
}

/** A plan's ops ANDed, exactly as successive PostgREST filters are. Empty → TRUE. */
export function opsSql(ops: Op[], types: ColumnTypes, p: SqlParams): string {
  return ops.length ? ops.map((o) => opSql(o, types, p)).join('\n  AND ') : 'TRUE';
}
