/** B2 unit tests: bounded tool results, tool-offer guard, answer chain, customer-safe messages. */
import { describe, it, expect } from 'vitest';
import { boundToolResult, perResultBudget, MIN_PER_RESULT_CHARS } from './bound-tool-result';
import { filterToolsForQuestion, isOpenOpportunityQuestion } from './tool-selection';
import { resolveAnswerChain } from './planner-config';
import { CUSTOMER_ERROR_MESSAGES } from './customer-errors';

describe('boundToolResult', () => {
  it('leaves a result under the cap byte-identical', () => {
    const c = JSON.stringify({ ok: true, results: [1, 2, 3] });
    expect(boundToolResult(c, 10_000)).toMatchObject({ content: c, truncated: false });
  });

  it('keeps the first records in order, keeps provenance whole, and reports shown-of-total', () => {
    const sources = Array.from({ length: 40 }, (_, i) => ({ url: `https://sam.gov/opp/${i}`, title: 'y'.repeat(300) }));
    const results = Array.from({ length: 1000 }, (_, i) => ({ piid: `P${i}`, description: 'd'.repeat(2000) }));
    const b = boundToolResult(JSON.stringify({ ok: true, results, sources, data_as_of: '2026-11-13' }), 30_000);
    const p = JSON.parse(b.content);
    expect(b.content.length).toBeLessThanOrEqual(30_000);
    expect(p.sources).toEqual(sources); // protected: every element, full text
    expect(p.data_as_of).toBe('2026-11-13');
    expect(p.results.map((r: { piid: string }) => r.piid)).toEqual(Array.from({ length: p.results.length }, (_, i) => `P${i}`));
    expect(p.results[0].description).toMatch(/chars not shown\]$/);
    expect(p._truncation.lists).toEqual([{ path: 'results', shown: p.results.length, total: 1000 }]);
    expect(p._truncation.note).toMatch(/Do not describe the shown items as all of the results/);
  });

  it('last resort: an oversized provenance list is trimmed first-N with a report, never blind-cut', () => {
    const sources = Array.from({ length: 200 }, (_, i) => ({ url: `https://sam.gov/opp/${i}`, title: 'y'.repeat(800) }));
    const b = boundToolResult(JSON.stringify({ ok: true, results: [{ a: 1 }], sources, _meta: { grounded: true } }), 20_000);
    const p = JSON.parse(b.content); // still valid JSON
    expect(p._meta).toEqual({ grounded: true });
    expect(p.sources[0].url).toBe('https://sam.gov/opp/0');
    expect(p.sources[0].title).toHaveLength(800); // protected text is never clipped
    expect(p._truncation.lists).toEqual([{ path: 'sources', shown: p.sources.length, total: 200 }]);
  });

  it('wraps a root array so the truncation report has a home', () => {
    const arr = Array.from({ length: 500 }, (_, i) => ({ id: i, t: 'z'.repeat(200) }));
    const p = JSON.parse(boundToolResult(JSON.stringify(arr), 8_000).content);
    expect(p._truncation.lists[0]).toMatchObject({ path: 'items', total: 500 });
  });

  it('cuts non-JSON text with an explicit not-complete marker', () => {
    const b = boundToolResult('a'.repeat(50_000), 5_000);
    expect(b.content.length).toBeLessThanOrEqual(5_000);
    expect(b.content).toMatch(/do not treat this result as complete/);
  });

  it('splits the turn budget across results with a floor', () => {
    expect(perResultBudget(1)).toBe(120_000);
    expect(perResultBudget(4)).toBe(30_000);
    expect(perResultBudget(100)).toBe(MIN_PER_RESULT_CHARS);
  });
});

describe('tool-offer guard', () => {
  const defs = ['get_expiring_contracts', 'search_sam_opportunities', 'find_opportunities'].map((name) => ({ function: { name } }));
  it.each([
    'What janitorial opportunities are open in Florida?',
    'Show me current solicitations for HVAC',
    'any RFPs for cybersecurity available?',
  ])('removes expiring contracts for an open-opportunity question: %s', (q) => {
    expect(filterToolsForQuestion(defs, q).removed).toEqual(['get_expiring_contracts']);
  });
  it.each([
    'Which janitorial contracts are expiring next year?',
    'What opportunities are coming up for recompete at the VA?',
    'Who is the incumbent on the Fort Bragg janitorial contract?',
    'How do I write a capability statement?',
    'show me the next page',
  ])('keeps every tool otherwise: %s', (q) => {
    expect(filterToolsForQuestion(defs, q).removed).toEqual([]);
  });
  it('classifies', () => {
    expect(isOpenOpportunityQuestion('open bids for roofing')).toBe(true);
    expect(isOpenOpportunityQuestion('open bids ending soon')).toBe(false);
  });
});

