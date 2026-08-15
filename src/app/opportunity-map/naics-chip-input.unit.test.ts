/**
 * THE BUG (Eric 2026-08-14): the Filters NAICS box was freetext whose value became the query
 * verbatim. Its placeholder showed ONE code ("e.g. 236220 or a word like construction") and
 * nothing said multiple codes need COMMAS — but the reader split on ',' only. So the natural
 * "541512 541611" parsed as ONE junk token, and typing a word without picking from the
 * autocomplete sent the literal word ("construction") as a NAICS filter. Both silently returned
 * WRONG results with no signal — the worst failure mode.
 *
 * The contract (Eric): natural-language lookup stays, but chips hold RESOLVED CODES ONLY.
 * A word must be picked from the directory; codes separated by comma/space/newline auto-chip
 * after verification; unresolved text NEVER reaches the query and BLOCKS apply instead.
 *
 * These tests RUN the shipped wireChipCodes() (extracted from route.ts's injected <script>, the
 * same technique as network-drawer-dispatch.unit.test.ts) against a stub DOM + fetch, so they
 * assert real behavior rather than the shape of a regex.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function deEscape(s: string): string { return s.replace(/\\\\/g, '\\'); }

function extractFn(name: string): string {
  const start = routeSrc.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist in route.ts`).toBeGreaterThan(-1);
  const open = routeSrc.indexOf('{', routeSrc.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < routeSrc.length; i++) {
    if (routeSrc[i] === '{') depth++;
    else if (routeSrc[i] === '}') { depth--; if (depth === 0) return deEscape(routeSrc.slice(start, i + 1)); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

/** The real NAICS directory rows /api/suggest-codes serves for the queries these tests make. */
const DIR: Record<string, Array<{ type: string; code: string; name: string }>> = {
  '541512': [{ type: 'naics', code: '541512', name: 'Computer Systems Design Services' }],
  '541611': [{ type: 'naics', code: '541611', name: 'Administrative Management Consulting' }],
  '236220': [{ type: 'naics', code: '236220', name: 'Commercial and Institutional Building Construction' }],
  // A PREFIX returns its CHILDREN, never itself — this is why the code chips the prefix as typed.
  '5415': [
    { type: 'naics', code: '541511', name: 'Custom Computer Programming Services' },
    { type: 'naics', code: '541512', name: 'Computer Systems Design Services' },
  ],
  '999999': [],                                     // not a real code → must be rejected
  construction: [{ type: 'naics', code: '236220', name: 'Commercial and Institutional Building Construction' }],
};

type El = Record<string, any>;

/** Minimal DOM good enough for the chip widget: listeners, innerHTML, querySelectorAll. */
function makeEl(id: string): El {
  const el: El = {
    id, value: '', innerHTML: '', textContent: '', placeholder: '',
    _on: {} as Record<string, Function[]>,
    classList: { _s: new Set<string>(), add(c: string) { this._s.add(c); }, remove(c: string) { this._s.delete(c); }, toggle(c: string, v?: boolean) { v ? this._s.add(c) : this._s.delete(c); }, contains(c: string) { return this._s.has(c); } },
    addEventListener(ev: string, fn: Function) { (el._on[ev] ||= []).push(fn); },
    fire(ev: string, e: any = {}) { (el._on[ev] || []).forEach((f) => f({ preventDefault() {}, stopPropagation() {}, ...e })); },
    querySelectorAll() { return []; },
    focus() {}, remove() {},
  };
  return el;
}

