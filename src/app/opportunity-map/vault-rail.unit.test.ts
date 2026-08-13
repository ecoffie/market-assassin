/**
 * Vault reachable from the map — the "LATER migration step" the vault page's own header names.
 *
 * /opportunity-map/vault shipped standalone for review and deliberately touched no other file:
 * "It does NOT touch the rail copies, account-menu.ts, or any other existing file ... the
 * rail-sync + account-menu repoint are the LATER migration step." So the page existed but nothing
 * linked to it (Eric 2026-08-13: "wire the vault too").
 *
 * Every map sub-page carries its OWN copy of the left rail. Adding Vault to only some of them is
 * worse than adding it to none: the item would appear on the map and then VANISH the moment you
 * opened Watchlist or Pursuits, which reads as a broken link rather than a missing feature. These
 * assertions are what keep the copies in agreement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Every page that renders the workspace rail. If a new sub-view is added with a rail, add it here
// — a rail copy nobody checks is exactly how these drifted apart in the first place.
const RAIL_PAGES = [
  'route.ts',
  'favorites/route.ts',
  'forecasts/route.ts',
  'saved/route.ts',
  'market/route.ts',
  'proposal/route.ts',
  'reports/route.ts',
  'pursuits/route.ts',
  'vault/route.ts',
];

describe('the Vault is reachable from every map surface', () => {
  it.each(RAIL_PAGES)('%s links to the vault', (rel) => {
    const src = readFileSync(join(__dirname, rel), 'utf8');
    expect(src).toContain('href="/opportunity-map/vault"');
  });

  it('uses ONE label and title everywhere, copied from the vault page itself', () => {
    // Divergent copy is how a rail starts feeling like two different products.
    for (const rel of RAIL_PAGES) {
      const src = readFileSync(join(__dirname, rel), 'utf8');
      expect(src).toContain('title="Vault — your company profile Mindy writes from"');
      expect(src).toContain('<span>Vault</span>');
    }
  });

  it('sits after Reports, so the rail order matches the vault page', () => {
    for (const rel of RAIL_PAGES) {
      const src = readFileSync(join(__dirname, rel), 'utf8');
      const reports = src.indexOf('/opportunity-map/reports"');
      const vault = src.indexOf('/opportunity-map/vault"');
      expect(reports).toBeGreaterThan(-1);
      expect(vault).toBeGreaterThan(reports);
    }
  });

  it('is in the mobile workspace drawer too, not desktop-only', () => {
    const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');
    // The map has TWO surfaces: the desktop rail and the mobile drawer's "Your workspace" group.
    expect(map.match(/href="\/opportunity-map\/vault"/g)?.length).toBe(2);
    const drawer = map.slice(map.indexOf('Your workspace'));
    expect(drawer).toContain('/opportunity-map/vault');
  });
});
