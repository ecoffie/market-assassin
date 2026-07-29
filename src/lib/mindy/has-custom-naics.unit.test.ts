/**
 * hasCustomNaics dedup (Eric/QA 2026-07-28). Three admin surfaces (qualify-customers,
 * mi-growth-brief, dashboard) each carried their own "is this profile custom?" logic to gauge
 * "profile complete". One — the dashboard's inline getBootcampRollout block — had DRIFTED: it only
 * treated a profile as non-custom when the array was EXACTLY the full 5-code default set, so a single
 * default code (['541512']) wrongly counted as custom and inflated profilesCompleted / readyForAlerts.
 * Fix: all three import the shared canonical (src/lib/mindy/upgrade-intent.ts hasCustomNaics =
 * "at least one code outside the default set"). This locks the canonical + asserts the drift is gone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasCustomNaics } from './upgrade-intent';

describe('hasCustomNaics — the canonical semantics', () => {
  it('a single DEFAULT code is NOT custom (the exact drift case)', () => {
    expect(hasCustomNaics(['541512'])).toBe(false);
  });
  it('the full default set is NOT custom', () => {
    expect(hasCustomNaics(['541512', '541611', '541330', '541990', '561210'])).toBe(false);
  });
  it('any code outside the default set IS custom', () => {
    expect(hasCustomNaics(['236220'])).toBe(true);
    expect(hasCustomNaics(['541512', '236220'])).toBe(true); // default + real → custom
  });
  it('empty / null → NOT custom (no profile is not a custom profile)', () => {
    expect(hasCustomNaics([])).toBe(false);
    expect(hasCustomNaics(null)).toBe(false);
    expect(hasCustomNaics(undefined)).toBe(false);
  });
});

describe('the drifted variant is gone + all three admin routes use the canonical', () => {
  const dashboard = readFileSync(
    join(__dirname, '../../app/api/admin/dashboard/route.ts'), 'utf8');
  const qualify = readFileSync(
    join(__dirname, '../../app/api/admin/qualify-customers/route.ts'), 'utf8');
  const growth = readFileSync(
    join(__dirname, '../../app/api/admin/mi-growth-brief/route.ts'), 'utf8');

  it('the drifted "exactly the default set" test no longer exists in dashboard', () => {
    expect(dashboard).not.toContain('naics.length === DEFAULT_NAICS.length');
  });
  it('all three routes import the canonical hasCustomNaics', () => {
    for (const src of [dashboard, qualify, growth]) {
      expect(src).toContain("from '@/lib/mindy/upgrade-intent'");
    }
  });
  it('no route redefines its own hasCustomNaics function anymore', () => {
    for (const src of [dashboard, qualify, growth]) {
      expect(src).not.toMatch(/function hasCustomNaics\s*\(/);
    }
  });
});
