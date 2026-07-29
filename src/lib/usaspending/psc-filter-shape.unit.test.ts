/**
 * USASpending spending_by_award PSC filter shape (FM-05, Eric/QA 2026-07-28). The endpoint rejects
 * `psc_codes: { require: ['1385'] }` with HTTP 422 ("'1385' is not a valid type (array)") — that tiered
 * `require` form is for an array-of-arrays hierarchy path; a flat code must be passed as a FLAT array
 * `psc_codes: ['1385']`. The broken form made search_past_contracts (and IDV search, and weekly-briefing
 * PSC matching) silently 422 → degraded/empty for a valid PSC (psc 1385 EOD tools returned nothing though
 * Parsons/KBR/Foster-Miller hold real awards). This locks the flat shape in every spending_by_award caller
 * so the regression can't creep back via copy-paste. (naics_codes legitimately DOES take { require }.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CALLERS = [
  '../usaspending/awards-search.ts',
  '../idv-search.ts',
  '../../app/api/cron/precompute-weekly-briefings/route.ts',
];

describe('every spending_by_award caller passes psc_codes as a FLAT array (FM-05)', () => {
  for (const rel of CALLERS) {
    const path = join(__dirname, rel);
    const src = readFileSync(path, 'utf8');
    const name = rel.split('/').pop();

    it(`${name} does NOT use the 422-ing psc_codes: { require } form`, () => {
      // No `psc_codes = { require` / `psc_codes: { require` anywhere (comments quoting the bug are fine
      // because they don't assign — match only an actual assignment to the require-object form).
      expect(src).not.toMatch(/psc_codes\s*[:=]\s*\{\s*require/);
    });

    it(`${name} assigns psc_codes as a flat array`, () => {
      expect(src).toMatch(/psc_codes\s*[:=]\s*\[/);
    });
  }
});
