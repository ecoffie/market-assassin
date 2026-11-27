import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSearchWebTool, SEARCH_WEB, SEARCH_WEB_TOOL_DEF, DEFAULT_MAX_SEARCHES_PER_TURN, copiesDocumentText, privacyRefusal, callerKeyFor } from './search-web-tool';

describe('search_web tool', () => {
  it('exports the Ask tool name and a query-required schema', () => {
    expect(SEARCH_WEB).toBe('search_web');
    expect(SEARCH_WEB_TOOL_DEF.function.name).toBe('search_web');
    expect(SEARCH_WEB_TOOL_DEF.function.parameters.required).toEqual(['query']);
  });

  it('returns available=false when Serper is not configured (known gap)', async () => {
    const tool = makeSearchWebTool({
      isConfigured: () => false,
      search: vi.fn(),
    });
    const out = await tool.execute({ query: 'NPS deferred maintenance CRS' });
    expect(out).toMatchObject({
      ok: true,
      grounded: false,
      available: false,
      count: 0,
    });
    expect(String(out.note)).toMatch(/known gap/i);
  });

  it('returns grounded hits from Serper and caps results', async () => {
    const search = vi.fn().mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        title: `Hit ${i}`,
        url: `https://example.gov/${i}`,
        snippet: `Snippet ${i}`,
        source: 'example.gov',
        publishedDate: null,
      })),
    );
    const tool = makeSearchWebTool({ isConfigured: () => true, search });
    const out = await tool.execute({ query: 'Legacy Restoration Fund bill' });
    expect(search).toHaveBeenCalledWith(['Legacy Restoration Fund bill'], expect.objectContaining({ includeNews: true }));
    expect(out).toMatchObject({ ok: true, grounded: true, available: true, count: 8 });
    expect((out.results as unknown[]).length).toBe(8);
  });

  it('returns grounded=false when search runs empty', async () => {
    const tool = makeSearchWebTool({
      isConfigured: () => true,
      search: vi.fn().mockResolvedValue([]),
    });
    const out = await tool.execute({ query: 'obscure query xyz' });
    expect(out).toMatchObject({ ok: true, grounded: false, available: true, count: 0 });
    expect(String(out.note)).toMatch(/Do not fabricate/i);
  });

  it('refuses a missing query', async () => {
    const tool = makeSearchWebTool({ isConfigured: () => true, search: vi.fn() });
    const out = await tool.execute({});
    expect(out).toMatchObject({ ok: false, error: 'missing_query' });
  });
});

