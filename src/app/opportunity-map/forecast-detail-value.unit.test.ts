/**
 * Forecast listing-detail VALUE hero (Eric 2026-08-05: "for forecast use the actual number and
 * colors — we had it working then changed it"). The regression: the detail hero collapsed the
 * agency's published RANGE to a single median ($25M) in the GREEN open-opp style, while the sidebar
 * card correctly showed the range ("R3 – $7.5M–$25M") in FORECAST PURPLE. This locks the detail to:
 *   1. use o.estRange (the agency's real published range) — NOT mCompact(o.est) (the collapsed median);
 *   2. render it in the purple .vrange-fore treatment, matching the sidebar + the "Forecast" badge.
 * A REAL government figure (no ≈ modeled glyph) — grounded, never fabricated.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('forecast listing-detail value hero — real range, forecast purple', () => {
  it('uses the agency published RANGE (o.estRange) in the purple vrange-fore, not the collapsed green median', () => {
    // the FORECAST value hero (the one with vrange-fore)
    const start = route.indexOf('vrange-fore" id="osec-value"');
    expect(start, 'the forecast vrange-fore hero must exist').toBeGreaterThan(-1);
    const hero = route.slice(start - 120, start + 260);
    expect(hero).toContain('o.estRange'); // the real published range leads
    expect(hero).toContain('vrange-fore'); // purple forecast treatment
    // the value is the range string (falls back to the median only when there's NO range)
    expect(hero).toMatch(/\(o\.estRange&&String\(o\.estRange\)\.trim\(\)\)\?o\.estRange:mCompact\(o\.est\)/);
    // it must NOT lead with the OLD bare "vr-big">'+esc(mCompact(o.est))" (single median) in this hero
    expect(hero).not.toMatch(/vr-big">'\+esc\(mCompact\(o\.est\)\)<\/div>/);
  });

  it('defines the purple .vrange-fore styling (matches the forecast badge color #7c3aed)', () => {
    expect(route).toContain('.vrange-fore{');
    expect(route).toContain('.vrange-fore .vr-label{color:#7c3aed}');
  });
});
