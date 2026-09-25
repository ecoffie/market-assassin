/**
 * ROW 8 / DECISION 5 (canonical discovery) — AN EXCLUSION NEEDS A POSITIVE SCOPE, AND THE MAP SAYS SO.
 *
 * Since Phase C/C2/C3 the three Maps endpoints return discovery.status 'needs_positive_scope' (or
 * 'needs_refinement') with a human refinement sentence when the query cannot define a market —
 * "-computers" alone excludes one word from the whole federal market. Measured on production
 * 2026-09-23: /api/app/opportunity-map?q=-computers → success, totalForFilters 0, pins [],
 * discovery {status:'needs_positive_scope', refinement:'"-computers" only says what to leave out…'}.
 * The client ignored discovery.status, so the map rendered "0 results" / "No opportunities match" —
 * a statement about the MARKET for a query that searched nothing.
 *
 * The helpers are EXECUTED here (extracted from the served source), not grepped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const served = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');
const cook = (s: string) => s.replace(/\\\\/g, '\\');

function extractFn(src: string, name: string): string {
  const s = src.indexOf(`function ${name}(`); const o = src.indexOf('{', s); let d = 0;
  for (let i = o; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(s, i + 1); } }
  throw new Error(name + ' not found');
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib = new Function(cook(['horizonCount', 'horizonCountLabel', 'coverageNote', 'needsScopeNote'].map((n) => extractFn(route, n)).join('\n'))
  + ';return {horizonCount, horizonCountLabel, coverageNote, needsScopeNote};')() as any;
const fmt = (n: number) => String(n);

const REFINE = '"-computers" only says what to leave out. Add what you do sell (a capability, NAICS, agency or state) — excluding one word from the whole federal market is not a search.';
// Real production shapes (getmindy.ai, 2026-09-23), trimmed.
const OPEN_NPS = { success: true, totalForFilters: 0, pins: [], discovery: { version: 2, status: 'needs_positive_scope', refinement: REFINE, via: 'needs_positive_scope' } };
const FC_NPS = { success: true, totalForFilters: 0, pins: [], unplaced: [], discovery: { version: 2, status: 'needs_positive_scope', refinement: REFINE, via: 'needs_positive_scope', coverage: 'ok' } };
const NEEDS_REF = { success: true, totalForFilters: 0, pins: [], discovery: { status: 'needs_refinement', refinement: 'Nothing in "show me" names a capability…' } };
const REAL_ZERO = { success: true, totalForFilters: 0, pins: [], discovery: { status: 'ok', coverage: 'ok' } };

describe('horizonCount — needs_scope is its own meaning, never a 0', () => {
  it('needs_positive_scope → total null, state needs_scope, the server refinement carried through', () => {
    for (const d of [OPEN_NPS, FC_NPS]) {
      const c = lib.horizonCount(d);
      expect(c.state).toBe('needs_scope');
      expect(c.total).toBeNull();
      expect(c.refinement).toBe(REFINE);
      expect(lib.horizonCountLabel(c, fmt)).toBe('—');   // an em dash, not "0"
    }
  });
  it('needs_refinement is the same class', () => {
    expect(lib.horizonCount(NEEDS_REF).state).toBe('needs_scope');
  });
  it('status wins over coverage (forecast returns coverage ok beside the status)', () => {
    expect(lib.horizonCount(FC_NPS).state).toBe('needs_scope');
  });
  it('a real measured zero is still a real zero', () => {
    const c = lib.horizonCount(REAL_ZERO);
    expect(c).toEqual({ total: 0, state: 'ok', gaps: [] });
    expect(lib.horizonCountLabel(c, fmt)).toBe('0');
  });
  it('needs_scope is not a coverage fact — the coverage note stays empty', () => {
    expect(lib.coverageNote({ open: lib.horizonCount(OPEN_NPS) })).toBe('');
  });
});

describe('needsScopeNote — the refinement when EVERY enabled horizon says so', () => {
  const nps = lib.horizonCount(OPEN_NPS);
  it('all three enabled horizons needs_scope → the server sentence', () => {
    expect(lib.needsScopeNote({ open: nps, recompete: nps, forecast: lib.horizonCount(FC_NPS) }, ['open', 'recompete', 'forecast'])).toBe(REFINE);
  });
  it('one enabled horizon (Open only) → the sentence', () => {
    expect(lib.needsScopeNote({ open: nps }, ['open'])).toBe(REFINE);
  });
  it('any horizon with a real count → no refinement (the real result renders)', () => {
    expect(lib.needsScopeNote({ open: nps, recompete: lib.horizonCount(REAL_ZERO) }, ['open', 'recompete'])).toBe('');
  });
  it('a horizon that has not reported → no claim yet', () => {
    expect(lib.needsScopeNote({ open: nps }, ['open', 'recompete'])).toBe('');
    expect(lib.needsScopeNote({}, [])).toBe('');
  });
  it('an older server with status but no text → a fixed honest sentence, never blank', () => {
    const bare = lib.horizonCount({ success: true, totalForFilters: 0, discovery: { status: 'needs_positive_scope' } });
    expect(lib.needsScopeNote({ open: bare }, ['open'])).toMatch(/only says what to leave out/);
  });
});

describe('wiring — header and feed render the refinement, never "0 results"', () => {
  const hdr = extractFn(route, 'updateHeader');
  it('the header needs-scope branch runs BEFORE the unavailable and empty-total branches', () => {
    const ns = hdr.indexOf('if(window.__needsScope){');
    expect(ns).toBeGreaterThan(0);
    expect(ns).toBeLessThan(hdr.indexOf('if(window.__coverageAllUnavailable){'));
    expect(ns).toBeLessThan(hdr.indexOf('if(!TOTAL && '));
    const branch = hdr.slice(ns, hdr.indexOf('return;', ns));
    expect(branch).toContain('Nothing searched yet');          // a state, never a count
    expect(branch).not.toMatch(/>0</);
    expect(branch).toContain("getElementById('mapCount')");   // the map pill is hidden, not "0 opportunities"
  });
  // Measured in the headless journey: the focus-time fetch for "medical" resolved after "-computers" was
  // typed and appended "218 without a mapped location" under a query that searches nothing.
  it('an unplaced-forecast count for an EARLIER query never lands under the current one', () => {
    const row = extractFn(route, '_unplacedRow');
    const guard = row.indexOf("if((input.value||'').trim()!==q) return;");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(row.indexOf('panel.appendChild(b)'));
  });
  it('the fetch merge publishes __needsScope from the per-horizon counts on every successful pass', () => {
    const fetchBlock = route.slice(route.indexOf('function _partFrom('), route.indexOf('_unplacedFoot();'));
    expect(fetchBlock).toContain('window.__needsScope=needsScopeNote(window.__horizonCounts,_enabled);');
  });
  it('the feed shows the refinement BEFORE the generic "No opportunities match" empty state', () => {
    const feed = extractFn(tmpl, 'drawFeed');
    const ns = feed.indexOf('if(!rows.length && window.__needsScope){');
    expect(ns).toBeGreaterThan(0);
    expect(ns).toBeLessThan(feed.indexOf('No opportunities match'));
    expect(feed.slice(ns, feed.indexOf('return;', ns))).toContain('esc(window.__needsScope)');
  });
  it('the served template carries the same branch (template-html.ts in sync)', () => {
    expect(served).toContain('window.__needsScope');
  });
});
