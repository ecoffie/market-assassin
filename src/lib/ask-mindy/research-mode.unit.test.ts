/**
 * Research mode engine (ASK_MINDY_RESEARCH_MODE). The loop is Claude's; these tests pin the harness: limits, full
 * results, parallel calls, the final no-tools step, the figure check, and tool parity with the MCP catalog.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  researchModeEnabledFor, toAnthropicTools, runResearchLoop, wantsReport, RESEARCH_SYNTHESIS_AT_CALLS, groundAnswer, fullResult, progressLine, researchSystemPrompt,
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
    expect(JSON.stringify(last.messages[last.messages.length - 1].content)).toMatch(/Research is complete/);
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
    expect(RESEARCH_INSTRUCTIONS).toMatch(/check abilityone\.gov yourself/);
  });
});

describe('the writing budget (Eric: 30 calls of breadth and no report)', () => {
  const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => toolUse(`${prefix}${i}`, 'find_opportunities'));
  it('research stops at 24 calls and the answer is written, decision first, with no process talk asked for', async () => {
    let step = 0;
    const create = vi.fn(async (body: { tool_choice: { type: string } }) => (body.tool_choice.type === 'none' ? msg([text('The answer.')], 'end_turn') : msg(many(4, `s${++step}-`), 'tool_use')));
    const r = await runResearchLoop({ ...base, client: { messages: { create } } as never, execute: async (cs) => cs.map((c) => ({ id: c.id, content: 'ok' })) });
    expect(RESEARCH_SYNTHESIS_AT_CALLS).toBe(24);
    expect(r.calls).toBe(24);
    expect(r.stop).toBe('max_calls');
    const final = (create.mock.calls.at(-1) as never[])[0] as { messages: Array<{ content: Array<{ text?: string }> }> };
    const note = JSON.stringify(final.messages[final.messages.length - 1].content);
    expect(note).toMatch(/decision first/);
    expect(note).toMatch(/Do not describe your process or list what you did not do/);
    expect(note).not.toMatch(/could not finish/);
  });
  it('research stops at 80% of the deadline even with calls left', async () => {
    let t = 0;
    const create = vi.fn(async (body: { tool_choice: { type: string } }) => (body.tool_choice.type === 'none' ? msg([text('Written.')], 'end_turn') : msg([toolUse(`a${t}`, 'find_opportunities')], 'tool_use')));
    const r = await runResearchLoop({ ...base, client: { messages: { create } } as never, now: () => t, deadlineMs: 1_000_000, execute: async (cs) => { t += 300_000; return cs.map((c) => ({ id: c.id, content: 'ok' })); } });
    expect(r).toMatchObject({ stop: 'deadline', text: 'Written.' });
    expect(r.calls).toBe(3);
  });
  const isReportStep = (body: { tool_choice: { type: string; disable_parallel_tool_use?: boolean } }) => body.tool_choice.type === 'auto' && body.tool_choice.disable_parallel_tool_use === true;
  it('asked for a report: a run that hits the limit still writes the report document, then the answer (tool_choice auto, never forced)', async () => {
    const create = vi.fn(async (body: { tool_choice: { type: string; disable_parallel_tool_use?: boolean }; max_tokens: number }) => {
      if (isReportStep(body)) return msg([toolUse('doc1', 'create_document', { doc_model: { title: 'Assessment' } }), toolUse('x', 'find_opportunities')], 'tool_use');
      if (body.tool_choice.type === 'none') return msg([text('Here is the decision. The report is ready.')], 'end_turn');
      return msg(many(3, `r${create.mock.calls.length}-`), 'tool_use');
    });
    const executed: string[] = [];
    const r = await runResearchLoop({ ...base, client: { messages: { create } } as never, maxCalls: 6, reportTool: 'create_document', execute: async (cs) => { executed.push(...cs.map((c) => c.name)); return cs.map((c) => ({ id: c.id, content: 'ok' })); } });
    const bodies = create.mock.calls.map((c) => (c as never[])[0] as { tool_choice: { type: string; disable_parallel_tool_use?: boolean }; max_tokens: number; messages: Array<{ content: unknown }> });
    expect(bodies.slice(-2).map((b) => b.tool_choice)).toEqual([{ type: 'auto', disable_parallel_tool_use: true }, { type: 'none' }]);
    const reportStep = bodies.find(isReportStep)!;
    expect(reportStep.max_tokens).toBe(32_000);
    expect(JSON.stringify(reportStep.messages[reportStep.messages.length - 1].content)).toMatch(/Call create_document now, once, with the full report\. Call no other tool\./);
    expect(executed.filter((n) => n === 'create_document')).toHaveLength(1);
    expect(executed.at(-1)).toBe('create_document'); // the extra find_opportunities in the report step is not run
    expect(r.text).toBe('Here is the decision. The report is ready.');
  });
  it('the research model only accepts auto or none: no request ever forces a tool', async () => {
    const create = vi.fn(async (body: { tool_choice: { type: string } }) => (body.tool_choice.type === 'none' ? msg([text('A.')], 'end_turn') : msg(many(4, `q${create.mock.calls.length}-`), 'tool_use')));
    await runResearchLoop({ ...base, client: { messages: { create } } as never, maxCalls: 8, reportTool: 'create_document', execute: async (cs) => cs.map((c) => ({ id: c.id, content: 'ok' })) });
    for (const c of create.mock.calls) expect(['auto', 'none']).toContain(((c as never[])[0] as { tool_choice: { type: string } }).tool_choice.type);
  });
  it('a report step that does not call the report tool degrades to the answer, never an error', async () => {
    const create = vi.fn(async (body: { tool_choice: { type: string; disable_parallel_tool_use?: boolean } }) => {
      if (isReportStep(body)) return msg([toolUse('w', 'search_web', { query: 'x' })], 'tool_use');
      if (body.tool_choice.type === 'none') return msg([text('The decision, without a document.')], 'end_turn');
      return msg(many(2, `p${create.mock.calls.length}-`), 'tool_use');
    });
    const executed: string[] = [];
    const r = await runResearchLoop({ ...base, client: { messages: { create } } as never, maxCalls: 2, reportTool: 'create_document', execute: async (cs) => { executed.push(...cs.map((c) => c.name)); return cs.map((c) => ({ id: c.id, content: 'ok' })); } });
    expect(executed).not.toContain('search_web');
    expect(r.text).toBe('The decision, without a document.');
  });
  it('a report already written before the limit is not forced again', async () => {
    let step = 0;
    const create = vi.fn(async (body: { tool_choice: { type: string } }) => {
      if (body.tool_choice.type === 'none') return msg([text('Done.')], 'end_turn');
      step++;
      return step === 1 ? msg([toolUse('d', 'create_document')], 'tool_use') : msg(many(3, `z${step}-`), 'tool_use');
    });
    await runResearchLoop({ ...base, client: { messages: { create } } as never, maxCalls: 4, reportTool: 'create_document', execute: async (cs) => cs.map((c) => ({ id: c.id, content: 'ok' })) });
    expect(create.mock.calls.some((c) => ((c as never[])[0] as { tool_choice: { disable_parallel_tool_use?: boolean } }).tool_choice.disable_parallel_tool_use === true)).toBe(false);
  });
});

describe('report requests', () => {
  it('a full assessment or report on a company is a report request; a question is not', () => {
    expect(wantsReport('Full company assessment and report for Ridgeline Digital')).toBe(true);
    expect(wantsReport('Create a capability statement for us')).toBe(true);
    expect(wantsReport('What janitorial bids are open in Florida?')).toBe(false);
  });
});

describe('decision, not findings (Eric, 2026-11-25)', () => {
  it('plan before calling; read before recommending; decision-first report; no process talk; gaps only as risks', () => {
    expect(RESEARCH_INSTRUCTIONS).toMatch(/0\. PLAN BEFORE CALLING/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/Never recommend or cite an item you have not opened/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/REPORT = A DECISION, NOT FINDINGS/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/the 3 ranked moves/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/No process talk/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/under Risks, at most 3/);
    expect(RESEARCH_INSTRUCTIONS).not.toMatch(/what you could not finish/);
  });
  it('AbilityOne is a mandatory source a set-aside does not override; agencies are named from the award record', () => {
    expect(RESEARCH_INSTRUCTIONS).toMatch(/a small-business set-aside does not override that/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/awarding agency and funding agency fields, never from an office code or a city/);
  });
});

describe('the writing budget is exact (acceptance: 25 and 28 calls)', () => {
  it('a 6-call step at 22 calls runs only 2; the other 4 get "Not run"; the total is 24', async () => {
    let step = 0;
    const create = vi.fn(async (body: { tool_choice: { type: string } }) => {
      if (body.tool_choice.type === 'none') return msg([text('Done.')], 'end_turn');
      step++;
      const n = step <= 11 ? 2 : 6; // 11 steps x 2 = 22, then one step asking for 6
      return msg(Array.from({ length: n }, (_, i) => toolUse(`s${step}-${i}`, 'find_opportunities')), 'tool_use');
    });
    const batches: number[] = [];
    const r = await runResearchLoop({ ...base, client: { messages: { create } } as never, execute: async (cs) => { batches.push(cs.length); return cs.map((c) => ({ id: c.id, content: 'ok' })); } });
    expect(batches.at(-1)).toBe(2);
    expect(r.calls).toBe(24);
    const final = (create.mock.calls.at(-1) as never[])[0] as { messages: Array<{ role: string; content: Array<{ content?: string }> }> };
    const results = final.messages.filter((m) => m.role === 'user').at(-1)!.content;
    expect(results.filter((b) => String(b.content).startsWith('Not run'))).toHaveLength(4);
  });
});

describe('a named company is researched even when the saved profile is a different company', () => {
  it('the mismatch is one line in Sources & coverage, never the opening', () => {
    expect(RESEARCH_INSTRUCTIONS).toMatch(/A company named in the question is the company to research, even when it differs from the saved company profile/);
    expect(RESEARCH_INSTRUCTIONS).toMatch(/only as one line in "Sources & coverage", never at the start of the answer/);
  });
});
