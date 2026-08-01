/**
 * SBIR-as-Open-Opp map pins (Eric 2026-07-28: "put SBIR under open opps"). SBIR topics have no place
 * of performance, so they're pinned at the sponsoring branch HQ (a real geocoded city), flagged
 * APPROXIMATE. This asserts the wiring: the opt-in source, the branch→HQ map, and the fail-soft/honesty
 * contract. (getSbirMapPins itself needs Supabase, so the pin build is covered at the source level.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pinsSrc = readFileSync(join(__dirname, 'sbir-map-pins.ts'), 'utf8');
const routeSrc = readFileSync(join(__dirname, '../../app/api/app/opportunity-map/route.ts'), 'utf8');

describe('SBIR pins are real, approximate, and fail-soft', () => {
  it('branch → a REAL HQ city (geocoded, never a hardcoded lat/lng)', () => {
    // The HQ map uses city+state names run through geocodeCity — no invented coordinates.
    expect(pinsSrc).toContain('import { geocodeCity }');
    expect(pinsSrc).toContain('army:');
    expect(pinsSrc).toContain('Aberdeen');
    expect(pinsSrc).toContain("'air force':");
    // and a real-coords guard: no geocode hit → NO pin (never fabricate a location)
    expect(pinsSrc).toContain('if (!g) continue');
  });
  it("pins are flagged APPROXIMATE (locSrc='office') — not a real place of performance", () => {
    expect(pinsSrc).toContain("locSrc: 'office'");
    expect(pinsSrc).toContain("src: 'SBIR'");
  });
  it('reads the cached table (never the rate-limited sbir.gov API) and is fail-soft', () => {
    expect(pinsSrc).toContain("from('dod_sbir_topics')");
    expect(pinsSrc).toContain("eq('status', 'open')");
    expect(pinsSrc).toContain('return []'); // any error → [] so SAM pins are unaffected
  });
});

describe('SBIR is an opt-in source under Open Opps (like DIBBS)', () => {
  it('wantSbirSources gates it on ?sources=...,sbir', () => {
    expect(routeSrc).toContain('function wantSbirSources');
    expect(routeSrc).toContain("s.includes('sbir')");
  });
  it('SBIR pins are merged + counted separately (never absorb the SAM headline)', () => {
    // Assert the INVARIANT (all three sources merged, SBIR counted on its own),
    // not the exact statement text — the merge line legitimately changes when
    // pins gain decoration (e.g. the early-signal badge wraps it), and pinning
    // the literal made an unrelated feature look like an SBIR regression.
    expect(routeSrc).toMatch(/merged\s*=[^;]*\[\.\.\.pins,\s*\.\.\.dlaPins,\s*\.\.\.sbirPins\]/);
    expect(routeSrc).toMatch(/SBIR:\s*sbirPins\.length/);
    // fail-soft in the route too
    expect(routeSrc).toContain('SBIR viewport pins failed (SAM unaffected)');
  });
});
