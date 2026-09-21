/**
 * GUARD — the top nav must look IDENTICAL on every map surface.
 *
 * Eric 2026-08-15: *"when i click pursuits it is the only one that is different navigation bar at
 * top."* /pursuits was the only one of nine pages applying `zh-on` (blue + a 2px underline) to its
 * own nav item, so the header visibly changed shape when you landed there. Verified on prod at the
 * time: pursuits 2 occurrences, every other page 0.
 *
 * WHERE ACTIVE STATE LIVES: the LEFT RAIL (`a.on` → blue + tinted), in ONE place. It cannot live
 * in the top nav consistently anyway — Watchlist and Saved have no top-nav item, and Markets has
 * no rail item (nav-only by design) — so any nav-highlight rule leaves some pages unmarked no
 * matter how it is written. One place, not two.
 *
 * This file also pins the LABEL SET, because the same nine hand-maintained copies drifted three
 * ways at once earlier the same day: eight pages still said "Players"→"Network" inconsistently,
 * pursuits said "Map" instead of "Opportunities", and none carried "Markets".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGES = [
  'route.ts',
  'favorites/route.ts', 'forecasts/route.ts', 'market/route.ts', 'proposal/route.ts',
  'pursuits/route.ts', 'reports/route.ts', 'saved/route.ts', 'vault/route.ts',
];
const read = (p: string) => readFileSync(join(process.cwd(), 'src/app/opportunity-map', p), 'utf8');

describe('map top nav is identical on every page', () => {
  it('read the real routes (a vacuous pass would hide every assertion below)', () => {
    for (const p of PAGES) expect(read(p).length, `${p} unexpectedly tiny`).toBeGreaterThan(1000);
  });

  it.each(PAGES)('%s does NOT mark its own nav item active', (page) => {
    expect(read(page), `${page} applies zh-on — the header changes shape on this page`)
      .not.toMatch(/class="zh-on"/);
  });

  it.each(PAGES)('%s carries all four nav labels', (page) => {
    const src = read(page);
    for (const label of ['Opportunities', 'Players', 'Pursuits', 'Markets']) {
      expect(src, `${page} is missing nav item "${label}"`).toContain(`>${label}</a>`);
    }
  });

  it('no page uses the retired labels ("Map" as a nav item, or "Network")', () => {
    for (const page of PAGES) {
      const src = read(page);
      expect(src, `${page} still shows the retired "Network" label`).not.toContain('>Network</a>');
      // "Map" is a RAIL item (<span>Map</span>), never a top-nav <a>. pursuits used to say it.
      expect(src, `${page} uses "Map" as a top-nav item`).not.toMatch(/<a href="\/opportunity-map">Map<\/a>/);
    }
  });
});