describe('search_web server-side controls (Agent 4 review)', () => {
  const hits = [{ title: 'GAO-25-1', url: 'https://www.gao.gov/x', snippet: 's' }];
  const mk = (extra: Parameters<typeof makeSearchWebTool>[0] = {}) => {
    const search = vi.fn(async () => hits);
    const usage: unknown[] = [];
    const tool = makeSearchWebTool({ deps: { isConfigured: () => true, search }, onUsage: (u) => usage.push(u), ...extra });
    return { tool, search, usage };
  };

  it('caps searches per turn (default 5) with an honest limit_reached result and no outside call', async () => {
    const { tool, search, usage } = mk();
    for (let i = 0; i < DEFAULT_MAX_SEARCHES_PER_TURN; i++) expect((await tool.execute({ query: `q ${i}` })).grounded).toBe(true);
    const sixth = await tool.execute({ query: 'one more' });
    expect(sixth).toMatchObject({ ok: true, grounded: false, limit_reached: true, count: 0 });
    expect(search).toHaveBeenCalledTimes(DEFAULT_MAX_SEARCHES_PER_TURN);
    expect(usage.at(-1)).toMatchObject({ outcome: 'limit_reached', call: 6 });
  });

  it('refuses a query with the caller or workspace email, never sending it out', async () => {
    const { tool, search, usage } = mk({ forbidden: { emails: ['Owner@Example.com', null] } });
    const r = await tool.execute({ query: 'contracts for owner@example.com company' });
    expect(r).toMatchObject({ ok: false, refused: true, error: 'query_refused' });
    expect(search).not.toHaveBeenCalled();
    expect(usage[0]).toMatchObject({ outcome: 'refused', refusedBecause: 'email' });
  });

  it('refuses a query with a known UEI', async () => {
    const { tool, search } = mk({ forbidden: { ueis: ['ABCDEFGH1234'] } });
    expect(await tool.execute({ query: 'awards abcdefgh1234' })).toMatchObject({ refused: true });
    expect(search).not.toHaveBeenCalled();
  });

  it('refuses 8+ consecutive words copied from this turn\'s document excerpts; allows a short overlap', async () => {
    const documentText = 'Section L: the offeror shall provide a staffing plan that covers all three shifts at the medical center.';
    const { tool, search } = mk({ documentText });
    expect(await tool.execute({ query: 'offeror shall provide a staffing plan that covers all three shifts' })).toMatchObject({ refused: true });
    expect(copiesDocumentText('staffing plan medical center GAO findings', documentText)).toBe(false);
    expect((await tool.execute({ query: 'VA medical center staffing GAO report' })).grounded).toBe(true);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('logs one usage record per call with no query text and no credit amount', async () => {
    const { tool, usage } = mk();
    await tool.execute({ query: 'NPS deferred maintenance CRS' });
    expect(usage).toEqual([{ tool: 'search_web', outcome: 'ok', call: 1, queryLength: 28, resultCount: 1 }]);
    expect(JSON.stringify(usage)).not.toMatch(/deferred|maintenance|credit/i);
  });

  it('a failing usage logger never breaks the search', async () => {
    const tool = makeSearchWebTool({ deps: { isConfigured: () => true, search: async () => hits }, onUsage: () => { throw new Error('log down'); } });
    expect((await tool.execute({ query: 'GAO' })).grounded).toBe(true);
  });

  it('tells the model web findings are unverified and other GovCon platforms are never cited', async () => {
    expect(privacyRefusal('plain query', {})).toBeNull();
    const { tool } = mk();
    expect(String((await tool.execute({ query: 'GAO' })).note)).toMatch(/unverified open-web results.*Never cite other GovCon data platforms/);
  });
});

describe('search_web corrections (Agent 4 re-review of #2204)', () => {
  const hits = [{ title: 'GAO-25-1', url: 'https://www.gao.gov/x', snippet: 's' }];

  it('guards text that find_my_documents returns DURING the turn (per-turn accumulator, read per call)', async () => {
    // Mirrors the chat route: the guard reads an accumulator the find_my_documents wrapper appends to.
    const turnDocumentTexts: string[] = [];
    const search = vi.fn(async () => hits);
    const tool = makeSearchWebTool({ deps: { isConfigured: () => true, search }, documentText: () => turnDocumentTexts.join('\n'), onUsage: () => {} });
    const q = 'contractor shall maintain a minimum staffing level of twelve licensed technicians';
    expect((await tool.execute({ query: q })).grounded).toBe(true); // nothing retrieved yet
    turnDocumentTexts.push(JSON.stringify({ ok: true, results: [{ excerpt: 'The contractor shall maintain a minimum staffing level of twelve licensed technicians on site.' }] }));
    expect(await tool.execute({ query: q })).toMatchObject({ refused: true, error: 'query_refused' });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('attributes each usage record by a hashed caller key and session id, never the raw email or query', async () => {
    const usage: Array<Record<string, unknown>> = [];
    const email = 'Owner@Example.com';
    const tool = makeSearchWebTool({
      deps: { isConfigured: () => true, search: async () => hits },
      attribution: { callerKey: callerKeyFor(email), sessionId: '11111111-2222-4333-8444-555555555555' },
      onUsage: (u) => usage.push(u as unknown as Record<string, unknown>),
    });
    await tool.execute({ query: 'Legacy Restoration Fund bill status' });
    expect(usage[0]).toMatchObject({ outcome: 'ok', callerKey: callerKeyFor('owner@example.com'), sessionId: '11111111-2222-4333-8444-555555555555' });
    expect(String(usage[0].callerKey)).toMatch(/^u_[0-9a-f]{16}$/);
    const serialized = JSON.stringify(usage);
    expect(serialized).not.toMatch(/owner@example\.com/i);
    expect(serialized).not.toMatch(/Legacy|Restoration/);
  });

  it('callerKeyFor is stable, case-insensitive and empty for no email', () => {
    expect(callerKeyFor(' A@B.com ')).toBe(callerKeyFor('a@b.com'));
    expect(callerKeyFor('a@b.com')).not.toBe(callerKeyFor('c@d.com'));
    expect(callerKeyFor('')).toBeUndefined();
    expect(callerKeyFor(null)).toBeUndefined();
  });
});

describe('chat route wiring for the search_web guard', () => {
  const route = readFileSync(join(__dirname, '../../app/api/app/chat/route.ts'), 'utf8');
  it('feeds the attached documents, connected files and every find_my_documents result into the guard, with attribution', () => {
    expect(route).toMatch(/const turnDocumentTexts: string\[\] = \[documentContext\?\.block, connectedFiles\?\.block\]\.filter\(\(t\): t is string => !!t\);/);
    expect(route).toMatch(/documentText: \(\) => turnDocumentTexts\.join\('\\n'\),/);
    expect(route).toMatch(/attribution: \{ callerKey: callerKeyFor\(auth\.email\), sessionId: turnSessionId \},/);
    expect(route).toMatch(/return myDocs\.execute\(a\)\.then\(\(r\) => \{\n\s+try \{ turnDocumentTexts\.push\(JSON\.stringify\(r\)\); \}/);
  });
});
