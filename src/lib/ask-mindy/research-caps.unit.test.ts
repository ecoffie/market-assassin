import { describe, it, expect, vi } from 'vitest';
import { researchCapDecision, plansFor, capFor, researchCapsConfig, capNotice, countsTowardCap, mcpPlanFromLedger, utcDayStart, DEFAULT_RESEARCH_CAPS, type PlanFacts } from './research-caps';
import { SUBSCRIPTION_PLANS } from '@/lib/mcp/packages';

const facts = (over: Partial<PlanFacts> = {}): PlanFacts => ({ staff: false, appTier: 'none', access: { level: 'free', source: 'free' }, mcpPlan: null, ...over });
const cfg = researchCapsConfig({});
const trace = (calls: number) => ({ engine: 'research_mode', call_count: calls });
const decide = (f: PlanFacts, used: number, env: Record<string, string> = {}) =>
  researchCapDecision('a@b.com', { facts: async () => f, todaysTraces: async () => Array.from({ length: used }, () => trace(3)), env, now: () => Date.parse('2026-11-28T15:00:00Z') });

describe('each plan\'s daily limit (Eric\'s table)', () => {
  it.each([
    ['free', facts(), 2],
    ['trial', facts({ access: { level: 'pro', source: 'trial' } }), 2],
    ['Pro lifetime', facts({ access: { level: 'pro', source: 'lifetime' } }), 3],
    ['Pro monthly (Stripe)', facts({ appTier: 'pro', access: { level: 'pro', source: 'stripe' } }), 10],
    ['Team (per user)', facts({ appTier: 'team' }), 10],
    ['MCP Entry', facts({ mcpPlan: 'entry' }), 5],
    ['MCP Mid', facts({ mcpPlan: 'mid' }), 15],
    ['MCP Growth', facts({ mcpPlan: 'growth' }), 25],
    ['Enterprise (defaults to Team)', facts({ appTier: 'enterprise' }), 10],
  ])('%s', (_n, f, cap) => { expect(capFor('a@b.com', f, cfg).cap).toBe(cap); });
  it('staff and the internal team are uncapped', async () => {
    expect(capFor('a@b.com', facts({ staff: true }), cfg)).toEqual({ cap: null, plan: 'staff' });
    expect(await decide(facts({ staff: true }), 999)).toMatchObject({ allowed: true, cap: null });
  });
});

describe('highest cap wins; lifetime vs monthly', () => {
  it('Pro lifetime + MCP Mid gets 15', () => { expect(capFor('a@b.com', facts({ access: { level: 'pro', source: 'lifetime' }, mcpPlan: 'mid' }), cfg)).toEqual({ cap: 15, plan: 'mcp_mid' }); });
  it('lifetime is 3, a paid monthly subscription is 10', () => {
    expect(capFor('a@b.com', facts({ access: { level: 'pro', source: 'lifetime' } }), cfg).cap).toBe(3);
    expect(capFor('a@b.com', facts({ access: { level: 'pro', source: 'stripe' } }), cfg).cap).toBe(10);
    expect(plansFor(facts({ appTier: 'pro', access: { level: 'pro', source: 'lifetime' } }))).toEqual(['pro_lifetime']);
  });
  it('Team + MCP Growth gets 25', () => { expect(capFor('a@b.com', facts({ appTier: 'team', mcpPlan: 'growth' }), cfg).cap).toBe(25); });
});

