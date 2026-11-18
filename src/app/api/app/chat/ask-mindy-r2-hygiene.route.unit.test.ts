/**
 * Ask Mindy R2 hygiene — drives the REAL /api/app/chat handler with providers/tools mocked.
 *
 * Pins through the route:
 *  - clean multi-hop (seed → hop) runs two planner passes; R2 uses tool_choice:auto
 *  - R1 under OPP_INTENT still uses tool_choice:required
 *  - plain lookup / due-date questions skip the second planner pass
 *  - document-research hops after lookup are offered and execute
 *  - identical R2 calls are deduped; pagination (display_offset) is kept
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ME = 'pro@example.com';

type ToolCall = { id: string; function: { name: string; arguments: string } };
const state: {
  /** Each planner invocation consumes the next queue entry (empty → no tool_calls). */
  plannerQueue: ToolCall[][];
  plannerBodies: Array<Record<string, unknown>>;
  executed: string[][];
  executedArgs: Array<Record<string, unknown>>;
  offered: string[][];
} = {} as never;

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => true }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => null, formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => false, recordLlmUsage: async () => {} }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: async () => {} }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: () => {} }));
vi.mock('@/lib/chat/tier0-tools', () => ({ makeTier0Tools: () => ({ execute: async () => ({}) }), TIER0_TOOL_DEFS: [], TIER0_TOOL_NAMES: new Set() }));

const OFFERED = [
  'lookup_solicitation',
  'get_solicitation_incumbent',
  'search_past_contracts',
  'find_capable_contractors',
  'search_federal_contacts',
  'get_solicitation_documents',
  'find_opportunities',
  'search_sam_opportunities',
];

vi.mock('@/lib/chat/chat-tool-executor', () => ({
  createChatToolExecutor: () => ({
    offeredToolDefs: () => OFFERED.map((name) => ({
      type: 'function',
      function: { name, description: name, parameters: { type: 'object', properties: {} } },
    })),
    executeRound: async (calls: ToolCall[]) => {
      state.executed.push(calls.map((c) => c.function.name));
      for (const c of calls) {
        try {
          state.executedArgs.push({ tool: c.function.name, ...JSON.parse(c.function.arguments || '{}') });
        } catch {
          state.executedArgs.push({ tool: c.function.name });
        }
      }
      return calls.map((c) => ({
        tool_call_id: c.id,
        content: JSON.stringify({ ok: true, grounded: true, tool: c.function.name }),
        argsRedacted: {},
        record: { tool: c.function.name, status: 'success', execution_id: 'x' },
      }));
    },
    policyFor: () => ({ decision: 'allowed_read' }),
  }),
}));

function builder() {
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q; q.order = () => q; q.limit = () => q;
  q.update = () => ({ eq: async () => ({ error: null }) });
  q.insert = async () => ({ error: null });
  q.maybeSingle = async () => ({ data: null, error: null });
  return q;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => builder() }) }));

function sse(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) {
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
    c.close();
  } });
}

