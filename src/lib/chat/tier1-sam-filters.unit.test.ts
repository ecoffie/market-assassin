/**
 * Review finding (2026-11-14): search_sam_opportunities exact-matched a comma NAICS list into 0
 * rows and silently dropped an unparseable state (searching every state). Lists are now OR'd and
 * an unrecognizable value is an error, never a silent zero or a silent widening.
 */
import { describe, it, expect } from 'vitest';
import { makeTier1Tools, type Tier1Db } from './tier1-tools';

function stubDb(captured: Array<[string, unknown]>): Tier1Db {
  const chain: Record<string, unknown> = {};
  const rec = (name: string, v: unknown) => { captured.push([name, v]); return chain; };
  for (const m of ['eq', 'in', 'gte', 'ilike', 'textSearch']) chain[m] = (c: string, v: unknown) => rec(`${m}:${c}`, v);
  chain.or = (expr: string) => rec('or', expr);
  chain.select = () => chain;
  chain.order = () => chain;
  chain.limit = async () => ({ data: [], error: null });
  return { from() { return chain as unknown as ReturnType<Tier1Db['from']>; } };
}
const run = async (args: Record<string, unknown>) => {
  const calls: Array<[string, unknown]> = [];
  const res = await makeTier1Tools(stubDb(calls)).execute('search_sam_opportunities', { keyword: 'janitorial', ...args });
  return { res, calls };
};

describe('search_sam_opportunities filters', () => {
  it('a comma NAICS list is OR-ed, not exact-matched as one string', async () => {
    const { calls } = await run({ naics: '561720,561730' });
    expect(calls).toContainEqual(['or', 'naics_code.eq.561720,naics_code.eq.561730']);
    expect(calls.some(([n, v]) => n === 'eq:naics_code' && String(v).includes(','))).toBe(false);
  });
  it('a single 6-digit code stays an exact match; a prefix is a prefix', async () => {
    expect((await run({ naics: '561720' })).calls).toContainEqual(['eq:naics_code', '561720']);
    expect((await run({ naics: '5617' })).calls).toContainEqual(['or', 'naics_code.like.5617%']);
  });
  it('several states are all applied (place of performance OR buying office)', async () => {
    const { calls } = await run({ state: 'VA, MD and DC' });
    expect(calls).toContainEqual(['or', 'pop_state.eq.VA,office_address->>state.eq.VA,pop_state.eq.MD,office_address->>state.eq.MD,pop_state.eq.DC,office_address->>state.eq.DC']);
  });
  it('an unrecognized state is an error, not a silent national search', async () => {
    const { res, calls } = await run({ state: 'Narnia' });
    expect(res).toMatchObject({ ok: false, error: 'unknown_state' });
    expect(calls).toEqual([]);
  });
  it('a NAICS that is not a code is an error, not a silent zero', async () => {
    const { res } = await run({ naics: 'janitorial' });
    expect(res).toMatchObject({ ok: false, error: 'invalid_naics' });
  });
});