function harness() {
  const els: Record<string, El> = {};
  for (const id of ['mfNaics', 'mfNaicsAc', 'mfNaicsChips', 'mfNaicsBox', 'mfNaicsErr']) els[id] = makeEl(id);
  const calls: string[] = [];

  const fetchStub = vi.fn((url: string) => {
    calls.push(url);
    const q = decodeURIComponent((url.match(/[?&]q=([^&]*)/) || [, ''])[1]);
    return Promise.resolve({ json: () => Promise.resolve({ success: true, results: DIR[q] ?? [] }) });
  });

  const win: Record<string, any> = {};
  const doc = { getElementById: (id: string) => els[id] || null, activeElement: els.mfNaics };
  const factory = new Function(
    'document', 'window', 'fetch', 'setTimeout',
    `${extractFn('wireChipCodes')}; return wireChipCodes;`,
  );
  const wire = factory(doc, win, fetchStub, (fn: Function) => { fn(); return 0; });
  const api = wire('mfNaics', 'mfNaicsAc', 'mfNaicsChips', 'mfNaicsBox', 'mfNaicsErr', 'naics');
  return { api, els, calls, fetchStub };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('NAICS filter: chips hold resolved codes only', () => {
  it('SPACE-separated codes both become chips — the exact input that silently broke', async () => {
    const h = harness();
    h.els.mfNaics.value = '541512 541611 ';
    h.els.mfNaics.fire('input');
    await tick(); await tick();

    // Pre-fix this was ONE junk token "541512 541611". Now: two verified codes, nothing pending.
    expect(h.api.value()).toBe('541512,541611');
    expect(h.api.pending(), 'the text box must be drained once codes are chipped').toBe('');
  });

  it('an unverifiable number is REJECTED, not chipped', async () => {
    const h = harness();
    h.els.mfNaics.value = '999999 ';
    h.els.mfNaics.fire('input');
    await tick(); await tick();

    expect(h.api.value(), '999999 is not in the directory — it must never become a filter').toBe('');
    expect(h.els.mfNaicsErr.textContent).toContain('999999');
  });

  it('a valid PREFIX chips as the prefix itself (the shared filter does a LIKE match)', async () => {
    const h = harness();
    h.els.mfNaics.value = '5415,';
    h.els.mfNaics.fire('input');
    await tick(); await tick();

    // Must NOT expand into its children — that would change the filter's meaning.
    expect(h.api.value()).toBe('5415');
  });

  it('an unresolved WORD stays pending and never enters the value', async () => {
    const h = harness();
    h.els.mfNaics.value = 'construction';
    h.els.mfNaics.fire('input');
    await tick(); await tick();

    expect(h.api.value(), 'a word the user never picked must not be queried').toBe('');
    expect(h.api.pending()).toBe('construction');
  });

  it('duplicate codes collapse instead of stacking', async () => {
    const h = harness();
    h.els.mfNaics.value = '541512 541512 ';
    h.els.mfNaics.fire('input');
    await tick(); await tick();

    expect(h.api.value()).toBe('541512');
  });

  it('set() round-trips the Industry dropdown selection (two-controls-one-FILT sync)', () => {
    const h = harness();
    h.api.set('236220,238210');
    expect(h.api.value()).toBe('236220,238210');
    h.api.clear();
    expect(h.api.value()).toBe('');
  });
});

describe('NAICS filter: unresolved text blocks Apply', () => {
  it('readDeep bails on pending text instead of filtering', () => {
    // The guard that makes the contract enforceable: readDeep returns FALSE, and the Apply
    // handler bails on false so the panel stays open with the error visible.
    const readDeep = routeSrc.slice(routeSrc.indexOf('function readDeep()'));
    expect(readDeep).toMatch(/_nc\.pending\(\)/);
    expect(readDeep.slice(0, 900)).toMatch(/return false/);
    expect(
      routeSrc.includes('if(readDeep()===false)return;'),
      'the Apply click handler must respect a blocked read',
    ).toBe(true);
  });

  it('FILT.naics is fed by the chip tray, never the raw text box', () => {
    const readDeep = routeSrc.slice(routeSrc.indexOf('function readDeep()'), routeSrc.indexOf('function readDeep()') + 1200);
    expect(readDeep).toMatch(/FILT\.naics=_nc\.value\(\)/);
  });
});
