/**
 * GUARD — every agency in the Competition Health picker must RESOLVE to a USASpending toptier.
 *
 * The failure this prevents is silent, which is what makes it worth a test: `computeCompetitionDepth`
 * deliberately REFUSES to sample when it can't confidently map a SAM department long-name to a
 * USASpending toptier name (a guess would pull a DIFFERENT agency's awards and present them as this
 * buyer's competition). So an unresolvable agency doesn't error — it just renders a card with no
 * competition depth, and nobody notices until someone asks why that one buyer has no bidder data.
 *
 * Adding an agency to the picker is a one-line edit that looks obviously safe. This test is what
 * makes it actually safe.
 *
 * Source-level on purpose: it reads the picker list out of the admin page and the resolver out of
 * the lib, so the two files cannot drift apart without failing here. No network — resolution is
 * pure string logic (the TOPTIER map + the "X, DEPARTMENT OF" regex fallback).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PICKER = join(process.cwd(), 'src/app/admin/competition-health/page.tsx');
const DEPTH = join(process.cwd(), 'src/lib/analytics/competition-depth.ts');

/** Pull the AGENCIES array out of the admin page source. */
function pickerAgencies(): string[] {
  const src = readFileSync(PICKER, 'utf8');
  const block = src.match(/const AGENCIES = \[([\s\S]*?)\];/);
  if (!block) throw new Error('AGENCIES array not found in the Competition Health page');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Pull the TOPTIER keys out of the depth lib. */
function toptierKeys(): Set<string> {
  const src = readFileSync(DEPTH, 'utf8');
  const block = src.match(/const TOPTIER: Record<string, string> = \{([\s\S]*?)\};/);
  if (!block) throw new Error('TOPTIER map not found in competition-depth.ts');
  return new Set([...block[1].matchAll(/'([^']+)':/g)].map((m) => m[1]));
}

/** Mirror of resolveToptier's logic: explicit map, else the "X, DEPARTMENT OF [THE]" fallback. */
function resolves(agency: string, keys: Set<string>): boolean {
  const key = agency.trim().toUpperCase();
  if (keys.has(key)) return true;
  return /^(.*),\s*DEPARTMENT OF( THE)?$/.test(key);
}

describe('Competition Health agency picker', () => {
  const agencies = pickerAgencies();
  const keys = toptierKeys();

  it('actually read both files (a vacuous pass would hide every other assertion)', () => {
    expect(agencies.length).toBeGreaterThanOrEqual(6);
    expect(keys.size).toBeGreaterThanOrEqual(10);
  });

  it.each(pickerAgencies())('"%s" resolves to a USASpending toptier', (agency) => {
    expect(resolves(agency, keys)).toBe(true);
  });

  it('has no duplicates (a repeated option is a picker bug)', () => {
    expect(new Set(agencies).size).toBe(agencies.length);
  });

  it('leads with Dept of Defense — the highest-volume buyer, so the page opens on a real market', () => {
    expect(agencies[0]).toBe('DEPT OF DEFENSE');
  });
});
