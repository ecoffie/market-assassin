/**
 * /api/forecasts/unplaced paging must enumerate every row exactly once (2026-09-23).
 *
 * The fake builder models what Postgres is allowed to do: rows tied on EVERY `ORDER BY` key may come back
 * in any order, and a separate query (each offset page is one) may break those ties differently. With the
 * value alone as the key, pages overlap — the production USDA failure (509 duplicated, 509 unreachable).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyUnplacedOrder, UNPLACED_ORDER } from './unplaced-order';

type Row = { id: string; estimated_value_max: number | null };
type Ord = { col: keyof Row; ascending: boolean; nullsFirst: boolean };

/** A seeded shuffle, so each query breaks ties differently — deterministically per seed. */
function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs]; let s = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function fakeQuery(rows: Row[], seed: number) {
  const orders: Ord[] = [];
  const q = {
    order(col: keyof Row, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) { orders.push({ col, ascending: opts.ascending !== false, nullsFirst: !!opts.nullsFirst }); return q; },
    range(from: number, to: number) {
      const cmp = (a: Row, b: Row) => {
        for (const o of orders) {
          const x = a[o.col], y = b[o.col];
          if (x === y) continue;
          if (x == null) return o.nullsFirst ? -1 : 1;
          if (y == null) return o.nullsFirst ? 1 : -1;
          return (x < y ? -1 : 1) * (o.ascending ? 1 : -1);
        }
        return 0; // tied on every ORDER BY key → any order is legal
      };
      return shuffle(rows, seed).sort(cmp).slice(from, to + 1); // Array.sort is stable → ties keep the shuffled order
    },
  };
  return q;
}
function pageAll(rows: Row[], order: (q: ReturnType<typeof fakeQuery>) => ReturnType<typeof fakeQuery>, pageSize = 200) {
  const out: Row[] = [];
  for (let off = 0, page = 0; off < rows.length; off += pageSize, page++) out.push(...order(fakeQuery(rows, 7919 * (page + 1))).range(off, off + pageSize - 1));
  return out;
}

// 1,100 forecasts in three value bands + a few with no value: every page crosses a large tie group.
const ROWS: Row[] = Array.from({ length: 1100 }, (_, i) => ({
  id: `f${String(i).padStart(5, '0')}`,
  estimated_value_max: i % 50 === 0 ? null : [19_000_000, 9_900_000, 4_900_000][i % 3],
}));

describe('unplaced paging — estimated_value_max → id', () => {
  const paged = pageAll(ROWS, (q) => applyUnplacedOrder(q));
  it('every expected id appears exactly once across all pages (0 duplicates, 0 omissions)', () => {
    const ids = paged.map((r) => r.id);
    expect(ids.length).toBe(ROWS.length);
    expect(new Set(ids).size).toBe(ROWS.length);
    expect(ROWS.filter((r) => !ids.includes(r.id))).toEqual([]);
  });
  it('the primary value order is preserved (desc, nulls last)', () => {
    const vals = paged.map((r) => r.estimated_value_max);
    const firstNull = vals.indexOf(null);
    expect(vals.slice(firstNull).every((v) => v === null)).toBe(true);
    const nums = vals.slice(0, firstNull) as number[];
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeLessThanOrEqual(nums[i - 1]);
  });
  it('id only resolves ties — ascending within each value band', () => {
    for (let i = 1; i < paged.length; i++) {
      if (paged[i].estimated_value_max === paged[i - 1].estimated_value_max) expect(paged[i].id > paged[i - 1].id).toBe(true);
    }
  });
  it('the order is exactly value → id and nothing else', () => {
    expect(UNPLACED_ORDER.map((o) => o.col)).toEqual(['estimated_value_max', 'id']);
    expect(UNPLACED_ORDER[0].opts).toEqual({ ascending: false, nullsFirst: false });
  });
  it('the fake reproduces the production defect without the tiebreaker (the model is honest)', () => {
    const valueOnly = pageAll(ROWS, (q) => q.order('estimated_value_max', { ascending: false, nullsFirst: false }));
    expect(new Set(valueOnly.map((r) => r.id)).size).toBeLessThan(ROWS.length);
  });
  it('the route pages through applyUnplacedOrder (no inline value-only order)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/forecasts/unplaced/route.ts'), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    expect(src).toMatch(/applyUnplacedOrder\(q\)\s*\.range\(offset, offset \+ limit - 1\)/);
    expect(src).not.toContain(".order('estimated_value_max'");
  });
});
