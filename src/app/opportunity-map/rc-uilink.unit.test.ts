/**
 * Unit test for the Awarded/Recompete drawer's USASpending URL builder (gap 2 — the dead uiLink fix).
 *
 * `usaspendingUrlForRecompete(o)` (in route.ts's injected drawer JS) turns a recompete row into a
 * live USASpending URL so the sticky "View on USASpending" action is NEVER dead (the recompete CUR
 * shipped with uiLink:''). More is a utility dropdown (copy / download / report), not this link.
 * It must:
 *   - use the PIID (o.sol) as the USASpending search query
 *   - strip a multi-award rollup suffix ("(+N more)") down to the base PIID
 *   - fall back to the incumbent name, then a bare /search, so it's never empty
 *
 * Extracted straight from route.ts and eval'd so the test tracks the SHIPPED source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function extractFn(name: string): string {
  const start = routeSrc.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist in route.ts`).toBeGreaterThan(-1);
  const open = routeSrc.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < routeSrc.length; i++) {
    const c = routeSrc[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return deEscape(routeSrc.slice(start, i + 1)); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// The drawer JS lives inside a TS template literal, so a runtime `≤` / `\(` is written as
// `\\u2264` / `\\(` in the raw source (the template-literal emit halves the backslashes into the
// browser's `<script>`). Eval-ing the RAW source would double-escape; de-escaping `\\` → `\` here
// reproduces exactly what the browser runs.
function deEscape(s: string): string { return s.replace(/\\\\/g, '\\'); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const usaspendingUrlForRecompete: (o: any) => string =
  new Function(`${extractFn('usaspendingUrlForRecompete')}; return usaspendingUrlForRecompete;`)();

describe('usaspendingUrlForRecompete — the recompete sticky View on USASpending URL (gap 2)', () => {
  it('searches USASpending by the PIID', () => {
    const url = usaspendingUrlForRecompete({ sol: 'W912PL21C0001', title: 'Acme Corp' });
    expect(url).toBe('https://www.usaspending.gov/search?query=W912PL21C0001');
  });

  it('strips a "(+N more)" multi-award rollup suffix down to the base PIID', () => {
    const url = usaspendingUrlForRecompete({ sol: 'GS35F0119Y (+4 more)', title: 'Acme' });
    expect(url).toBe('https://www.usaspending.gov/search?query=GS35F0119Y');
  });

  it('falls back to the incumbent name when there is no PIID', () => {
    const url = usaspendingUrlForRecompete({ sol: '', title: 'Booz Allen Hamilton' });
    expect(url).toBe('https://www.usaspending.gov/search?query=Booz%20Allen%20Hamilton');
  });

  it('never returns empty — bare /search as the last resort', () => {
    expect(usaspendingUrlForRecompete({})).toBe('https://www.usaspending.gov/search');
    expect(usaspendingUrlForRecompete(null)).toBe('https://www.usaspending.gov/search');
  });
});
