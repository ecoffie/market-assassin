/**
 * Guards the forecast AGENCY filter against the column it forgot.
 *
 * THE BUG (found 2026-08-02 while wiring forecast alerts): applyForecastFilters
 * matched on `department` only. That column is NULL for over half the corpus —
 * NAVY (8,821 rows), HHS (3,643) and USACE (2,908) store the agency in
 * `source_agency` — so an agency filter returned ZERO for them, silently, on the
 * map as well as in alerts. A saved search for "HHS forecasts" matched nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/lib/opportunities/map-data.ts'), 'utf8');

describe('forecast agency filter', () => {
  it('matches on source_agency as well as department', () => {
    // Either column alone loses half the corpus: `department` is null for
    // NAVY/HHS/USACE, and `source_agency` is the only place they carry it.
    const block = SRC.slice(SRC.indexOf('export function applyForecastFilters'));
    expect(block).toContain("agencyOrExpr('department'");
    expect(block).toContain("agencyOrExpr('source_agency'");
  });

  it('combines them into ONE .or() — not two chained filters', () => {
    // Two chained .or() calls AND together, which matches only rows carrying the
    // agency in BOTH columns — i.e. almost nothing. They must be one OR.
    const block = SRC.slice(SRC.indexOf('export function applyForecastFilters'));
    expect(block).toMatch(/\[agencyOrExpr\([\s\S]{0,120}\]\s*\n?\s*\.filter\(Boolean\)\.join\(','\)/);
  });
});
