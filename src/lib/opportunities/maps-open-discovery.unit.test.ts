/**
 * Maps Open adapter contract (Phase C, 2026-09-22). Hermetic: a recording stub stands in for the
 * Supabase builder, so these assert exactly which predicates the route would send.
 */
import { describe, it, expect } from 'vitest';
import { mapsOpenRequest, applyMapsOpenFilters, mapsSurfaceScope, queryNamesMarket } from './maps-open-discovery';
import { buildSearchOr } from '@/lib/mi-dashboard/search';
import type { PlanContext } from '@/lib/discovery';

const CTX: PlanContext = { today: '2026-09-22', fiscalYear: 2026 };
type Call = { m: string; a: unknown[] };
function stub() {
  const calls: Call[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['eq', 'gt', 'lt', 'or', 'in', 'not', 'lte', 'gte', 'neq', 'contains', 'is', 'ilike']) q[m] = (...a: unknown[]) => { calls.push({ m, a }); return q; };
  return { q, calls };
}
const req = (params: Record<string, string>, profile?: { profileNaics?: string[]; profileStates?: string[] }) =>
  mapsOpenRequest((k) => (k === 'status' ? params.status ?? 'active' : params[k] ?? null), { ...profile, ctx: CTX });
const run = (params: Record<string, string>, profile?: { profileNaics?: string[]; profileStates?: string[] }) => {
  const r = req(params, profile);
  const s = stub();
  applyMapsOpenFilters(s.q, r);
  return { r, calls: s.calls, ors: s.calls.filter((c) => c.m === 'or').map((c) => String(c.a[0])) };
};

describe('positive-scope rule (Eric, 2026-09-22)', () => {
  const status = (params: Record<string, string>, profile?: { profileNaics?: string[] }) => req(params, profile).plan.status;
  it.each([
    ['541512 -computers', {}],
    ['USDA -computers', {}],
    ['SDVOSB -computers', {}],
  ])('%s → valid (canonical positive scope)', (q) => expect(status({ q })).toBe('ok'));
  it('profile market + -computers → valid', () => expect(status({ q: '-computers', scope: 'profile' }, { profileNaics: ['541512'] })).toBe('ok'));
  it.each([['setAside', 'SB'], ['fullOpen', '1'], ['strategy', 'repeat_buyer'], ['subAgency', 'Forest Service'], ['sapBuyer', 'most']])(
    'Maps-only scope %s qualifies', (k, v) => expect(status({ q: '-computers', [k]: v })).toBe('ok'));
  it('naked -computers → needs_positive_scope', () => expect(status({ q: '-computers' })).toBe('needs_positive_scope'));
  it('freshness / presentation filters never qualify', () => {
    const r = req({ q: '-computers', noticeType: 'Solicitation', closingDays: '30', postedDays: '7', hasDocs: '1', hasContact: '1', country: 'us', hideCommodity: '1' });
    expect(mapsSurfaceScope(r.filters)).toEqual([]);
    expect(r.plan.status).toBe('needs_positive_scope');
  });
  it('an invalid plan fails CLOSED — never broadens, never drops the exclusion', () => {
    const { ors, calls } = run({ q: '-computers', closingDays: '30' });
    expect(calls.some((c) => c.m === 'is' && c.a[0] === 'notice_id' && c.a[1] === null)).toBe(true);
    expect(ors.join()).not.toMatch(/computers/); // no plan ops besides the fail-closed one
  });
  it('a valid exclusion is actually applied', () => {
    const { ors } = run({ q: '-computers', setAside: 'SB' });
    expect(ors.some((e) => /computer/.test(e) && /not\./.test(e))).toBe(true);
  });
});

describe('the legacy search brain never sees the query', () => {
  for (const q of ['ai governance', 'janitorial', 'cyber, cloud', 'IT services', 'Pro Audio']) {
    it(`"${q}": no buildSearchOr / %substring% predicate reaches the query`, () => {
      const { ors } = run({ q });
      expect(ors).not.toContain(buildSearchOr(q));
      expect(ors.join()).not.toMatch(/\.ilike\.%/);
    });
  }
  it('agency is whole-word identity, never the substring matcher', () => {
    const { ors } = run({ agency: 'VA' });
    expect(ors.join()).not.toMatch(/ilike\.%VA%/i);
    expect(ors.join()).toMatch(/veterans/i);
  });
});

describe('multi-agency (Maps presets are pipe-joined distinct buyers)', () => {
  it('pipe list → string[] into the plan; one buyer stays a string', () => {
    expect(req({ agency: 'AGRICULTURE|VETERANS AFFAIRS' }).input.agency).toEqual(['AGRICULTURE', 'VETERANS AFFAIRS']);
    expect(req({ agency: 'VETERANS AFFAIRS' }).input.agency).toBe('VETERANS AFFAIRS');
    expect(req({ agency: 'AGRICULTURE|VETERANS AFFAIRS' }).plan.buyers).toHaveLength(2);
  });
});

describe('surface policy preserved', () => {
  it('state named in the query reaches the state filter (pop OR office)', () => {
    const { ors } = run({ q: 'Naval facilities in Nevada' });
    expect(ors).toContain('pop_state.eq.NV,office_address->>state.eq.NV');
  });
  it('an unresolvable explicit state still fails closed', () => {
    const { calls } = run({ q: 'janitorial', state: 'XX' });
    expect(calls.some((c) => c.m === 'eq' && c.a[0] === 'pop_state' && c.a[1] === '__NONE__')).toBe(true);
  });
  it('status / notice type / strategy still flow through applyMapFilters', () => {
    const { calls } = run({ q: 'janitorial', status: 'all', noticeType: 'Solicitation', strategy: 'repeat_buyer' });
    expect(calls.some((c) => c.m === 'eq' && c.a[0] === 'active')).toBe(false);
    expect(calls.some((c) => c.m === 'in' && c.a[0] === 'notice_type')).toBe(true);
    expect(calls.some((c) => c.m === 'contains' && c.a[0] === 'opportunity_dna_keys')).toBe(true);
  });
});

describe('profile scope is suppressed only when the query names a market', () => {
  const profile = { profileNaics: ['561720'], profileStates: ['FL'] };
  const hasProfile = (ors: string[]) => ors.includes('naics_code.eq.561720');
  it('no query → profile applies', () => expect(hasProfile(run({ scope: 'profile' }, profile).ors)).toBe(true));
  it('an explicit query escapes profile scope (pre-migration rule)', () => {
    const { r, ors } = run({ q: 'janitorial', scope: 'profile' }, profile);
    expect(queryNamesMarket(r.plan)).toBe(true);
    expect(hasProfile(ors)).toBe(false);
  });
  it('an exclusion-only query KEEPS the profile it depends on (never broadens to the whole market)', () => {
    const { r, ors } = run({ q: '-computers', scope: 'profile' }, profile);
    expect(r.plan.status).toBe('ok');
    expect(queryNamesMarket(r.plan)).toBe(false);
    expect(hasProfile(ors)).toBe(true);
  });
});
