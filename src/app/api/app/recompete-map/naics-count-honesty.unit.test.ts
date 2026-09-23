import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapsRecompeteRequest } from '@/lib/recompete/maps-recompete-discovery';

/**
 * The count must describe the SAME universe as the rows.
 *
 * A demo attendee reported "I cant filter with 333612" (2026-08-22). The filter worked and
 * every rendered card was 333612 — but the header said "3,555 results" when the true total
 * was 805, so they concluded nothing had happened.
 *
 * The cause was here: a single-code NAICS search widened to its 3-digit family for the COUNT
 * query — `naics_code.eq.333612 OR naics_code.like.333%` — which is 3,528 rows against 118
 * real matches. The map header sums each horizon's totalForFilters, so that number became the
 * headline.
 *
 * This is a source-level guard because the defect is a query-shape mistake, not a behaviour
 * reachable from a unit test without a live database. The browser-level contract test
 * (scripts/verify-filter-contract.mjs) covers the end-to-end assertion.
 */
const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/app/recompete-map/route.ts'),
  'utf8',
);

describe('recompete-map NAICS count honesty', () => {
  it('does not widen a full NAICS code to its 3-digit family', () => {
    // The exact shape that caused the bug. If this reappears, the count starts lying again.
    expect(SRC).not.toMatch(/naics_code\.like\.\$\{[^}]*substring\(0,\s*3\)/);
    expect(SRC).not.toContain('substring(0, 3)');
  });

  it('uses the shared naicsMatchConds gold master (prefix <6, exact at 6, multi OR)', () => {
    // Since Phase C2 (2026-09-22) the route executes the canonical discovery plan, which applies the
    // gold master (route → maps-recompete-discovery.ts → discovery/plan.ts). Asserted on that path AND
    // behaviourally: the exact demo case must stay exact.
    const path = ['src/lib/recompete/maps-recompete-discovery.ts', 'src/lib/discovery/plan.ts']
      .map((f) => readFileSync(join(process.cwd(), f), 'utf8')).join('\n');
    expect(SRC).toContain('applyMapsRecompeteFilters');
    expect(path).toContain('applyRecompetePlan');
    expect(path).toMatch(/naicsMatchConds\(inputNaics\)\.join\(','\)/);
    expect(path).not.toContain('substring(0, 3)');
    const ops = (params: Record<string, string>) => mapsRecompeteRequest((k) => params[k] ?? null, { ctx: { today: '2026-09-22', fiscalYear: 2026 } })
      .plan.horizons.recompete.ops.filter((o) => o.op === 'or').map((o) => (o as { expr: string }).expr);
    expect(ops({ naics: '333612' })).toContain('naics_code.eq.333612');
    expect(ops({ naics: '333612' }).join()).not.toMatch(/naics_code\.like\.333%/);
    expect(ops({ naics: '333' })).toContain('naics_code.like.333%');
    expect(ops({ naics: '541512,541611' })).toContain('naics_code.eq.541512,naics_code.eq.541611');
  });

  it('applies the same filter builder to the count and the rows', () => {
    // The contract only holds if one function feeds both. If the count query stops going
    // through applyFilters, the two can drift apart again silently.
    expect(SRC).toMatch(/totalForFiltersHead\s*=\s*applyFilters\(/);
    expect(SRC).toMatch(/applyFilters\(db\.from\('recompete_opportunities'\)\.select\(COLS/);
  });
});
