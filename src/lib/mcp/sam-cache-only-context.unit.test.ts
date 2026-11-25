/**
 * Research mode's samCacheOnly switch (Agent 1 RM-2; Eric 2026-11-25: zero live SAM calls). Set only by Ask Mindy on
 * research turns; MCP transports never set it, so hosted MCP is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { lookup } = vi.hoisted(() => ({
  lookup: vi.fn(async () => ({ queried: {}, entity: null, matches: [], _meta: { grounded: false, degraded: false, match_count: 0, mode: 'uei', source: 'local_registry', lookup_status: 'not_found' } })),
}));
vi.mock('@/mcp/tools/sam-entity', async (orig) => ({ ...(await orig<object>()), lookupSamEntity: lookup }));

import { runMcpTool } from './tool-registry';
import { findOpportunitiesTool } from '@/mcp/tools/find-opportunities';

beforeEach(() => lookup.mockClear());

describe('ctx.samCacheOnly', () => {
  it('lookup_sam_entity runs cache-only when research mode sets it', async () => {
    await runMcpTool('lookup_sam_entity', { name: 'EFS Digital' }, { userEmail: 'research@test', samCacheOnly: true }).catch(() => null);
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ name: 'EFS Digital' }), { cacheOnly: true });
  });
  it('hosted MCP (no flag) keeps the default live-first behaviour', async () => {
    await runMcpTool('lookup_sam_entity', { name: 'EFS Digital' }, { userEmail: 'mcp@test' }).catch(() => null);
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ name: 'EFS Digital' }), { cacheOnly: false });
  });
  it('find_opportunities with a uei resolves the company anchor cache-only', async () => {
    const empty = { data: [], count: 0, error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? (r: (v: unknown) => unknown) => r(empty) : () => chain), apply: () => chain });
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => chain, rpc: () => chain }) }));
    await findOpportunitiesTool({ query: 'advertising', uei: 'C9K6EE9JVDK7', limit_per_horizon: 1 }, { samCacheOnly: true }).catch(() => null);
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ uei: 'C9K6EE9JVDK7' }), { cacheOnly: true });
  });
});

describe('ctx.samCacheOnly reaches the incumbent and documents tools', () => {
  it('get_solicitation_incumbent: a cache miss never calls live SAM and says so', async () => {
    vi.resetModules();
    const fetchSpy = vi.fn(async () => { throw new Error('no network in research mode'); });
    vi.stubGlobal('fetch', fetchSpy);
    process.env.SAM_API_KEY = 'k';
    const empty = { data: [], count: 0, error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? (r: (v: unknown) => unknown) => r(empty) : () => chain), apply: () => chain });
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => chain, rpc: () => chain }) }));
    const { getSolicitationIncumbent } = await import('@/mcp/tools/solicitation-incumbent');
    const r = await getSolicitationIncumbent({ solicitation_number: 'N0017426R1003' }, { samCacheOnly: true });
    const samCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('sam.gov'));
    expect(samCalls).toHaveLength(0);
    expect(r.notice).toBeNull();
    expect((r._meta as unknown as Record<string, unknown>).sam_cache_only).toBe(true);
    expect(String((r._meta as unknown as Record<string, unknown>).cache_only_note)).toMatch(/Live SAM was not consulted/);
    vi.unstubAllGlobals();
  });
  it('the registry passes the flag to get_solicitation_incumbent and get_solicitation_documents', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'tool-registry.ts'), 'utf8') as string;
    expect(src.match(/samCacheOnly: ctx\.samCacheOnly === true/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/cacheOnly: ctx\.samCacheOnly === true/);
  });
  it('documents: research mode stops before the live SAM download and names the limitation', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'sam', 'solicitation-documents.ts'), 'utf8') as string;
    const stop = src.indexOf('if (input.samCacheOnly) {\n    base.source');
    const live = src.indexOf('await fetchAndExtractNoticeFiles(');
    expect(stop).toBeGreaterThan(0);
    expect(stop).toBeLessThan(live);
    expect(src).toMatch(/input\.samCacheOnly\s*\n?\s*\? \(\{ text: '' \}/);
  });
});
