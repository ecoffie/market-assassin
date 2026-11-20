import { describe, expect, it, vi } from 'vitest';
import { makeSearchWebTool, SEARCH_WEB, SEARCH_WEB_TOOL_DEF } from './search-web-tool';

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
