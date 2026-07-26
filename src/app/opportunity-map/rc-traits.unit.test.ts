/**
 * Unit test for the Awarded/Recompete drawer's "What's special" trait chips (gap 5).
 *
 * `recompeteTraitChips(o)` (in route.ts's injected drawer JS) builds the small chip row for a
 * recompete (service line · set-aside · expiry window), reusing the opp drawer's .ws-tag styling.
 * `recompeteExpiryWindow(exp)` is the pure expiry-bucket helper it uses. Both are REAL-fields-only
 * (never fabricated). Extracted from route.ts and eval'd so the test tracks the SHIPPED source.
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

// The drawer JS lives in a TS template literal, so a runtime `≤` is written `\\u2264` in the raw
// source (the template emit halves the backslashes into the browser's <script>). De-escaping
// `\\` → `\` here reproduces exactly what the browser runs.
function deEscape(s: string): string { return s.replace(/\\\\/g, '\\'); }

// recompeteExpiryWindow is standalone; recompeteTraitChips needs esc + recompeteExpiryWindow in scope.
const esc = 'function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recompeteExpiryWindow: (exp: string) => string =
  new Function(`${extractFn('recompeteExpiryWindow')}; return recompeteExpiryWindow;`)();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recompeteTraitChips: (o: any) => string =
  new Function(`${esc}${extractFn('recompeteExpiryWindow')}${extractFn('recompeteTraitChips')}; return recompeteTraitChips;`)();

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

describe('recompeteExpiryWindow — expiry buckets (gap 5)', () => {
  it('buckets by months to expiry', () => {
    expect(recompeteExpiryWindow(daysFromNow(90))).toBe('Expires ≤ 6 mo');   // 3 mo
    expect(recompeteExpiryWindow(daysFromNow(300))).toBe('Expires ≤ 12 mo'); // 10 mo
    expect(recompeteExpiryWindow(daysFromNow(500))).toBe('Expires ≤ 18 mo'); // 16.7 mo
    expect(recompeteExpiryWindow(daysFromNow(800))).toBe('Expires 18 mo+');       // 26 mo
  });
  it('handles expired + empty honestly', () => {
    expect(recompeteExpiryWindow(daysFromNow(-30))).toBe('Expired');
    expect(recompeteExpiryWindow('')).toBe('');
  });
});

describe('recompeteTraitChips — trait chip row (gap 5)', () => {
  it('renders service line · set-aside · expiry window as .ws-tag chips', () => {
    const html = recompeteTraitChips({ cat: 'Janitorial', set: 'SDVOSB', exp: daysFromNow(90) });
    expect(html).toContain('ws-tag');
    expect(html).toContain('Janitorial');
    expect(html).toContain('SDVOSB');
    expect(html).toContain('Expires');
  });
  it('shows "Open / unrestricted" when there is no set-aside', () => {
    const html = recompeteTraitChips({ cat: 'Roofing', set: 'None', exp: '' });
    expect(html).toContain('Open / unrestricted');
    expect(html).not.toContain('Expires'); // no exp → no expiry chip
  });
  it('caps at 6 chips and escapes content', () => {
    const html = recompeteTraitChips({ cat: '<script>', set: 'None', exp: daysFromNow(90) });
    expect(html).toContain('&lt;script&gt;');
    expect((html.match(/ws-tag/g) || []).length).toBeLessThanOrEqual(6);
  });
});
