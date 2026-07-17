/**
 * Tier-1 chat tools — behavior tests (public data, no per-user isolation).
 * Focus: correct filtering (active + open only), no-fabrication on empty,
 * clean schema, arg validation.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeTier1Tools, TIER1_TOOL_DEFS, TIER1_TOOL_NAMES, type Tier1Db } from './tier1-tools';

// Mock the vocabulary lib.
const vocabCalls: string[][] = [];
vi.mock('@/lib/market/vocabulary', () => ({
  getVocabularyForCodes: vi.fn(async (codes: string[]) => {
    vocabCalls.push(codes);
    if (codes.includes('000000')) return [];
    return [
      { term: 'cybersecurity', kind: 'word', weight: 9.1, df: 420 },
      { term: 'incident response', kind: 'bigram', weight: 7.3, df: 130 },
    ];
  }),
}));

/** Stub Supabase that records the filters applied and returns `rows`. */
function stubDb(rows: unknown[], captured: { table?: string; calls: Array<[string, unknown]> }): Tier1Db {
  const chain: Record<string, unknown> = {};
  const rec = (name: string, ...a: unknown[]) => { captured.calls.push([name, a[0]]); return chain; };
  chain.select = () => chain;
  chain.eq = (c: string, v: unknown) => rec(`eq:${c}`, v);
  chain.in = (c: string, v: unknown) => rec(`in:${c}`, v);
  chain.gte = (c: string, v: unknown) => rec(`gte:${c}`, v);
  chain.ilike = (c: string, v: unknown) => rec(`ilike:${c}`, v);
  chain.textSearch = (c: string, q: unknown) => rec(`textSearch:${c}`, q);
  chain.order = () => chain;
  chain.limit = async () => ({ data: rows, error: null });
  return {
    from(table: string) { captured.table = table; return chain as unknown as ReturnType<Tier1Db['from']>; },
  };
}

describe('Tier-1 tool definitions', () => {
  it('registers exactly the two SHARED (MCP-safe) Tier-1 tools', () => {
    expect([...TIER1_TOOL_NAMES].sort()).toEqual(['get_market_vocabulary', 'search_sam_opportunities']);
  });
  it('forbids extra properties on every tool', () => {
    for (const def of TIER1_TOOL_DEFS) expect(def.function.parameters.additionalProperties).toBe(false);
  });
  it('sam search requires a keyword; vocabulary requires naics', () => {
    const sam = TIER1_TOOL_DEFS.find((t) => t.function.name === 'search_sam_opportunities')!;
    const vocab = TIER1_TOOL_DEFS.find((t) => t.function.name === 'get_market_vocabulary')!;
    expect(sam.function.parameters.required).toContain('keyword');
    expect(vocab.function.parameters.required).toContain('naics');
  });
});

