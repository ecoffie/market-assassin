/**
 * The early-signal chip: does this buying office telegraph work BEFORE it hits
 * the street?
 *
 * Scored per office (the DoDAAC prefixing the solicitation number). 46 offices
 * are >=50% early while 115 post ZERO, so the department average (21.2%)
 * describes almost nobody — that spread is the whole reason the chip exists.
 *
 * Two rules this pins, both of which are easy to "improve" into being wrong:
 *   - only high/medium earn a chip (a chip on all 470 scored offices is
 *     wallpaper, and "never posts early" is not news on every card)
 *   - the PERCENT stays in the tooltip, never the label — the rate moves ~10.7
 *     points between periods, so a number on the card implies false precision
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const tmplTs = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');

function extractFn(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const open = src.indexOf('{', start);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
}

const earlySignalChip = new Function(
  `${extractFn(tmpl, 'earlySignalChip')}; return earlySignalChip;`,
)() as (o: Record<string, unknown>) => string;

describe('earlySignalChip', () => {
  it('chips a high-signal office', () => {
    const out = earlySignalChip({ earlySignal: 'high', earlySignalPct: 89 });
    expect(out).toContain('Posts early');
    expect(out).toContain('chip early high');
  });

  it('chips a medium-signal office with softer wording', () => {
    const out = earlySignalChip({ earlySignal: 'medium', earlySignalPct: 35 });
    expect(out).toContain('Sometimes early');
    expect(out).toContain('chip early medium');
  });

  it('stays SILENT for low / none / unscored offices', () => {
    // A chip on every card is wallpaper; "this office never posts early" is not
    // news worth repeating on 115 offices' worth of pins.
    expect(earlySignalChip({ earlySignal: 'low', earlySignalPct: 10 })).toBe('');
    expect(earlySignalChip({ earlySignal: 'none', earlySignalPct: 0 })).toBe('');
    expect(earlySignalChip({})).toBe('');
    expect(earlySignalChip({ earlySignal: undefined })).toBe('');
  });

  it('keeps the percent in the TOOLTIP, not the visible label', () => {
    const out = earlySignalChip({ earlySignal: 'high', earlySignalPct: 89 });
    const label = out.replace(/^.*>([^<]*)<\/span>$/, '$1');
    expect(label).toBe('Posts early');
    expect(label).not.toContain('89');
    expect(out).toContain('title="89%');
  });

  it('renders without a percent when the score is missing', () => {
    const out = earlySignalChip({ earlySignal: 'high' });
    expect(out).toContain('Posts early');
    expect(out).toContain('title=""');
  });
});

describe('template sync', () => {
  it('the generated template-html.ts carries the chip', () => {
    // template-html.ts is what actually ships; a hand-edit to template.html
    // that skips the generator silently never reaches users.
    expect(tmplTs).toContain('earlySignalChip');
    expect((tmplTs.match(/earlySignalChip/g) || []).length)
      .toBe((tmpl.match(/earlySignalChip/g) || []).length);
  });

  it('the chip is rendered on the card, not just defined', () => {
    // Defined-but-never-called is the silent-failure mode here. Called on BOTH the result-list card
    // and the map-pin popup. As of 2026-08-03 the card wires it into a `crow` const (earlySignalChip(o)
    // + urgency), so the call is a bare expression, not a ${...} interpolation — match the CALL, not
    // the interpolation form.
    const calls = (tmpl.match(/earlySignalChip\(o\)/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(3); // 1 def + popup call + card call
    // and it genuinely reaches the result-list card body (the crow const)
    const card = tmpl.slice(tmpl.indexOf('function cardHTML(o)'), tmpl.indexOf('function pass(o)'));
    expect(card).toContain('earlySignalChip(o)');
  });

  it('ships CSS for both chip states', () => {
    expect(tmpl).toContain('.chip.early.high');
    expect(tmpl).toContain('.chip.early.medium');
  });
});
