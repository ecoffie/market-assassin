import { describe, it, expect } from 'vitest';
import {
  planHhsReconciliation, hhsPlanReconciles, hhsPlanIsSemanticallySane,
  canonicalHhsFingerprint, hhsDataAdvanced, HHS_SOURCE_OWNED_FIELDS, HHS_DERIVED_FIELDS, type HhsRow,
} from './hhs-reconcile';

const row = (id: string, over: Partial<HhsRow> = {}): HhsRow =>
  ({ external_id: id, title: 'T', naics_code: '541512', ...over });

describe('identity + diffing', () => {
  it('matched-but-identical rows are UNCHANGED and produce NO write', () => {
    const held = new Map([['HHS-A', { title: 'T', naics_code: '541512' }]]);
    const p = planHhsReconciliation([row('HHS-A')], held);
    expect(p.unchanged).toBe(1);
    expect(p.toUpdate).toHaveLength(0);
    expect(p.matchedExisting).toBe(1);
  });

  it('only CHANGED source-owned fields enter the patch', () => {
    const held = new Map([['HHS-A', { title: 'OLD', naics_code: '541512' }]]);
    const p = planHhsReconciliation([row('HHS-A', { title: 'NEW' })], held);
    expect(p.toUpdate).toHaveLength(1);
    expect(p.toUpdate[0].changedFields).toEqual(['title']);
    expect(p.toUpdate[0].patch).toEqual({ title: 'NEW' });
  });

  it('a field the SOURCE did not supply is never written (no null-clobber)', () => {
    const held = new Map([['HHS-A', { title: 'T', incumbent_name: 'ACME' }]]);
    const p = planHhsReconciliation([{ external_id: 'HHS-A', title: 'T' }], held);
    expect(p.unchanged).toBe(1);                    // incumbent_name absent != changed
    expect(p.toUpdate).toHaveLength(0);
  });

  it('whitespace-only differences are not changes', () => {
    const held = new Map([['HHS-A', { title: 'a  b' }]]);
    const p = planHhsReconciliation([{ external_id: 'HHS-A', title: 'a b' }], held);
    expect(p.unchanged).toBe(1);
  });

  it('held rows absent upstream are RETAINED, never deleted', () => {
    const held = new Map([['HHS-A', { title: 'T' }], ['HHS-GONE', { title: 'X' }]]);
    const p = planHhsReconciliation([row('HHS-A')], held);
    expect(p.absentUpstream).toEqual(['HHS-GONE']);
  });

  it('Mindy enrichment is not in the source-owned whitelist', () => {
    for (const f of ['map_lat', 'map_lng', 'map_loc_source', 'created_at', 'last_synced_at']) {
      expect(HHS_SOURCE_OWNED_FIELDS as readonly string[]).not.toContain(f);
    }
  });
});

describe('accounting gate', () => {
  it('a balanced plan reconciles on all three identities', () => {
    // HHS-B must match the upstream row on EVERY source-owned field it supplies,
    // otherwise it is legitimately CHANGED (which is what the first draft got wrong).
    const held = new Map([['HHS-A', { title: 'OLD', naics_code: '541512' }],
                          ['HHS-B', { title: 'T', naics_code: '541512' }]]);
    const p = planHhsReconciliation([row('HHS-A', { title: 'NEW' }), row('HHS-B'), row('HHS-C')], held);
    expect(hhsPlanReconciles(p).ok).toBe(true);
    expect(p.toInsert).toHaveLength(1);
    expect(p.toUpdate).toHaveLength(1);
    expect(p.unchanged).toBe(1);
  });

  it('a duplicate uuid inside one payload is counted, not merged', () => {
    const p = planHhsReconciliation([row('HHS-A'), row('HHS-A')], new Map());
    expect(p.duplicateSourceIds).toEqual(['HHS-A']);
    expect(p.usableUpstream).toBe(1);
    expect(hhsPlanReconciles(p).ok).toBe(true);
  });

  it('a row with no identity is REJECTED, never assigned a guessed id', () => {
    const p = planHhsReconciliation([null, { external_id: '' } as HhsRow, row('HHS-A')], new Map());
    expect(p.parseRejected).toBe(2);
    expect(hhsPlanReconciles(p).ok).toBe(true);
  });
});

describe('SEMANTIC gate — the Navy tripwires', () => {
  it('THE NAVY SHAPE: balanced arithmetic, zero matches -> STOP', () => {
    const held = new Map([['OLD-1', { title: 'x' }], ['OLD-2', { title: 'y' }]]);
    const p = planHhsReconciliation([row('NEW-1'), row('NEW-2')], held);
    expect(hhsPlanReconciles(p).ok).toBe(true);            // arithmetic BALANCES
    const s = hhsPlanIsSemanticallySane(p, held.size);
    expect(s.ok).toBe(false);                              // but identity FAILED
    expect(s.problems.join(' ')).toContain('matchedExisting = 0');
  });

  it('a genuinely healthy plan passes the semantic gate', () => {
    const held = new Map([['HHS-A', { title: 'T' }]]);
    const p = planHhsReconciliation([row('HHS-A'), row('HHS-B')], held);
    expect(hhsPlanIsSemanticallySane(p, held.size).ok).toBe(true);
  });

  it('an empty corpus (first ingest) is NOT a semantic failure', () => {
    const p = planHhsReconciliation([row('HHS-A')], new Map());
    expect(hhsPlanIsSemanticallySane(p, 0).ok).toBe(true);
  });
});