describe('resolveAnswerChain', () => {
  it('defaults to the primary then openai:gpt-4o-mini; Groq is not a default', () => {
    expect(resolveAnswerChain({ OPENAI_API_KEY: 'k', GROQ_API_KEY: 'g' }, { primaryModel: 'gpt-4o' }))
      .toEqual([{ provider: 'openai', model: 'gpt-4o' }, { provider: 'openai', model: 'gpt-4o-mini' }]);
  });
  it('dedupes when the primary is already gpt-4o-mini (over-budget users)', () => {
    expect(resolveAnswerChain({ OPENAI_API_KEY: 'k' }, { primaryModel: 'gpt-4o-mini' })).toHaveLength(1);
  });
  it("'none' disables fallbacks; an explicit Groq entry needs its key", () => {
    expect(resolveAnswerChain({ OPENAI_API_KEY: 'k', CHAT_ANSWER_FALLBACKS: 'none' }, { primaryModel: 'gpt-4o' })).toHaveLength(1);
    expect(resolveAnswerChain({ OPENAI_API_KEY: 'k', CHAT_ANSWER_FALLBACKS: 'groq:llama-3.3-70b-versatile' }, { primaryModel: 'gpt-4o' })).toHaveLength(1);
    expect(resolveAnswerChain({ OPENAI_API_KEY: 'k', GROQ_API_KEY: 'g', CHAT_ANSWER_FALLBACKS: 'groq:llama-3.3-70b-versatile' }, { primaryModel: 'gpt-4o' }))
      .toEqual([{ provider: 'openai', model: 'gpt-4o' }, { provider: 'groq', model: 'llama-3.3-70b-versatile' }]);
  });
  it('returns nothing without an OpenAI key (the route then shows the fixed message)', () => {
    expect(resolveAnswerChain({}, { primaryModel: 'gpt-4o' })).toEqual([]);
  });
});

describe('customer error messages', () => {
  it('carry no provider, model, status or stack detail', () => {
    for (const m of CUSTOMER_ERROR_MESSAGES) expect(m).not.toMatch(/\b(openai|groq|anthropic|gpt|llama|claude|api|error \d|\d{3}|stack|token)\b/i);
  });
});

import { fitMessages, inputBudget, contextWindow, estimateRequestTokens, type MsgKind } from './token-budget';
import { openAiChatParams } from './planner-config';

describe('token budget', () => {
  it('context windows: known families, and unknown models never guessed upward', () => {
    expect(contextWindow('gpt-4o')).toBe(128_000);
    expect(contextWindow('gpt-6-luna')).toBe(1_050_000);
    expect(contextWindow('mystery-model')).toBe(128_000);
    expect(inputBudget('gpt-4o', 2048)).toBe(100_000); // policy cap below 128K - headroom
    expect(inputBudget('gpt-4o', 2048, 500_000)).toBe(128_000 - 2048 - 2_000);
  });

  it('counts tools, tool_calls and every message', () => {
    const base = estimateRequestTokens([{ role: 'user', content: 'x'.repeat(300) }]);
    expect(estimateRequestTokens([{ role: 'user', content: 'x'.repeat(300) }], [{ big: 'y'.repeat(3000) }])).toBeGreaterThan(base + 900);
  });

  const msgs = () => [
    { role: 'system', content: 's'.repeat(3000) },
    { role: 'user', content: 'h'.repeat(30_000) }, { role: 'assistant', content: 'h'.repeat(30_000) },
    { role: 'user', content: 'what janitorial opportunities are open?' },
    { role: 'assistant', content: null, tool_calls: [{ id: 't1' }] },
    { role: 'tool', tool_call_id: 't1', content: '{}' },
    { role: 'system', content: 'VERIFIED RECORD LIST: ' + 'r'.repeat(40_000) },
  ];
  const kinds: MsgKind[] = ['system', 'history', 'history', 'user', 'tool_call', 'tool', 'records'];

  it('fits as-is when under budget', () => {
    const f = fitMessages(msgs(), kinds, { budget: 1_000_000 });
    expect(f).toMatchObject({ fits: true, droppedHistory: 0 });
  });

  it('drops oldest history first and keeps the current question and the system prompt', () => {
    const f = fitMessages(msgs(), kinds, { budget: 25_000 });
    expect(f.fits).toBe(true);
    expect(f.droppedHistory).toBeGreaterThanOrEqual(1);
    expect(f.messages[0].role).toBe('system');
    expect(f.messages.some((m) => m.content === 'what janitorial opportunities are open?')).toBe(true);
  });

  it('re-bounds tool results from the FULL original, with a shown-of-total report', () => {
    const full = JSON.stringify({ ok: true, results: Array.from({ length: 500 }, (_, i) => ({ id: i, d: 'z'.repeat(400) })) });
    const m = msgs(); m[5].content = full.slice(0, 60_000); // an already-bounded copy
    const f = fitMessages(m, kinds, { budget: 20_000, toolOriginals: new Map([['t1', full]]) });
    expect(f.toolCapChars).not.toBeNull();
    const p = JSON.parse(String(f.messages.find((x) => x.role === 'tool')!.content));
    expect(p._truncation.lists[0]).toMatchObject({ path: 'results', total: 500 });
  });

  it('reports fits=false rather than sending a request that cannot fit', () => {
    const f = fitMessages([{ role: 'system', content: 's'.repeat(600_000) }, { role: 'user', content: 'q' }], ['system', 'user'], { budget: 100_000 });
    expect(f.fits).toBe(false);
  });
});

