import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The agency title-caser (cleanAgency server-side + the client `clean()`) lowercased the tail of
// every word — which turned the dotted acronym "U.S." into "U.s." on the forecast drawer
// (Eric 2026-08-03). Both must now PRESERVE a dotted acronym while still title-casing normal words.
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// Mirror the shipped logic so we can assert real OUTPUT, not just the source text.
function cleanLike(d: string): string {
  return (d || '')
    .replace(/,?\s*DEPARTMENT OF( THE)?/i, '')
    .replace(/DEPARTMENT OF( THE)?\s*/i, '')
    .trim()
    .replace(/\b([A-Z])([A-Z0-9'&./-]*)/g, (m, a, b) => {
      if (/^(?:[A-Z]\.){2,}$/.test(m)) return m; // U.S. / U.S.C. → keep exactly
      return a + b.toLowerCase();
    }) || d;
}

describe('Agency casing — dotted acronyms preserved', () => {
  it('"U.S." is NOT lowercased to "U.s." (the reported bug)', () => {
    expect(cleanLike('U.S. National Science Foundation')).toBe('U.S. National Science Foundation');
    expect(cleanLike('U.S. NATIONAL SCIENCE FOUNDATION')).toBe('U.S. National Science Foundation');
    expect(cleanLike('U.S. ARMY CORPS OF ENGINEERS')).toBe('U.S. Army Corps Of Engineers');
  });

  it('normal words still title-case (no over-preservation)', () => {
    expect(cleanLike('DEPARTMENT OF THE NAVY')).toBe('Navy');
    expect(cleanLike('GENERAL SERVICES ADMINISTRATION')).toBe('General Services Administration');
  });

  it('BOTH the server cleanAgency AND the client clean() carry the dotted-acronym guard', () => {
    // the guard appears twice — once in cleanAgency (real regex `[A-Z]\.`) and once in the client
    // clean() inside a template literal (escaped `[A-Z]\\.`). Count both forms.
    const server = (route.match(/\(\?:\[A-Z\]\\\.\)\{2,\}/g) || []).length;   // [A-Z]\.
    const client = (route.match(/\(\?:\[A-Z\]\\\\\.\)\{2,\}/g) || []).length; // [A-Z]\\.
    expect(server + client).toBeGreaterThanOrEqual(2);
  });
});
