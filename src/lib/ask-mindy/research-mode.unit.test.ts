/**
 * Research mode engine (ASK_MINDY_RESEARCH_MODE). The loop is Claude's; these tests pin the harness: limits, full
 * results, parallel calls, the final no-tools step, the figure check, and tool parity with the MCP catalog.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  researchModeEnabledFor, toAnthropicTools, runResearchLoop, groundAnswer, fullResult, progressLine, researchSystemPrompt,
  RESEARCH_INSTRUCTIONS, RESEARCH_WITHHELD_TOOLS, RESULT_CEILING_CHARS, FINAL_RESERVE_MS, researchToolDefs, stripLiveSamArgs,
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
      exceptions[f.name] = RESEARCH_WITHHELD_TOOLS.has(f.name) ? 'withheld: live SAM (Eric, zero live SAM calls) until it has a cache-only mode'
        : !isChatOfferable(policy) ? `chat policy: ${policy.decision}` : 'UNEXPLAINED';
    }
    expect(Object.entries(exceptions).filter(([, why]) => why === 'UNEXPLAINED')).toEqual([]);
    expect(exceptions.lookup_sam_entity).toMatch(/withheld: live SAM/);
    expect(byName.has('search_web')).toBe(true);
    // The other direction: nothing outside the public catalog except Ask Mindy's private tools.
    const pub = new Set(listPublicMcpTools().map((d) => fn(d).name));
    expect(research.map((t) => t.name).filter((n) => !pub.has(n))).toEqual(['search_web']);
  });
});

describe('zero live SAM in research mode', () => {
  it('every tool Data Core traced to live SAM is withheld', () => {
    for (const t of ['lookup_sam_entity', 'get_contractor_award_history', 'get_solicitation_incumbent', 'get_solicitation_documents', 'match_company_to_pathways']) expect(RESEARCH_WITHHELD_TOOLS.has(t), t).toBe(true);
  });
  it('find_opportunities runs without the uei that would start its live company anchor', () => {
    expect(stripLiveSamArgs('find_opportunities', { query: 'x', uei: 'ABC123DEF456' })).toEqual({ input: { query: 'x' }, dropped: ['uei'] });
    expect(stripLiveSamArgs('find_opportunities', { query: 'x' })).toEqual({ input: { query: 'x' }, dropped: [] });
    expect(stripLiveSamArgs('search_contractors', { keyword: 'x', uei: 'u' }).dropped).toEqual([]);
  });
});