beforeEach(() => {
  Object.assign(state, {
    plannerQueue: [],
    plannerBodies: [],
    executed: [],
    executedArgs: [],
    offered: [],
  });
  vi.stubEnv('OPENAI_API_KEY', 'ok');
  vi.stubEnv('GROQ_API_KEY', 'gk');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as Record<string, unknown>;
    if (!b.stream) {
      state.plannerBodies.push(b);
      state.offered.push(((b.tools as Array<{ function?: { name?: string } }>) ?? []).map((t) => String(t.function?.name)));
      const calls = state.plannerQueue.shift() ?? [];
      return new Response(JSON.stringify({
        choices: [{ message: { content: null, tool_calls: calls.length ? calls : undefined } }],
        usage: { prompt_tokens: 100, completion_tokens: 5 },
      }), { status: 200 });
    }
    return new Response(sse('Review the records above.'), { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ask(message: string) {
  vi.resetModules();
  const { POST } = await import('./route');
  const res = await POST(new Request('https://getmindy.ai/api/app/chat', {
    method: 'POST',
    body: JSON.stringify({ email: ME, message }),
  }) as never);
  const raw = await res.text();
  const events = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
  return { status: res.status, raw, events };
}

function tc(name: string, args: Record<string, unknown>, id?: string): ToolCall {
  return { id: id || `c_${name}`, function: { name, arguments: JSON.stringify(args) } };
}

describe('R2 hygiene via chat route', () => {
  it('T4-shaped: incumbent seed → capable-contractors hop; R2 tool_choice is auto; R1 OPP_INTENT stays required', async () => {
    state.plannerQueue = [
      [tc('get_solicitation_incumbent', { solicitation: 'A031392' })],
      [tc('find_capable_contractors', { naics: '541512' })],
    ];
    const msg = 'Who held the previous contract for solicitation A031392 and which other companies compete with that incumbent';
    const { status, events } = await ask(msg);
    expect(status).toBe(200);
    expect(state.plannerBodies).toHaveLength(2);
    expect(state.plannerBodies[0].tool_choice).toBe('required'); // OPP_INTENT (solicitation/contract)
    expect(state.plannerBodies[1].tool_choice).toBe('auto');
    expect(state.executed).toEqual([
      ['get_solicitation_incumbent'],
      ['find_capable_contractors'],
    ]);
    expect(events.some((e) => e.type === 'token')).toBe(true);
  });

  it('T9-shaped: lookup → contacts hop executes on round 2', async () => {
    state.plannerQueue = [
      [tc('lookup_solicitation', { solicitation: 'FA480027Q0009' })],
      [tc('search_federal_contacts', { agency: 'Air Force' })],
    ];
    await ask('What is solicitation FA480027Q0009 about and who is the contact');
    expect(state.plannerBodies).toHaveLength(2);
    expect(state.plannerBodies[1].tool_choice).toBe('auto');
    expect(state.executed).toEqual([
      ['lookup_solicitation'],
      ['search_federal_contacts'],
    ]);
  });

  it('C-shaped: past contracts → buying-office contact hop', async () => {
    state.plannerQueue = [
      [tc('search_past_contracts', { keyword: 'snow removal', state: 'MA' })],
      [tc('search_federal_contacts', { keyword: 'snow' })],
    ];
    await ask('Past contracts for snow removal in MA, then the buying-office contact');
    expect(state.executed).toEqual([
      ['search_past_contracts'],
      ['search_federal_contacts'],
    ]);
  });

  it('T7-shaped plain due-date lookup: no second planner pass', async () => {
    state.plannerQueue = [
      [tc('lookup_solicitation', { solicitation: '36C24626B0031' })],
      [tc('get_solicitation_documents', { solicitation: '36C24626B0031' })], // would be harmful if offered
    ];
    await ask('What is solicitation 36C24626B0031 about and when is it due');
    expect(state.plannerBodies).toHaveLength(1);
    expect(state.executed).toEqual([['lookup_solicitation']]);
  });

  it('document-research hop after lookup is offered and executes', async () => {
    state.plannerQueue = [
      [tc('lookup_solicitation', { solicitation: 'FA480027Q0009' })],
      [tc('get_solicitation_documents', { solicitation: 'FA480027Q0009' })],
    ];
    await ask('Pull the SOW and attachments for solicitation FA480027Q0009');
    expect(state.plannerBodies).toHaveLength(2);
    expect(state.plannerBodies[1].tool_choice).toBe('auto');
    expect(state.executed).toEqual([
      ['lookup_solicitation'],
      ['get_solicitation_documents'],
    ]);
  });

  it('identical R2 call is deduped (no second executeRound); pagination offset is kept', async () => {
    state.plannerQueue = [
      [tc('search_past_contracts', { keyword: 'snow', state: 'MA', display_offset: 0 })],
      [tc('search_past_contracts', { keyword: 'snow', state: 'MA', display_offset: 0 })],
    ];
    await ask('Past contracts for snow in MA and the buying-office contact');
    // Offered (contact cue) but R2 only repeated the seed → deduped → single execute round
    expect(state.plannerBodies).toHaveLength(2);
    expect(state.executed).toEqual([['search_past_contracts']]);

    // Fresh turn: page-2 must execute
    Object.assign(state, { plannerQueue: [], plannerBodies: [], executed: [], executedArgs: [], offered: [] });
    state.plannerQueue = [
      [tc('search_past_contracts', { keyword: 'snow', state: 'MA', display_offset: 0 })],
      [tc('search_past_contracts', { keyword: 'snow', state: 'MA', display_offset: 10 })],
    ];
    await ask('Past contracts for snow in MA, then show the next page of contacts and awards');
    // "contacts" cue offers R2; page-2 past_contracts has different display_offset → kept
    expect(state.executed).toEqual([
      ['search_past_contracts'],
      ['search_past_contracts'],
    ]);
    expect(state.executedArgs[1]).toMatchObject({ display_offset: 10 });
  });

  it('already-complete R1 (contacts in round 1) skips second planner', async () => {
    state.plannerQueue = [
      [
        tc('lookup_solicitation', { solicitation: 'W912WJ26QA168' }, 'a'),
        tc('search_federal_contacts', { agency: 'Army' }, 'b'),
      ],
      [tc('find_capable_contractors', { naics: '541512' })],
    ];
    await ask('Lookup W912WJ26QA168 and the contacts for the buying office');
    expect(state.plannerBodies).toHaveLength(1);
    expect(state.executed).toEqual([['lookup_solicitation', 'search_federal_contacts']]);
  });

  it('map preamble alone must not buy R2 (hop cues stripped from view note)', async () => {
    state.plannerQueue = [
      [tc('lookup_solicitation', { solicitation: '36C24626B0031' })],
      [tc('search_federal_contacts', { agency: 'VA' })],
    ];
    await ask(
      '[Current map view \u2014 contacts for this NAICS; buying offices nearby. Answer for THIS view.]\n\nWhat is solicitation 36C24626B0031 about and when is it due',
    );
    expect(state.plannerBodies).toHaveLength(1);
    expect(state.executed).toEqual([['lookup_solicitation']]);
  });
});
