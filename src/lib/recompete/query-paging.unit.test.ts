/**
 * Paging for the shared recompete query (get_expiring_contracts result-size fix, Ask Mindy Backend Spec).
 * Records every builder call so the DATABASE request is what is asserted:
 *   - a page is a `.range(offset, offset + limit + headroom - 1)`, never a bare `.limit()`;
 *   - rows are ordered with `contract_id` as the tie-break, so pages never repeat or skip a row;
 *   - anchored rows (a company's own vehicles) join page 1 only, never every page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = [string, unknown[]];
const db = vi.hoisted(() => ({ calls: [] as Array<{ table: string; calls: Call[] }>, rows: [] as unknown[] }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const rec = { table, calls: [] as Call[] };
      db.calls.push(rec);
      const done = () => Promise.resolve({ data: db.rows, count: db.rows.length, error: null });
      const b: Record<string, unknown> = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') return undefined;
          return (...a: unknown[]) => {
            rec.calls.push([prop, a]);
            return prop === 'range' || prop === 'limit' ? done() : b;
          };
        },
      });
      return b;
    },
  }),
}));

const { queryExpiringContracts } = await import('./query');
const NOW = new Date('2026-11-21T15:00:00Z');

beforeEach(() => { db.calls.length = 0; db.rows = []; });

describe('queryExpiringContracts paging', () => {
  it('page 1: range from 0, contract_id tie-break after the end-date order', async () => {
    await queryExpiringContracts({ naics: '561320', limit: 25, now: NOW });
    const q = db.calls[0].calls;
    const orders = q.filter(([m]) => m === 'order').map(([, a]) => a[0]);
    expect(orders).toEqual(['period_of_performance_current_end', 'contract_id']);
    const range = q.find(([m]) => m === 'range')!;
    expect(range[1][0]).toBe(0);
    expect(Number(range[1][1])).toBeGreaterThanOrEqual(24);
    expect(q.some(([m]) => m === 'limit')).toBe(false);
  });

  it('offset moves the window; the page size is unchanged', async () => {
    await queryExpiringContracts({ naics: '561320', limit: 25, now: NOW });
    const first = db.calls[0].calls.find(([m]) => m === 'range')![1] as number[];
    db.calls.length = 0;
    await queryExpiringContracts({ naics: '561320', limit: 25, offset: 50, now: NOW });
    const second = db.calls[0].calls.find(([m]) => m === 'range')![1] as number[];
    expect(second[0]).toBe(50);
    expect(second[1] - second[0]).toBe(first[1] - first[0]);
  });

  it('value order keeps the same tie-break', async () => {
    await queryExpiringContracts({ naics: '561320', limit: 10, orderBy: 'value', now: NOW });
    const orders = db.calls[0].calls.filter(([m]) => m === 'order').map(([, a]) => a[0]);
    expect(orders).toEqual(['total_obligation', 'contract_id']);
  });

  it('anchored vehicles are looked up on page 1 only', async () => {
    await queryExpiringContracts({ naics: '236220', limit: 25, anchorPiidPrefixes: ['FA4610'], now: NOW });
    expect(db.calls).toHaveLength(2);
    db.calls.length = 0;
    await queryExpiringContracts({ naics: '236220', limit: 25, offset: 25, anchorPiidPrefixes: ['FA4610'], now: NOW });
    expect(db.calls).toHaveLength(1);
  });
});