describe('search_sam_opportunities', () => {
  it('filters to active + not-yet-closed and runs FTS on the keyword', async () => {
    const captured = { calls: [] as Array<[string, unknown]> };
    const db = stubDb([{ title: 'Cyber Support', department: 'DHS', response_deadline: '2026-08-01' }], captured);
    const tools = makeTier1Tools(db);
    await tools.execute('search_sam_opportunities', { keyword: 'cybersecurity' });

    expect(captured.table).toBe('sam_opportunities');
    const names = captured.calls.map(([n]) => n);
    expect(names).toContain('eq:active');            // active only
    expect(names).toContain('gte:response_deadline'); // not-yet-closed
    expect(names.some((n) => n === 'textSearch:search_tsv')).toBe(true); // FTS, not ILIKE
  });

  it('applies optional naics + set_aside filters when given', async () => {
    const captured = { calls: [] as Array<[string, unknown]> };
    const tools = makeTier1Tools(stubDb([], captured));
    await tools.execute('search_sam_opportunities', { keyword: 'it', naics: '541512', set_aside: 'WOSB' });
    expect(captured.calls).toContainEqual(['eq:naics_code', '541512']);
    // The CODE column, never an ILIKE over the free-text description.
    expect(captured.calls).toContainEqual(['in:set_aside_code', ['WOSB', 'WOSBSS']]);
    expect(captured.calls.some(([n]) => n === 'ilike:set_aside_description')).toBe(false);
  });

  // Regression: 2026-07-17. The filter was ilike('set_aside_description','%8(a)%')
  // and the tool's own description told the model to send "8(a)". SAM writes the
  // COMPETED notices as "8a Competed" (no parens), so that matched 66 rows and
  // missed all 130 competed ones — returning ZERO for a state with only competed
  // notices, with no error. Live data at the time: 66 vs 196.
  it('"8(a)" matches BOTH competed (8A) and sole-source (8AN) — the substring never could', async () => {
    const captured = { calls: [] as Array<[string, unknown]> };
    const tools = makeTier1Tools(stubDb([], captured));
    await tools.execute('search_sam_opportunities', { keyword: 'construction', set_aside: '8(a)' });
    expect(captured.calls).toContainEqual(['in:set_aside_code', ['8A', '8AN']]);
  });

  it('accepts the human spellings and raw codes for the same program', async () => {
    for (const term of ['8(a)', '8a', '8A']) {
      const captured = { calls: [] as Array<[string, unknown]> };
      const tools = makeTier1Tools(stubDb([], captured));
      await tools.execute('search_sam_opportunities', { keyword: 'x', set_aside: term });
      expect(captured.calls).toContainEqual(['in:set_aside_code', ['8A', '8AN']]);
    }
    // A raw code still resolves to exactly itself (precision when asked for).
    const cap = { calls: [] as Array<[string, unknown]> };
    await makeTier1Tools(stubDb([], cap)).execute('search_sam_opportunities', { keyword: 'x', set_aside: '8AN' });
    expect(cap.calls).toContainEqual(['in:set_aside_code', ['8AN']]);
  });

  it('an unknown set-aside is an ERROR listing valid options — never a silent zero', async () => {
    const captured = { calls: [] as Array<[string, unknown]> };
    const tools = makeTier1Tools(stubDb([], captured));
    const res = await tools.execute('search_sam_opportunities', { keyword: 'it', set_aside: 'banana' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('unknown_set_aside');
    expect(String(res.message)).toContain('8(a)');
    // and it must not have silently queried
    expect(captured.calls.some(([n]) => n === 'in:set_aside_code')).toBe(false);
  });

  it('a zero-result note names the set-aside filter that produced it', async () => {
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    const res = await tools.execute('search_sam_opportunities', { keyword: 'roofing', set_aside: '8(a)' });
    expect(res.count).toBe(0);
    // "nothing exists" vs "nothing matched THIS filter" must be distinguishable.
    expect(String(res.note)).toContain('8(a)');
    expect(String(res.note)).toContain('8A/8AN');
  });

  it('empty keyword is rejected (never a bare all-SAM dump)', async () => {
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    const res = await tools.execute('search_sam_opportunities', { keyword: '  ' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('keyword_required');
  });

  it('no matches → honest note + count 0 (no fabrication surface)', async () => {
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    const res = await tools.execute('search_sam_opportunities', { keyword: 'zzznomatch' });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(0);
    expect(res.items).toEqual([]);
    expect(String(res.note)).toMatch(/no open sam/i);
  });

  it('maps rows to the citable shape (agency/deadline/link)', async () => {
    const rows = [{ title: 'Cyber Support', department: 'DHS', naics_code: '541512', response_deadline: '2026-08-01', ui_link: 'https://sam.gov/x' }];
    const tools = makeTier1Tools(stubDb(rows, { calls: [] }));
    const res = await tools.execute('search_sam_opportunities', { keyword: 'cyber' }) as { count: number; items: Array<Record<string, unknown>> };
    expect(res.count).toBe(1);
    expect(res.items[0]).toMatchObject({ title: 'Cyber Support', agency: 'DHS', naics: '541512', link: 'https://sam.gov/x' });
  });
});

describe('get_market_vocabulary', () => {
  it('passes the NAICS codes through to the vocabulary lib', async () => {
    vocabCalls.length = 0;
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    await tools.execute('get_market_vocabulary', { naics: ['541512', '541519'] });
    expect(vocabCalls[0]).toEqual(['541512', '541519']);
  });

  it('returns terms with award counts', async () => {
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    const res = await tools.execute('get_market_vocabulary', { naics: ['541512'] }) as { count: number; terms: Array<Record<string, unknown>> };
    expect(res.count).toBe(2);
    expect(res.terms[0]).toMatchObject({ term: 'cybersecurity', awards: 420 });
  });

  it('empty naics rejected; unindexed NAICS → honest note', async () => {
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    const bad = await tools.execute('get_market_vocabulary', { naics: [] });
    expect(bad.ok).toBe(false);
    const none = await tools.execute('get_market_vocabulary', { naics: ['000000'] });
    expect(none.count).toBe(0);
    expect(String(none.note)).toMatch(/no market vocabulary/i);
  });
});

describe('execute — unknown tool', () => {
  it('never silently succeeds', async () => {
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    const res = await tools.execute('drop_all', {});
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/unknown_tool/);
  });
});
