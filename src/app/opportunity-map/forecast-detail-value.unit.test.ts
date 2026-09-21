/**
 * Forecast listing-detail VALUE hero (Eric 2026-08-05: "for forecast use the actual number and
 * colors — we had it working then changed it"). The regression: the detail hero collapsed the
 * agency's published RANGE to a single median ($25M) in the GREEN open-opp style, while the sidebar
 * card correctly showed the range ("R3 – $7.5M–$25M") in FORECAST PURPLE. This locks the detail to:
 *   1. use o.estRange (the agency's real published range) — NOT mCompact(o.est) (the collapsed median);
 *   2. render it in the purple .vrange-fore treatment, matching the sidebar + the "Forecast" badge.
 * A REAL government figure (no ≈ modeled glyph) — grounded, never fabricated.
 *
 * 2026-08-08 update: the hero now routes through foreVal(o) instead of the inline
 * `(...)?o.estRange:mCompact(o.est)` ternary. foreVal passes a real range/text through verbatim
 * but FORMATS a bare numeric estRange ("99000000" → "$99M") that was previously printed raw
 * (Eric screenshot). This test locks: (1) the hero calls foreVal(o); (2) foreVal is defined; and
 * (3) it distinguishes a bare number from a real range instead of collapsing to the green median.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('forecast listing-detail value hero — real range, forecast purple', () => {
  it('renders the value via foreVal(o) in the purple vrange-fore, not the collapsed green median', () => {
    // the FORECAST value hero (the one with vrange-fore)
    const start = route.indexOf('vrange-fore" id="osec-value"');
    expect(start, 'the forecast vrange-fore hero must exist').toBeGreaterThan(-1);
    const hero = route.slice(start - 120, start + 400);
    expect(hero).toContain('o.estRange'); // the real published range still gates which hero shows
    expect(hero).toContain('vrange-fore'); // purple forecast treatment
    // the value is produced by foreVal(o), the range-vs-bare-number formatter
    expect(hero).toMatch(/vr-big">'\+esc\(foreVal\(o\)\)\+'<\/div>/);
    // it must NOT lead with the OLD bare "vr-big">'+esc(mCompact(o.est))" (single green median)
    expect(hero).not.toMatch(/vr-big">'\+esc\(mCompact\(o\.est\)\)\+'<\/div>/);
  });

  it('defines foreVal(o) — passes a real range through, formats a bare number via fmtM', () => {
    expect(route).toContain('function foreVal(o){');
    // it must guard on range/text markers (letter/$/dash/"to") before treating estRange as a number
    const fvStart = route.indexOf('function foreVal(o){');
    const fv = route.slice(fvStart, fvStart + 700);
    expect(fv).toContain('return r;'); // a real range/text passes through verbatim
    expect(fv).toContain('fmtM('); // a bare number is formatted, never printed raw
  });

  it('defines the purple .vrange-fore styling (matches the forecast badge color #7c3aed)', () => {
    expect(route).toContain('.vrange-fore{');
    expect(route).toContain('.vrange-fore .vr-label{color:#7c3aed}');
  });
});
