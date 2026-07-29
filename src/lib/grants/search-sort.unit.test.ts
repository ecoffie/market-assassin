/**
 * FM-U07 grants sort guard (Eric/QA re-verify 2026-07-29).
 *
 * The grants.gov endpoint this lib uses (apply07.grants.gov/grantsws) ONLY accepts DATE sort fields
 * (openDate / closeDate). Any other value — relevancy, title, agencyCode — makes it return hitCount:0
 * with errorcode:0: a SILENT EMPTY, not an error. The first FM-U07 attempt set `relevancy|desc` on a
 * keyword and thereby zeroed out EVERY keyword grant search (live: "health" → 664 with openDate, 0 with
 * relevancy). This test asserts the payload sort stays a supported DATE field so that regression can't
 * come back. (The Federal Register half of FM-U07 has a genuine `relevance` order — this guard is only
 * about the grants.gov endpoint's constraint.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'search.ts'), 'utf8');

describe('FM-U07 grants sort field', () => {
  it('never sends a non-date sort to grants.gov (relevancy|title|agencyCode → silent 0 hits)', () => {
    // No forbidden sort field appears as a sortBy VALUE anywhere in the file.
    expect(src).not.toMatch(/sortBy:\s*[^;]*relevanc/i);
    expect(src).not.toMatch(/sortBy:\s*[^;]*['"]title\|/i);
    expect(src).not.toMatch(/sortBy:\s*[^;]*['"]agencyCode\|/i);
  });
  it('uses a supported date sort (openDate / closeDate)', () => {
    expect(src).toMatch(/sortBy:\s*['"]openDate\|desc['"]/);
  });
});
