/**
 * Guards the dashboard's classification-version selection.
 *
 * THE BUG (2026-08-04): the dashboard picked the "latest" classification version with
 * Math.max(). ONE row in customer_classifications carries classification_version = 999
 * — a sentinel/test value — against 1,476 rows on v3 and 254 on v2.
 *
 * Max latched onto 999, so the "keep only the latest version" filter discarded
 * 1,731 of 1,732 rows and kept exactly one. The dashboard reported:
 *
 *     briefingsEntitled       1     really 508
 *     briefingsCronEligible   1     really 113
 *     briefingsExpired        0     really 152
 *
 * Three numbers on a screen used to decide who receives briefings, all silently zeroed
 * by a single stray row. Nothing errored; the counts just quietly became meaningless.
 *
 * The tell that it was NOT the usual 1,000-row cap: the read was already paged, and
 * `briefings.sent = 114` (a real delivery count) sat correct right beside the wrong
 * numbers. Same screen, one source truthful and one not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/admin/dashboard/route.ts'),
  'utf8'
);

// Mirrors dominantClassificationVersion() in the route.
function dominant(rows: Array<{ classification_version?: number | null }>): number {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const v = Number(row.classification_version || 0);
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = 0, bestCount = -1;
  for (const [version, count] of counts) {
    if (count > bestCount || (count === bestCount && version > best)) {
      best = version; bestCount = count;
    }
  }
  return best;
}

const rows = (spec: Record<number, number>) =>
  Object.entries(spec).flatMap(([v, n]) =>
    Array.from({ length: n }, () => ({ classification_version: Number(v) })));

describe('a stray sentinel row cannot hijack the version', () => {
  it('ignores the single v999 row against the real corpus', () => {
    // The exact production distribution on 2026-08-04.
    const production = rows({ 1: 1, 2: 254, 3: 1476, 999: 1 });
    expect(dominant(production)).toBe(3);      // Math.max gave 999
  });

  it('keeps 1,730 of 1,732 rows instead of 1', () => {
    const production = rows({ 1: 1, 2: 254, 3: 1476, 999: 1 });
    const v = dominant(production);
    const kept = production.filter(r => Number(r.classification_version || 0) === v).length;
    expect(kept).toBe(1476);
    expect(kept).toBeGreaterThan(1000);        // the old filter kept exactly 1
  });

  it('is unmoved by several outliers', () => {
    expect(dominant(rows({ 3: 1476, 999: 5, 1000: 3 }))).toBe(3);
  });
});

describe('genuine version rollouts still advance', () => {
  it('follows the majority once it migrates', () => {
    expect(dominant(rows({ 3: 400, 4: 1300 }))).toBe(4);
  });

  it('breaks a tie toward the HIGHER version', () => {
    // A 50/50 rollout should read as the new version, not the old one.
    expect(dominant(rows({ 3: 500, 4: 500 }))).toBe(4);
  });

  it('handles a single-version corpus', () => {
    expect(dominant(rows({ 3: 1732 }))).toBe(3);
  });

  it('returns 0 for an empty set rather than throwing', () => {
    expect(dominant([])).toBe(0);
  });

  it('treats null/undefined versions as 0, not NaN', () => {
    expect(dominant([{ classification_version: null }, { classification_version: null }, {}])).toBe(0);
  });
});

describe('the route uses it at every site', () => {
  it('no longer reduces with Math.max over classification_version', () => {
    expect(SRC).not.toMatch(/Math\.max\(max,\s*Number\(row\.classification_version/);
  });

  it('both call sites go through the shared helper', () => {
    expect(SRC).toContain('function dominantClassificationVersion');
    // Two independent handlers in this file compute the same thing.
    expect(SRC.match(/dominantClassificationVersion\(classificationRows\)/g)?.length ?? 0).toBe(2);
  });
});
