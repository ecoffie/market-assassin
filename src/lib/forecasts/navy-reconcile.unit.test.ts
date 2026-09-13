import { describe, it, expect } from 'vitest';
import {
  planReconciliation, planReconciles, dataAdvanced,
  NAVY_SOURCE_OWNED_FIELDS, type NavyRow,
} from './navy-reconcile';

const row = (id: string, o: Partial<NavyRow> = {}): NavyRow =>
  ({ external_id: id, title: `T-${id}`, fiscal_year: 'FY2026', ...o });

describe('the plan must reconcile before any mutation', () => {
  it('balances all three identities on a clean run', () => {
    const held = new Map([['a', { title: 'T-a', fiscal_year: 'FY2026' }]]);
    const p = planReconciliation([row('a'), row('b')], held);
    expect(p.toInsert).toHaveLength(1);
    expect(p.matchedExisting).toBe(1);
    expect(p.unchanged).toBe(1);
    expect(planReconciles(p).ok).toBe(true);
  });

  it('counts duplicates and rejects WITHOUT losing them from the accounting', () => {
    const p = planReconciliation([row('a'), row('a'), null, { external_id: '  ' } as NavyRow], new Map());
    expect(p.duplicateSourceIds).toEqual(['a']);
    expect(p.parseRejected).toBe(2);        // null + blank id
    expect(p.usableUpstream).toBe(1);
    expect(planReconciles(p).ok).toBe(true); // 1 + 1 + 2 == 4
  });

  it('a plan that does not balance is reported, not executed', () => {
    const p = planReconciliation([row('a')], new Map());
    const broken = { ...p, upstreamTotal: 99 };
    const chk = planReconciles(broken);
    expect(chk.ok).toBe(false);
    expect(chk.problems[0]).toContain('upstream accounting');
  });
});

describe('in-place change detection (Navy edits the same revision)', () => {
  it('detects a changed source-owned field', () => {
    const held = new Map([['a', { title: 'OLD', fiscal_year: 'FY2026' }]]);
    const p = planReconciliation([row('a', { title: 'NEW' })], held);
    expect(p.toUpdate).toHaveLength(1);
    expect(p.toUpdate[0].changedFields).toEqual(['title']);
    expect(p.unchanged).toBe(0);
  });

  it('ignores whitespace-only formatting noise', () => {
    const held = new Map([['a', { title: 'T-a', fiscal_year: 'FY2026' }]]);
    const p = planReconciliation([row('a', { title: '  T-a  ' })], held);
    expect(p.unchanged).toBe(1);
    expect(p.toUpdate).toHaveLength(0);
  });

  it('only patches the fields that actually differ', () => {
    const held = new Map([['a', { title: 'OLD', fiscal_year: 'FY2026', naics_code: '541512' }]]);
    const p = planReconciliation([row('a', { title: 'NEW', naics_code: '541512' })], held);
    expect(Object.keys(p.toUpdate[0].patch)).toEqual(['title']);
  });

  it('never touches a field the source did not supply', () => {
    const held = new Map([['a', { title: 'T-a', pop_state: 'VA' }]]);
    const p = planReconciliation([{ external_id: 'a', title: 'T-a' }], held);
    expect(p.unchanged).toBe(1);            // pop_state absent upstream -> not a change
  });
});

describe('Mindy-derived enrichment is never source-owned', () => {
  it.each(['map_lat', 'map_lng', 'map_loc_source', 'id', 'created_at', 'last_synced_at'])(
    '%s is NOT in the source-owned field list',
    (f) => {
      expect((NAVY_SOURCE_OWNED_FIELDS as readonly string[])).not.toContain(f);
    },
  );

  it('a geocoded row is not rewritten by a source refresh', () => {
    // 5,033 Navy rows carry map_lat we computed; a refresh must not clear it.
    const held = new Map([['a', { title: 'T-a', fiscal_year: 'FY2026' }]]);
    const p = planReconciliation([row('a')], held);
    expect(p.toUpdate).toHaveLength(0);
  });
});

describe('absence is evidence, not deletion authority', () => {
  it('held rows missing from the workbook are RETAINED and counted', () => {
    const held = new Map([['a', { title: 'T-a' }], ['gone', { title: 'T-gone' }]]);
    const p = planReconciliation([row('a', { title: 'T-a' })], held);
    expect(p.absentUpstream).toEqual(['gone']);
    expect(planReconciles(p).ok).toBe(true);   // absence never breaks the accounting
  });

  it('the plan exposes no delete path at all', () => {
    const p = planReconciliation([], new Map([['x', {}]]));
    expect(Object.keys(p)).not.toContain('toDelete');
    expect(p.absentUpstream).toEqual(['x']);
  });
});

describe('idempotency and the data-advance clock', () => {
  it('a second identical run yields 0 inserts and 0 updates', () => {
    const upstream = [row('a'), row('b')];
    const held = new Map(upstream.map((r) => [r.external_id, { title: r.title, fiscal_year: r.fiscal_year }]));
    const p = planReconciliation(upstream, held);
    expect(p.toInsert).toHaveLength(0);
    expect(p.toUpdate).toHaveLength(0);
    expect(p.unchanged).toBe(2);
  });

  it('lastDataAdvance only advances when data really changed', () => {
    expect(dataAdvanced(0, 0)).toBe(false);   // idempotent rerun
    expect(dataAdvanced(1, 0)).toBe(true);
    expect(dataAdvanced(0, 1)).toBe(true);
  });
});
