/**
 * Ask Mindy fit ranking in chat (ASK_MINDY_RECIPES, default off). Drives the REAL route handler and the real tool
 * executor; only auth, telemetry, storage, providers, the MCP tool runner and the company-profile loader are faked.
 *
 * Requirements (Agent 4 / Eric, 2026-11-22): flag off → identical prompt and no profile read; the profile is read
 * only through loadCompanyProfile(ChatActingScope); value first (a refused, failed or slow profile never blocks or
 * reorders the answer); show/related bands with the evidence floor; subcontract labelled; no second filter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { plannerResponse, answerStream, isPlannerCall, readSse, answerText, chatRequest, withinMs, type SseEvent } from './__fixtures__/route-harness';

const h = vi.hoisted(() => ({
  runMcpTool: vi.fn(),
  loadCompanyProfile: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ['from', 'select', 'eq', 'in', 'order', 'limit', 'update', 'upsert', 'insert', 'ilike', 'or', 'gte', 'lte', 'neq', 'is']) chain[m] = vi.fn(self);
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.single = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return { createClient: () => chain };
});
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => ({ authenticated: true, email })) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: vi.fn(async () => true) }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: vi.fn() }));
vi.mock('@/lib/proposal/loaders', async (orig) => ({ ...(await orig<object>()), loadBidderProfile: vi.fn(async () => ({})), formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: vi.fn(async () => false), recordLlmUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/mentioned-notice', () => ({ resolveMentionedNotice: vi.fn(async () => ({ status: 'none' })), answerUsesNotice: () => false }));
vi.mock('@/lib/mcp/credits', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/credits')>()), logCall: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/tool-registry')>()), runMcpTool: h.runMcpTool }));
vi.mock('@/lib/ask-mindy/company-profile', async (orig) => ({ ...(await orig<object>()), loadCompanyProfile: h.loadCompanyProfile }));

const NOW = Date.now();
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

// Synthetic (illustrative) company profile, already in the CompanyProfile shape.
const PROFILE = {
  companyName: 'Example Staffing Co', naicsCodes: ['561320'], states: ['TN'],
  certifications: [{ name: 'WOSB', source: 'self_reported' }],
  pastPerformance: { buyerAgencies: ['Department of Veterans Affairs'], buyerOffices: [], naicsCodes: ['561320'], largestAward: 1_500_000, primeCount: 1, subCount: 0, otherRoleCount: 0 },
  unknown: ['uei', 'targetAgencies', 'targetSetAsides', 'vehiclesHeld', 'keywords'],
};

const openItem = (over: Record<string, unknown> = {}) => ({
  horizon: 'open_now', title: 'Laboratory Staffing Services', buyer: 'Department of Veterans Affairs', naics_code: '561320',
  response_deadline: days(30), relevant_date: days(30).slice(0, 10), relevant_date_label: 'Responses due', value_label: null,
  place_of_performance_state: 'TN', set_aside_description: 'Total Small Business', set_aside_code: 'SBA',
  location_label: 'TN', source: 'sam', why_this_matched: 'naics', identity: { kind: 'notice', id: 'n1' }, ...over,
});
const FIND = {
  query_summary: { query: 'staffing', location: null, agency: null, timeframe: null, set_aside: null, horizons_requested: ['open_now', 'coming_back', 'coming_soon'], interpreted_as: {} },
  horizons: {
    open_now: { status: 'grounded', matched_count: 2, returned_count: 2, items: [openItem(), openItem({ title: 'HUBZone Clerical Support', set_aside_description: 'HUBZone Set-Aside', set_aside_code: 'HZC', identity: { kind: 'notice', id: 'n2' } })], source: 'sam', as_of: null, filters_consumed: [], filters_unsupported: [], unmapped_count: null, error: null, allowed_handoffs: [], semantics_note: null },
    coming_back: { status: 'empty', matched_count: 0, returned_count: 0, items: [], source: 'recompete', as_of: null, filters_consumed: [], filters_unsupported: [], unmapped_count: null, error: null, allowed_handoffs: [], semantics_note: null },
    coming_soon: { status: 'unavailable', matched_count: null, returned_count: 0, items: [], source: 'forecast', as_of: null, filters_consumed: [], filters_unsupported: [], unmapped_count: null, error: { class: 'timeout', message: 'timeout' }, allowed_handoffs: [], semantics_note: null },
  },
  summary: {},
};

let answerBodies: Array<Record<string, unknown>> = [];
let plannerCalls: Array<{ name: string; args: unknown; id?: string }> = [];

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
  answerBodies = [];
  plannerCalls = [{ name: 'find_opportunities', args: { query: 'staffing' }, id: 'find' }];
  h.runMcpTool.mockReset();
  h.runMcpTool.mockImplementation(async (name: string) => ({ result: name === 'find_opportunities' ? FIND : { ok: true }, credits: 0 }));
  h.loadCompanyProfile.mockReset();
  h.loadCompanyProfile.mockResolvedValue({ status: 'ok', profile: PROFILE, workspace: 'own' });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    if (isPlannerCall(body)) return plannerResponse(plannerCalls);
    answerBodies.push(body);
    return answerStream(['Here are the picks.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ask(message = 'What staffing work should we go after?'): Promise<SseEvent[]> {
  vi.resetModules();
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return withinMs(readSse(await POST(chatRequest({ message }) as any)), 8000, 'chat stream');
}
const answerSystem = () => ((answerBodies[0]?.messages ?? []) as Array<{ role: string; content: string }>).filter((m) => m.role === 'system').map((m) => m.content);
const answerMessagesJson = () => JSON.stringify(answerBodies[0]?.messages ?? []);

describe('flag off (default)', () => {
  it('reads no profile and adds no ranking note', async () => {
    await ask();
    expect(h.loadCompanyProfile).not.toHaveBeenCalled();
    expect(answerSystem().join('\n')).not.toContain('FIT RANKING');
  });

  it('the answer prompt is identical whether the flag is unset or on for someone else (allowlist)', async () => {
    await ask();
    const unset = answerMessagesJson();
    answerBodies = [];
    vi.stubEnv('ASK_MINDY_RECIPES', 'allowlist');
    vi.stubEnv('ASK_MINDY_RECIPES_ALLOWLIST', 'someone-else@example.com');
    await ask();
    expect(answerMessagesJson()).toBe(unset);
    expect(h.loadCompanyProfile).not.toHaveBeenCalled();
  });
});

describe('flag on', () => {
  beforeEach(() => { vi.stubEnv('ASK_MINDY_RECIPES', 'true'); });

  it('loads the profile only through the acting scope (never a raw email) and adds the ranking note', async () => {
    await ask();
    expect(h.loadCompanyProfile).toHaveBeenCalledTimes(1);
    expect(h.loadCompanyProfile.mock.calls[0][0]).toMatchObject({ kind: 'own', email: 'erika@example.com' });
    expect(typeof h.loadCompanyProfile.mock.calls[0][0]).toBe('object');
    const note = answerSystem().find((c) => c.startsWith('FIT RANKING'))!;
    expect(note).toBeTruthy();
    expect(note).toContain('1. Laboratory Staffing Services, Department of Veterans Affairs [Open now');
    expect(note).toContain('Never print a score.');
    expect(note).toContain('Could not be checked this turn (unavailable, not zero): Coming soon (forecast).');
  });

  it('labels a subcontract-route pick and never presents it as prime work', async () => {
    await ask();
    const note = answerSystem().find((c) => c.startsWith('FIT RANKING'))!;
    expect(note).toMatch(/HUBZone Clerical Support.*Why: Subcontract route: set aside for HUBZone, which you do not hold.*do not present this as work the company can bid as prime/);
  });

  it('keeps every tool result in the prompt (no second filter): the find result is still there unchanged in substance', async () => {
    await ask();
    expect(answerMessagesJson()).toContain('HUBZone Clerical Support');
    expect(answerMessagesJson()).toContain('Laboratory Staffing Services');
  });

  it('value first: a refused profile adds no note, and the answer is still given', async () => {
    h.loadCompanyProfile.mockResolvedValue({ status: 'refused', reason: 'workspace_unconfirmed' });
    const ev = await ask();
    expect(answerText(ev)).toContain('Here are the picks.');
    expect(answerSystem().join('\n')).not.toContain('FIT RANKING');
  });

  it('value first: a failed or hanging profile load never blocks the answer', async () => {
    h.loadCompanyProfile.mockRejectedValue(new Error('db down'));
    expect(answerText(await ask())).toContain('Here are the picks.');
    answerBodies = [];
    h.loadCompanyProfile.mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    expect(answerText(await ask())).toContain('Here are the picks.');
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(answerSystem().join('\n')).not.toContain('FIT RANKING');
  });

  it('no find_opportunities call this turn → no note', async () => {
    plannerCalls = [];
    await ask('What is a NAICS code?');
    expect(answerSystem().join('\n')).not.toContain('FIT RANKING');
  });
});

describe('route wiring (static)', () => {
  it('is gated on the flag and never runs in card chat', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
    expect(route).toMatch(/const fitRankingOn = !cardCtx && askMindyRecipesEnabledFor\(auth\.email\);/);
    expect(route).toMatch(/const fitProfileP = fitRankingOn \? loadCompanyProfile\(actingScope\)\.catch\(\(\) => null\) : null;/);
    expect(route).toMatch(/if \(fitProfileP && findResult\) \{/);
  });
});
