/**
 * GUARD: the Recompete "Contract value" Min/Max separator renders a real en dash (issue #1694).
 *
 * MORE_FILTERS is server-side HTML: route.ts splices it straight into the page markup with
 * repl(html, ...). A `–` escape un-escapes only inside a JavaScript string literal, so the
 * old `'<span class="mf-dash">\\u2013</span>'` reached the browser as the six characters
 * "–" (confirmed on getmindy.ai/opportunity-map?horizon=recompete, 2026-11-22). The fix
 * writes the real character. This test reads the MORE_FILTERS block AND its call site, so it
 * fails if the escape returns or if the block stops being emitted as markup the way it is now.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The MORE_FILTERS constant's source, from its declaration up to the next top-level const. */
function moreFiltersBlock(): string {
  const start = SRC.indexOf("const MORE_FILTERS = '");
  const end = SRC.indexOf('const SAVE_SEARCH_BTN', start);
  expect(start, 'MORE_FILTERS declaration not found').toBeGreaterThan(-1);
  expect(end, 'end of MORE_FILTERS block not found').toBeGreaterThan(start);
  return stripComments(SRC.slice(start, end));
}

describe('Recompete value range separator (MORE_FILTERS markup)', () => {
  it('renders a real en dash between Min and Max', () => {
    const block = moreFiltersBlock();
    expect(block).toContain('<span class="mf-dash">–</span>');
    expect(block).not.toContain('<span class="mf-dash">\\u2013</span>');
  });

  it('MORE_FILTERS markup carries no literal \\uXXXX escape anywhere', () => {
    const found = moreFiltersBlock().match(/\\u[0-9a-fA-F]{4}/g) ?? [];
    expect(found).toEqual([]);
  });

  it('call site: MORE_FILTERS is spliced into the served HTML as markup (not a JS string)', () => {
    const code = stripComments(SRC);
    expect(code).toMatch(
      /html = repl\(html, '<button class="clr" id="clrAll">Clear all<\/button>',\s*MORE_FILTERS \+ SAVE_SEARCH_BTN/,
    );
  });
});
