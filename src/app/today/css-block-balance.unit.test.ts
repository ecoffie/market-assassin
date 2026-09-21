/**
 * GUARD — a CSS syntax error silently DISCARDS every rule after it.
 *
 * Shipped 2026-08-15: while hiding the hero search per feedback, the rules were deleted but
 * their wrapper survived as a dangling `.tsearch-off{` with no closing brace — SCSS-style
 * nesting that plain CSS cannot parse. The browser recovered by dropping the ENTIRE remainder
 * of the stylesheet: 106 rules parsed down to 50. Everything after that line died, including
 * ACCOUNT_MENU_CSS (imported LAST), so the account menu lost `position:absolute; display:none`
 * and rendered fully expanded across the header, and the LIVE badge lost its positioning.
 *
 * WHY THIS CLASS IS DANGEROUS: the CSS text is all present in the served HTML — grepping the
 * response finds `.mindy-acct-menu` and `.mlive` and every byte looks right. tsc passes (it's
 * a template literal). The page returns 200. The ONLY observable is computed style in a real
 * browser: `position` reads `static` instead of `absolute`. Three separate "is it there?"
 * checks said yes while the page was visibly broken.
 *
 * THE CHECK: brace balance across each emitted <style> block. An unclosed rule is exactly the
 * defect above, and a stray closing brace ends the sheet early the same way. This is a cheap
 * structural invariant that catches the whole class without needing a browser or a CSS parser.
 *
 * SCOPE: only the CSS inside <style>…</style>. JS blocks legitimately contain unbalanced braces
 * inside string literals, so widening this to whole files would cry wolf.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Route files that emit their own <style> block as a concatenated string. */
const STYLE_ROUTES = [
  'today/route.ts',
  'opportunity-map/route.ts',
  'opportunity-map/favorites/route.ts',
  'opportunity-map/forecasts/route.ts',
  'opportunity-map/saved/route.ts',
];

const APP_DIR = join(process.cwd(), 'src', 'app');

/**
 * Strip what would make a naive brace count lie:
 *  - CSS comments (may contain braces in prose)
 *  - `${...}` template interpolations (their contents are TS, not CSS, and are balanced already)
 *  - quoted strings (content:"{" is legal CSS)
 */
export function stripNonStructural(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$\{[^{}]*\}/g, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

/** Net brace depth of a CSS chunk. 0 = balanced; >0 = unclosed rule; <0 = stray close. */
export function braceDepth(css: string): number {
  const cleaned = stripNonStructural(css);
  let depth = 0;
  for (const ch of cleaned) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}

/** Pull every <style>…</style> body out of a source file. */
function styleBlocks(src: string): string[] {
  return [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

describe('emitted CSS blocks are brace-balanced', () => {
  for (const rel of STYLE_ROUTES) {
    it(`${rel} — every <style> block closes every rule it opens`, () => {
      const src = readFileSync(join(APP_DIR, rel), 'utf8');
      const blocks = styleBlocks(src);
      expect(blocks.length).toBeGreaterThan(0);

      blocks.forEach((css, i) => {
        const depth = braceDepth(css);
        // A non-zero depth means the browser stops parsing here and DROPS the rest of the sheet.
        expect(
          depth,
          `${rel} <style> block #${i + 1} has net brace depth ${depth} ` +
            `(${depth > 0 ? `${depth} unclosed rule(s)` : `${-depth} stray closing brace(s)`}). ` +
            `Everything after the error is silently discarded by the browser.`,
        ).toBe(0);
      });
    });
  }
});

describe('the checker itself detects the real defect', () => {
  it('flags the dangling SCSS-style wrapper that actually shipped', () => {
    const shipped = `
      .tsearch{display:none}
      .tsearch-off{
      .tsearch input{width:100%;outline:none}
      .tcta{background:var(--seal)}
    `;
    expect(braceDepth(shipped)).toBe(1);
  });

  it('accepts the corrected version', () => {
    expect(braceDepth(`.tsearch{display:none}\n.tcta{background:var(--seal)}`)).toBe(0);
  });

  it('flags a stray closing brace (also truncates the sheet)', () => {
    expect(braceDepth(`.a{color:red}}\n.b{color:blue}`)).toBe(-1);
  });

  it('does not trip on comments, interpolation, media queries, or quoted braces', () => {
    const legit = `
      /* a comment with a stray { brace in prose */
      \${ACCOUNT_MENU_CSS}
      @media(max-width:760px){.tframe iframe{height:56vh}}
      .chk::after{content:"{"}
    `;
    expect(braceDepth(legit)).toBe(0);
  });
});
