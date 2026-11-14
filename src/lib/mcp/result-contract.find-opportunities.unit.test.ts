/** Review finding: find_opportunities applies a string `states` and a normalized `stage`; neither may be reported as ignored. */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/mcp/tools/find-opportunities', () => ({ findOpportunitiesTool: vi.fn(async () => ({ horizons: {}, _meta: { grounded: true, degraded: false } })) }));
import { runMcpTool } from './tool-registry';

describe('find_opportunities coerced arguments', () => {
  it('string states + human stage are applied, so result_state stays results', async () => {
    const { result } = await runMcpTool('find_opportunities', { query: 'janitorial', states: 'TN', stage: 'market research' }, { userEmail: 't@example.com' } as never);
    const m = result._meta as { result_state: string; ignored_args: unknown[]; applied_filters: Record<string, unknown> };
    expect(m.ignored_args).toEqual([]);
    expect(m.result_state).toBe('results');
    expect(m.applied_filters).toMatchObject({ states: 'TN', stage: 'MARKET_RESEARCH' });
  });
  it('an unrecognizable stage is still reported', async () => {
    const { result } = await runMcpTool('find_opportunities', { query: 'janitorial', stage: 'banana' }, { userEmail: 't@example.com' } as never);
    expect((result._meta as { ignored_args: Array<{ arg: string }> }).ignored_args.map((i) => i.arg)).toContain('stage');
  });
});
