import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preserveRicherEnrichment } from './preserve-enrichment';

describe('preserveRicherEnrichment (MINDY-007)', () => {
  const stored = { psc_code: 'R422', description: 'CONSUMER RESEARCH', psc_description: 'Market research' };
  const searchNull = { psc_code: null, description: null, psc_description: null };

  it('does not let a null search payload erase stored PSC/description', () => {
    const next = preserveRicherEnrichment({ ...searchNull, piid: 'X' } as typeof searchNull & { piid: string }, stored);
    expect(next.psc_code).toBe('R422');
    expect(next.description).toBe('CONSUMER RESEARCH');
    expect(next.psc_description).toBe('Market research');
  });

  it('lets a non-null incoming value improve known data', () => {
    const next = preserveRicherEnrichment(
      { psc_code: 'R405', description: 'NEW TITLE', psc_description: 'Ops' },
      stored,
    );
    expect(next.psc_code).toBe('R405');
    expect(next.description).toBe('NEW TITLE');
    expect(next.psc_description).toBe('Ops');
  });

  it('lets incoming enrichment populate a currently-null stored row', () => {
    const next = preserveRicherEnrichment(
      { psc_code: 'R422', description: 'CONSUMER RESEARCH', psc_description: 'Market research' },
      { psc_code: null, description: null, psc_description: null },
    );
    expect(next.psc_code).toBe('R422');
    expect(next.description).toBe('CONSUMER RESEARCH');
    expect(next.psc_description).toBe('Market research');
  });

  it('treats blank strings as empty, not an improvement', () => {
    const next = preserveRicherEnrichment(
      { psc_code: '  ', description: '', psc_description: '\t' },
      stored,
    );
    expect(next.psc_code).toBe('R422');
    expect(next.description).toBe('CONSUMER RESEARCH');
    expect(next.psc_description).toBe('Market research');
  });

  it('inserts (no existing row) keep incoming nulls as honest empty', () => {
    const next = preserveRicherEnrichment(searchNull, undefined);
    expect(next.psc_code).toBeNull();
    expect(next.description).toBeNull();
  });

  it('hourly sync maps through preserveRicherEnrichment before upsert', () => {
    const src = readFileSync(
      join(__dirname, '../../app/api/cron/sync-recompete-contracts/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/preserveRicherEnrichment/);
    expect(src).toMatch(/toWrite/);
    expect(src).toMatch(/upsertContracts\(supabase, toWrite\)/);
  });

  it('full sweep also merges through preserveRicherEnrichment (does not wait on the DB trigger)', () => {
    const src = readFileSync(join(__dirname, '../../../scripts/sync-recompete-full.ts'), 'utf8');
    expect(src).toMatch(/preserveRicherEnrichment/);
    expect(src).toMatch(/toWrite/);
  });

  it('DB trigger refuses null/blank incoming over stored non-null', () => {
    const sql = readFileSync(
      join(__dirname, '../../../supabase/migrations/20260917_preserve_recompete_enrichment.sql'),
      'utf8',
    );
    expect(sql).toMatch(/preserve_recompete_enrichment/);
    expect(sql).toMatch(/BEFORE UPDATE ON recompete_opportunities/);
    expect(sql).toMatch(/btrim\(NEW\.psc_code\)/);
    expect(sql).toMatch(/btrim\(NEW\.description\)/);
  });
});
