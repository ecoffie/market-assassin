/**
 * Map filter / deeplink parity — the five contracts verified broken on prod 2026-08-27.
 *
 * 1. ?naics= applies the filter but leaves chips empty
 * 2. Numeric ?q= leaves controls unsynchronized
 * 3. Newline-separated NAICS concatenates (paste must split)
 * 4. Awarded/recompete multi-NAICS uses divergent exact-only matching
 * 5. ?horizon=forecast opens the default horizon instead of Forecast
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { naicsMatchConds } from '@/lib/opportunities/map-filters';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const RECOMPETE = readFileSync(
  join(process.cwd(), 'src/app/api/app/recompete-map/route.ts'),
  'utf8',
);

function deEscape(s: string): string {
  return s.replace(/\\\\/g, '\\');
}

function extractFn(name: string): string {
  const start = MAP.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);
  const open = MAP.indexOf('{', MAP.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < MAP.length; i++) {
    if (MAP[i] === '{') depth++;
    else if (MAP[i] === '}') {
      depth--;
      if (depth === 0) return deEscape(MAP.slice(start, i + 1));
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

function extractApplySavedSearch(): string {
  const start = MAP.indexOf('window.__applySavedSearch=function');
  expect(start).toBeGreaterThan(-1);
  const open = MAP.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < MAP.length; i++) {
    if (MAP[i] === '{') depth++;
    else if (MAP[i] === '}') {
      depth--;
      if (depth === 0) return deEscape(MAP.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced __applySavedSearch');
}

function extractScopeDeeplink(): string {
  const marker = "var agency=P('agency'), naics=P('naics')";
  const start = MAP.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  // The IIFE that owns agency/naics/mode restore.
  const blockStart = MAP.lastIndexOf('(function(){', start);
  const endMarker = "// \"Today's Lens\" pill";
  const end = MAP.indexOf(endMarker, start);
  expect(blockStart).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return deEscape(MAP.slice(blockStart, end));
}

type El = Record<string, any>;

function makeEl(id: string): El {
  const el: El = {
    id,
    value: '',
    innerHTML: '',
    textContent: '',
    placeholder: '',
    _on: {} as Record<string, Function[]>,
    classList: {
      _s: new Set<string>(),
      add(c: string) {
        this._s.add(c);
      },
      remove(c: string) {
        this._s.delete(c);
      },
      toggle(c: string, v?: boolean) {
        if (v) this._s.add(c);
        else this._s.delete(c);
      },
      contains(c: string) {
        return this._s.has(c);
      },
    },
    addEventListener(ev: string, fn: Function) {
      (el._on[ev] ||= []).push(fn);
    },
    fire(ev: string, e: any = {}) {
      (el._on[ev] || []).forEach((f) =>
        f({ preventDefault() {}, stopPropagation() {}, ...e }),
      );
    },
    querySelectorAll() {
      return [];
    },
    focus() {},
    remove() {},
  };
  return el;
}

const DIR: Record<string, Array<{ type: string; code: string; name?: string; title?: string }>> = {
  '541512': [{ type: 'naics', code: '541512', title: 'Computer Systems Design Services' }],
  '541611': [{ type: 'naics', code: '541611', title: 'Administrative Management Consulting' }],
  '333612': [{ type: 'naics', code: '333612', title: 'Speed Changer, Industrial High-Speed Drive, and Gear Manufacturing' }],
  '999999': [],
};

function chipHarness() {
  const els: Record<string, El> = {};
  for (const id of ['mfNaics', 'mfNaicsAc', 'mfNaicsChips', 'mfNaicsBox', 'mfNaicsErr']) {
    els[id] = makeEl(id);
  }
  const fetchStub = vi.fn((url: string) => {
    const q = decodeURIComponent((url.match(/[?&]q=([^&]*)/) || [, ''])[1]);
    return Promise.resolve({
      json: () => Promise.resolve({ success: true, results: DIR[q] ?? [] }),
    });
  });
  const doc = { getElementById: (id: string) => els[id] || null, activeElement: els.mfNaics };
  const factory = new Function(
    'document',
    'window',
    'fetch',
    'setTimeout',
    `${extractFn('wireChipCodes')}; return wireChipCodes;`,
  );
  const wire = factory(doc, {}, fetchStub, (fn: Function) => {
    fn();
    return 0;
  });
  const api = wire('mfNaics', 'mfNaicsAc', 'mfNaicsChips', 'mfNaicsBox', 'mfNaicsErr', 'naics');
  return { api, els, fetchStub };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('1. ?naics= restore must sync chips', () => {
  it('__applySavedSearch writes FILT.naics into __naicsChips.set', () => {
    const body = extractApplySavedSearch();
    // Industry sync alone is not enough — Filters chips must show the restored codes.
    expect(body).toMatch(/__naicsChips\.set\(FILT\.naics\)/);
  });
});

describe('2. Numeric ?q= must sync NAICS controls', () => {
  it('scope deeplink promotes a numeric q into filters.naics', () => {
    const block = extractScopeDeeplink();
    // A pure NAICS q must land in f.naics so chips / Industry / &naics= share one universe.
    expect(block).toMatch(/f\.naics\s*=\s*_qToks\.join/);
    expect(block).toMatch(/\[0-9\]\{2,6\}/);
  });
});

describe('3. Newline-separated NAICS must resolve as two codes', () => {
  it('paste of 541512\\n541611 creates two chips, never a concatenated token', async () => {
    const h = chipHarness();
    h.els.mfNaics.fire('paste', {
      clipboardData: { getData: () => '541512\n541611' },
    });
    await tick();
    await tick();
    expect(h.api.value()).toBe('541512,541611');
    expect(h.api.pending()).toBe('');
  });

  it('set() accepts newline / mixed whitespace without networking', () => {
    const h = chipHarness();
    h.api.set('541512\n541611');
    expect(h.api.value()).toBe('541512,541611');
    expect(h.fetchStub).not.toHaveBeenCalled();

    h.api.set('541512 ,  541611');
    expect(h.api.value()).toBe('541512,541611');
  });
});

describe('4. Awarded/recompete uses gold-master naicsMatchConds', () => {
  it('imports and calls naicsMatchConds instead of inline exact-only multi', () => {
    expect(RECOMPETE).toMatch(/naicsMatchConds/);
    expect(RECOMPETE).not.toMatch(
      /codes\.length > 1\) \{\s*q = q\.or\(codes\.map\(\(c\) => `naics_code\.eq\.\$\{c\}`\)/,
    );
  });

  it('gold master: single 6-digit exact, short prefix LIKE, multi OR, no cross-code widen', () => {
    expect(naicsMatchConds(['333612'])).toEqual(['naics_code.eq.333612']);
    expect(naicsMatchConds(['333'])).toEqual(['naics_code.like.333%']);
    expect(naicsMatchConds(['33361'])).toEqual(['naics_code.like.33361%']);
    expect(naicsMatchConds(['541512', '541611'])).toEqual([
      'naics_code.eq.541512',
      'naics_code.eq.541611',
    ]);
    expect(naicsMatchConds(['541', '333612'])).toEqual([
      'naics_code.like.541%',
      'naics_code.eq.333612',
    ]);
  });
});

describe('5. ?horizon=forecast aliases ?mode=forecast', () => {
  it('scope deeplink reads horizon and prefers explicit mode', () => {
    const block = extractScopeDeeplink();
    expect(block).toMatch(/P\('horizon'\)/);
    // Canonical mode wins when both are present.
    expect(block).toMatch(/mode\s*\|\|/);
  });
});
