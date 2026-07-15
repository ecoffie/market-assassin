/**
 * Tier-1 chat tools — behavior tests (public data, no per-user isolation).
 * Focus: correct filtering (active + open only), no-fabrication on empty,
 * clean schema, arg validation.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeTier1Tools, TIER1_TOOL_DEFS, TIER1_TOOL_NAMES, CHAT_ONLY_TOOL_DEFS, CHAT_ONLY_TOOL_NAMES, type Tier1Db } from './tier1-tools';

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

// Mock the federal-contacts directory lib (lazy-imported inside the tool).
const contactCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/gov-contacts/contact-roster', () => ({
  queryFederalContacts: vi.fn(async (input: Record<string, unknown>) => {
    contactCalls.push(input);
    if (input.agency === 'EMPTYVILLE') {
      return { contacts: [], anchor: 'none', total: 0, emailableCount: 0, degraded: false, trace: [] };
    }
    return {
      contacts: [{
        contact_fullname: 'Jane Buyer', contact_title: 'MS', contact_email: 'jane@usda.gov',
        contact_phone: '202-555-0100', department_ind_agency: 'Department of Agriculture',
        role: 'Contracting Officer', role_category_label: 'Contracting Officer',
        poc_label: null, sub_agency: 'Forest Service', derived_office: 'R2 Acquisition', dodaac: null,
      }],
      anchor: 'department', total: 1, emailableCount: 1, degraded: false, trace: [],
    };
  }),
}));

/** Stub Supabase that records the filters applied and returns `rows`. */
function stubDb(rows: unknown[], captured: { table?: string; calls: Array<[string, unknown]> }): Tier1Db {
  const chain: Record<string, unknown> = {};
  const rec = (name: string, ...a: unknown[]) => { captured.calls.push([name, a[0]]); return chain; };
  chain.select = () => chain;
  chain.eq = (c: string, v: unknown) => rec(`eq:${c}`, v);
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
  it('keeps find_decision_makers CHAT-ONLY (out of the MCP-shared array)', () => {
    // Must NOT leak into the shared defs the MCP registry spreads — that name
    // collides with MCP's own search_federal_contacts.
    expect([...CHAT_ONLY_TOOL_NAMES]).toEqual(['find_decision_makers']);
    expect(TIER1_TOOL_NAMES.has('find_decision_makers')).toBe(false);
    expect(TIER1_TOOL_NAMES.has('search_federal_contacts')).toBe(false);
  });
  it('forbids extra properties on every tool (shared + chat-only)', () => {
    for (const def of [...TIER1_TOOL_DEFS, ...CHAT_ONLY_TOOL_DEFS]) expect(def.function.parameters.additionalProperties).toBe(false);
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
    expect(captured.calls.some(([n]) => n === 'ilike:set_aside_description')).toBe(true);
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

describe('find_decision_makers', () => {
  it('requires at least one anchor (never an unfiltered 112K scan)', async () => {
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    const res = await tools.execute('find_decision_makers', {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('agency_or_search_required');
  });

  it('passes agency/search/role through to the directory lib', async () => {
    contactCalls.length = 0;
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    await tools.execute('find_decision_makers', { agency: 'Forest Service', role: 'Contracting Officer' });
    expect(contactCalls[0]).toMatchObject({ agency: 'Forest Service', role: 'Contracting Officer' });
  });

  it('maps rows to the citable contact shape (name/title/office/email)', async () => {
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    const res = await tools.execute('find_decision_makers', { agency: 'Department of Agriculture' }) as { total: number; contacts: Array<Record<string, unknown>> };
    expect(res.total).toBe(1);
    expect(res.contacts[0]).toMatchObject({
      name: 'Jane Buyer', title: 'Contracting Officer', agency: 'Department of Agriculture',
      sub_agency: 'Forest Service', office: 'R2 Acquisition', email: 'jane@usda.gov',
    });
  });

  it('no matches → honest note + count 0 (no fabricated contacts)', async () => {
    const tools = makeTier1Tools(stubDb([], { calls: [] }));
    const res = await tools.execute('find_decision_makers', { agency: 'EMPTYVILLE' });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(0);
    expect(res.contacts).toEqual([]);
    expect(String(res.note)).toMatch(/no federal contacts/i);
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
