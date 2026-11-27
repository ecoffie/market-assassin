/**
 * get_award_detail carries how the award was competed, from the SAME detail response (no extra call).
 * Frozen USASpending responses (see award-detail-ceiling.unit.test.ts for provenance).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAwardDetail } from './award-detail';
import idvVdats from './__fixtures__/award-detail-idv-vdats.json';
import orderF0047 from './__fixtures__/award-detail-order-mech-elec-f0047.json';

const once = (payload: unknown) => {
  const fn = vi.fn(async () => ({ ok: true, json: async () => payload }));
  vi.stubGlobal('fetch', fn);
  return fn;
};
afterEach(() => vi.unstubAllGlobals());

describe('award detail competition', () => {
  it('VDATS: 8(a) sole source, not competed, with the statutory reason', async () => {
    const f = once(idvVdats);
    const d = await fetchAwardDetail('CONT_IDV_FA857123D0004_9700');
    expect(f).toHaveBeenCalledTimes(1);
    expect(d!.competition).toMatchObject({ class: 'not_competed', label: '8(a) sole source', offers_received: 1, source: 'usaspending_award' });
  });
  it('F0047 order: competed as a small-business set-aside, 1 offer reported', async () => {
    once(orderF0047);
    const d = await fetchAwardDetail('CONT_AWD_FA850126F0047_9700_FA850124D0005_9700');
    expect(d!.competition).toMatchObject({ class: 'competed', label: 'Competed · SB set-aside', offers_received: 1 });
  });
  it('offers missing on the record → null (not reported), never 0 or 1', async () => {
    const stripped = JSON.parse(JSON.stringify(orderF0047));
    delete stripped.latest_transaction_contract_data.number_of_offers_received;
    once(stripped);
    const d = await fetchAwardDetail('X');
    expect(d!.competition!.offers_received).toBeNull();
    expect(d!.competition!.detail).not.toMatch(/offer/);
  });
  it('no contract data → unknown, never competed', async () => {
    const stripped = JSON.parse(JSON.stringify(orderF0047));
    delete stripped.latest_transaction_contract_data;
    once(stripped);
    const d = await fetchAwardDetail('X');
    expect(d!.competition).toMatchObject({ class: 'unknown', label: 'Not established' });
  });
});
