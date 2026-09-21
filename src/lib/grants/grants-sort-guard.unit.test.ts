/**
 * Repo-wide grants.gov sort guard (FM-U07 re-verify, 2026-07-29).
 *
 * The grants.gov search endpoints only sort by DATE fields (openDate / closeDate). Any other sort
 * value — relevancy, title, agencyCode, oppNumber — makes the endpoint return hitCount:0 with
 * errorcode:0: a SILENT EMPTY, not an error. That regression zeroed out EVERY keyword grant search on
 * the MCP surface (live: "health" → 664 with openDate, 0 with relevancy) and shipped only because the
 * per-file guard covered ONE call site. Grants.gov is called from FOUR independent files (the FM-07
 * duplicate-path class), so this guard scans ALL of them: every `sortBy:` literal in any grants source
 * must be a date field. A future edit that reintroduces `relevancy` on ANY path fails the push here.
 *
 * (In-app relevance RANKING is fine — it's done by scoring the returned rows in app code, NOT by asking
 * grants.gov to sort. This guard only polices the `sortBy` sent TO grants.gov.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Every file that issues a grants.gov search request. If you add another grants.gov caller, add it here.
const GRANTS_CALL_SITES = [
  '../../lib/grants/search.ts',
  '../../app/api/grants/route.ts',
  '../../lib/briefings/pipelines/grants-gov.ts',
  '../../lib/scrapers/apis/grantsgov-all.ts',
];

// Strip line + block comments so a comment that mentions `relevancy` (like the fix note) isn't flagged.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const ALLOWED_SORT = /^(openDate|closeDate)\|(asc|desc)$/;

describe('grants.gov sort guard (all call sites)', () => {
  for (const rel of GRANTS_CALL_SITES) {
    it(`${rel} sends only a DATE sort to grants.gov (never relevancy/title/etc.)`, () => {
      const code = stripComments(readFileSync(join(__dirname, rel), 'utf8'));
      // Every `sortBy: '<value>'` literal must be a supported date sort.
      const sorts = [...code.matchAll(/sortBy:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of sorts) {
        expect(ALLOWED_SORT.test(s), `disallowed grants sortBy "${s}" in ${rel}`).toBe(true);
      }
      // Also catch the ternary form `keyword ? 'relevancy|desc' : ...` that started the regression.
      expect(code).not.toMatch(/sortBy:\s*[^,\n]*relevanc/i);
    });
  }
});
