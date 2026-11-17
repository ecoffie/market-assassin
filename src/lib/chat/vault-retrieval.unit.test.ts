/**
 * Ask Mindy Vault retrieval: only the records relevant to the question reach the model.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The loader module creates a Supabase client lazily; the retrieval code only needs
// its pure helpers. A recording supabase stub lets us also prove the loader option.
const queries: Array<{ table: string; cols: string; limit?: number }> = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const rec: { table: string; cols: string; limit?: number } = { table, cols: '' };
      queries.push(rec);
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => { rec.cols = cols; return chain; };
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.order = () => chain;
      chain.limit = (n: number) => { rec.limit = n; return Promise.resolve({ data: [], error: null }); };
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return chain;
    },
  }),
}));

import { retrieveVault, parseRetrieveArgs, safeIdentity, RETRIEVAL_CAPS, type VaultHit, type VaultRetrievalDeps } from './vault-retrieval';
import { loadVaultContext, ALL_VAULT_SECTIONS } from '@/lib/proposal/loaders';
import type { VaultContext } from '@/lib/proposal/types';

const VAULT: VaultContext = {
  has_any: true,
  identity: { user_email: 'o@x.com', legal_name: 'Acme Fed LLC', uei: 'ABC123DEF456', ein: '12-3456789', annual_revenue: '5000000', contact_phone: '555-0100', certifications: ['8(a)'] },
  past_performance: [
    { id: 'pp-1', contract_title: 'DLA Spare Parts Supply', agency: 'DLA', contract_value: 2000000, scope_description: 'NSN spare parts', reference_phone: '555-0199' },
    { id: 'pp-2', contract_title: 'VA Janitorial', agency: 'VA', scope_description: 'Custodial services' },
    { id: 'pp-stub', contract_title: '[Contract Title] — [Agency Name]', scope_description: '📝 Fill in the scope' },
  ],
  capabilities: [
    { id: 'c-1', capability_name: 'Precision machining', description: 'CNC machining to drawing' },
  ],
  team: [
    { id: 't-1', full_name: 'Pat Lee', title: 'Program Manager', security_clearance: 'Secret', is_key_personnel: true },
  ],
};

function deps(hits: VaultHit[], vault: VaultContext = VAULT): VaultRetrievalDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    loadVault: async () => vault,
    matchEvidence: async (_email, q) => { calls.push(q); return hits; },
  };
}

const hit = (kind: VaultHit['kind'], id: string, score = 1): VaultHit => ({ kind, id, label: id, detail: '', score });

describe('retrieveVault', () => {
  it('returns only matched records, hydrated from the real row (no snippet reconstruction)', async () => {
    const res = await retrieveVault('o@x.com', { query: 'DLA spare parts' }, deps([hit('past_performance', 'pp-1')]));
    expect(res.mode).toBe('retrieved');
    expect(res.past_performance).toEqual([{ contract_title: 'DLA Spare Parts Supply', agency: 'DLA', contract_value: 2000000, scope_description: 'NSN spare parts' }]);
    expect(res.capabilities).toEqual([]);
    expect(res.team).toEqual([]);
    expect(res.matched).toBe(1);
    // The unrelated VA contract never reaches the model.
    expect(JSON.stringify(res)).not.toContain('VA Janitorial');
  });

  it('never sends reference phone numbers or the identity EIN/revenue/contact', async () => {
    const res = await retrieveVault('o@x.com', { query: 'DLA' }, deps([hit('past_performance', 'pp-1')]));
    const s = JSON.stringify(res);
    expect(s).not.toContain('555-0199');
    expect(s).not.toContain('12-3456789');
    expect(s).not.toContain('555-0100');
    expect(s).not.toContain('5000000');
    expect(res.identity).toEqual({ legal_name: 'Acme Fed LLC', uei: 'ABC123DEF456', certifications: ['8(a)'] });
  });

  it('no match → honest note and empty sections; never padded with unrelated records', async () => {
    const res = await retrieveVault('o@x.com', { query: 'submarine sonar' }, deps([]));
    expect(res.matched).toBe(0);
    expect(res.past_performance).toEqual([]);
    expect(String(res.note)).toMatch(/Nothing in your Vault matches "submarine sonar"/);
  });

  it('a matcher failure degrades to no-match, not an error', async () => {
    const d = deps([]);
    d.matchEvidence = async () => { throw new Error('embeddings down'); };
    const res = await retrieveVault('o@x.com', { query: 'DLA' }, d);
    expect(res.ok).toBe(true);
    expect(res.matched).toBe(0);
  });

  it('drops template (stub) rows and hits outside the loaded pool', async () => {
    const res = await retrieveVault('o@x.com', { query: 'x' }, deps([hit('past_performance', 'pp-stub'), hit('past_performance', 'not-loaded')]));
    expect(res.past_performance).toEqual([]);
    expect((res.counts as Record<string, number>).past_performance).toBe(2); // stub not counted
  });

  it('maps matcher kinds to sections (capability → capabilities, person → team)', async () => {
    const res = await retrieveVault('o@x.com', { query: 'cleared PM machining' }, deps([hit('person', 't-1'), hit('capability', 'c-1')]));
    expect(res.team).toEqual([{ full_name: 'Pat Lee', title: 'Program Manager', is_key_personnel: true, security_clearance: 'Secret' }]);
    expect(res.capabilities).toEqual([{ capability_name: 'Precision machining', description: 'CNC machining to drawing' }]);
  });

  it('honours the sections filter and leaves identity out of a section-specific read', async () => {
    const res = await retrieveVault('o@x.com', { query: 'x', sections: ['team'] }, deps([hit('past_performance', 'pp-1'), hit('person', 't-1')]));
    expect(res.team).toHaveLength(1);
    expect(res).not.toHaveProperty('past_performance');
    expect(res.identity).toBeNull();
  });

  it('caps records per section', async () => {
    const many: VaultContext = { has_any: true, past_performance: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, contract_title: `Contract ${i}`, agency: 'DLA' })) };
    const res = await retrieveVault('o@x.com', { query: 'DLA' }, deps(many.past_performance!.map((r, i) => hit('past_performance', String(r.id), 9 - i)), many));
    expect((res.past_performance as unknown[]).length).toBe(RETRIEVAL_CAPS.past_performance);
  });

  it('without a query: overview of titles + counts, no record bodies, matcher not called', async () => {
    const d = deps([hit('past_performance', 'pp-1')]);
    const res = await retrieveVault('o@x.com', {}, d);
    expect(d.calls).toEqual([]);
    expect(res.mode).toBe('overview');
    expect(res.titles).toEqual({
      past_performance: ['DLA Spare Parts Supply — DLA', 'VA Janitorial — VA'],
      capabilities: ['Precision machining'],
      team: ['Pat Lee, Program Manager'],
    });
    expect(JSON.stringify(res)).not.toContain('NSN spare parts');
  });

  it('empty Vault → has_any:false with an honest note', async () => {
    const res = await retrieveVault('o@x.com', { query: 'x' }, deps([], { has_any: false }));
    expect(res).toMatchObject({ ok: true, has_any: false });
    expect(String(res.note)).toMatch(/empty/i);
  });
});

describe('parseRetrieveArgs', () => {
  it('keeps only a trimmed, bounded query and known sections; ignores identity fields', () => {
    expect(parseRetrieveArgs({ query: '  DLA  ', sections: ['team', 'bogus', 'team'], email: 'v@y.com' })).toEqual({ query: 'DLA', sections: ['team'] });
    expect(parseRetrieveArgs({ query: 'x'.repeat(500) }).query).toHaveLength(300);
    expect(parseRetrieveArgs({})).toEqual({ query: null, sections: null });
    expect(parseRetrieveArgs({ query: 42, sections: 'team' })).toEqual({ query: null, sections: null });
  });
});

describe('safeIdentity', () => {
  it('returns null when no safe field is set', () => {
    expect(safeIdentity({ ein: '1', user_email: 'a@b.c' })).toBeNull();
    expect(safeIdentity(null)).toBeNull();
  });
});

describe('loadVaultContext sections option', () => {
  beforeEach(() => { queries.length = 0; });

  it('exec_summary without the option keeps the drafter narrowing (no capabilities, no team)', async () => {
    await loadVaultContext('o@x.com', 'exec_summary');
    expect(queries.map((q) => q.table).sort()).toEqual(['user_identity_profile', 'user_past_performance']);
  });

  it('sections: ALL loads identity, past performance, capabilities and team', async () => {
    await loadVaultContext('o@x.com', 'exec_summary', { sections: ALL_VAULT_SECTIONS });
    expect(queries.map((q) => q.table).sort()).toEqual(['user_capabilities_library', 'user_identity_profile', 'user_past_performance', 'user_team_members']);
    for (const q of queries.filter((x) => x.table !== 'user_identity_profile')) expect(q.cols.split(',')[0].trim()).toBe('id');
  });

  it('limits override the default caps; defaults are unchanged', async () => {
    await loadVaultContext('o@x.com', 'exec_summary', { sections: ALL_VAULT_SECTIONS });
    const def = Object.fromEntries(queries.filter((q) => q.limit).map((q) => [q.table, q.limit]));
    expect(def).toEqual({ user_past_performance: 10, user_capabilities_library: 15, user_team_members: 8 });
    queries.length = 0;
    await loadVaultContext('o@x.com', 'exec_summary', { sections: ['past_performance'], limits: { past_performance: 50 } });
    expect(queries).toEqual([expect.objectContaining({ table: 'user_past_performance', limit: 50 })]);
  });
});
