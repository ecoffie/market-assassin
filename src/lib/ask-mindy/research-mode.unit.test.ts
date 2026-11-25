/**
 * Research mode engine (ASK_MINDY_RESEARCH_MODE). The loop is Claude's; these tests pin the harness: limits, full
 * results, parallel calls, the final no-tools step, the figure check, and tool parity with the MCP catalog.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  researchModeEnabledFor, toAnthropicTools, runResearchLoop, billedInputTokens, describeResearchError, groundAnswer, fullResult, progressLine, researchSystemPrompt,
  RESEARCH_INSTRUCTIONS, RESEARCH_WITHHELD_TOOLS, RESEARCH_EXTRA_TOOLS, RESULT_CEILING_CHARS, FINAL_RESERVE_MS, researchToolDefs,
} from './research-mode';
import { MCP_CONNECTOR_INSTRUCTIONS } from '@/lib/mcp/schedule-discovery';
import { listPublicMcpTools } from '@/lib/mcp/public-catalog';
import { createChatToolExecutor } from '@/lib/chat/chat-tool-executor';
import { SEARCH_WEB_TOOL_DEF, SEARCH_WEB } from '@/lib/chat/search-web-tool';
import { chatToolPolicy, isChatOfferable } from '@/lib/chat/chat-tool-policy';

type Block = Record<string, unknown>;
const msg = (content: Block[], stop: string) => ({ content, stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } });
const toolUse = (id: string, name: string, input: Block = {}) => ({ type: 'tool_use', id, name, input });
const text = (t: string) => ({ type: 'text', text: t });
const scripted = (replies: Array<ReturnType<typeof msg>>) => {
  const create = vi.fn(async () => replies.length > 1 ? replies.shift()! : replies[0]);
  return { client: { messages: { create } } as never, create };
};
const base = { model: 'm', system: 's', conversation: [{ role: 'user' as const, content: 'Assess Ridgeline Digital.' }], tools: [{ name: 'find_opportunities', description: 'd', input_schema: { type: 'object' } }] };

describe('flag', () => {
  it('is off by default and on only for the allowlist', () => {
    expect(researchModeEnabledFor('a@b.com', {})).toBe(false);
    expect(researchModeEnabledFor('a@b.com', { ASK_MINDY_RESEARCH_MODE: 'true' })).toBe(false);
    expect(researchModeEnabledFor('a@b.com', { ASK_MINDY_RESEARCH_MODE: 'true', ASK_MINDY_RESEARCH_MODE_ALLOWLIST: 'a@b.com' })).toBe(true);
  });
});

describe('the loop is Claude\'s: call, read, call again, then answer', () => {
  it('parallel tool calls in one step run as one batch; full results go back; the final text is the answer', async () => {
    const { client, create } = scripted([
      msg([text('Checking two things.'), toolUse('t1', 'find_opportunities', { query: 'x' }), toolUse('t2', 'search_web', { query: 'y' })], 'tool_use'),
      msg([text('Here is the decision.')], 'end_turn'),
    ]);
    const execute = vi.fn(async (cs: Array<{ id: string }>) => cs.map((c) => ({ id: c.id, content: `result ${c.id}` })));
    const r = await runResearchLoop({ ...base, client, execute });
    expect(execute).toHaveBeenCalledTimes(1);
    expect((execute.mock.calls[0] as never[])[0]).toHaveLength(2);
    const second = (create.mock.calls[1] as never[])[0] as { messages: Array<{ role: string; content: Block[] }> };
    const results = second.messages[second.messages.length - 1].content;
    expect(results.map((b) => b.content)).toEqual(['result t1', 'result t2']);
    expect(r).toMatchObject({ text: 'Here is the decision.', stop: 'done', calls: 2, steps: 2 });
    expect(r.evidence).toEqual(expect.arrayContaining(['result t1', 'result t2']));
  });

  it('the intermediate "thinking out loud" text is never the answer', async () => {
    const { client } = scripted([msg([text('Let me look.'), toolUse('t1', 'find_opportunities')], 'tool_use'), msg([text('Final.')], 'end_turn')]);
    const r = await runResearchLoop({ ...base, client, execute: async (cs) => cs.map((c) => ({ id: c.id, content: 'ok' })) });
    expect(r.text).toBe('Final.');
  });

  it('the call cap: calls beyond it are not run, then one final step with tools disabled answers', async () => {
    const { client, create } = scripted([
      msg([toolUse('a', 'find_opportunities'), toolUse('b', 'find_opportunities')], 'tool_use'),
      msg([toolUse('c', 'find_opportunities'), toolUse('d', 'find_opportunities')], 'tool_use'),
      msg([text('Answer from what I have.')], 'end_turn'),
    ]);
    const execute = vi.fn(async (cs: Array<{ id: string }>) => cs.map((c) => ({ id: c.id, content: 'ok' })));
    const r = await runResearchLoop({ ...base, client, execute, maxCalls: 3 });
    expect(r.calls).toBe(3);
    expect((execute.mock.calls[1] as never[])[0]).toHaveLength(1);
    const last = (create.mock.calls[2] as never[])[0] as { tool_choice: { type: string }; messages: Array<{ content: Block[] }> };
    expect(last.tool_choice).toEqual({ type: 'none' });
    expect(JSON.stringify(last.messages[last.messages.length - 1].content)).toMatch(/tool-call limit/);
    expect(JSON.stringify(last.messages[last.messages.length - 1].content)).toMatch(/Not run: the tool-call limit/);
    expect(r.stop).toBe('max_calls');
    expect(r.text).toBe('Answer from what I have.');
  });

  it('onFinalStep fires once when a limit forces the final answer (the "writing" phase)', async () => {
    const { client } = scripted([msg([toolUse('a', 'find_opportunities')], 'tool_use'), msg([text('Done.')], 'end_turn')]);
    const onFinalStep = vi.fn();
    await runResearchLoop({ ...base, client, maxCalls: 1, onFinalStep, execute: async (cs) => cs.map((c) => ({ id: c.id, content: 'ok' })) });
    expect(onFinalStep).toHaveBeenCalledTimes(1);
    expect(onFinalStep).toHaveBeenCalledWith('max_calls');
  });

  it('the deadline: once less than the final reserve is left, the next step answers with tools disabled', async () => {
    let t = 0;
    const { client, create } = scripted([msg([toolUse('a', 'find_opportunities')], 'tool_use'), msg([text('Partial answer.')], 'end_turn')]);
    const r = await runResearchLoop({ ...base, client, now: () => t, deadlineMs: FINAL_RESERVE_MS + 10_000, execute: async (cs) => { t += 20_000; return cs.map((c) => ({ id: c.id, content: 'ok' })); } });
    expect(((create.mock.calls[1] as never[])[0] as { tool_choice: { type: string } }).tool_choice).toEqual({ type: 'none' });
    expect(r).toMatchObject({ stop: 'deadline', text: 'Partial answer.' });
  });

  it('a model that returns nothing is no_answer (the route then says so plainly)', async () => {
    const { client } = scripted([msg([], 'end_turn')]);
    expect((await runResearchLoop({ ...base, client, execute: async () => [] })).stop).toBe('no_answer');
  });
});

describe('full results', () => {
  it('a result is passed whole up to the ceiling; beyond it the cut is marked, never silent', () => {
    expect(fullResult('x'.repeat(1000))).toEqual({ content: 'x'.repeat(1000), cut: 0 });
    const big = fullResult('y'.repeat(RESULT_CEILING_CHARS + 5));
    expect(big.cut).toBe(5);
    expect(big.content).toMatch(/\[\.\.\. 5 more characters of this result were not shown\]$/);
  });
});

describe('figure check after the loop (#2442 on research answers)', () => {
  it('an untraceable figure triggers one revision; a clean revision is used without disclosure', async () => {
    const revise = vi.fn(async () => 'The contract is worth $1.2M.');
    const r = await groundAnswer({ text: 'The contract is worth $4.2M.', evidence: ['obligated $1.2M'], revise });
    expect(revise).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ text: 'The contract is worth $1.2M.', revised: true, disclosed: false, untraceable: ['$4.2M'] });
  });
  it('still untraceable after revision: the answer opens with the disclosure naming the figure', async () => {
    const r = await groundAnswer({ text: 'Worth $4.2M.', evidence: ['obligated $1.2M'], revise: async () => 'Worth $4.2M.' });
    expect(r.disclosed).toBe(true);
    expect(r.text.split('\n')[0]).toMatch(/^I could not fully verify this answer/);
    expect(r.text).toContain('These figures could not be traced to the data: $4.2M.');
  });
  it('a grounded answer is untouched', async () => {
    const revise = vi.fn();
    expect(await groundAnswer({ text: 'Worth $1.2M.', evidence: ['obligated $1.2M'], revise })).toMatchObject({ text: 'Worth $1.2M.', revised: false, disclosed: false });
    expect(revise).not.toHaveBeenCalled();
  });
});

describe('instructions', () => {
  it('the system prompt is the MCP connector instructions verbatim, then the research spec and the output standard', () => {
    const sys = researchSystemPrompt({ today: '2026-11-25' });
    expect(sys.startsWith(MCP_CONNECTOR_INSTRUCTIONS)).toBe(true);
    expect(sys).toContain('IDENTITY FIRST');
    expect(sys).toContain('No homework');
    expect(sys).toContain('Lead with the decision');
  });
  it('buyer problems come from cited sources; reported officers are worded as reported and verified', () => {
    expect(RESEARCH_INSTRUCTIONS).toMatch(/LEGACY_MANUAL or unsourced is a hypothesis to verify, never evidence/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/strategic plans and budget justifications on the agency's own site/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/officers as reported to USASpending/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/none_reported does not mean the company has no leaders/);
  });
  it('registration facts carry the SAM record date in plain words; never "go check SAM.gov"', () => {
    expect(RESEARCH_INSTRUCTIONS).toMatch(/say the date of Mindy's SAM registration record in plain words/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/never tell the customer to go check SAM\.gov/);
  });
  it('the spec is generic: no reference-case company, person or identifier', () => {
    expect(RESEARCH_INSTRUCTIONS).not.toMatch(/\bEFS\b|Norwich|Colon|X6PKH4P1T124|UConn/i);
  });
  it('progress lines are plain words, no tool names', () => {
    expect(progressLine('Contractor award history (USASpending)')).toBe('Checking contractor award history.');
  });
});

describe('tool parity with the MCP catalog', () => {
  const fn = (d: Record<string, unknown>) => (d as { function: { name: string; description?: string; parameters?: unknown } }).function;
  it('every public MCP tool is offered with its description and schema unchanged, or is a listed, justified exception', () => {
    const executor = createChatToolExecutor({ userEmail: 'a@b.com', tier0: { defs: [SEARCH_WEB_TOOL_DEF as never], names: new Set([SEARCH_WEB]), execute: async () => ({}) } });
    const research = toAnthropicTools(researchToolDefs(executor.offeredToolDefs(), new Set([SEARCH_WEB])));
    const byName = new Map(research.map((t) => [t.name, t]));
    const exceptions: Record<string, string> = {};
    for (const raw of listPublicMcpTools()) {
      const f = fn(raw);
      const t = byName.get(f.name);
      if (t) {
        expect(t.description, f.name).toBe(f.description ?? '');
        expect(t.input_schema, f.name).toEqual(f.parameters ?? { type: 'object', properties: {} });
        continue;
      }
      const policy = chatToolPolicy(f.name, true);
      exceptions[f.name] = RESEARCH_WITHHELD_TOOLS.has(f.name) ? 'withheld (regression list)'
        : !isChatOfferable(policy) ? `chat policy: ${policy.decision}` : 'UNEXPLAINED';
    }
    expect(Object.entries(exceptions).filter(([, why]) => why === 'UNEXPLAINED')).toEqual([]);
    expect(byName.has('search_web')).toBe(true);
    // The other direction: nothing outside the public catalog except Ask Mindy's private tools.
    const pub = new Set(listPublicMcpTools().map((d) => fn(d).name));
    expect(research.map((t) => t.name).filter((n) => !pub.has(n)).sort()).toEqual(['get_buying_offices', 'search_web']);
    for (const n of ['lookup_sam_entity', 'get_contractor_award_history', 'get_solicitation_incumbent', 'get_solicitation_documents', 'find_opportunities']) expect(byName.has(n), n).toBe(true);
    expect([...RESEARCH_EXTRA_TOOLS]).toEqual(['get_buying_offices']);
  });
});

describe('zero live SAM in research mode (samCacheOnly, #2458)', () => {
  it('nothing is withheld: every SAM-backed tool runs cache-only under the context flag', () => {
    expect([...RESEARCH_WITHHELD_TOOLS]).toEqual([]);
  });
  it('the instructions fill gaps from official public sources and settle AbilityOne themselves', () => {
    expect(RESEARCH_INSTRUCTIONS).toMatch(/official public source with search_web and read_web_page/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/AbilityOne Procurement List, check abilityone\.gov yourself/);
  });
});

describe('prompt caching (766K input tokens on one answer)', () => {
  it('system prompt and tool definitions are cache breakpoints; exactly one moving breakpoint on the newest message; history is never mutated', async () => {
    const { client, create } = scripted([
      msg([toolUse('t1', 'find_opportunities')], 'tool_use'),
      msg([toolUse('t2', 'find_opportunities')], 'tool_use'),
      msg([text('Done.')], 'end_turn'),
    ]);
    const tools = [{ name: 'a', description: 'd', input_schema: { type: 'object' } }, { name: 'find_opportunities', description: 'd', input_schema: { type: 'object' } }];
    await runResearchLoop({ ...base, tools, client, execute: async (cs) => cs.map((c) => ({ id: c.id, content: 'r' })) });
    for (const call of create.mock.calls) {
      const body = (call as never[])[0] as { system: Array<{ cache_control?: unknown }>; tools: Array<{ cache_control?: unknown }>; messages: Array<{ content: unknown }> };
      expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(body.tools.map((t) => !!t.cache_control)).toEqual([false, true]);
      const marks = JSON.stringify(body.messages).match(/"cache_control"/g) ?? [];
      expect(marks).toHaveLength(1);
      const last = body.messages[body.messages.length - 1].content as Array<{ cache_control?: unknown }>;
      expect(last[last.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    }
  });
  it('cache reads and writes are counted and priced (reads 0.1x, writes 1.25x)', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 9000, cache_creation_input_tokens: 400 } }));
    const r = await runResearchLoop({ ...base, client: { messages: { create } } as never, execute: async () => [] });
    expect(r.usage).toEqual({ input: 100, output: 10, cacheRead: 9000, cacheWrite: 400 });
    expect(billedInputTokens(r.usage)).toBe(100 + 900 + 500);
  });
  it('modelled on an EFS-sized run (24 steps, 30k system+tools, ~8k new per step): billed input falls by over 75%', () => {
    const steps = 24, fixed = 30_000, perStep = 8_000;
    let before = 0, after = 0, prefix = fixed;
    for (let i = 0; i < steps; i++) {
      const prompt = prefix + (i === 0 ? 0 : perStep);
      before += prompt;
      after += i === 0 ? fixed * 1.25 : prefix * 0.1 + perStep * 1.25;
      prefix = prompt;
    }
    expect(after / before).toBeLessThan(0.25);
  });
});

describe('a failed research turn keeps its cost and its cause', () => {
  const creditError = () => Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'), {
    status: 400, error: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } },
  });
  it('the thrown error carries the usage, steps and calls accrued before it', async () => {
    let n = 0;
    const create = vi.fn(async () => {
      if (++n === 1) return { content: [toolUse('t1', 'find_opportunities')], stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 40, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 } };
      throw creditError();
    });
    const err = await runResearchLoop({ ...base, client: { messages: { create } } as never, execute: async (cs) => cs.map((c) => ({ id: c.id, content: 'ok' })) }).catch((e) => e);
    const d = describeResearchError(err);
    expect(d.class).toBe('credit_balance_too_low');
    expect(d.status).toBe(400);
    expect(d.message).toMatch(/credit balance is too low/);
    expect(d.progress).toEqual({ usage: { input: 500, output: 40, cacheRead: 2000, cacheWrite: 100 }, steps: 1, calls: 1 });
  });
  it('other provider errors keep their own type; a plain error its name', () => {
    expect(describeResearchError(Object.assign(new Error('529 overloaded'), { status: 529, error: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }))).toMatchObject({ class: 'overloaded_error', status: 529, message: 'Overloaded' });
    expect(describeResearchError(new TypeError('boom'))).toMatchObject({ class: 'TypeError', status: null, message: 'boom', progress: null });
  });
});
