import { describe, it, expect } from 'vitest';
import { rankOfficesByEarlySignal } from './office-early-signal';

/** Stub returning opportunity rows, then the dodaac decode. */
function stub(opps: unknown[], dir: unknown[] = [], failOpps = false) {
  let call = 0;
  const chain = (rows: unknown[], err: unknown) => {
    const api: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'like', 'or', 'in', 'ilike', 'limit']) {
      api[m] = () => api;
    }
    (api as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: rows, error: err });
    return api;
  };
  return {
    from() {
      call += 1;
      return call === 1 ? chain(failOpps ? [] : opps, failOpps ? { message: 'boom' } : null) : chain(dir, null);
    },
  } as never;
}

const opp = (sol: string, type: string) => ({ solicitation_number: sol, notice_type: type, sub_tier: 'DEPT OF THE NAVY' });

describe('rankOfficesByEarlySignal', () => {
  it('separates a high-signal office from a high-VOLUME one (the whole point)', async () => {
    const r = await rankOfficesByEarlySignal(stub([
      // NAVAIR: small but nearly all early
      opp('N00019-25-R-001', 'Sources Sought'),
      opp('N00019-25-R-002', 'Presolicitation'),
      opp('N00019-25-R-003', 'Sources Sought'),
      // DLA parts desk: high volume, zero early
      ...Array.from({ length: 8 }, (_, i) => opp(`SPE7M1-25-T-00${i}`, 'Solicitation')),
    ], [
      { dodaac: 'N00019', office_name: 'NAVAL AIR SYSTEMS COMMAND', sub_agency: 'Department of the Navy', award_count: 50486, total_obligated: 4e11 },
      { dodaac: 'SPE7M1', office_name: 'DLA LAND', sub_agency: 'Defense Logistics Agency', award_count: 9000, total_obligated: 1e9 },
    ]), { minOpportunities: 3 });

    expect(r.offices[0].dodaac).toBe('N00019');           // ranked FIRST despite 3 vs 8 opps
    expect(r.offices[0].pctEarly).toBe(100);
    expect(r.offices[0].officeName).toBe('NAVAL AIR SYSTEMS COMMAND');
    const dla = r.offices.find((o) => o.dodaac === 'SPE7M1');
    expect(dla?.earlyStage).toBe(0);
  });

  it('ranks by early COUNT before rate — a 1-of-1 office is not a target', async () => {
    const r = await rankOfficesByEarlySignal(stub([
      opp('AAAAAA-1', 'Sources Sought'),                                   // 1 of 1 = 100%
      opp('AAAAAA-2', 'Solicitation'), opp('AAAAAA-3', 'Solicitation'),
      ...Array.from({ length: 4 }, (_, i) => opp(`BBBBBB-${i}`, 'Sources Sought')),  // 4 early
      opp('BBBBBB-9', 'Solicitation'),
    ]), { minOpportunities: 3 });
    expect(r.offices[0].dodaac).toBe('BBBBBB');   // 4 early beats 1 early at a higher %
  });

  it('honours minOpportunities', async () => {
    const r = await rankOfficesByEarlySignal(stub([
      opp('CCCCCC-1', 'Sources Sought'),
      opp('DDDDDD-1', 'Sources Sought'), opp('DDDDDD-2', 'Sources Sought'), opp('DDDDDD-3', 'Sources Sought'),
    ]), { minOpportunities: 3 });
    expect(r.offices.map((o) => o.dodaac)).toEqual(['DDDDDD']);
  });

  it('skips rows with no parseable DoDAAC instead of inventing one', async () => {
    const r = await rankOfficesByEarlySignal(stub([
      { solicitation_number: null, notice_type: 'Sources Sought', sub_tier: null },
      { solicitation_number: '12-3', notice_type: 'Sources Sought', sub_tier: null },
    ]), { minOpportunities: 1 });
    expect(r.offices).toHaveLength(0);
    expect(r.totals.opportunities).toBe(0);
  });

  it('keeps the DoDAAC when the decode has no entry (gap, not a fake office)', async () => {
    const r = await rankOfficesByEarlySignal(stub([
      opp('DIU782-1', 'Sources Sought'), opp('DIU782-2', 'Sources Sought'), opp('DIU782-3', 'Presolicitation'),
    ], []), { minOpportunities: 3 });
    expect(r.offices[0].dodaac).toBe('DIU782');
    expect(r.offices[0].officeName).toBeNull();
  });

  it('reports degraded on a read error rather than a confident empty ranking', async () => {
    const r = await rankOfficesByEarlySignal(stub([], [], true), {});
    expect(r.degraded).toBe(true);
    expect(r.offices).toHaveLength(0);
  });
});
