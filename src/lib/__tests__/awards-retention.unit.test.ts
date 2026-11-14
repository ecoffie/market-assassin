/**
 * Serving-table retention (2026-11-14). Build 12 kept only the current top 12,000 by spend, so
 * 251 contractors the previous generation served lost their /contracts pages (9 of them were in
 * the Search Console 404 sample, 200 → 5xx). The build now retains every contractor the active
 * and previous generations serve that is still a canonical rollup, and promotion stops on any
 * unexplained removal. docs/SEO-RECOVERY-2026-11.md has the measurements.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const bq = vi.hoisted(() => ({ rows: [] as unknown[], calls: [] as Array<{ query: string; params?: Record<string, unknown> }> }));
vi.mock('@/lib/bigquery/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  bqQuery: vi.fn(async (o: { query: string; params?: Record<string, unknown> }) => { bq.calls.push(o); return bq.rows; }),
}));
vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: { set: vi.fn(), get: vi.fn(), del: vi.fn() } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

import {
  BUILD_QUERY, ELIGIBLE_LIMIT, retainParam, classifyRemovals, compareCoverage, REMOVAL_REVIEW_PCT,
} from '../awards-refresh';

beforeEach(() => { bq.rows = []; bq.calls = []; });

describe('BUILD_QUERY eligibility', () => {
  it('= the top 12,000 by spend PLUS served contractors that are still the canonical rollup for their slug', () => {
    expect(ELIGIBLE_LIMIT).toBe(12000);
    expect(BUILD_QUERY).toMatch(/ROW_NUMBER\(\) OVER \(ORDER BY total_obligated DESC\) AS spend_rank/);
    expect(BUILD_QUERY).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY slug ORDER BY total_obligated DESC\) AS slug_rank/);
    expect(BUILD_QUERY).toMatch(/WHERE spend_rank <= 12000\s+OR \(rollup_uei IN UNNEST\(@retain_ueis\) AND slug_rank = 1\)/);
  });
  it('the slug is computed with the same SQL the contractor pages use', () => {
    const recipients = readFileSync('src/lib/bigquery/recipients.ts', 'utf8');
    expect(recipients).toMatch(/export const COMPUTED_SLUG_SQL/);
    expect(readFileSync('src/lib/awards-refresh.ts', 'utf8')).toMatch(/\$\{COMPUTED_SLUG_SQL\('rollup_name'\)\} AS slug/);
  });
  it('still keys rows by the rollup UEI over de-duplicated child UEIs (no duplicate awards or pages)', () => {
    expect(BUILD_QUERY).toMatch(/SELECT DISTINCT e\.rollup_uei, u AS uei FROM elig e, UNNEST\(e\.child_ueis\) AS u/);
    expect(BUILD_QUERY).toMatch(/GROUP BY r\.recipient_uei, page_number/);
  });
  it('an empty retain list becomes a sentinel (BigQuery rejects an untyped empty array)', () => {
    expect(retainParam([])).toEqual(['__none__']);
    expect(retainParam(['A', 'B'])).toEqual(['A', 'B']);
  });
});

describe('classifyRemovals (verified against the warehouse)', () => {
  it('maps each removed contractor to a reason; qualifying data still present = unexplained', async () => {
    bq.rows = [
      { rollup_uei: 'B', slug_rank: 2, positive_actions: 40 },
      { rollup_uei: 'C', slug_rank: 1, positive_actions: 0 },
      { rollup_uei: 'D', slug_rank: 1, positive_actions: 12 },
    ];
    const r = await classifyRemovals(['A', 'B', 'C', 'D']);
    expect(Object.fromEntries(r)).toEqual({
      A: 'not-a-rollup', B: 'not-canonical-for-slug', C: 'no-qualifying-awards', D: 'unexplained',
    });
    expect(bq.calls[0].params).toEqual({ removed: ['A', 'B', 'C', 'D'] });
  });
  it('no removals ⇒ no BigQuery query', async () => {
    expect((await classifyRemovals([])).size).toBe(0);
    expect(bq.calls).toHaveLength(0);
  });
});

describe('compareCoverage (staging vs the active generation)', () => {
  const set = (n: number, p = 'U') => new Set(Array.from({ length: n }, (_, i) => `${p}${i}`));

  it('reports retained / added / restored-from-previous / removed and page change', () => {
    const active = set(1000);
    const previous = new Set([...set(990), 'OLD1', 'OLD2']);
    const staging = new Set([...active, 'OLD1', 'NEW1']);
    const r = compareCoverage({ active, previous }, staging, new Map(), { live: 2500, staging: 2510 });
    expect(r).toMatchObject({ ok: true, retained: 1000, added: 2, restoredFromPrevious: 1, removed: 0 });
    expect(r.pages).toEqual({ live: 2500, staging: 2510, delta: 10 });
  });

  it('STOPS on any unexplained removal of a served contractor', () => {
    const active = set(1000);
    const staging = new Set([...active].filter((u) => u !== 'U7'));
    const r = compareCoverage({ active, previous: new Set() }, staging, new Map([['U7', 'unexplained']]), { live: 1, staging: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/1 served contractor\(s\) removed with qualifying award data/);
    expect(r.removedSample).toEqual([{ recipient_uei: 'U7', reason: 'unexplained' }]);
  });

  it('a removal with no classified reason is treated as unexplained', () => {
    const active = set(10);
    const staging = new Set([...active].filter((u) => u !== 'U3'));
    expect(compareCoverage({ active, previous: new Set() }, staging, new Map(), { live: 1, staging: 1 }).ok).toBe(false);
  });

  it('allows a few EXPLAINED removals (merged, non-canonical, no qualifying awards)', () => {
    const active = set(1000);
    const gone = ['U1', 'U2', 'U3'];
    const staging = new Set([...active].filter((u) => !gone.includes(u)));
    const reasons = new Map<string, 'not-a-rollup' | 'not-canonical-for-slug' | 'no-qualifying-awards'>([
      ['U1', 'not-a-rollup'], ['U2', 'not-canonical-for-slug'], ['U3', 'no-qualifying-awards'],
    ]);
    const r = compareCoverage({ active, previous: new Set() }, staging, reasons, { live: 1, staging: 1 });
    expect(r).toMatchObject({ ok: true, removed: 3, removedByReason: { 'not-a-rollup': 1, 'not-canonical-for-slug': 1, 'no-qualifying-awards': 1 } });
  });

  it(`STOPS for review when explained removals exceed ${REMOVAL_REVIEW_PCT}% of the active generation`, () => {
    const active = set(1000);
    const gone = [...active].slice(0, 25);
    const staging = new Set([...active].slice(25));
    const reasons = new Map(gone.map((u) => [u, 'not-a-rollup' as const]));
    const r = compareCoverage({ active, previous: new Set() }, staging, reasons, { live: 1, staging: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/25 served contractors removed \(> 2% of 1000\)/);
  });
});

describe('worker wiring', () => {
  const src = readFileSync('src/app/api/cron/awards-build-worker/route.ts', 'utf8');
  it('reads the served contractors BEFORE the build and refuses to build if it cannot', () => {
    expect(src.indexOf('readServedRecipients()')).toBeLessThan(src.indexOf('query: BUILD_QUERY'));
    expect(src).toMatch(/return await fail\('coverage-read'/);
  });
  it('passes them to the build as @retain_ueis', () => {
    expect(src).toMatch(/params: \{ retain_ueis: retainParam\(served\.retain\) \}/);
  });
  it('runs the coverage check before the size check; a coverage refusal is terminal and recorded', () => {
    expect(src.indexOf('compareCoverage(')).toBeLessThan(src.indexOf('checkPlausibility('));
    expect(src).toMatch(/fail\('coverage', coverage\.reason \?\? 'coverage regression', true, \{ coverage \}\)/);
    expect(src).toMatch(/plausibility: p\.record, usedSizeOverride: p\.usedOverride,\s+coverage,/);
  });
});
