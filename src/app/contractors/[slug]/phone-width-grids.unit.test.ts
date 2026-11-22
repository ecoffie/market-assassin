import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Public contractor profiles (/contractors/<slug>) scrolled sideways on phones:
 * at 390px wide, /contractors/lockheed-martin-corp measured scrollWidth=947 and
 * /contractors/rtx-corp 872 (Playwright, 2026-11-21). The "Top Federal Agencies"
 * and "Top NAICS Activity" cards ran off screen and hid the dollar amounts.
 *
 * Cause: a grid with only `md:grid-cols-N` has NO column template below md, so the
 * single implicit track is `auto` and sizes to the min-content width of its widest
 * child. A `truncate` name (white-space: nowrap) makes that min-content the full
 * unbroken name, so the track grows past the screen. `grid-cols-1` sets
 * `repeat(1, minmax(0, 1fr))`, which lets the track shrink and `truncate` work.
 */
const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

function gridClassNames(source: string): string[] {
  return [...source.matchAll(/className="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((cls) => /(^|\s)grid(\s|$)/.test(cls));
}

describe('contractor profile page: grids fit a phone screen', () => {
  it('the Top Agencies + Top NAICS section has an explicit one-column track below md', () => {
    const section = src.match(/\{\/\* Top Agencies \+ Top NAICS \*\/\}\s*<section className="([^"]*)"/);
    expect(section, 'Top Agencies + Top NAICS section not found').not.toBeNull();
    const cls = section![1].split(/\s+/);
    expect(cls).toContain('grid');
    expect(cls).toContain('md:grid-cols-2');
    expect(cls).toContain('grid-cols-1');
  });

  it('every responsive grid on the page sets a base column template', () => {
    const responsive = gridClassNames(src).filter((cls) => /(^|\s)(sm|md|lg):grid-cols-\d/.test(cls));
    expect(responsive.length).toBeGreaterThan(0);
    const missing = responsive.filter((cls) => !/(^|\s)grid-cols-\d/.test(cls));
    expect(missing).toEqual([]);
  });
});
