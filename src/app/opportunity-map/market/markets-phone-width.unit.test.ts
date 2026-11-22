import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Markets page (/opportunity-map/market, also /market-explorer) fits a phone (2026-11-21).
//
// The agency and industry lists are `.hubgrid` rows whose title is nowrap + ellipsis. The grid used
// plain `1fr` tracks; a `1fr` track cannot shrink below its min-content, which for a nowrap title is
// the whole title. Measured: 1046px of page on a 390px iPhone 13 and a 320px iPhone SE, every dollar
// amount off-screen, and the event pop-up centred on the wider layout with its close button out of
// reach. With `minmax(0,1fr)` the existing ellipsis works: page == viewport on SE / 13 / Pixel 7,
// 0 amounts off-screen, 2 columns kept on tablet and desktop.

const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('Markets lists fit a phone screen', () => {
  it('both .hubgrid column rules use a 0 floor, never a bare 1fr', () => {
    const rules = [...src.matchAll(/\.hubgrid\{[^}]*grid-template-columns:([^;}]+)/g)].map((m) => m[1].trim());
    expect(rules.length, 'expected the base and the ≤640px .hubgrid rules').toBeGreaterThanOrEqual(2);
    for (const cols of rules) {
      expect(cols, cols).toMatch(/minmax\(0,\s*1fr\)/);
      expect(cols, cols).not.toMatch(/(^|\s)1fr(\s|$)/);
    }
  });

  it('keeps two columns above the phone breakpoint and one below', () => {
    expect(src).toContain('.hubgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))');
    expect(src).toMatch(/@media\(max-width:640px\)\{\.hubgrid\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  });

  it('the row title can still truncate (the ellipsis the fix relies on)', () => {
    expect(src).toMatch(/\.hubrow \.t\{[^}]*overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
    expect(src).toContain('.hubrow .l{min-width:0}');
  });
});
