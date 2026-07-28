/**
 * Contacts (Companies/Buyers) count honesty — the "26 results / No contacts in view" bug.
 *
 * companiesPins/buyersPins returned only `totalForFilters` = the pre-bbox MATCH count (firms
 * matching search/naics across candidate states), but the map shows only pins that SURVIVED the
 * geocode+bbox filter. When a search matches off-viewport firms, the header claimed "26 results"
 * while the map rendered zero. Fix: return `totalInView` (= pins.length) and have the client show
 * the honest in-view count (+ a "· N match — zoom out" hint) for contacts mode.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, '../api/app/contacts-map/route.ts'), 'utf8');
const mapSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('contacts-map returns totalInView (honest map count)', () => {
  it('BOTH companiesPins and buyersPins return totalInView alongside totalForFilters', () => {
    // Two return sites — one per pins builder. Both must carry totalInView now.
    const returns = [...routeSrc.matchAll(/return \{[^}]*pins[^}]*\}/g)].map((m) => m[0]);
    const withPins = returns.filter((r) => /\bpins\b/.test(r));
    expect(withPins.length).toBeGreaterThanOrEqual(2);
    for (const r of withPins) {
      expect(r, r).toContain('totalInView');
      expect(r, r).toContain('totalForFilters');
    }
  });

  it('totalInView is pins.length (what actually rendered), never the broader match total', () => {
    expect(routeSrc).toContain('totalInView: pins.length');
  });
});

describe('client shows the honest in-view count for contacts mode', () => {
  it('renders a "N match — zoom out" hint when 0 are in view but matches exist', () => {
    // Guards the specific "26 results / No contacts in view" contradiction from recurring.
    expect(mapSrc).toContain('isContactMode(MODE) && n===0 && TOTAL>0');
    expect(mapSrc).toContain('zoom out');
  });
});

describe('company Overview enriched to Open-drawer density (6-cell grid)', () => {
  it('companyHead grid adds "Active since" (first–last award year) and "Primary buyer" cells', () => {
    // Was a 4-cell grid (Total won / Awards / Agencies / NAICS); Open leads with a 6-cell grid, so
    // the firm grid now also carries its active span + #1 agency — all real fields, no fabrication.
    const idx = mapSrc.indexOf('function companyHead');
    expect(idx).toBeGreaterThan(-1);
    const block = mapSrc.slice(idx, idx + 2500);
    expect(block).toContain('Active since');
    expect(block).toContain('Primary buyer');
    expect(block).toContain('firstActionDate');
    expect(block).toContain('lastActionDate');
  });
});

describe('company deep-link syncs the sort scope (no stale "Deadline" label)', () => {
  it('?company= path forces company sort scope even when already in companies mode', () => {
    // setMapMode early-returns when mode already matches → __setSortScope was skipped → the header
    // showed a meaningless "Deadline (soonest)" for a firm. The deep-link now forces it.
    // Anchor on the deep-link IIFE (its match regex is unique in the file), then confirm the
    // sort-scope force sits within it.
    const idx = mapSrc.indexOf('/[?&]company=([^&]+)/');
    expect(idx, 'company deep-link IIFE must exist').toBeGreaterThan(-1);
    const block = mapSrc.slice(idx, idx + 800);
    expect(block).toContain("__setSortScope('company')");
  });
});

describe('company/buyer list cards match the Awarded card polish', () => {
  const mapSrc2 = readFileSync(join(__dirname, 'route.ts'), 'utf8');
  it('contactCard renders the .stats facts grid + .cfoot footer + View details (like cardHTML)', () => {
    const idx = mapSrc2.indexOf('function contactCard');
    expect(idx).toBeGreaterThan(-1);
    const block = mapSrc2.slice(idx, idx + 4400);
    expect(block).toContain("class=\"stats\"");
    expect(block).toContain("class=\"st\"");
    expect(block).toContain("class=\"cfoot\"");
    expect(block).toContain("View details");
  });
  it('company card grid uses real fields (totalObligated / awardCount / distinctAgencyCount)', () => {
    const idx = mapSrc2.indexOf('function contactCard');
    const block = mapSrc2.slice(idx, idx + 4400);
    expect(block).toContain('o.totalObligated');
    expect(block).toContain('o.awardCount');
    expect(block).toContain('o.distinctAgencyCount');
  });
});
