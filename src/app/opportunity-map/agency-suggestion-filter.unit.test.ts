/**
 * ROW 8 (canonical discovery Phase A) — AN AGENCY SUGGESTION IS AN AGENCY FILTER.
 *
 * Before: picking "Department of Veterans Affairs" from the search suggestions was a
 * data-act="run" row — it typed the NAME into the keyword box, so the map ran q="Department of
 * Veterans Affairs" (a TEXT search over titles/descriptions) while the Agency control still read
 * "Agency". The user picked a BUYER. The canonical input for a buyer is the `agency` param, which
 * the server resolves whole-term (src/lib/discovery/buyer.ts) — so the suggestion now sets it.
 *
 * Executes the extracted client source against fake globals.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const cook = (s: string) => s.replace(/\\\\/g, '\\');
const between = (a: string, b: string) => {
  const s = MAP.indexOf(a); expect(s, a).toBeGreaterThan(0);
  const e = MAP.indexOf(b, s + a.length); expect(e, b).toBeGreaterThan(s);
  return MAP.slice(s, e);
};

const PRESETS = [
  { name: 'Department of Defense', match: 'DEFENSE' },
  { name: 'Department of Veterans Affairs', match: 'VETERANS AFFAIRS' },
  { name: 'NASA', match: 'NATIONAL AERONAUTICS' },
];

type El = { value: string; textContent: string; hidden: boolean; classList: { add(c: string): void; toggle(c: string, on?: boolean): void; has: Set<string> } };
const el = (): El => {
  const has = new Set<string>();
  return { value: '', textContent: '', hidden: true, classList: { has, add: (c) => has.add(c), toggle: (c, on) => { if (on === false) has.delete(c); else has.add(c); } } };
};

function run(name: string, opts: { Q?: string; agSetFromVal?: boolean } = {}) {
  const src = cook(between('window.__agencyNeedleFor=function(name){', '  // (Removed the header source badge'));
  const els: Record<string, El> = { mfAgency: el(), agencyLabel: el(), agencyBtn: el(), zsearchInput: el(), mfBadge: el(), moreBtn: el() };
  els.zsearchInput.value = opts.Q ?? name;
  els.agencyLabel.textContent = 'Agency';
  const calls: string[] = [];
  const agSet: string[] = [];
  const win: Record<string, unknown> = {
    __AGENCY_PRESETS: PRESETS,
    __syncQueryUrl: (drop: boolean) => calls.push('sync:' + drop),
    __track: (_k: string, action: string) => calls.push('track:' + action),
  };
  if (opts.agSetFromVal !== false) win.__agSetFromVal = (v: string) => { agSet.push(v); };
  const state = { FILT: { agency: '', naics: '' } as Record<string, string>, Q: opts.Q ?? name };
  const fn = new Function('window', 'document', 'state', 'fetchView',
    'var FILT=state.FILT, Q=state.Q;' + src
      + '; var r=window.__applyAgencySuggestion(' + JSON.stringify(name) + '); state.Q=Q; return r;');
  const ok = fn(win, { getElementById: (id: string) => els[id] || null }, state, () => calls.push('fetch'));
  return { ok, FILT: state.FILT, Q: state.Q, els, calls, agSet, needleFor: win.__agencyNeedleFor as (n: string) => string };
}

describe('__agencyNeedleFor — preset needle when the name IS a preset, else the full name', () => {
  const { needleFor } = run('x');
  it('an exact preset name → its match needle (the Agency pill can check that row)', () => {
    expect(needleFor('Department of Veterans Affairs')).toBe('VETERANS AFFAIRS');
    expect(needleFor('department of defense')).toBe('DEFENSE');
    expect(needleFor('NASA')).toBe('NATIONAL AERONAUTICS');
  });
  it('anything else → the official name verbatim; NO substring collapse onto a broader preset', () => {
    // "Department of the Army" contains no preset match string, but "U.S. Army Corps of Engineers"
    // style names must never be guessed onto DEFENSE — the server resolves whole names (#1672).
    expect(needleFor('Department of the Army')).toBe('Department of the Army');
    expect(needleFor('Defense Logistics Agency')).toBe('Defense Logistics Agency');
    expect(needleFor('Department of Housing and Urban Development')).toBe('Department of Housing and Urban Development');
  });
  it('empty → empty (nothing applied)', () => {
    expect(needleFor('  ')).toBe('');
  });
});

describe('__applyAgencySuggestion — sets the agency filter, not a keyword', () => {
  it('preset: FILT.agency = needle, the pill checks that preset, the keyword is cleared, refetch', () => {
    const r = run('Department of Veterans Affairs');
    expect(r.ok).toBe(true);
    expect(r.FILT.agency).toBe('VETERANS AFFAIRS');
    expect(r.els.mfAgency.value).toBe('VETERANS AFFAIRS');       // the Filters-panel input agrees
    expect(r.agSet).toEqual(['VETERANS AFFAIRS']);                // picker owns the label
    expect(r.Q).toBe('');                                          // NOT q="Department of Veterans Affairs"
    expect(r.els.zsearchInput.value).toBe('');
    expect(r.calls).toContain('sync:true');                        // URL drops the typed fragment
    expect(r.calls[r.calls.length - 1]).toBe('fetch');
  });
  it('non-preset: FILT.agency = full name and the pill shows that name honestly', () => {
    const r = run('Department of Housing and Urban Development', { Q: 'housing and' });
    expect(r.FILT.agency).toBe('Department of Housing and Urban Development');
    expect(r.els.agencyLabel.textContent).toBe('Department of Housing and Urban Development');
    expect(r.els.agencyBtn.classList.has.has('hasfilt')).toBe(true);
    expect(r.Q).toBe('');
  });
  it('the Filters badge counts the agency filter', () => {
    const r = run('NASA');
    expect(r.els.mfBadge.hidden).toBe(false);
    expect(r.els.mfBadge.textContent).toBe('1');
  });
  it('an empty name applies nothing and does not refetch', () => {
    const r = run('');
    expect(r.ok).toBe(false);
    expect(r.calls).not.toContain('fetch');
  });
});

describe('wiring — the suggestion row routes to the agency filter', () => {
  const panel = MAP.slice(MAP.indexOf('const SEARCH_PANEL_JS'));
  it('agency suggestion rows are data-act="agency", not a keyword run', () => {
    const agBlock = panel.slice(panel.indexOf('<div class="zsp-h">Agencies</div>'), panel.indexOf('<div class="zsp-h">Codes</div>'));
    expect(agBlock).toContain('data-act="agency" data-agency="');
    expect(agBlock).not.toContain('data-act="run"');
  });
  it('the click handler calls __applyAgencySuggestion (keyword run only as a partial-deploy fallback)', () => {
    const h = panel.slice(panel.indexOf("else if(act==='agency'){"), panel.indexOf("else if(act==='unplaced')"));
    expect(h).toContain('window.__applyAgencySuggestion(an)');
    expect(h.indexOf('window.__applyAgencySuggestion(an)')).toBeLessThan(h.indexOf('runSearch(an)'));
  });
  it('code suggestions are unchanged (still a keyword run; the canonical plan reads a code in q)', () => {
    const codes = panel.slice(panel.indexOf('<div class="zsp-h">Codes</div>'));
    expect(codes.slice(0, 400)).toContain('data-act="run"');
  });
});
