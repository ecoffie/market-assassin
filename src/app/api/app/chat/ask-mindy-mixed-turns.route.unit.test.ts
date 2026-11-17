/**
 * Ask Mindy mixed turns (audit A1, P1b): when one tool's records are rendered as a verified list and another
 * tool's result is not, the no-facts rule and the analysis lint apply to the rendered records only. The other
 * tool's findings, and any sentence saying a lookup failed, must reach the user.
 *
 * Drives the REAL route handler and the real tool executor; only auth, profile, telemetry, storage and the
 * providers are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  plannerResponse, answerStream, isPlannerCall, readSse, answerText, chatRequest, withinMs, type SseEvent,
} from './__fixtures__/route-harness';

const h = vi.hoisted(() => ({
  runMcpTool: vi.fn(),
  loadBidderProfile: vi.fn(async () => ({})),
  failCardTurn: vi.fn(async () => {}),
}));

vi.mock('@supabase/supabase-js', () => {
  // Every query resolves to "no row, no error"; writes succeed.
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
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: h.loadBidderProfile, formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: vi.fn(async () => false), recordLlmUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/mentioned-notice', () => ({ resolveMentionedNotice: vi.fn(async () => ({ status: 'none' })), answerUsesNotice: () => false }));
vi.mock('@/lib/chat/card-chat-turns', () => ({
  parseTurnId: (v: unknown) => (typeof v === 'string' ? v : null),
  claimCardTurn: vi.fn(), completeCardTurn: vi.fn(), failCardTurn: h.failCardTurn,
}));
vi.mock('@/lib/mcp/credits', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/credits')>()), logCall: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/tool-registry')>()), runMcpTool: h.runMcpTool }));

const ENV_KEYS = ['OPENAI_API_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};

type FetchPlan = {
  planner?: (init: RequestInit) => Promise<Response>;
  answer?: (init: RequestInit) => Promise<Response>;
};
let plan: FetchPlan = {};
const fetchCalls: Array<{ kind: 'planner' | 'answer'; body: Record<string, unknown> }> = [];

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'sk-test';
  fetchCalls.length = 0;
  plan = {};
  h.runMcpTool.mockReset();
  h.runMcpTool.mockImplementation(async (name: string) => ({ result: TOOL_RESULTS[name] ?? { ok: true }, credits: 0 }));
  h.loadBidderProfile.mockReset();
  h.loadBidderProfile.mockResolvedValue({});
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    const kind = isPlannerCall(body) ? 'planner' : 'answer';
    fetchCalls.push({ kind, body });
    const handler = kind === 'planner' ? plan.planner : plan.answer;
    if (handler) return handler(init);
    return kind === 'planner' ? plannerResponse([]) : answerStream(['Hello ', 'there.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function ask(message: string, extra: Record<string, unknown> = {}): Promise<SseEvent[]> {
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await POST(chatRequest({ message, ...extra }) as any);
  return withinMs(readSse(res), 5000, 'chat stream');
}

const types = (ev: SseEvent[]) => ev.map((e) => e.type);

const PIID = '36C24927C0001';
const EXPIRING = {
  contracts: [{
    contract_id: `CONT_${PIID}`, piid: PIID, incumbent_name: 'ALLPRO STAFFNET LLC', awarding_agency: 'Department of Veterans Affairs',
    awarding_sub_agency: null, place_of_performance_city: 'MEMPHIS', place_of_performance_state: 'TN',
    period_of_performance_current_end: '2027-02-03', total_obligation: 123456.7, description: 'temporary laboratory staffing',
  }],
  _meta: {
    grounded: true, degraded: false, result_state: 'results', ignored_args: [], total: 1,
    applied_filters: { naics: ['561320'], months_window: 18 },
    window: { after: '2026-11-14', through: '2028-05-14', as_of: '2026-11-14', months: 18 },
  },
};
const AGENCY = { ok: true, agency: 'Department of Energy', pain_points: ['grid modernization'], _meta: { grounded: true, degraded: false, result_state: 'known', ignored_args: [] } };
const TOOL_RESULTS: Record<string, unknown> = { get_expiring_contracts: EXPIRING, get_agency_intel: AGENCY };

const MIXED_PLAN = () => plannerResponse([
  { name: 'get_expiring_contracts', args: { naics: '561320' }, id: 'exp' },
  { name: 'get_agency_intel', args: { agency: 'Department of Energy' }, id: 'intel' },
]);
const Q = 'Expiring staffing contracts for 561320, and what are the Department of Energy pain points?';

describe('A1: a mixed turn keeps the unrendered results', () => {
  it('the unrendered tool\'s facts reach the user, with digits, and the marker is never shown', async () => {
    plan.planner = async () => MIXED_PLAN();
    plan.answer = async () => answerStream(['The Department of Energy lists grid modernization as its top priority for 2026.\n', 'NEXT STEPS:\n', 'Open each listed record\'s description before contacting the incumbent.']);
    const ev = await ask(Q);
    const text = answerText(ev);
    expect(text).toContain(PIID); // the verified list is still rendered
    expect(text).toContain('The Department of Energy lists grid modernization as its top priority for 2026.');
    expect(text).toContain('Open each listed record\'s description before contacting the incumbent.');
    expect(text).not.toMatch(/NEXT STEPS/);
    expect(text.split(PIID).length - 1).toBe(1); // the record is shown once
  });

  it('a failed unrendered lookup is reported in the answer, not deleted', async () => {
    h.runMcpTool.mockImplementation(async (name: string) => {
      if (name === 'get_agency_intel') throw new Error('upstream down');
      return { result: TOOL_RESULTS[name], credits: 0 };
    });
    plan.planner = async () => MIXED_PLAN();
    plan.answer = async () => answerStream(['The Department of Energy lookup was unavailable for this question, so I cannot list its pain points.\nNEXT STEPS:\nReview the record above.']);
    const ev = await ask(Q);
    expect(answerText(ev)).toContain('The Department of Energy lookup was unavailable for this question');
  });

  it('without the marker, unrendered facts are kept and a sentence restating a rendered record is removed', async () => {
    plan.planner = async () => MIXED_PLAN();
    plan.answer = async () => answerStream([`The Department of Energy lists grid modernization for 2026. Contract ${PIID} ends 2027-02-03 and is worth $123,457.`]);
    const ev = await ask(Q);
    const text = answerText(ev);
    expect(text).toContain('The Department of Energy lists grid modernization for 2026.');
    expect(text).not.toContain('is worth $123,457');
    expect(text.split(PIID).length - 1).toBe(1);
  });

  it('a count in part 1 about the other lookup is not "corrected" against the rendered list', async () => {
    plan.planner = async () => MIXED_PLAN();
    plan.answer = async () => answerStream(['The Department of Energy has 12 awards tied to grid modernization.\nNEXT STEPS:\nReview the record above.']);
    const ev = await ask(Q);
    expect(answerText(ev)).toContain('12 awards tied to grid modernization');
    expect(answerText(ev)).not.toContain('Count check');
  });

  it('the answer model is told which results were not shown, and the no-facts rule names only the rendered lists', async () => {
    plan.planner = async () => MIXED_PLAN();
    await ask(Q);
    const answerBody = fetchCalls.find((c) => c.kind === 'answer')!.body;
    const note = (answerBody.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'system' && m.content.startsWith('VERIFIED RECORD LIST'))!.content;
    expect(note).toContain('NOT shown to the user: get_agency_intel');
    expect(note).toContain('NEXT STEPS:');
  });
});

describe('unchanged: a turn where every result was rendered', () => {
  it('uses the deterministic next steps and never shows the model\'s closing', async () => {
    plan.planner = async () => plannerResponse([{ name: 'get_expiring_contracts', args: { naics: '561320' } }]);
    plan.answer = async () => answerStream(['You have 1 record worth $123,457. Great market!']);
    const ev = await ask('Expiring staffing contracts for 561320');
    const text = answerText(ev);
    expect(text).toContain(PIID);
    expect(text).not.toContain('Great market');
    expect(text).toContain('Open each listed record\'s description to confirm it matches your work before contacting the incumbent.');
    const note = ((fetchCalls.find((c) => c.kind === 'answer')!.body.messages) as Array<{ role: string; content: string }>).find((m) => m.content?.startsWith?.('VERIFIED RECORD LIST'))!.content;
    expect(note).toMatch(/^VERIFIED RECORD LIST: the records below were rendered/);
  });

  it('a turn with no rendered list streams the model answer unchanged', async () => {
    plan.planner = async () => plannerResponse([{ name: 'get_agency_intel', args: { agency: 'Department of Energy' } }]);
    plan.answer = async () => answerStream(['DOE lists grid modernization for 2026.']);
    const ev = await ask('What are the Department of Energy pain points?');
    expect(answerText(ev)).toBe('DOE lists grid modernization for 2026.');
    expect(types(ev).at(-1)).toBe('done');
  });
});
