/**
 * Guards the past-fiscal-year exclusion in the forecast query.
 *
 * THE BUG (found 2026-08-01, after 8 new sources took agency_forecasts from
 * 9,733 to 30,635 rows): the exclusion ran only in memory, AFTER an
 * `OVERFETCH = 500` cap. When an agency's corpus is mostly historical, those
 * 500 rows are consumed by past-dated records that the filter then discards —
 * so the tool returned **8 of HHS's 689** usable forecasts. NAVY reported a
 * total of "500" against 8,699 real rows.
 *
 * The filter has to run in SQL. Getting the PostgREST expression right took
 * three attempts, and each failure mode is worth pinning because they all look
 * plausible:
 *
 *   or(is.null, not.ilike each stale)  → 3,643 (no filtering at all: an .or of
 *                                       negations is TRUE for every row)
 *   chained .not per year              →   687 (silently drops NULL fiscal_year:
 *                                       `col NOT LIKE x` is NULL, not TRUE)
 *   or(is.null, ilike each FUTURE)     →   689 ✓ exact
 *
 * Measured against HHS, whose truth is 689 future-or-undated of 3,643.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/lib/forecasts/query.ts'), 'utf8');

describe('past-fiscal-year exclusion', () => {
  it('runs in SQL, not only in memory', () => {
    // The in-memory pass alone starves agencies whose corpus is mostly
    // historical, because OVERFETCH truncates before the filter sees the rows.
    const beforeFetch = SRC.slice(0, SRC.indexOf('const OVERFETCH'));
    expect(beforeFetch).toContain('input.includePast');
    expect(beforeFetch).toMatch(/fiscal_year\.is\.null/);
  });

  it('WHITELISTS future years rather than blacklisting stale ones', () => {
    // A blacklist expressed as an .or of negations matches every row, and a
    // chained .not drops NULLs. Both were measured wrong; only the whitelist
    // is exact.
    expect(SRC).toMatch(/fiscal_year\.ilike\.%\$\{y\}%|fiscal_year\.ilike\.%/);
    expect(SRC).not.toMatch(/q\s*=\s*q\.not\('fiscal_year',\s*'ilike'/);
  });

  it('keeps rows with NO fiscal year', () => {
    // Unknown timing is not past timing, and most of the corpus is undated —
    // DOE is 100% undated and a NULL-dropping filter emptied it completely.
    expect(SRC).toContain('fiscal_year.is.null');
  });

  it('respects includePast by skipping the filter entirely', () => {
    // Assert the STRUCTURE (guard opens before the clause), not proximity — the
    // explanatory comment sits between them, so a character-window check is
    // brittle and fails on a doc edit rather than a behaviour change.
    const guardIdx = SRC.indexOf('if (!input.includePast)');
    const clauseIdx = SRC.indexOf('fiscal_year.is.null');
    expect(guardIdx, 'includePast guard must exist').toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(clauseIdx);
  });

  it('reports the POST-filter total, not the OVERFETCH ceiling', () => {
    // Previously clamped to rowsRaw.length, so NAVY showed "500" for 8,699.
    expect(SRC).not.toMatch(/Math\.min\(count \?\? rowsRaw\.length, rowsRaw\.length\)/);
    expect(SRC).toMatch(/filteredTotal[\s\S]{0,200}count \?\? rowsRaw\.length/);
  });

  it('documents why the OVERFETCH cap is safe now', () => {
    // The cap still exists; it is only safe because the fetch is pre-filtered.
    expect(SRC).toContain('OVERFETCH');
    expect(SRC).toMatch(/starv|HHS|8 of 689|past-dated/i);
  });
});
