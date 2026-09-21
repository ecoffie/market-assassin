/**
 * The header has NO subtitle line (Eric struck "23 SDVOSB-eligible · N closing this week" through in
 * red, Jul 26). The count lives on the sort row ("N results"). updateHeader() blanks the sumline, but
 * the template's render() + renderClusters() also write it — and render() had kept RE-POPULATING the
 * killed SDVOSB line after updateHeader cleared it, so it reappeared (Eric 2026-07-28: "you snuck in
 * the 23 sdvosb language"). This test fails if ANY sumline-writer re-introduces a subtitle.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// Strip line comments so we only inspect RENDERED code (a comment may legitimately quote the killed
// text while explaining the decision).
const code = tmpl.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('no SDVOSB/closing subtitle line (Eric killed it Jul 26)', () => {
  it('render() does NOT emit the "SDVOSB-eligible · closing this week" subtitle', () => {
    expect(code).not.toContain('SDVOSB-eligible');
    expect(code).not.toContain('closing this week');
  });
  it('every sumline writer in the template BLANKS it (no subtitle content)', () => {
    // Each `.innerHTML=` assignment on the sumline element must be the empty string.
    const writes = code.match(/sumline'?\)?\.innerHTML\s*=\s*[^;]+/g) || [];
    const slVarWrites = (code.match(/\bsl\.innerHTML\s*=\s*[^;]+/g) || []);
    const sumElWrites = (code.match(/\bsumEl\.innerHTML\s*=\s*[^;]+/g) || []);
    for (const w of [...writes, ...slVarWrites, ...sumElWrites]) {
      expect(w).toMatch(/innerHTML\s*=\s*''/); // only ever set to '' — never populated
    }
  });
  it('the route updateHeader() also keeps the sumline blank', () => {
    expect(route).toContain("if(sum)sum.innerHTML=''");
  });
});
