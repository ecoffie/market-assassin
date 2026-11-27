/**
 * End-to-end: the REAL research-mode tools under McpToolContext.samCacheOnly make zero live SAM calls (Agent 4's
 * follow-up to RM-2 #2463). Every live SAM entry point (the entity API functions and any fetch to sam.gov) records the
 * call and throws; Supabase and BigQuery answer empty. Each tool may fail or return nothing; what may never happen is
 * a live SAM call.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const live = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('@/lib/sam/entity-api', async (orig) => {
  const real = await orig<typeof import('@/lib/sam/entity-api')>();
  const deny = (name: string) => vi.fn(async () => { live.calls.push(name); throw new Error(`LIVE SAM: ${name}`); });
  return {
    ...real,
    searchEntities: deny('searchEntities'), getEntityByUEI: deny('getEntityByUEI'), getEntityByCAGE: deny('getEntityByCAGE'),
    verifySAMStatus: deny('verifySAMStatus'), getCertifications: deny('getCertifications'), searchByCertification: deny('searchByCertification'),
    getEntityNAICS: deny('getEntityNAICS'), findTeamingPartners: deny('findTeamingPartners'),
  };
});
vi.mock('@supabase/supabase-js', () => {
  const empty = { data: [], count: 0, error: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? (r: (v: unknown) => unknown) => r(empty) : () => chain), apply: () => chain });
  return { createClient: () => ({ from: () => chain, rpc: () => chain, storage: { from: () => chain } }) };
});
vi.mock('@google-cloud/bigquery', () => ({ BigQuery: class { query = async () => [[]]; createQueryJob = async () => [{ getQueryResults: async () => [[]] }]; dataset() { return { table: () => ({ getRows: async () => [[]] }) }; } } }));

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ['SAM_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) saved[k] = process.env[k];
  process.env.SAM_API_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk';
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url);
    if (/sam\.gov/i.test(u)) { live.calls.push(`fetch:${u.split('?')[0]}`); throw new Error('LIVE SAM fetch'); }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ctx = { userEmail: 'research@example.com', samCacheOnly: true } as const;
const withinTest = <T>(p: Promise<T>) => Promise.race([p.catch((e) => e), new Promise((r) => setTimeout(() => r('timeout'), 8000))]);

describe('research tools under samCacheOnly reach no live SAM', () => {
  it.each([
    ['find_opportunities (with a uei: company anchor)', 'find_opportunities', { query: 'digital marketing', uei: 'ABC123DEF456', limit_per_horizon: 1 }],
    ['lookup_sam_entity by name', 'lookup_sam_entity', { name: 'Ridgeline Digital', state: 'VA' }],
    ['lookup_sam_entity by UEI', 'lookup_sam_entity', { uei: 'ABC123DEF456' }],
    ['get_contractor_award_history', 'get_contractor_award_history', { uei: 'ABC123DEF456' }],
    ['get_solicitation_incumbent', 'get_solicitation_incumbent', { solicitation_number: 'W912PL26Q0042' }],
    ['get_solicitation_documents', 'get_solicitation_documents', { notice_id: '6ba812a7e0284f79bc44c4932777c340' }],
  ])('%s', async (_label, tool, args) => {
    live.calls.length = 0;
    const { runMcpTool } = await import('./tool-registry');
    await withinTest(runMcpTool(tool, args as Record<string, unknown>, ctx));
    expect(live.calls, `${tool} reached live SAM: ${live.calls.join(', ')}`).toEqual([]);
  }, 15000);

  it('the trap works: without samCacheOnly, lookup_sam_entity by name does reach the live client', async () => {
    live.calls.length = 0;
    const { runMcpTool } = await import('./tool-registry');
    await withinTest(runMcpTool('lookup_sam_entity', { name: 'Ridgeline Digital' }, { userEmail: 'mcp@example.com' }));
    expect(live.calls.length).toBeGreaterThan(0);
  }, 15000);
});
