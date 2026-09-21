/**
 * PERMANENT GUARD for the opportunity-map filter bar's overflow bug.
 *
 * `.fscroll` (the filter-pill scroller) MUST NOT carry a clipping overflow
 * (overflow:auto / hidden / scroll on x or shorthand). Any such value clips every
 * dropdown panel that opens from the bar — Set-aside, NAICS, the template's filter
 * sheets — and has silently broken the bar THREE separate times (filter sheet
 * clipping → blanked bar → Set-aside "stopped working"). Each fix patched one panel
 * to position:fixed instead of killing the root cause.
 *
 * The bar is kept on one row by `flex-wrap:nowrap` + `min-width:0` (pills shrink; the
 * search absorbs the squeeze), and page-widening is prevented one level up on
 * `.app`/`html`/`body`. So `.fscroll` can and MUST be overflow:visible.
 *
 * If this test fails, DO NOT re-add overflow to .fscroll to "fix" a wide bar — fix the
 * width on the page shell (.app/html/body) or let the pills shrink. Re-adding the clip
 * will break dropdowns again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('opportunity-map filter bar overflow invariant', () => {
  it('.fscroll is overflow:visible in the route override (not a clipping overflow)', () => {
    // The authoritative override: '.ztop .fbar .fscroll{...overflow:visible!important...}'.
    const rule = routeSrc.match(/\.ztop \.fbar \.fscroll\{[^}']*\}/);
    expect(rule, 'the .ztop .fbar .fscroll override rule must exist').toBeTruthy();
    const css = rule![0];
    expect(css, '.fscroll must declare overflow:visible so dropdowns are not clipped').toContain('overflow:visible');
  });

  it('no APPLIED .fscroll rule uses a clipping overflow (auto/hidden/scroll)', () => {
    // Scan only APPLIED CSS rules — those inside the injected style-string constants, which
    // carry !important on the filter-bar overrides. This deliberately ignores the html.replace()
    // ARGUMENTS (lines that quote the old `overflow-x:auto` string in order to REMOVE it) and the
    // embed-only EMBED_CSS. An applied .fscroll rule with a clipping overflow is the actual bug.
    const importantFscroll = routeSrc.match(/\.fscroll\{[^}']*!important[^}']*\}/g) || [];
    expect(importantFscroll.length, 'expected the applied !important .fscroll override rules to exist').toBeGreaterThan(0);
    for (const rule of importantFscroll) {
      expect(rule, `clipping overflow found on an applied .fscroll rule: ${rule}`).not.toMatch(/overflow(-x)?\s*:\s*(auto|hidden|scroll)/);
    }
  });

  it('.ztop itself carries no clipping overflow (dropdowns escape it)', () => {
    const ztop = routeSrc.match(/'\.ztop\{[^}']*\}/);
    if (ztop) {
      expect(ztop[0]).not.toMatch(/overflow(-x)?\s*:\s*(auto|hidden|scroll)/);
    }
  });
});
