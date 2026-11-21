import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Product pages: the tab row fits a phone (2026-11-21).
//
// ProductPageAppSumo renders 13 product pages (/expiring-contracts, /market-assassin, /ai-prompts,
// /tribal-list, …). Its tab row — Overview · Features · Pricing · Reviews · [Get Access | Download
// Free] — was a single non-wrapping flex line with px-6 + gap-8. On a 320px iPhone SE it measured
// 475–493px: the purchase / download button sat off-screen and every page overflowed (mobile browsers
// then shrink the whole page to fit, so all text rendered ~35% smaller). Measured on all 12 rendering
// pages × iPhone SE / 13. After: the button wraps onto a second line on phones; desktop (1366) row is
// pixel-identical (54px, button on the same line, same x).

const src = readFileSync(join(__dirname, 'ProductPageAppSumo.tsx'), 'utf8');

/** className of the element that directly wraps the #overview tab link. */
function tabRowClass(): string {
  const at = src.indexOf('href="#overview"');
  expect(at, '#overview tab not found').toBeGreaterThan(-1);
  const divAt = src.lastIndexOf('<div className="', at);
  const m = src.slice(divAt, at).match(/<div className="([^"]+)">/);
  expect(m, 'tab row wrapper not found').toBeTruthy();
  return m![1];
}

describe('ProductPageAppSumo tab row fits a phone screen', () => {
  it('wraps, so the call-to-action drops to a new line instead of off-screen', () => {
    const cls = tabRowClass().split(/\s+/);
    expect(cls).toContain('flex');
    expect(cls).toContain('flex-wrap');
  });

  it('uses phone-sized spacing below sm and keeps the desktop spacing from sm up', () => {
    const cls = tabRowClass().split(/\s+/);
    // No unprefixed 32px gap / 24px padding on phones (that alone made the row ~493px wide).
    expect(cls).not.toContain('gap-8');
    expect(cls).not.toContain('px-6');
    expect(cls).toContain('sm:gap-x-8');
    expect(cls).toContain('sm:px-6');
  });

  it('every call-to-action variant is still a direct child of the row', () => {
    const row = src.slice(src.indexOf('href="#overview"'), src.indexOf('</div>', src.indexOf('href="#overview"')));
    expect(row).toContain('Download Free');
    expect((row.match(/Get Access/g) || []).length).toBe(2);
  });
});