describe('canonical fingerprint — failure semantics', () => {
  const a = [{ uuid: 'b', title: 'B' }, { uuid: 'a', title: 'A' }];

  it('is invariant to record order and key order', () => {
    const reordered = [{ title: 'A', uuid: 'a' }, { title: 'B', uuid: 'b' }];
    expect(canonicalHhsFingerprint(a)).toBe(canonicalHhsFingerprint(reordered));
  });

  it('changes when any record is added, removed, or edited', () => {
    const base = canonicalHhsFingerprint(a);
    expect(canonicalHhsFingerprint([...a, { uuid: 'c', title: 'C' }])).not.toBe(base);
    expect(canonicalHhsFingerprint([a[0]])).not.toBe(base);
    expect(canonicalHhsFingerprint([{ uuid: 'b', title: 'CHANGED' }, a[1]])).not.toBe(base);
  });

  it('EMPTY payload -> NULL (unmeasured), never a hash of nothing', () => {
    expect(canonicalHhsFingerprint([])).toBeNull();
  });

  it('non-array / malformed payload -> NULL (failure, not zero)', () => {
    expect(canonicalHhsFingerprint(null)).toBeNull();
    expect(canonicalHhsFingerprint({ error: 'boom' })).toBeNull();
    expect(canonicalHhsFingerprint('<html>503</html>')).toBeNull();
  });

  it('is a TRUNCATED sha256 — 32 hex chars', () => {
    expect(canonicalHhsFingerprint(a)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('data advance gates the clock', () => {
  it('only a real mutation advances it', () => {
    expect(hhsDataAdvanced(0, 0)).toBe(false);   // idempotent re-run
    expect(hhsDataAdvanced(1, 0)).toBe(true);
    expect(hhsDataAdvanced(0, 1)).toBe(true);
  });
});

describe('ONE whitelist governs BOTH diffing and writing', () => {
  it('derived fields are NOT source-owned', () => {
    for (const f of HHS_DERIVED_FIELDS) {
      expect(HHS_SOURCE_OWNED_FIELDS as readonly string[]).not.toContain(f);
    }
  });

  it('the whitelist is exactly the 16 proven HHS-owned fields', () => {
    expect(HHS_SOURCE_OWNED_FIELDS).toHaveLength(16);
  });

  it('a field excluded from the diff can NEVER appear in an update payload', () => {
    // Upstream carries derived fields with DIFFERENT values than held.
    const held = new Map([['HHS-A', { title: 'T', anticipated_quarter: 'Q1', fiscal_year: 'FY2025' }]]);
    const upstream = [{ external_id: 'HHS-A', title: 'T',
                        anticipated_quarter: 'Q4', fiscal_year: 'FY2099' } as unknown as HhsRow];
    const p = planHhsReconciliation(upstream, held);
    // Not diffed -> the row is UNCHANGED and nothing is written.
    expect(p.unchanged).toBe(1);
    expect(p.toUpdate).toHaveLength(0);
  });

  it('even when another field DOES change, the patch excludes derived fields', () => {
    const held = new Map([['HHS-A', { title: 'OLD', anticipated_quarter: 'Q1', fiscal_year: 'FY2025' }]]);
    const upstream = [{ external_id: 'HHS-A', title: 'NEW',
                        anticipated_quarter: 'Q4', fiscal_year: 'FY2099' } as unknown as HhsRow];
    const p = planHhsReconciliation(upstream, held);
    expect(p.toUpdate).toHaveLength(1);
    expect(Object.keys(p.toUpdate[0].patch)).toEqual(['title']);
    for (const f of HHS_DERIVED_FIELDS) expect(p.toUpdate[0].patch).not.toHaveProperty(f);
  });
});

describe('FAILURE SEMANTICS — no failed path may become "0 new records" or "quiet"', () => {
  it('a missing uuid is REJECTED, never inserted with a guessed identity', () => {
    const p = planHhsReconciliation(
      [{ external_id: '', title: 'X' } as HhsRow, { external_id: 'HHS-A', title: 'T' }], new Map());
    expect(p.parseRejected).toBe(1);
    expect(p.toInsert).toHaveLength(1);
    expect(p.toInsert[0].external_id).toBe('HHS-A');
  });

  it('a duplicate uuid is a source identity failure, surfaced not merged', () => {
    const p = planHhsReconciliation(
      [{ external_id: 'HHS-A', title: 'first' }, { external_id: 'HHS-A', title: 'second' }], new Map());
    expect(p.duplicateSourceIds).toEqual(['HHS-A']);
    expect(p.toInsert).toHaveLength(1);           // first wins, second NOT silently applied
    expect(p.toInsert[0].title).toBe('first');
  });

  it('partial normalization keeps the rejected count VISIBLE in the accounting', () => {
    const p = planHhsReconciliation([null, null, { external_id: 'HHS-A', title: 'T' }], new Map());
    expect(p.parseRejected).toBe(2);
    expect(hhsPlanReconciles(p).ok).toBe(true);   // reconciles only BECAUSE rejects are counted
  });
});
