/**
 * Regression tests for the four defects found in PR #1609 review at bcedf465.
 *
 * Each block below is a bug that shipped, not a hypothetical. The behavioural
 * assertions (forecast summary) exercise real logic; the source assertions
 * guard properties that only exist as code shape — a script that "does not call
 * BigQuery by default" cannot be proven by running it, only by reading it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateSummary,
  FORECAST_SUMMARY_VERSION,
  FORECAST_SUMMARY_MAX_AGE_MS,
  type StoredForecastSummary,
} from './forecasts-summary';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Strip comments before asserting a file does NOT contain something.
 *
 * These files document the very defects they fix, so their prose legitimately
 * contains the banned strings — the docblock quotes the MCP call site as
 * `getRollupOrSingleBySlug(slug, true)`, and explains that the old code read
 * `agency_forecasts`. Twice now a test has failed on its own explanation.
 * Assert against CODE.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const parity = code(read('scripts/seo-mcp-parity-report.ts'));
const warmer = code(read('scripts/warm-contractor-slugs.ts'));
const summaryLib = code(read('src/lib/seo/forecasts-summary.ts'));
const builder = code(read('scripts/build-forecast-summary.ts'));
const page = code(read('src/app/forecasts/page.tsx'));

// ── DEFECT 1 ────────────────────────────────────────────────────────────────
// The parity report resolved with liveBq=true unconditionally, so simply
// running the diagnostic spent BigQuery — and did, twice.
describe('defect 1 — parity report is cache-only by default', () => {
  it('gates live resolution behind an explicit --live-bq flag', () => {
    expect(parity).toContain("argv.includes('--live-bq')");
  });

  it('passes the flag to BOTH live resolver calls, never a hardcoded true', () => {
    expect(parity).toContain('getRollupOrSingleBySlug(slug, liveBq)');
    expect(parity).toContain('resolveCanonicalSlug(slug, liveBq)');
    expect(parity).not.toContain('getRollupOrSingleBySlug(slug, true)');
    expect(parity).not.toContain('resolveCanonicalSlug(slug, true)');
  });

  it('will not claim a source-data verdict it cannot measure cache-only', () => {
    // Saying "genuinely gone" from a cache miss is the error class this whole
    // audit was about: asserting a fact that was never measured.
    expect(parity).toContain("'unknown (cache-only)'");
  });
});

// ── DEFECT 2 ────────────────────────────────────────────────────────────────
// The alias dry run estimated CANONICAL_SLUG_SQL (scalar, bound on
// @slug/@normSlug) while execution ran CANONICAL_SLUG_BATCH_SQL with array
// params. The estimate described a different query and could not even bind.
describe('defect 2 — the warmer estimates exactly what it would execute', () => {
  it('dry-runs the BATCH sql, not the scalar sql', () => {
    expect(warmer).toContain('bqDryRun({ query: CANONICAL_SLUG_BATCH_SQL, params })');
    expect(warmer).not.toMatch(/bqDryRun\(\{\s*query:\s*CANONICAL_SLUG_SQL/);
  });

  it('does not import the scalar canonical sql at all', () => {
    // Importing it invites the mismatch back.
    expect(warmer).not.toMatch(/^\s*CANONICAL_SLUG_SQL,$/m);
  });

  it('builds the params ONCE and reuses that object for the estimate', () => {
    // Estimating one parameter set and executing another is the same defect in
    // a different coat.
    expect(warmer).toContain('const params = { slugs: part, normSlugs: part.map(normalizeCompanyName) }');
  });

  it('still dry-runs the profile scan against its own sql', () => {
    expect(warmer).toContain('bqDryRun({ query: ROLLUP_BY_SLUG_SQL, params: { slugs: part } })');
  });
});

// ── DEFECT 3 ────────────────────────────────────────────────────────────────
// A byte-denominated dry run cannot predict the CPU-to-bytes refusal that this
// query has actually hit (9,106 CPU-sec vs 27 MB), so no estimate authorizes it.
describe('defect 3 — alias batch execution is disabled', () => {
  it('never calls the batch alias resolver', () => {
    expect(warmer).not.toContain('resolveCanonicalSlugsBatch(');
  });

  it('records why, naming the CPU refusal rather than a vague caveat', () => {
    expect(warmer).toContain('ALIAS_EXECUTION_DISABLED_REASON');
    expect(warmer).toMatch(/9,?106 CPU/);
  });

  it('requires an authorized bounded runtime probe to re-enable', () => {
    expect(warmer).toMatch(/bounded runtime probe/i);
  });

  it('leaves profile warming executable — it is a different query shape', () => {
    // ROLLUP_BY_SLUG_SQL is a single-table filter with no UNNEST join.
    expect(warmer).toContain('getRollupsBySlugBatch(part, String(L.maxBytesPerScan))');
  });

  it('does not report unresolved slugs as "genuinely gone"', () => {
    expect(warmer).toContain('status UNKNOWN');
    expect(warmer).not.toContain('genuinely gone → 404');
  });
});

// ── DEFECT 4 ────────────────────────────────────────────────────────────────
// /forecasts paged the whole agency_forecasts table on the request path, twice
// per render (generateMetadata calls the loader separately).
describe('defect 4 — /forecasts reads a compact materialized summary', () => {
  it('the page data layer never queries the table', () => {
    expect(summaryLib).not.toContain('agency_forecasts');
    expect(summaryLib).not.toContain('@supabase/supabase-js');
    expect(summaryLib).not.toContain('.range(');
  });

  it('shares ONE read between metadata and page render via React cache()', () => {
    expect(summaryLib).toContain("import { cache } from 'react'");
    expect(summaryLib).toContain('cache(async (): Promise<ForecastSummary>');
    // Both call sites use the same memoized accessor.
    expect(page.match(/getForecastSummary\(\)/g)?.length).toBe(2);
  });

  it('the page never touches BigQuery or Supabase directly', () => {
    for (const bad of ['bqQuery', 'BQ_TABLES', '@supabase/supabase-js']) {
      expect(page).not.toContain(bad);
    }
  });

  const base: StoredForecastSummary = {
    version: FORECAST_SUMMARY_VERSION,
    builtAt: '2026-09-21T00:00:00.000Z',
    total: 35912,
    truncated: false,
    agencies: [{ key: 'a', label: 'A', count: 1 }],
    naics: [{ key: '541519', label: 'x', count: 1 }],
    fiscalYears: [{ key: 'FY2026', label: 'FY2026', count: 1 }],
    setAsides: [{ key: 's', label: 's', count: 1 }],
    sources: [{ key: 'csv', label: 'csv', count: 1 }],
    lastSynced: '2026-09-20T13:00:31.327Z',
  };
  const now = Date.parse('2026-09-21T01:00:00.000Z');

  it('publishes a complete, fresh summary', () => {
    const r = evaluateSummary(base, now);
    expect(r.available).toBe(true);
    expect(r.total).toBe(35912);
  });

  it('FAILS CLOSED on a truncated summary — undercounting is worse than nothing', () => {
    const r = evaluateSummary({ ...base, truncated: true }, now);
    expect(r.available).toBe(false);
    expect(r.reason).toBe('summary-truncated');
  });

  it('FAILS CLOSED when nothing has been materialized', () => {
    expect(evaluateSummary(null, now).reason).toBe('no-summary-materialized');
  });

  it('FAILS CLOSED on a stale summary', () => {
    const r = evaluateSummary(base, now + FORECAST_SUMMARY_MAX_AGE_MS + 1);
    expect(r.available).toBe(false);
    expect(r.reason).toBe('summary-stale');
  });

  it('FAILS CLOSED on a different stored version', () => {
    const r = evaluateSummary({ ...base, version: 'v0' }, now);
    expect(r.reason).toBe('summary-shape-invalid-or-wrong-version');
  });

  it('FAILS CLOSED on a malformed or zero-total object', () => {
    expect(evaluateSummary({ ...base, total: 0 }, now).available).toBe(false);
    expect(evaluateSummary({ ...base, agencies: 'nope' }, now).available).toBe(false);
    expect(evaluateSummary('garbage', now).available).toBe(false);
  });

  it('an unavailable summary never leaks a partial count to the renderer', () => {
    const r = evaluateSummary({ ...base, truncated: true }, now);
    expect(r.total).toBe(0);
    expect(r.agencies).toEqual([]);
  });

  it('the builder derives total from an authoritative COUNT, not rows transferred', () => {
    expect(builder).toContain("select('*', { count: 'exact', head: true })");
    expect(builder).toContain('total: count');
  });

  it('the builder marks truncation when transfer and count disagree', () => {
    expect(builder).toContain('rows.length !== count');
    expect(builder).toContain('truncated = true');
  });

  it('the builder is dry-run by default', () => {
    expect(builder).toContain("process.argv.includes('--go')");
    expect(builder).toContain('DRY RUN — nothing written');
  });
});
