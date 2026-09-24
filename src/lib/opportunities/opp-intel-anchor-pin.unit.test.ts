import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAwardDetail } from '@/lib/usaspending/award-detail';
import { predecessorAnchorValue } from './opp-intel';
import idvMechElec from '@/lib/usaspending/__fixtures__/award-detail-idv-mech-elec-rca.json';
import idvVdats from '@/lib/usaspending/__fixtures__/award-detail-idv-vdats.json';
import orderF0047 from '@/lib/usaspending/__fixtures__/award-detail-order-mech-elec-f0047.json';

/**
 * The ceiling-mapping fix must NOT move the M-Estimate. Before the fix, opp-intel's predecessor
 * value was `pred.ceiling ?? …` where ceiling was computed as below (legacy keys that the award
 * API never returns). This pins the anchor to exactly that legacy value on real frozen payloads.
 */
function legacyCeiling(d: Record<string, unknown>): number {
  return Number((d.base_and_all_options_value as number) || (d.base_exercised_options_val as number) || (d.total_obligation as number) || 0);
}

afterEach(() => vi.unstubAllGlobals());

describe('opp-intel predecessor anchor is pinned across the ceiling fix', () => {
  for (const [name, payload] of [['Mech-Elec IDV', idvMechElec], ['VDATS IDV', idvVdats], ['order F0047', orderF0047]] as const) {
    it(`${name}: anchor == pre-fix value`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
      const d = await fetchAwardDetail('X');
      expect(predecessorAnchorValue(d)).toBe(legacyCeiling(payload as Record<string, unknown>));
    });
  }

  it('an award whose options exceed its obligation keeps the OBLIGATION as the anchor', () => {
    expect(predecessorAnchorValue({ obligated: 1_000_000, ceiling: 5_000_000 } as never)).toBe(1_000_000);
  });

  it('no predecessor → null', () => {
    expect(predecessorAnchorValue(null)).toBeNull();
  });
});
