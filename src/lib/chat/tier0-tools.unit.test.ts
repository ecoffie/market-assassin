/**
 * Tier-0 chat tools — isolation + behavior tests.
 *
 * The isolation tests here are the MERGE-BLOCKING gate from
 * tasks/PRD-mindy-chat-data-core.md §7. If any of them fail, a user's chat could
 * reach another user's crown-jewel data — do not ship.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeTier0Tools, TIER0_TOOL_DEFS, TIER0_TOOL_NAMES, type Tier0Db } from './tier0-tools';

// Mock the Vault loader so searchMyVault tests don't hit the real DB. We capture
// the email it was called with to prove the bound email flows through.
const vaultCalls: string[] = [];
vi.mock('@/lib/proposal/loaders', () => ({
  loadVaultContext: vi.fn(async (email: string) => {
    vaultCalls.push(email);
    if (email === 'empty@x.com') return { has_any: false };
    return {
      has_any: true,
      identity: { company_name: 'Acme Fed' },
      past_performance: [{ contract_title: 'DLA Tubing', agency: 'DLA' }],
      capabilities: [{ capability_name: 'Machining' }],
    };
  }),
}));

/**
 * A stub Supabase that RECORDS the filters applied, so a test can assert the
 * query was scoped to the bound email. Returns `rows` as the final result.
 */
function stubDb(rows: unknown[], captured: { table?: string; filters: Array<[string, string]> }): Tier0Db {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    chain.eq = (col: string, val: string) => {
      captured.filters.push([col, val]);
      return chain;
    };
    chain.order = () => chain;
    chain.limit = async () => ({ data: rows, error: null });
    return chain;
  };
  return {
    from(table: string) {
      captured.table = table;
      return { select: () => makeChain() };
    },
  } as unknown as Tier0Db;
}

describe('Tier-0 tool definitions — isolation by schema', () => {
  it('exposes NO email/user/workspace argument on any tool (model cannot request another user)', () => {
    for (const def of TIER0_TOOL_DEFS) {
      const props = Object.keys(def.function.parameters.properties || {});
      expect(props).not.toContain('email');
      expect(props).not.toContain('user_email');
      expect(props).not.toContain('user');
      expect(props).not.toContain('workspace_id');
    }
  });

  it('forbids extra properties (additionalProperties:false) so a coerced field is schema-rejected', () => {
    for (const def of TIER0_TOOL_DEFS) {
      expect(def.function.parameters.additionalProperties).toBe(false);
    }
  });

  it('registers exactly the two Phase-1 tools', () => {
    expect([...TIER0_TOOL_NAMES].sort()).toEqual(['get_my_pipeline', 'search_my_vault']);
  });
});

describe('get_my_pipeline — scoped to the bound email', () => {
  it('filters user_pipeline by the BOUND email, not anything from args', async () => {
    const captured = { filters: [] as Array<[string, string]> };
    const db = stubDb([{ title: 'A', stage: 'bidding', response_deadline: '2026-07-18' }], captured);
    const tools = makeTier0Tools(db, 'owner@x.com');

    // Adversarial: the model tries to smuggle a different user's email.
    await tools.execute('get_my_pipeline', { email: 'victim@y.com', user_email: 'victim@y.com' } as Record<string, unknown>);

    expect(captured.table).toBe('user_pipeline');
    // The ONLY user_email filter applied is the bound owner — never the smuggled one.
    const emailFilters = captured.filters.filter(([c]) => c === 'user_email').map(([, v]) => v);
    expect(emailFilters).toEqual(['owner@x.com']);
    expect(emailFilters).not.toContain('victim@y.com');
  });

  it('applies a valid stage filter and ignores a bogus stage', async () => {
    const capturedValid = { filters: [] as Array<[string, string]> };
    const tools1 = makeTier0Tools(stubDb([], capturedValid), 'o@x.com');
    await tools1.execute('get_my_pipeline', { stage: 'submitted' });
    expect(capturedValid.filters).toContainEqual(['stage', 'submitted']);

    const capturedBogus = { filters: [] as Array<[string, string]> };
    const tools2 = makeTier0Tools(stubDb([], capturedBogus), 'o@x.com');
    await tools2.execute('get_my_pipeline', { stage: 'DROP TABLE' });
    // bogus stage never becomes a filter
    expect(capturedBogus.filters.some(([c]) => c === 'stage')).toBe(false);
  });

  it('empty pipeline returns an honest note + count 0 (no fabrication surface)', async () => {
    const tools = makeTier0Tools(stubDb([], { filters: [] }), 'o@x.com');
    const res = await tools.execute('get_my_pipeline', {});
    expect(res.ok).toBe(true);
    expect(res.count).toBe(0);
    expect(res.items).toEqual([]);
    expect(String(res.note)).toMatch(/no pursuits/i);
  });

  it('maps rows to the citable shape (deadline/value/naics surfaced)', async () => {
    const rows = [{ title: 'DLA Tubing', agency: 'DLA', stage: 'bidding', response_deadline: '2026-07-18', value_estimate: '$2M', naics_code: '332996' }];
    const tools = makeTier0Tools(stubDb(rows, { filters: [] }), 'o@x.com');
    const res = await tools.execute('get_my_pipeline', {}) as { count: number; items: Array<Record<string, unknown>> };
    expect(res.count).toBe(1);
    expect(res.items[0]).toMatchObject({ title: 'DLA Tubing', agency: 'DLA', deadline: '2026-07-18', naics: '332996' });
  });
});

describe('search_my_vault — scoped to the bound email', () => {
  it('calls loadVaultContext with the BOUND email', async () => {
    vaultCalls.length = 0;
    const tools = makeTier0Tools(stubDb([], { filters: [] }), 'owner@x.com');
    await tools.execute('search_my_vault', { email: 'victim@y.com' } as Record<string, unknown>);
    expect(vaultCalls).toEqual(['owner@x.com']); // never the smuggled email
  });

  it('empty Vault returns has_any:false + honest note', async () => {
    const tools = makeTier0Tools(stubDb([], { filters: [] }), 'empty@x.com');
    const res = await tools.execute('search_my_vault', {});
    expect(res.has_any).toBe(false);
    expect(String(res.note)).toMatch(/empty/i);
  });

  it('populated Vault returns identity + past performance + capabilities', async () => {
    const tools = makeTier0Tools(stubDb([], { filters: [] }), 'owner@x.com');
    const res = await tools.execute('search_my_vault', {}) as { has_any: boolean; past_performance: unknown[] };
    expect(res.has_any).toBe(true);
    expect(res.past_performance).toHaveLength(1);
  });
});

describe('execute — unknown tool is never a silent success', () => {
  it('returns an error for a name outside the Tier-0 set', async () => {
    const tools = makeTier0Tools(stubDb([], { filters: [] }), 'o@x.com');
    const res = await tools.execute('get_someone_elses_pipeline', {});
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/unknown_tool/);
  });
});
