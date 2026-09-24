import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAwardDetail, resolveAwardCeiling } from './award-detail';
import { summarizePredecessor } from './find-predecessor';
import idvMechElec from './__fixtures__/award-detail-idv-mech-elec-rca.json';
import idvVdats from './__fixtures__/award-detail-idv-vdats.json';
import orderF0047 from './__fixtures__/award-detail-order-mech-elec-f0047.json';

/**
 * Frozen USASpending `/api/v2/awards/<id>/` responses, captured 2026-09-22/23:
 *   - CONT_IDV_FA850124D0005_9700 — Robins Mech-Elec II holder (RCA), MULTIPLE AWARD, $95M ceiling
 *   - CONT_IDV_FA857123D0004_9700 — VDATS single-award requirements IDV, $63,446,220.63 ceiling
 *   - CONT_AWD_FA850126F0047_9700_FA850124D0005_9700 — a $4,524,529 delivery order under Mech-Elec II
 *
 * The endpoint's keys are `base_and_all_options` / `base_exercised_options`. Before this fix the
 * reader used `base_and_all_options_value` (a bulk-CSV column name), so every IDV reported
 * ceiling 0 and every contract's "ceiling" silently equalled its obligation.
 */

function mockFetchOnce(payload: unknown) {
  const fn = vi.fn(async () => ({ ok: true, json: async () => payload }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAwardDetail — ceiling comes from the award API field that exists', () => {
  it('frozen fixtures carry base_and_all_options and NOT the legacy *_value key', () => {
    expect((idvMechElec as Record<string, unknown>).base_and_all_options).toBe(95_000_000);
    expect('base_and_all_options_value' in (idvMechElec as Record<string, unknown>)).toBe(false);
    expect((idvMechElec as Record<string, unknown>).total_obligation).toBe(0);
  });

  it('Mech-Elec II holder IDV → $95,000,000, not 0', async () => {
    mockFetchOnce(idvMechElec);
    const d = await fetchAwardDetail('CONT_IDV_FA850124D0005_9700');
    expect(d).not.toBeNull();
    expect(d!.ceiling).toBe(95_000_000);
    expect(d!.ceilingSource).toBe('base_and_all_options');
    expect(d!.obligated).toBe(0);
    expect(d!.multipleOrSingleAward).toBe('MULTIPLE AWARD');
  });

  it('VDATS single-award IDV → $63,446,220.63', async () => {
    mockFetchOnce(idvVdats);
    const d = await fetchAwardDetail('CONT_IDV_FA857123D0004_9700');
    expect(d!.ceiling).toBeCloseTo(63_446_220.63, 2);
    expect(d!.ceilingSource).toBe('base_and_all_options');
  });

  it('a delivery order reads its own base_and_all_options (not the obligation fallback)', async () => {
    mockFetchOnce(orderF0047);
    const d = await fetchAwardDetail('CONT_AWD_FA850126F0047_9700_FA850124D0005_9700');
    expect(d!.ceiling).toBe(4_524_529);
    expect(d!.ceilingSource).toBe('base_and_all_options');
    expect(d!.parentIdvPiid).toBe('FA850124D0005');
  });

  it('summarizePredecessor now states the real IDV ceiling instead of dropping it', async () => {
    mockFetchOnce(idvMechElec);
    const d = await fetchAwardDetail('CONT_IDV_FA850124D0005_9700');
    const text = summarizePredecessor({ ...d!, matchConfidence: 'medium' });
    expect(text).toContain('contract ceiling $95.0M');
  });
});

describe('resolveAwardCeiling — guards', () => {
  it('IDV with no ceiling reported → not_reported / 0, NEVER the obligation', () => {
    expect(resolveAwardCeiling({ category: 'idv', total_obligation: 1_234 })).toEqual({ ceiling: 0, ceilingSource: 'not_reported' });
    expect(resolveAwardCeiling({ generated_unique_award_id: 'CONT_IDV_X_9700', total_obligation: 5 }))
      .toEqual({ ceiling: 0, ceilingSource: 'not_reported' });
  });

  it('contract with no option values falls back to obligated, labelled as such', () => {
    expect(resolveAwardCeiling({ category: 'contract', total_obligation: 500 })).toEqual({ ceiling: 500, ceilingSource: 'obligated_fallback' });
  });

  it('prefers all-options over exercised; reads the legacy names only as a guard', () => {
    expect(resolveAwardCeiling({ base_and_all_options: 10, base_exercised_options: 5 }).ceiling).toBe(10);
    expect(resolveAwardCeiling({ base_exercised_options: 5, total_obligation: 1 })).toEqual({ ceiling: 5, ceilingSource: 'base_exercised_options' });
    expect(resolveAwardCeiling({ base_and_all_options_value: 7 })).toEqual({ ceiling: 7, ceilingSource: 'base_and_all_options' });
  });

  it('null / zero / non-numeric values are not a ceiling', () => {
    expect(resolveAwardCeiling({ category: 'idv', base_and_all_options: null })).toEqual({ ceiling: 0, ceilingSource: 'not_reported' });
    expect(resolveAwardCeiling({ category: 'idv', base_and_all_options: 0 })).toEqual({ ceiling: 0, ceilingSource: 'not_reported' });
    expect(resolveAwardCeiling({ category: 'idv', base_and_all_options: 'abc' })).toEqual({ ceiling: 0, ceilingSource: 'not_reported' });
  });
});
