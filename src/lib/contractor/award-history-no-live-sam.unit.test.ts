/**
 * Research-mode parity gate (Agent 4, Mindy Day 11/28): get_contractor_award_history must resolve identity from
 * Mindy's caches — the local sam_entities mirror and cached certs — and never call live SAM. Verified by code trace
 * 2026-11-25; this guard keeps it true. If a live call is ever added here, route it through ctx.samCacheOnly first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const LIVE = /\b(getEntityByUEI|searchEntities|lookupSamEntity|resolveUei|makeSAMRequest|refreshCertForUei\w*)\s*\(|api\.sam\.gov/;

describe('get_contractor_award_history never calls live SAM', () => {
  for (const f of [
    'src/mcp/tools/contractor-award-history.ts',
    'src/lib/contractor/history-by-uei.ts',
    'src/lib/contractor/award-history-existence.ts',
    'src/lib/contractor/name-resolution.ts',
    'src/lib/contractor-sales-history.ts',
  ]) {
    it(`${f} has no live SAM call`, () => {
      expect(read(f)).not.toMatch(LIVE);
    });
  }
  it('UEI resolution is the local mirror; certifications come from the cache', () => {
    expect(read('src/lib/contractor/history-by-uei.ts')).toMatch(/lookupLocalEntityByUEI\(/);
    const recipients = read('src/lib/bigquery/recipients.ts');
    expect(recipients).toMatch(/getCachedCerts/);
    expect(recipients).not.toMatch(LIVE);
  });
});
