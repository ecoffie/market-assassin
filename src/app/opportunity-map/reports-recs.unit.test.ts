/**
 * Reports "Recommended actions" footer — GROUNDED derivation lock (Eric 2026-08-05, 9.7/10 review:
 * "every report should end with action, not data").
 *
 * buildRecsHtml(d) must derive its lines ONLY from the report's real fields (topBuyers / kpis.forecasts
 * / byState / kpis.recompetes / opportunityDna) — NEVER an LLM guess, NEVER generic filler. A line
 * appears only when its source field is present; the whole card is omitted ('' returned) when nothing
 * is groundable. This test extracts the SHIPPED function from route.ts's <script> (same template-literal
 * un-escape trick the other reports/pursuits tests use) so it tracks the real source, not a copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'reports/route.ts'), 'utf8');

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

function build() {
  const names = ['esc', 'fmtMoney', 'fmtNum', 'pct', 'buildRecsHtml'];
  const body = names.map(extract).join('\n') + `\n; return buildRecsHtml;`;
  // eslint-disable-next-line no-new-func
  return new Function(body)() as (d: unknown) => string;
}

const buildRecsHtml = build();

const FULL = {
  kpis: { forecasts: 15, recompetes: 5 },
  topBuyers: [{ name: 'Department of the Air Force', amount: 16_400_000_000 }],
  byState: [{ state: 'Florida', value: 30_000_000, pct: 0.27 }],
  opportunityDna: [{ label: 'Repeat buyer', count: 57, pct: 1.0 }],
};

describe('buildRecsHtml — grounded next steps, never fabricated', () => {
  it('renders a line per present field, all traced to real data', () => {
    const html = buildRecsHtml(FULL);
    expect(html).toContain('Recommended actions');
    expect(html).toContain('Watch <b>Department of the Air Force</b>');
    expect(html).toContain('leads at');            // uses the real amount
    expect(html).toContain('Monitor <b>15</b> upcoming forecasts');
    expect(html).toContain('Focus on <b>Florida</b>');
    expect(html).toContain('27% of open-opportunity value');
    expect(html).toContain('Review <b>5</b> upcoming recompetes');
    expect(html).toContain('target incumbents');   // the high repeat-buyer 5th line
  });

  it('OMITS the whole card (returns empty) when nothing is groundable', () => {
    expect(buildRecsHtml({ kpis: {}, topBuyers: [], byState: [], opportunityDna: [] })).toBe('');
    expect(buildRecsHtml({})).toBe('');
    expect(buildRecsHtml(null)).toBe('');
  });

  it('omits an individual line when its field is absent (no filler)', () => {
    // only a top buyer, nothing else -> exactly one "Watch" line, no forecast/state/recompete filler
    const html = buildRecsHtml({ kpis: {}, topBuyers: [{ name: 'DISA', amount: null }], byState: [] });
    expect(html).toContain('Watch <b>DISA</b>');
    expect(html).toContain('the top buyer in this market'); // amount null -> honest fallback phrasing
    expect(html).not.toContain('Monitor');
    expect(html).not.toContain('Focus on');
    expect(html).not.toContain('Review');
  });

  it('zero forecasts / zero recompetes produce NO line (a real 0 is not an action)', () => {
    const html = buildRecsHtml({ kpis: { forecasts: 0, recompetes: 0 }, topBuyers: [{ name: 'Navy', amount: 1 }], byState: [] });
    expect(html).not.toContain('Monitor');
    expect(html).not.toContain('Review');
  });

  it('singular vs plural is correct', () => {
    const html = buildRecsHtml({ kpis: { forecasts: 1, recompetes: 1 }, topBuyers: [], byState: [] });
    expect(html).toContain('upcoming forecast 6'); // singular, no trailing s before the space
    expect(html).toContain('Review <b>1</b> upcoming recompete<');
  });

  it('caps at 5 lines', () => {
    const html = buildRecsHtml(FULL);
    const lines = (html.match(/class="rec"/g) || []).length;
    expect(lines).toBeLessThanOrEqual(5);
    expect(lines).toBeGreaterThanOrEqual(4);
  });

  it('a low repeat-buyer pct (<40%) does NOT trigger the incumbent line', () => {
    const html = buildRecsHtml({ kpis: {}, topBuyers: [], byState: [], opportunityDna: [{ label: 'Repeat buyer', pct: 0.2 }] });
    expect(html).toBe(''); // nothing else groundable, and 0.2 < 0.4 so no incumbent line
  });
});