describe('counting', () => {
  it('the 10th research answer runs; the 11th is a standard answer with the notice (Pro monthly)', async () => {
    const pro = facts({ appTier: 'pro', access: { level: 'pro', source: 'stripe' } });
    expect(await decide(pro, 9)).toMatchObject({ allowed: true, used: 9, cap: 10, notice: null });
    const capped = await decide(pro, 10);
    expect(capped).toMatchObject({ allowed: false, used: 10 });
    expect(capped.notice).toBe("You've used today's 10 in-depth research answers, so this one is a standard answer. In-depth research resets tomorrow. The MCP Mid plan includes 15 a day.");
  });
  it('turns with no tool calls (and non-research turns) are not counted', () => {
    expect(countsTowardCap(trace(0))).toBe(false);
    expect(countsTowardCap({ engine: 'intelligence_gate', call_count: 5 })).toBe(false);
    expect(countsTowardCap(trace(1))).toBe(true);
    expect(countsTowardCap(null)).toBe(false);
  });
  it('a mixed day: only the counted turns use the allowance', async () => {
    const d = await researchCapDecision('a@b.com', { facts: async () => facts(), todaysTraces: async () => [trace(0), trace(0), trace(4)], env: {} });
    expect(d).toMatchObject({ used: 1, allowed: true, cap: 2 });
  });
  it('the count resets each UTC day: the read is from today\'s UTC midnight', async () => {
    const todaysTraces = vi.fn(async () => []);
    await researchCapDecision('a@b.com', { facts: async () => facts(), todaysTraces, env: {}, now: () => Date.parse('2026-11-28T23:59:00Z') });
    await researchCapDecision('a@b.com', { facts: async () => facts(), todaysTraces, env: {}, now: () => Date.parse('2026-11-29T00:01:00Z') });
    expect(todaysTraces.mock.calls.map((c) => (c as unknown as [string, string])[1])).toEqual(['2026-11-28T00:00:00.000Z', '2026-11-29T00:00:00.000Z']);
    expect(utcDayStart(Date.parse('2026-11-28T05:00:00+09:00'))).toBe('2026-11-27T00:00:00.000Z');
  });
  it('a count that cannot be read is unknown: research is allowed, and it says so', async () => {
    const d = await researchCapDecision('a@b.com', { facts: async () => facts(), todaysTraces: async () => null, env: {} });
    expect(d).toMatchObject({ allowed: true, used: null, countUnknown: true });
  });
});

describe('config, not code', () => {
  it('ASK_MINDY_RESEARCH_CAPS overrides plan caps and sets per-account caps; invalid values are ignored', async () => {
    const env = { ASK_MINDY_RESEARCH_CAPS: JSON.stringify({ free: 1, mcp_mid: -3, accounts: { 'A@B.com': 40 } }) };
    const c = researchCapsConfig(env);
    expect(c.caps.free).toBe(1);
    expect(c.caps.mcp_mid).toBe(DEFAULT_RESEARCH_CAPS.mcp_mid);
    expect(capFor('a@b.com', facts({ mcpPlan: 'growth' }), c)).toEqual({ cap: 40, plan: 'account' });
    expect((await decide(facts(), 1, { ASK_MINDY_RESEARCH_CAPS: JSON.stringify({ free: 1 }) })).allowed).toBe(false);
  });
  it('unreadable JSON falls back to the defaults (never zero)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(researchCapsConfig({ ASK_MINDY_RESEARCH_CAPS: '{not json' }).caps).toEqual(DEFAULT_RESEARCH_CAPS);
  });
});

describe('notice text', () => {
  it('names the next plan up; the top plan and account overrides get no upsell', () => {
    expect(capNotice(2, 'free', cfg)).toMatch(/today's 2 in-depth research answers.*resets tomorrow\. The Pro plan includes 10 a day\.$/);
    expect(capNotice(25, 'mcp_growth', cfg)).not.toMatch(/plan includes/);
    expect(capNotice(40, 'account', cfg)).not.toMatch(/plan includes/);
    expect(capNotice(1, 'free', researchCapsConfig({ ASK_MINDY_RESEARCH_CAPS: '{"free":1}' }))).toMatch(/today's 1 in-depth research answer,/);
  });
});

describe('MCP plan from the credit ledger', () => {
  const now = Date.parse('2026-11-28T00:00:00Z');
  const credits = (id: string, k: 'monthly' | 'annual') => { const p = SUBSCRIPTION_PLANS.find((x) => x.id === id)!; return k === 'monthly' ? p.monthly.credits : p.annual!.credits; };
  it('a recent monthly or annual grant names its plan by its credit amount', () => {
    expect(mcpPlanFromLedger([{ reason: 'mcp_sub_monthly', delta: credits('mid', 'monthly'), created_at: '2026-11-10T00:00:00Z' }], now)).toBe('mid');
    expect(mcpPlanFromLedger([{ reason: 'mcp_sub_annual', delta: credits('growth', 'annual'), created_at: '2026-03-01T00:00:00Z' }], now)).toBe('growth');
  });
  it('an expired grant or an unknown amount is no plan', () => {
    expect(mcpPlanFromLedger([{ reason: 'mcp_sub_monthly', delta: credits('mid', 'monthly'), created_at: '2026-09-01T00:00:00Z' }], now)).toBeNull();
    expect(mcpPlanFromLedger([{ reason: 'mcp_sub_monthly', delta: 1234, created_at: '2026-11-20T00:00:00Z' }], now)).toBeNull();
  });
});
