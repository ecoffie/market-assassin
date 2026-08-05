/**
 * Saved page — the naicsCode() coercer must NEVER render "NAICS [object Object]" (Eric screenshot
 * 2026-08-05: a favorites card showed "NAICS [object Object]"). A saved row's naics can arrive as a
 * string, an array, or an object on older rows; the fact line does 'NAICS '+h(naics), so a non-string
 * stringified to "[object Object]". This locks the coercer (extracted from the shipped <script>).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'favorites/route.ts'), 'utf8');

function extract(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i).replace(/\\\\/g, '\\');
}

// eslint-disable-next-line no-new-func
const naicsCode = new Function(extract('naicsCode') + '\n; return naicsCode;')() as (v: unknown) => string;

describe('naicsCode — coerce any shape to a clean code string, never [object Object]', () => {
  it('passes a plain string through (trimmed)', () => {
    expect(naicsCode('337121')).toBe('337121');
    expect(naicsCode('  423450 ')).toBe('423450');
  });
  it('takes the first entry of an array', () => {
    expect(naicsCode(['337121', '541'])).toBe('337121');
  });
  it('reads .code / .value off an object', () => {
    expect(naicsCode({ code: '423450' })).toBe('423450');
    expect(naicsCode({ value: '334118' })).toBe('334118');
  });
  it('NEVER returns "[object Object]" — the bug case', () => {
    // a bare object / array-of-object / object with no code|value -> '' (line omitted), NOT [object Object]
    expect(naicsCode({})).toBe('');
    expect(naicsCode([{}])).toBe('');
    expect(naicsCode({ foo: 1 })).toBe('');
    // belt-and-suspenders: even a literal "[object Object]" string is scrubbed to ''
    expect(naicsCode('[object Object]')).toBe('');
  });
  it('nullish -> empty string', () => {
    expect(naicsCode(null)).toBe('');
    expect(naicsCode(undefined)).toBe('');
    expect(naicsCode('')).toBe('');
  });
  it('exhaustive: no input shape ever yields the object-stringification', () => {
    for (const v of [{}, [{}], { foo: 1 }, [[]], [{ a: 1 }], new Date()]) {
      expect(naicsCode(v)).not.toBe('[object Object]');
    }
  });
});
