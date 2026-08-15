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

/**
 * OBS-009 v1.1-beta — the MINIMUM OBSERVATION THRESHOLD must stay real.
 *
 * Eric 2026-08-15: *"Competition Depth is only reported when the underlying sample meets the
 * minimum observation threshold. Otherwise, no result is shown… A missing result is preferable
 * to a misleading result."*
 *
 * The published standard now states this as method, so the ENGINE and the PUBLISHED STANDARD can
 * no longer drift apart silently: a future edit that softens the threshold to "show it anyway with
 * a caveat" fails here, because that would make the citation say something the code doesn't do.
 */
describe('OBS-009 — minimum observation threshold (standard ↔ engine)', () => {
  const METH = readFileSync(join(process.cwd(), 'src/lib/analytics/observatory-methodology.ts'), 'utf8');
  const OBS9 = METH.slice(METH.indexOf("id: 'OBS-009'"), METH.indexOf("id: 'OBS-009'") + 6000);

  it('read the real registry entry (guards a vacuous pass)', () => {
    expect(OBS9).toContain('Competition depth');
    expect(OBS9.length).toBeGreaterThan(1000);
  });

  it('publishes the threshold as part of the METHOD, not a footnote', () => {
    expect(OBS9).toMatch(/minimum observation threshold/i);
    expect(OBS9).toMatch(/A missing result is preferable to a misleading one/i);
  });

  it('states that a withheld buyer is ABSENT, not scored low', () => {
    // The dangerous misreading: "not listed" taken as "uncompetitive".
    expect(OBS9).toMatch(/not been measured, which is a different statement/i);
    expect(OBS9).toMatch(/An absent figure carries information/i);
  });

  it('the engine actually withholds below the threshold (prose ↔ code)', () => {
    const ENGINE = readFileSync(join(process.cwd(), 'src/lib/analytics/competition-depth.ts'), 'utf8');
    expect(ENGINE).toMatch(/const MIN_SAMPLE\s*=\s*\d+/);
    // The guard must return the empty/withheld shape, never fall through to a computed average.
    // The guard RETURNS the empty/withheld shape (it spreads empty(...) so it can preserve the
    // real sampled/withData counts for the "only N of M carried offers" disclosure) and must NOT
    // fall through to a computed average.
    const guard = ENGINE.slice(ENGINE.indexOf('withData < MIN_SAMPLE'), ENGINE.indexOf('withData < MIN_SAMPLE') + 800);
    expect(guard).toMatch(/return\s*\{?[\s\S]{0,300}?empty\(/);
    expect(guard).not.toMatch(/singleBidPct\s*[:=]\s*[a-zA-Z0-9_.(]/);
  });

  it('bumped the version and recorded WHY (invariant #4)', () => {
    expect(OBS9).toContain("version: 'v1.1-beta'");
    expect(OBS9).toMatch(/versionHistory[\s\S]*v1\.1-beta/);
  });
});
