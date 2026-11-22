import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Landscape phones get the same "no event banner on the map" rule as portrait phones (2026-11-21).
//
// Eric (2026-11-12) hid the homepage bar's event banner on the Map for phones, because as a card it
// covered a big part of the map. That rule lives in the `@media(max-width:640px)` block, but a phone
// turned sideways is 568–930px wide, so the banner came back: 123px of a 342–380px-tall screen.
// Measured (map visible / screen): iPhone 13 landscape 92px / 27%, iPhone 15 Pro Max 130px / 34%,
// Pixel 7 110px / 31% — vs 63–77% on every other device. After: 215 / 63%, 253 / 67%, 233 / 65%.
// A short DESKTOP window (pointer:fine) and tablets keep the banner.

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('event banner on the Map: portrait AND landscape phones', () => {
  it('portrait phones: still hidden inside the ≤640px block (Eric 2026-11-12)', () => {
    const phone = route.indexOf("+ '@media(max-width:640px){'\n  //    The homepage bar's event banner");
    const block = phone > -1 ? route.slice(phone, phone + 600) : route;
    expect(block).toContain("'.zhead .mp-evb-band{display:none!important}'");
  });

  it('landscape phones: a short TOUCH screen hides it too, whatever its width', () => {
    const m = route.match(/'@media\(max-height:(\d+)px\) and \(pointer:coarse\)\{\.zhead \.mp-evb-band\{display:none!important\}\}'/);
    expect(m, 'missing the short-touch-screen rule').toBeTruthy();
    const maxH = Number(m![1]);
    // Landscape phones are 320–430px tall; the smallest tablet (iPad Mini landscape) is 768.
    expect(maxH).toBeGreaterThanOrEqual(430);
    expect(maxH).toBeLessThan(600);
  });

  it('the rule is scoped to the map header, so other pages keep the banner', () => {
    const rules = route.match(/[^{}']*\.mp-evb-band\{display:none!important\}/g) || [];
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r.trim().endsWith('.zhead .mp-evb-band{display:none!important}')).toBe(true);
  });
});
