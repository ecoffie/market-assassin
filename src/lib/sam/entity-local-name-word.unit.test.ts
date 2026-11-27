/**
 * Name-only entity resolution (Eric, 2026-11-25; reference request: EFS Digital, a woman-owned agency in Norwich, CT).
 * Production lookup_sam_entity("EFS", state CT) on the local-mirror path returned CHIEFS, REEFS, DEFSEC, TOLLEFSON
 * from PA/KY/OH/DE: the ILIKE matched inside words and the state was ignored. A trading-name or acronym search
 * must match whole words and honour the state the customer's clues give.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = [string, ...unknown[]];
const calls: Call[][] = [];
const rows: Record<string, unknown>[] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const mine: Call[] = [];
      calls.push(mine);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'ilike', 'filter', 'eq', 'limit']) chain[m] = (...a: unknown[]) => { mine.push([m, ...a]); return chain; };
      chain.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
      return chain;
    },
  }),
}));

import { localNameFilters, lookupLocalEntitiesByName } from './entity-local-fallback';

const pgWordMatch = (regex: string, text: string) =>
  new RegExp(regex.replace(/\\m/g, '\\b').replace(/\\M/g, '\\b').replace(/\[\^\[:alnum:\]\]\+/g, '[^A-Za-z0-9]+'), 'i').test(text);

beforeEach(() => {
  calls.length = 0; rows.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'k';
});

describe('localNameFilters — whole words, any separator', () => {
  it('"EFS" matches EFS WEST / EFS DIGITAL LLC, never CHIEFS, REEFS, DEFSEC, BELIEFS, TOLLEFSON', () => {
    const f = localNameFilters('EFS')!;
    for (const n of ['EFS WEST', 'EFS DIGITAL LLC', 'SAGE-EFS JV']) expect(pgWordMatch(f.regex, n), n).toBe(true);
    for (const n of ['KANSAS STATE ASSOCIATION OF FIRE CHIEFS', 'KULEANA CORAL REEFS', 'DEFSEC LLC', 'CORE BELIEFS LLC', 'TOLLEFSON CONSTRUCTION, INC'])
      expect(pgWordMatch(f.regex, n), n).toBe(false);
  });
  it('multi-word trading names tolerate punctuation and suffixes ("EFS Digital" ↔ "EFS-DIGITAL, L.L.C.")', () => {
    const f = localNameFilters('EFS Digital LLC')!;
    expect(f.ilike).toBe('%EFS%Digital%');
    expect(pgWordMatch(f.regex, 'EFS-DIGITAL, L.L.C.')).toBe(true);
    expect(pgWordMatch(f.regex, 'EFS  DIGITAL MARKETING')).toBe(true);
    expect(pgWordMatch(f.regex, 'REEFS DIGITAL')).toBe(false);
  });
  it('an empty or punctuation-only name has no filter', () => {
    expect(localNameFilters('  ')).toBeNull();
    expect(localNameFilters('%_')).toBeNull();
  });
});

describe('lookupLocalEntitiesByName — the query it sends', () => {
  it('both legal and DBA queries carry the whole-word regex and the state', async () => {
    await lookupLocalEntitiesByName('EFS Digital', 10, 'ct');
    expect(calls).toHaveLength(2);
    const cols = calls.map((c) => c.find(([m]) => m === 'filter')?.[1]);
    expect(cols).toEqual(['legal_business_name', 'dba_name']);
    for (const c of calls) {
      expect(c).toContainEqual(['filter', expect.any(String), 'imatch', '\\mEFS[^[:alnum:]]+Digital\\M']);
      expect(c).toContainEqual(['eq', 'physical_state', 'CT']);
    }
  });
  it('no state (or a non-state value) → no state filter', async () => {
    await lookupLocalEntitiesByName('EFS Digital', 10);
    await lookupLocalEntitiesByName('EFS Digital', 10, 'Connecticut ');
    expect(calls.every((c) => !c.some(([m]) => m === 'eq'))).toBe(true);
  });
});
