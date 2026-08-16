/**
 * GUARD — the front page must not collapse at midnight, and its captions must describe what
 * they sit on.
 *
 * SHIPPED, and caught by looking at the live page at 00:13 UTC: the hero read
 * "16 opportunities posted in the last 24 hours" while the four preceding days held
 * 1322 / 1961 / 2059 / 2156. Not a data bug — a UX bug caused by a clock:
 *
 *   `posted_date` is a DATE, midnight-stamped (measured: every row reads T00:00:00+00:00),
 *   so `>= now - 24h` really means ">= yesterday's calendar date". Minutes after UTC midnight
 *   only the handful of notices already carrying yesterday's date qualify. The number is
 *   technically true and reads as a dead market — the worst combination on a page whose whole
 *   claim is that every figure is real.
 *
 * Two things this locks:
 *
 *  1. The window anchors to the latest day with REAL VOLUME, not to wall-clock now, and not
 *     merely to the newest date present (which is usually a PARTIAL day still filling — that
 *     naive version was written first and reproduced the exact collapse: still 16).
 *
 *  2. A caption over the map names what the map ACTUALLY shows. The pill read "16 posted
 *     today" above an unfiltered map — two different windows under one caption. A `?posted=7`
 *     was briefly added to "fix" this, but the map route reads only `embed` server-side, so it
 *     filtered nothing: a URL that reads like it works while doing nothing is worse than the
 *     mismatch it pretends to solve.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const INTEL = readFileSync(join(process.cwd(), 'src', 'lib', 'today', 'intel.ts'), 'utf8');
const ROUTE = readFileSync(join(process.cwd(), 'src', 'app', 'today', 'route.ts'), 'utf8');

/** Comments quote the old strings while explaining them — strip before asserting on code. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const intel = strip(INTEL);
const route = strip(ROUTE);

describe('the posting window survives midnight', () => {
  it('anchors to the latest day with data, not to now-minus-24h', () => {
    expect(intel).toMatch(/const day = await latestPostedDay\(sb\)/);
    // The old shape: a bare rolling 24h window feeding the hero number.
    expect(intel).not.toMatch(/const day = new Date\(Date\.now\(\) - 864e5\)/);
  });

  it('requires REAL VOLUME, so a partial day is never presented as a finished one', () => {
    // Without this floor the anchor lands on the newest (still-filling) date and the number
    // collapses exactly as before — the first version of this fix did precisely that.
    expect(intel).toMatch(/MIN_MEANINGFUL_DAY/);
    expect(intel).toMatch(/count >= MIN_MEANINGFUL_DAY/);
  });

  it('the floor sits below a quiet real day but above a trickle', () => {
    const m = intel.match(/const MIN_MEANINGFUL_DAY = (\d+)/);
    expect(m).toBeTruthy();
    const floor = Number(m![1]);
    expect(floor).toBeGreaterThan(20);    // above the 16-row partial day that caused this
    expect(floor).toBeLessThan(270);      // below a real weekend day (Aug 9 = 270)
  });

  it('falls back to the old behaviour rather than throwing', () => {
    // A probe failure must degrade to yesterday, never break the front page.
    expect(intel).toMatch(/return yesterday;/);
  });

  it('the user-facing label matches the anchor', () => {
    // "in the last 24 hours" would now be a lie: the window is a specific filing day.
    expect(intel).not.toMatch(/posted in the last 24 hours['"`]/);
    expect(intel).toMatch(/latest day of filings/);
  });
});

describe('captions describe what they sit on', () => {
  it('the map pill cites the map, not a window the embed does not apply', () => {
    expect(route).toMatch(/mcount">.*stat\('active'\)/s);
    // The mismatched caption that shipped.
    expect(route).not.toMatch(/mcount">.*posted today/s);
  });

  it('the embed URL carries no filter the map cannot honour', () => {
    // The map route reads ONLY `embed` server-side; anything else is decoration.
    const iframe = route.match(/<iframe src="([^"]+)"/)?.[1] || '';
    expect(iframe).toBe('/opportunity-map?embed=1');
  });
});

describe('map overlays clear the map\'s own controls', () => {
  /**
   * Leaflet owns bottom-left (legend) and bottom-right (zoom + attribution). Both overlays
   * originally sat at bottom:24–28px and covered them — the count pill sat on the legend text,
   * and the CTA sat on the +/− buttons, so the map could not be zoomed from the front page.
   * Undetectable from the DOM: the collision is with content inside a cross-origin iframe.
   */
  it('the count pill is not pinned to the bottom-left legend corner', () => {
    const rule = route.match(/\.mcount\{([^}]*)\}/)?.[1] || '';
    expect(rule).toMatch(/top:/);
    expect(rule).not.toMatch(/bottom:\s*\d/);
  });

  it('the CTA clears the zoom controls and attribution strip', () => {
    const rule = route.match(/\.tcta\{([^}]*)\}/)?.[1] || '';
    const bottom = Number(rule.match(/bottom:\s*(\d+)px/)?.[1] ?? 0);
    // Leaflet's zoom stack + attribution occupy roughly the bottom 60px.
    expect(bottom).toBeGreaterThanOrEqual(64);
  });
});
