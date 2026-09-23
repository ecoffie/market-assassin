/**
 * FIND Coming Back never returns task/delivery orders (Eric, 2026-09-22 — IMI Workstream B).
 *
 * An order under a contract vehicle is not re-competed on its own. queryComingBack excludes
 * award_kind = order_under_vehicle INSIDE the fetch (PostgREST predicate NOT_ORDER_UNDER_VEHICLE_OR,
 * so the row cap is spent on standalone contracts) and again in JS (parseAwardLineage) before
 * classification/ranking. Orders are counted (orders_excluded), never reclassified or moved to Open.
 *
 * The fake client below ignores filters and returns every fixture row, so these tests exercise
 * the JS guard — the same rule the SQL predicate encodes.
 *
 * Frozen fixtures: Tyonek (src/lib/opportunities/__fixtures__/imi-find/tyonek-recompete.json) and
 * the IMI NAICS 2382 / GA set (src/lib/recompete/__fixtures__/imi-expiring-ga-2382.*).
 */
import { describe, it, expect } from 'vitest';
import tyonekFx from './__fixtures__/imi-find/tyonek-recompete.json';
import buysideFx from './__fixtures__/imi-find/ga-buyside-recompete.json';
import { findOpportunities } from './find-opportunities';
import { parseAwardLineage, NOT_ORDER_UNDER_VEHICLE_OR } from '@/lib/recompete/award-lineage';
import { inWindowRows } from '@/lib/recompete/__fixtures__/imi-expiring-ga-2382';

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>) {
  const make = (table: string) => {
    let head = false;
    const rows = tables[table] || [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['select', 'or', 'eq', 'is', 'gt', 'lt', 'gte', 'lte', 'ilike', 'like', 'in', 'not', 'order', 'limit', 'range', 'neq', 'filter', 'contains', 'overlaps', 'match', 'textSearch']) {
      builder[m] = (...args: unknown[]) => {
        if (m === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true;
        return chain();
      };
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(head ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null });
    return builder;
  };
  return { from: (t: string) => make(t) } as never;
}

const TYONEK = tyonekFx.data as Row[];
const BUYSIDE = buysideFx.data as Row[];
const GA2382 = inWindowRows() as unknown as Row[];

describe('Coming Back excludes order_under_vehicle', () => {
  it('Tyonek task orders under FA8571-23-D-0004 cannot appear as individual items', async () => {
    const res = await findOpportunities(
      { query: 'industrial steel fabrication, machining, piping, rigging', location: 'GA', limit_per_horizon: 25 },
      { client: fakeClient({ sam_opportunities: [], recompete_opportunities: [...TYONEK, ...BUYSIDE], agency_forecasts: [] }) },
    );
    const back = res.horizons.coming_back;
    expect(back.items.some((i) => String(i.contract_id).includes('FA857123D0004'))).toBe(false);
    expect(back.items.some((i) => i.award_kind === 'order_under_vehicle')).toBe(false);
    expect(TYONEK.filter((r) => parseAwardLineage(r as { contract_id?: string }).award_kind === 'order_under_vehicle')).toHaveLength(6);
  });

  it('RCA orders under FA8501-24-D-0005 cannot appear; standalone contracts fill the slots', async () => {
    const res = await findOpportunities(
      { query: 'hvac mechanical plumbing', location: 'GA', limit_per_horizon: 25 },
      { client: fakeClient({ sam_opportunities: [], recompete_opportunities: GA2382, agency_forecasts: [] }) },
    );
    const back = res.horizons.coming_back;
    expect(back.items.some((i) => String(i.contract_id).includes('_FA850124D0005_'))).toBe(false);
    expect(back.items.every((i) => i.award_kind !== 'order_under_vehicle')).toBe(true);
    // Every returned item is a standalone contract from the frozen set.
    for (const i of back.items) expect(String(i.contract_id)).toMatch(/_-NONE-_-NONE-$/);
    expect(back.orders_excluded).toBeGreaterThanOrEqual(24);
  });

  it('if every matching row is an order: no standalone result, an internal note, no zero claim', async () => {
    const orders = TYONEK.filter((r) => String(r.contract_id).includes('FA857123D0004'));
    const res = await findOpportunities(
      { query: 'industrial steel fabrication, machining, piping, rigging', location: 'GA', limit_per_horizon: 25 },
      { client: fakeClient({ sam_opportunities: [], recompete_opportunities: orders, agency_forecasts: [] }) },
    );
    const back = res.horizons.coming_back;
    expect(back.items).toEqual([]);
    expect(back.status).not.toBe('grounded');
    expect(back.orders_excluded).toBe(6);
    expect(back.semantics_note ?? '').toMatch(/task\/delivery orders/i);
  });

  it('the SQL predicate names the same standalone shape and order types parseAwardLineage uses', () => {
    expect(NOT_ORDER_UNDER_VEHICLE_OR).toContain('contract_id.like.%-NONE-_-NONE-');
    expect(NOT_ORDER_UNDER_VEHICLE_OR).toContain('"DELIVERY ORDER","BPA CALL","TASK ORDER"');
    expect(parseAwardLineage({ contract_id: 'CONT_AWD_X_9700_-NONE-_-NONE-' }).award_kind).toBe('standalone_contract');
    for (const t of ['DELIVERY ORDER', 'BPA CALL', 'TASK ORDER']) {
      expect(parseAwardLineage({ contract_id: 'RAWPIID', contract_type: t }).award_kind).toBe('order_under_vehicle');
    }
  });
});
