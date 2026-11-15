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
    expect(perResultBudget(1)).toBe(60_000);
    expect(perResultBudget(4)).toBe(15_000);
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
