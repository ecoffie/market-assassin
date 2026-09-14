/**
 * Guards forecast AGENCY IDENTITY PARITY across every surface that filters forecasts.
 *
 * ── HISTORY ──────────────────────────────────────────────────────────────────────────────
 * 2026-08-02: applyForecastFilters matched `department` only — NULL for most of the corpus —
 *   so NAVY/HHS/USACE returned ZERO on the map and in alerts. Fixed by ALSO matching
 *   `source_agency`. This file used to assert that literal two-column ILIKE shape.
 * 2026-09-14 (surface audit): that ILIKE shape was itself the defect. It failed both ways —
 *   9 of 16 map agency presets returned ZERO (DoD 11,789 rows, HHS 5,504, DHS 1,644 …
 *   only 21.5% of the corpus was reachable by agency), while `agency=EPA` returned 7,246
 *   rows against a real corpus of 50 because "d-EPA-rtment" contains "EPA".
 *   Both classes are now impossible: every surface resolves agency identity through the ONE
 *   shared resolver (src/lib/forecasts/agency-identity.ts) to EXACT `source_agency` codes.
 *
 * So this file no longer guards a matching SHAPE — it guards that no surface has drifted back
 * to its own private agency matching. That drift is the actual recurring failure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveForecastAgencies } from '@/lib/forecasts/agency-identity';

/**
 * Read a source file with COMMENTS STRIPPED.
 *
 * ⚠️ Non-negotiable for a source-text assertion. Every fix above is documented in a comment that
 * QUOTES the very pattern it removed ("was `source_agency.ilike.%term%`"), so a naive grep matches
 * the explanation and reports the bug as still present. That false positive is what trains people
 * to delete the guard. Same rule the silent-failure gate learned (scripts/audit-supabase-errors.mjs).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

const MAP_DATA = read('src/lib/opportunities/map-data.ts');
const MCP_QUERY = read('src/lib/forecasts/query.ts');
const FORECASTS_ROUTE = read('src/app/api/forecasts/route.ts');
const ALERT_CRON = read('src/app/api/cron/saved-search-alerts/route.ts');
const LIVE_UTIL = read('src/lib/utils/agency-forecasts-live.ts');

/** The agency block of applyForecastFilters. */
const forecastFilterBlock = MAP_DATA.slice(MAP_DATA.indexOf('export function applyForecastFilters'));

describe('forecast agency identity — one shared resolver', () => {
  it('the MAP (applyForecastFilters) resolves identity instead of substring-matching', () => {
    expect(forecastFilterBlock).toContain('forecastAgencyOrExpr(resolveForecastAgencies(');
    // The old two-column ILIKE must be gone from the agency path.
    expect(forecastFilterBlock).not.toContain("agencyOrExpr('department'");
    expect(forecastFilterBlock).not.toContain("agencyOrExpr('source_agency'");
  });

  it('MCP (queryForecasts) uses the SAME resolver, not its own ilike', () => {
    expect(MCP_QUERY).toContain("from '@/lib/forecasts/agency-identity'");
    expect(MCP_QUERY).toContain('forecastAgencyOrExpr(resolveForecastAgencies(');
    expect(MCP_QUERY).not.toContain("q.ilike('source_agency'");
    expect(MCP_QUERY).not.toContain('source_agency.ilike.%');
  });

  it('/api/forecasts uses the SAME resolver on both its agency sites', () => {
    expect(FORECASTS_ROUTE).toContain("from '@/lib/forecasts/agency-identity'");
    expect(FORECASTS_ROUTE).not.toContain("ilike('source_agency'");
    expect(FORECASTS_ROUTE).not.toContain('source_agency.ilike.%');
    // two call sites: the office rollup + the main list
    expect(FORECASTS_ROUTE.match(/forecastAgencyOrExpr\(resolveForecastAgencies\(/g)?.length).toBe(2);
  });

  it('the SAVED-SEARCH ALERT evaluator routes through applyForecastFilters (so it inherits the resolver)', () => {
    // This is what makes alert identity parity structural rather than a promise: the cron does
    // not do its own agency matching, it calls the same shared filter the map does.
    expect(ALERT_CRON).toContain('applyForecastFilters');
    expect(ALERT_CRON).not.toContain('source_agency.ilike');
    expect(ALERT_CRON).not.toContain("ilike('source_agency'");
  });

  it('the retired private resolver (fullNameToForecastAgency) has not come back', () => {
    // It was the FOURTH implementation: civilian-only and it mapped NRL -> ONR.
    expect(LIVE_UTIL).not.toContain('fullNameToForecastAgency');
    expect(LIVE_UTIL).toContain("from '@/lib/forecasts/agency-identity'");
    expect(LIVE_UTIL).not.toContain('source_agency.ilike.%');
  });

  it('no forecast surface emits a bare `source_agency.ilike.%…%` substring clause', () => {
    for (const [name, src] of Object.entries({ MAP_DATA, MCP_QUERY, FORECASTS_ROUTE, ALERT_CRON, LIVE_UTIL })) {
      expect(src, `${name} still substring-matches source_agency`).not.toMatch(/source_agency\.ilike\.%/);
    }
  });
});

describe('identity parity is a VALUE guarantee, not just a shared import', () => {
  // Surface TOTALS may legitimately differ (the map needs a coordinate; MCP applies the past-FY
  // rule). The AGENCY SET must not. These assert the resolved code set every surface receives.
  const PARITY: Array<[string, string[]]> = [
    ['DOD', ['NAVY', 'NRL', 'ONR', 'USACE']],
    ['Department of Defense', ['NAVY', 'NRL', 'ONR', 'USACE']],
    ['NAVY', ['NAVY', 'NRL', 'ONR']],
    ['ARMY', ['USACE']],
    ['USACE', ['USACE']],
    ['HHS', ['HHS']],
    ['EPA', ['EPA']],
    ['SEC', []],
  ];
  for (const [term, expected] of PARITY) {
    it(`"${term}" resolves identically for map, MCP and alerts -> [${expected.join(', ')}]`, () => {
      // One resolver, called with the shape each surface passes (map: pipe string,
      // MCP: comma string, alerts: raw saved_searches.filters.agency value).
      expect(resolveForecastAgencies(term).codes.sort()).toEqual([...expected].sort());
      expect(resolveForecastAgencies([term]).codes.sort()).toEqual([...expected].sort());
    });
  }
});
