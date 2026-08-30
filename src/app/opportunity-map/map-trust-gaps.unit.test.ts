/**
 * Map trust gaps — Players deep-link gate + company drawer warehouse provenance.
 *
 * RED evidence (pre-fix):
 *   ?mode=buyers / ?company= / mobile Players nav / dataset pill called setMapMode directly,
 *   so anonymous visitors half-switched mode and kept a stale Opportunities count.
 *   companyFreshnessSec cited "USASpending / BigQuery" and ignored warehouseAsOf from company-detail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const companyDetail = readFileSync(
  join(process.cwd(), 'src/lib/bigquery/company-detail.ts'),
  'utf8',
);

function extractFn(name: string): string {
  const start = map.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist in route.ts`).toBeGreaterThan(-1);
  const open = map.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < map.length; i++) {
    if (map[i] === '{') depth++;
    else if (map[i] === '}') {
      depth--;
      if (depth === 0) return map.slice(start, i + 1).replace(/\\\\/g, '\\');
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const esc =
  "function esc(s){ return (s==null?'':String(s)).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]; }); }";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const companyFreshnessSec: (c: unknown) => string = new Function(
  `${esc}${extractFn('relTime')}${extractFn('warehouseAsOfLabel')}${extractFn('companyFreshnessSec')}; return companyFreshnessSec;`,
)();

describe('Players gate — deep links and nav must not bypass auth', () => {
  const gate = map.slice(map.indexOf('window.__playersGate = function'), map.indexOf('window.__playersGate = function') + 3200);

  it('accepts an optional onResume callback after auth', () => {
    expect(gate).toMatch(/window\.__playersGate\s*=\s*function\(mode,\s*onResume/);
    expect(gate).toMatch(/if\(typeof onResume===['"]function['"]\)/);
  });

  it('uses expired-session copy distinct from first-time visitors', () => {
    expect(gate).toContain('continue where you left off');
    expect(gate).toContain('meet the buyers behind the opportunities');
    expect(gate).toContain('mi_beta_email');
  });

  it('?mode=buyers scope links route through __playersGate before standalone applyScopeLink', () => {
    expect(map).toContain('__playersGate(_mode, applyScopeLink)');
    expect(map.indexOf('__playersGate(_mode, applyScopeLink)')).toBeLessThan(
      map.indexOf('applyScopeLink();'),
    );
  });

  it('?company= and ?buyer= deep links gate before opening drawers', () => {
    expect(map).toMatch(/__playersGate\('companies',\s*openCo\)/);
    expect(map).toMatch(/__playersGate\('companies',\s*openBu\)/);
    expect(map).not.toMatch(
      /company=\(\[\^&\]\+\)[\s\S]{0,400}setMapMode\('companies'\)/,
    );
  });

  it('mobile Players nav and dataset pill call __playersGate, not setMapMode directly', () => {
    expect(map).toMatch(/__playersGate&&__playersGate\(/);
    expect(map).toMatch(
      /if\(\(v==='companies'\|\|v==='buyers'\)&&typeof window\.__playersGate==='function'\)/,
    );
  });

  it('NL search intent re-gates Players dataset instead of switching mode immediately', () => {
    const block = map.slice(map.indexOf('window.__applySearchFilters'), map.indexOf('window.__applySearchFilters') + 1200);
    expect(block).toMatch(/__playersGate\('companies',\s*function\(\)\{\s*window\.__applySearchFilters\(intent\)/);
  });

  it('signed-out gate coalesces on a modal-ready queue (never /app)', () => {
    expect(map).toContain('window.__flushPlayersGateQueue');
    expect(map).toContain('var _pgPending = null');
    const gate = map.slice(map.indexOf('window.__playersGate = function'), map.indexOf('window.__playersGate = function') + 4200);
    expect(gate).toMatch(/_pgShowModal/);
    expect(gate).not.toMatch(/location\.href\s*=\s*['"]\/app/);
  });
});

describe('company-detail payload carries warehouse provenance', () => {
  it('includes warehouseAsOf from getContractorHistoryByUei', () => {
    expect(companyDetail).toContain('warehouseAsOf: hist.asOf');
    expect(companyDetail).toContain('historySource: hist.source');
    expect(companyDetail).toContain('historyResolution: hist.resolution');
  });
});

describe('Companies drawer freshness line — warehouse provenance visible', () => {
  it('labels BigQuery normalized warehouse, not live USASpending', () => {
    const html = companyFreshnessSec({
      uei: 'ABC123XYZ789',
      historySource: 'bigquery_normalized',
      warehouseAsOf: '2025-06-15T12:00:00.000Z',
    });
    expect(html).toContain('BigQuery normalized warehouse');
    expect(html).not.toMatch(/live USASpending/i);
    expect(html).not.toContain('From USASpending / BigQuery');
    expect(html).toMatch(/As of Jun 15, 2025/);
    expect(html).toMatch(/\(\d+ (day|month|year)/);
    expect(html).toContain('UEI ABC123XYZ789');
  });

  it('registry-zero shows SAM registry provenance honestly', () => {
    const html = companyFreshnessSec({
      uei: 'WDMBF2J6EML3',
      historySource: 'local_registry',
      historyResolution: 'registered_zero',
      warehouseAsOf: '2026-08-20T00:00:00.000Z',
    });
    expect(html).toContain('SAM entity registry');
    expect(html).toContain('no warehouse awards on file');
    expect(html).toMatch(/As of Aug 20, 2026/);
  });

  it('partial / budget-limited states stay visibly distinct', () => {
    const html = companyFreshnessSec({
      uei: 'FCJCDUZV7RM3',
      historySource: 'bigquery_normalized',
      warehouseAsOf: '2025-06-15',
      enrichmentStatus: 'budget_limited',
      historyDegraded: true,
    });
    expect(html).toContain('partial detail');
  });

  it('does not invent today when warehouseAsOf is missing', () => {
    const html = companyFreshnessSec({
      uei: 'ABC123XYZ789',
      historySource: 'bigquery_normalized',
      warehouseAsOf: null,
    });
    expect(html).not.toMatch(/As of/);
    expect(html).not.toMatch(/updated/);
  });
});
