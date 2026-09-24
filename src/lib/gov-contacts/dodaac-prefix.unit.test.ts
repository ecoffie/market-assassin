/**
 * The DoDAAC-prefix predicate is ONE definition, served by ONE index, used by EVERY surface.
 *
 * Why: federal_contacts (~298K rows) had no index on solicitation_number, so the W912PL
 * office lookup seq-scanned the table and timed out under concurrency (8s PostgREST
 * statement_timeout) — rendered downstream as "0 people" for an office with 182 contacts.
 * The fix is a trigram index that serves `solicitation_number ILIKE 'W912PL%'`. That only
 * holds while every surface emits exactly that operator on exactly that column, so:
 *   - the helper's output shape is pinned,
 *   - all three surfaces must route through the helper (no hand-rolled prefix ILIKE left),
 *   - the migration must build a gin_trgm_ops index on the same column.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DODAAC_PREFIX_COLUMN,
  dodaacPrefixPattern,
  withDodaacPrefix,
  dodaacPrefixOrExpr,
  MAX_DODAAC_PREFIX_CODES,
} from './dodaac-prefix';

const ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function recorder() {
  const calls: Array<[string, string]> = [];
  const q = {
    ilike(column: string, pattern: string) {
      calls.push([column, pattern]);
      return q;
    },
  };
  return { q, calls };
}

describe('dodaac-prefix — the indexable predicate', () => {
  it('emits a case-insensitive PREFIX match on solicitation_number for a valid code', () => {
    const { q, calls } = recorder();
    withDodaacPrefix(q, 'w912pl ');
    expect(calls).toEqual([['solicitation_number', 'W912PL%']]);
    expect(DODAAC_PREFIX_COLUMN).toBe('solicitation_number');
  });

  it('an invalid code leaves the query untouched (never a wildcard-only or injected filter)', () => {
    for (const bad of ['', 'W912', 'W912PLX', '%', 'W9%2PL', 'A,B.C', null, undefined]) {
      const { q, calls } = recorder();
      withDodaacPrefix(q, bad as string);
      expect(calls, String(bad)).toEqual([]);
      expect(dodaacPrefixPattern(bad as string)).toBeNull();
    }
  });

  it('OR expression: one ilike prefix per valid code, deduped, invalid dropped, capped', () => {
    expect(dodaacPrefixOrExpr(['W912PL', 'w912pl', 'junk', 'HR0011'])).toBe(
      'solicitation_number.ilike.W912PL%,solicitation_number.ilike.HR0011%',
    );
    expect(dodaacPrefixOrExpr(['junk', ''])).toBe('');
    const many = Array.from({ length: 80 }, (_, i) => `W9${String(i).padStart(4, '0')}`);
    expect(dodaacPrefixOrExpr(many).split(',')).toHaveLength(MAX_DODAAC_PREFIX_CODES);
  });
});

describe('every DoDAAC-prefix surface uses the shared predicate', () => {
  const surfaces = [
    'src/lib/gov-contacts/contact-roster.ts',
    'src/app/api/app/federal-contacts/route.ts',
    'src/app/api/app/contacts-map/route.ts',
  ];
  for (const rel of surfaces) {
    it(`${rel} imports dodaac-prefix and hand-rolls no solicitation_number prefix ILIKE`, () => {
      const src = read(rel);
      expect(src).toContain("from '@/lib/gov-contacts/dodaac-prefix'");
      expect(src).not.toMatch(/ilike\(\s*['"]solicitation_number['"]/);
      expect(src).not.toMatch(/solicitation_number\.ilike\./);
    });
  }

  it('federal-contacts route: dodaac path, agency-dodaac path, office-roster facet and emailable count all use it', () => {
    const src = read('src/app/api/app/federal-contacts/route.ts');
    expect(src).toMatch(/q = withDodaacPrefix\(q, validDodaac\)/);
    expect(src).toMatch(/eq = withDodaacPrefix\(eq, validDodaac\)/);
    expect(src).toMatch(/const orExpr = dodaacPrefixOrExpr\(dodaacCodes\)/);
    expect(src).toMatch(/\.or\(dodaacPrefixOrExpr\(rosterCodes\)\)/);
  });
});

describe('the predicate has an index that can serve it', () => {
  const sql = read('supabase/migrations/20260923_federal_contacts_solnum_prefix_idx.sql');
  it('is a non-transactional, idempotent CONCURRENTLY build', () => {
    expect(sql.split('\n')[0].trim()).toBe('-- migrate:no-transaction');
    expect(sql).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fed_contacts_solnum_trgm/);
  });
  it('is a trigram GIN on the RAW column (ILIKE-servable; an upper() btree is not)', () => {
    expect(sql).toMatch(/ON federal_contacts USING gin \(solicitation_number gin_trgm_ops\)/);
  });
});
