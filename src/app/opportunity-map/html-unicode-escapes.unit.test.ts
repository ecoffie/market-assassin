/**
 * GUARD — no literal \uXXXX in EMITTED HTML ATTRIBUTES.
 *
 * The map's main search box shipped for months reading a literal
 * "Show me Army, Navy, VA opportunities…" — the most prominent input in the product, with
 * six raw characters where an ellipsis belonged. Found 2026-08-15 while screenshotting the nav.
 *
 * THE RULE, precisely: `\uXXXX` un-escapes ONLY inside a JavaScript string literal. These route
 * files build HTML by concatenating strings, so an escape written into an HTML *attribute* is
 * emitted verbatim and the browser prints the six characters. Write the real character (…, –, —,
 * ·, ’) instead.
 *
 * ⚠️ SCOPE MATTERS — do NOT widen this to the whole file. Measured on prod: the map serves 406
 * literal escape sequences and 403 of them are CORRECT — they sit inside <script> blocks where
 * they genuinely un-escape at runtime. A blanket ban would flag 403 non-bugs, and a rule that
 * cries wolf gets suppressed. CSS `content:"\2713"` is also valid (CSS has its own escape syntax)
 * and is likewise not a bug. Only static HTML attributes are wrong.
 *
 * Verified in a real browser at the time of the fix: exactly ONE user-visible break existed
 * (the placeholder). The CSS checkmark rendered correctly; document.body.innerText contained
 * zero literal escapes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every route that emits map chrome as concatenated HTML strings. */
const HTML_ROUTES = [
  'route.ts',
  'favorites/route.ts',
  'forecasts/route.ts',
  'saved/route.ts',
  'market/route.ts',
  'proposal/route.ts',
  'reports/route.ts',
  'pursuits/route.ts',
  'vault/route.ts',
];

/**
 * A STATIC HTML attribute carrying a literal escape. Deliberately narrow:
 *  - only user-facing attributes (placeholder/aria-label/title/alt) — these are what a person reads
 *  - skips lines containing `'+`, which are JS concatenations where the escape resolves correctly
 */
const ATTR_ESCAPE = /(placeholder|aria-label|title|alt)="[^"]*\\u[0-9a-fA-F]{4}/;

function offenders(src: string): string[] {
  return src
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => ATTR_ESCAPE.test(line) && !line.includes("'+"))
    .map(({ line, n }) => `${n}: ${line.trim().slice(0, 90)}`);
}

describe('emitted HTML attributes carry real characters, not \\uXXXX', () => {
  it('read the real routes (a vacuous pass would hide every assertion below)', () => {
    for (const r of HTML_ROUTES) {
      expect(readFileSync(join(process.cwd(), 'src/app/opportunity-map', r), 'utf8').length).toBeGreaterThan(1000);
    }
  });

  for (const route of HTML_ROUTES) {
    it(`${route} — no literal escape in a user-facing attribute`, () => {
      const found = offenders(readFileSync(join(process.cwd(), 'src/app/opportunity-map', route), 'utf8'));
      expect(found, `literal \\uXXXX in HTML attribute(s):\n${found.join('\n')}`).toEqual([]);
    });
  }

  it('the map search placeholder reads a REAL ellipsis (the bug that started this)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');
    expect(src).toContain('placeholder="Show me Army, Navy, VA opportunities…"');
    // STRIP COMMENTS FIRST. The fix's own explanatory comment QUOTES the bad string, so a naive
    // not-toContain flags the very file it just fixed — the documented false-positive trap
    // (CLAUDE.md: "Several fixes now QUOTE the pattern while explaining the bug"). This assertion
    // hit it immediately when written. Check the CODE, not the prose about the code.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('opportunities\\u2026');
  });

  it('does NOT flag escapes inside <script> — those are correct and must stay allowed', () => {
    // Regression guard on the GUARD: 403 legitimate in-JS escapes exist. If this rule ever starts
    // matching them, it will be suppressed by whoever it annoys, and the real bug returns.
    const jsLine = `      + 'var label = "cost \\u2014 total";'`;
    expect(offenders(jsLine)).toEqual([]);
  });
});