describe('openAiChatParams', () => {
  it('gpt-4o family keeps temperature + max_tokens', () => {
    expect(openAiChatParams('gpt-4o-mini', { temperature: 0, maxTokens: 1024 })).toEqual({ temperature: 0, max_tokens: 1024 });
  });
  it('GPT-6 family: max_completion_tokens + reasoning_effort none (required for function calling on Chat Completions)', () => {
    expect(openAiChatParams('gpt-6-luna', { temperature: 0, maxTokens: 1024 })).toEqual({ max_completion_tokens: 1024, reasoning_effort: 'none' });
  });
});

import { inferredCodeDisclosure } from './code-disclosure';
import { warehouseDefenseLag } from '@/lib/usaspending/freshness';
import { defenseLagSentence } from './record-render';

describe('ported: strict-filter code disclosure', () => {
  const ok = (name: string, naics: unknown) => ({ name, status: 'success', content: JSON.stringify({ _meta: { applied_filters: { naics } } }) });
  const t = (c: string) => (c === '561720' ? 'Janitorial Services' : null);
  it('discloses codes a strict-filter tool reports it APPLIED', () => {
    expect(inferredCodeDisclosure([ok('get_expiring_contracts', ['561720'])], [], t))
      .toBe('Industry codes chosen by Mindy for the work you described (you did not give any): 561720 Janitorial Services. Results are limited to these codes, so work filed under other codes is not included');
  });
  it('never for a keyword tool, a failed call, a typed code, or codes the tool did not report applying', () => {
    expect(inferredCodeDisclosure([ok('derive_company_keywords', ['561720'])], [], t)).toBeNull();
    expect(inferredCodeDisclosure([{ ...ok('get_expiring_contracts', ['561720']), status: 'failed' }], [], t)).toBeNull();
    expect(inferredCodeDisclosure([ok('get_expiring_contracts', ['561720'])], ['561720'], t)).toBeNull();
    expect(inferredCodeDisclosure([ok('get_buying_offices', undefined)], [], t)).toBeNull();
  });
  it('a prefix code is described as a family', () => {
    expect(inferredCodeDisclosure([ok('get_buying_offices', '5617')], [], t)).toMatch(/5617 \(all codes starting 5617\)/);
  });
});

describe('ported: evidence-gated Defense lag', () => {
  const NOW = new Date('2026-11-14T00:00:00Z');
  it('null without evidence, even when the window is recent', () => {
    expect(warehouseDefenseLag({ fyTo: 2026, defenseEvidence: null, now: NOW })).toBeNull();
  });
  it('null when the window ends before the cutoff', () => {
    expect(warehouseDefenseLag({ fyTo: 2025, defenseEvidence: 'x', now: NOW })).toBeNull();
  });
  it('applies with evidence and a recent window; the renderer shows only the tool note', () => {
    const dl = warehouseDefenseLag({ fyTo: 2026, defenseEvidence: 'Defense office in results: X', now: NOW })!;
    expect(dl).toMatchObject({ applies: true, window_end: '2026-09-30', dod_complete_through: '2026-08-15' });
    expect(defenseLagSentence({ defense_lag: dl })).toBe(dl.note);
    expect(defenseLagSentence({})).toBeNull();
  });
});
