/**
 * Review finding (2026-11-14): search_sam_opportunities exact-matched a comma NAICS list into 0
 * rows and silently dropped an unparseable state (searching every state). Lists are now OR'd and
 * an unrecognizable value is an error, never a silent zero or a silent widening.
 */
import { describe, it, expect } from 'vitest';
import { makeTier1Tools, type Tier1Db } from './tier1-tools';

function stubDb(captured: Array<[string, unknown]>, rows: unknown[] = []): Tier1Db {
  const chain: Record<string, unknown> = {};
  const rec = (name: string, v: unknown) => { captured.push([name, v]); return chain; };
  for (const m of ['eq', 'in', 'gte', 'ilike', 'textSearch']) chain[m] = (c: string, v: unknown) => rec(`${m}:${c}`, v);
  chain.or = (expr: string) => rec('or', expr);
  chain.select = () => chain;
  chain.order = () => chain;
  chain.limit = async () => ({ data: rows, error: null });
  return { from() { return chain as unknown as ReturnType<Tier1Db['from']>; } };
}
const run = async (args: Record<string, unknown>, rows: unknown[] = []) => {
  const calls: Array<[string, unknown]> = [];
  const res = await makeTier1Tools(stubDb(calls, rows)).execute('search_sam_opportunities', { keyword: 'janitorial', ...args });
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
  it('several states are all applied: place of performance wins, buying office only when none is stated', async () => {
    const { calls } = await run({ state: 'VA, MD and DC' });
    expect(calls).toContainEqual(['or', 'pop_state.eq.VA,office_address->>state.eq.VA,pop_state.eq.MD,office_address->>state.eq.MD,pop_state.eq.DC,office_address->>state.eq.DC']);
    // ANDed with the first group: a row whose place of performance is another state can never match.
    expect(calls).toContainEqual(['or', 'pop_state.in.(VA,MD,DC),and(pop_state.is.null,or(pop_country.is.null,pop_country.eq.USA))']);
  });
  it('the Florida case (#2076): work performed in Puerto Rico by a Florida office is never returned', async () => {
    const row = (id: string, pop: string | null, office: string) => ({
      notice_id: id, title: `Janitorial ${id}`, response_deadline: '2099-01-01', pop_state: pop, office_address: { state: office },
    });
    const { res } = await run({ state: 'FL' }, [row('fl-work', 'FL', 'GA'), row('pr-work', 'PR', 'FL'), row('no-pop', null, 'FL')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = ((res as any).items as Array<{ notice_id?: string; title?: string }>).map((i) => i.notice_id ?? i.title);
    expect(ids.join(' ')).toContain('fl-work');
    expect(ids.join(' ')).toContain('no-pop');
    expect(ids.join(' ')).not.toContain('pr-work');
  });
  it('a no-state notice stated to be abroad is never returned for a US region, whatever the office (2026-11-24)', async () => {
    const row = (id: string, country: string | null) => ({
      notice_id: id, title: `Roads ${id}`, response_deadline: '2099-01-01', pop_state: null, pop_country: country, office_address: { state: 'DC' },
    });
    const { res } = await run({ state: 'VA, MD and DC' }, [row('zambia', 'ZMB'), row('domestic', 'USA'), row('unstated', null)]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = ((res as any).items as Array<{ notice_id?: string; title?: string }>).map((i) => i.notice_id ?? i.title).join(' ');
    expect(ids).not.toContain('zambia');
    expect(ids).toContain('domestic');
    expect(ids).toContain('unstated');
  });
  it('no state asked → no location predicate at all', async () => {
    const { calls } = await run({});
    expect(calls.some(([n, v]) => n === 'or' && String(v).includes('pop_state'))).toBe(false);
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
