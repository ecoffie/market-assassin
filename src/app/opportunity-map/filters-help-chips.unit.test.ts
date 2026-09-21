/**
 * Filters panel — Zillow redesign PR4: per-section "?" help chips.
 * (Eric 2026-07-28.) Zillow puts a "Help" affordance on every filter group. Each of our sections now
 * gets a "?" chip with a plain-language, one-line explainer (native tooltip), injected from a
 * per-section lookup keyed off data-mfsec. Only the first header of a multi-header section gets one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('per-section help chips', () => {
  it('a styled .mf-q help chip class exists', () => {
    expect(routeSrc).toContain('.mf-q{');
    expect(routeSrc).toContain('cursor:help');
  });
  it('a HELP lookup provides a line per section, injected as a "?" with a title tooltip', () => {
    expect(routeSrc).toContain('var HELP={');
    // covers the real sections
    for (const k of ['scope', 'codes', 'location', 'timing', 'setaside', 'noticetype']) {
      expect(routeSrc, `HELP.${k}`).toContain(`${k}:`);
    }
    expect(routeSrc).toContain("q.className='mf-q'");
    expect(routeSrc).toContain("q.setAttribute('title',HELP[k])");
    expect(routeSrc).toContain("q.setAttribute('aria-label',HELP[k])"); // accessible
  });
  it('dedupes multi-header sections (first header only)', () => {
    expect(routeSrc).toContain('if(!k||seen[k]||!HELP[k])return');
    expect(routeSrc).toContain('if(h.querySelector(\'.mf-q\'))return'); // idempotent
  });
});
