/**
 * #1608 acceptance gap: the saved state PERSISTED but was INVISIBLE.
 *
 * The real signed-out browser gate proved every persistence contract (canonical
 * notice id on the wire, exactly one `anonymous_shortlist` row, zero
 * `user_pipeline` rows, `shortlist_saved` telemetry, restore repopulating
 * `window.__anonSaved`, the correct card located — 1 of 878 `[data-nid]`
 * elements). The one thing that failed was rendering: the marker only wrote
 * visible text for a BUTTON, so a saved CARD showed nothing, and the drawer's
 * Save control had no `data-nid` at all and re-read "Start pursuit" on reopen.
 *
 * These tests execute the REAL client source extracted from route.ts against a
 * fake DOM, so a behaviour change fails them — not just a text change.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const TEMPLATE = readFileSync(join(__dirname, 'template.html'), 'utf8');
const NID = '313550655dcd4916a7700cb5c8f0ab68';   // canonical notice id
const SOL = 'FA670326Q0015';                       // its solicitation number

/** Pull a named client function out of the TS template literal and make it runnable. */
function extract(startMarker: string, endMarker: string) {
  const a = MAP.indexOf(startMarker);
  if (a < 0) throw new Error(`marker not found: ${startMarker}`);
  const b = MAP.indexOf(endMarker, a);
  if (b < 0) throw new Error(`end marker not found after start: ${endMarker}`);
  // Backslashes are doubled inside the template literal; undo that.
  return MAP.slice(a, b).replace(/\\\\/g, '\\');
}

// ── A tiny DOM good enough for the two code paths under test ──────────────
class El {
  tagName: string; className = ''; dataset: Record<string, string> = {};
  textContent = ''; innerHTML = ''; children: El[] = [];
  attrs: Record<string, string> = {}; classes = new Set<string>();
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  hasAttribute(k: string) { return k in this.attrs; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  get firstChild() { return this.children[0] ?? null; }
  insertBefore(n: El, ref: El | null) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i >= 0) this.children.splice(i, 0, n); else this.children.push(n);
    return n;
  }
  querySelector(sel: string): El | null {
    const hit = (e: El): El | null => {
      if (sel === '.cbody' && e.className.includes('cbody')) return e;
      if (sel === '.chip.saved' && e.innerHTML.includes('chip saved')) return e;
      for (const c of e.children) { const r = hit(c); if (r) return r; }
      return null;
    };
    for (const c of this.children) { const r = hit(c); if (r) return r; }
    return null;
  }
  get classList() {
    const self = this;
    return { add: (c: string) => { self.classes.add(c); } };
  }
}

function makeDoc(nodes: El[]) {
  return {
    createElement: (t: string) => new El(t),
    querySelectorAll: (sel: string) => {
      if (sel === '[data-nid]') return nodes.filter((n) => 'data-nid' in n.attrs);
      if (sel === 'button[onclick*="saveCurrentOpp"]') return nodes.filter((n) => n.tagName === 'BUTTON' && (n.attrs.onclick || '').includes('saveCurrentOpp'));
      return [];
    },
  };
}

/** Run the real _markSaved / _cardSavedChip against our DOM. */
function runMarkSaved(ids: string[], nodes: El[]) {
  const src = extract('function _cardSavedChip(el){', 'window.__remarkSaved=function()');
  const win: Record<string, unknown> = { __anonSaved: Object.create(null) };
  const posts: string[] = [];
  const fn = new Function('document', 'window', 'fetch', src + '; return _markSaved;');
  fn(makeDoc(nodes), win, (u: string) => { posts.push(u); return Promise.resolve({ json: () => Promise.resolve({}) }); })(ids);
  return { win, posts };
}

/** Run the real __markDrawerSaved against our DOM. */
function runDrawerMark(cur: Record<string, unknown> | null, savedIds: string[], buttons: El[]) {
  const src = extract('window.__markDrawerSaved=function(){', 'function setBtnLabel(btn,text){')
    + `
  function setBtnLabel(btn,text){ var t=btn.querySelector?btn.querySelector('.fc-move-t'):null; if(t)t.textContent=text; else btn.textContent=text; }
  return window.__markDrawerSaved;`;
  const anon = Object.create(null);
  for (const id of savedIds) anon[id] = 1;
  const win: Record<string, unknown> = { __anonSaved: anon };
  const posts: string[] = [];
  const fn = new Function('document', 'window', 'CUR', 'fetch', src);
  fn(makeDoc(buttons), win, cur, (u: string) => { posts.push(u); return Promise.resolve({ json: () => Promise.resolve({}) }); })();
  return { posts };
}

const card = (nid: string) => {
  const a = new El('article'); a.className = 'card'; a.setAttribute('data-nid', nid);
  const body = new El('div'); body.className = 'cbody'; a.children.push(body);
  return a;
};
const saveBtn = () => { const b = new El('button'); b.attrs.onclick = 'saveCurrentOpp(this)'; b.textContent = 'Start pursuit'; return b; };

beforeEach(() => { /* fresh nodes per test */ });

// ── A ─────────────────────────────────────────────────────────────────────
describe('A · a restored saved card is VISIBLY saved', () => {
  it('gets a visible ✓ Saved chip, not just a dataset flag', () => {
    const c = card(NID);
    runMarkSaved([NID], [c]);
    expect(c.dataset.saved).toBe('1');                       // the old behaviour
    const chipRow = c.children[0].children[0];               // inserted into .cbody
    expect(chipRow.innerHTML).toContain('chip saved');
    expect(chipRow.innerHTML).toContain('✓ Saved');      // VISIBLE text
  });

  it('the chip style exists in the served stylesheet', () => {
    expect(TEMPLATE).toMatch(/\.chip\.saved\{/);
    // template-html.ts is what the route actually serves.
    const served = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');
    expect(served).toContain('.chip.saved{');
  });
});

// ── B ─────────────────────────────────────────────────────────────────────
describe('B · reopening a saved SAM listing initialises the drawer control', () => {
  it('sets ✓ Saved and dataset.saved on the drawer Save button', () => {
    const b = saveBtn();
    runDrawerMark({ id: NID }, [NID], [b]);
    expect(b.dataset.saved).toBe('1');
    expect(b.textContent).toBe('✓ Saved');
  });

  it('the SAM drawer render path actually calls it', () => {
    expect(MAP).toMatch(/buildTabs\(\);[\s\S]{0,180}window\.__markDrawerSaved&&window\.__markDrawerSaved\(\)/);
  });
});

// ── C ─────────────────────────────────────────────────────────────────────
describe('C · rendering restored state performs NO write', () => {
  it('the card marker issues no fetch', () => {
    const { posts } = runMarkSaved([NID], [card(NID)]);
    expect(posts).toEqual([]);
  });

  it('the drawer marker issues no fetch and creates no pursuit', () => {
    const { posts } = runDrawerMark({ id: NID }, [NID], [saveBtn()]);
    expect(posts).toEqual([]);
  });

  it('the drawer marker contains no request or pursuit code at all', () => {
    const src = MAP.slice(MAP.indexOf('window.__markDrawerSaved=function(){'), MAP.indexOf('function setBtnLabel(btn,text){'));
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toMatch(/api\/pipeline/);
    expect(src).not.toMatch(/requireSignIn/);
  });

  it('a click on an already-saved control is a no-op, so reopening cannot double-write', () => {
    // saveCurrentOpp early-returns on dataset.saved==='1' — which the drawer
    // marker sets — so the reopened listing cannot POST again.
    expect(MAP).toMatch(/window\.saveCurrentOpp=function\(btn,done\)\{\s*\n\s*if\(!CUR\|\|btn\.dataset\.saved==='1'\)/);
  });
});

// ── D ─────────────────────────────────────────────────────────────────────
describe('D · an UNSAVED listing still renders the normal action', () => {
  it('leaves the drawer button untouched when the notice is not saved', () => {
    const b = saveBtn();
    runDrawerMark({ id: NID }, [], [b]);                     // nothing saved
    expect(b.dataset.saved).toBeUndefined();
    expect(b.textContent).toBe('Start pursuit');
  });

  it('leaves an unsaved card untouched', () => {
    const c = card('ffffffffffffffffffffffffffffffff');
    runMarkSaved([NID], [c]);
    expect(c.dataset.saved).toBeUndefined();
    expect(c.children[0].children.length).toBe(0);           // no chip injected
  });
});

// ── E ─────────────────────────────────────────────────────────────────────
describe('E · a solicitation number can never match a saved canonical notice id', () => {
  it('a DLA-shaped CUR whose id IS a solicitation number is not marked', () => {
    const b = saveBtn();
    // Even if the solicitation string were somehow in the saved set.
    runDrawerMark({ id: SOL }, [SOL, NID], [b]);
    expect(b.dataset.saved).toBeUndefined();
    expect(b.textContent).toBe('Start pursuit');
  });

  it('CUR.kind / isDla / dibbsUrl each disqualify the drawer even with a 32-hex id', () => {
    for (const cur of [{ id: NID, kind: 'recompete' }, { id: NID, isDla: true }, { id: NID, dibbsUrl: 'x' }]) {
      const b = saveBtn();
      runDrawerMark(cur, [NID], [b]);
      expect(b.dataset.saved).toBeUndefined();
    }
  });

  it('the gate is the canonical 32-hex test, stated in source', () => {
    const src = MAP.slice(MAP.indexOf('window.__markDrawerSaved=function(){'), MAP.indexOf('function setBtnLabel(btn,text){'));
    expect(src).toMatch(/\/\^\[a-f0-9\]\{32\}\$\/i\.test\(id\)/);
  });
});

// ── F ─────────────────────────────────────────────────────────────────────
describe('F · a feed repaint still restores the VISIBLE saved state', () => {
  it('re-marking a rebuilt feed re-injects the visible chip', () => {
    const first = card(NID);
    runMarkSaved([NID], [first]);
    expect(first.children[0].children[0].innerHTML).toContain('✓ Saved');
    // drawFeed rebuilds every card: a brand-new element, nothing carried over.
    const repainted = card(NID);
    runMarkSaved([NID], [repainted]);
    expect(repainted.dataset.saved).toBe('1');
    expect(repainted.children[0].children[0].innerHTML).toContain('✓ Saved');
  });

  it('marking twice does not duplicate the chip', () => {
    const c = card(NID);
    runMarkSaved([NID], [c]);
    runMarkSaved([NID], [c]);
    expect(c.children[0].children.length).toBe(1);
  });

  it('the repaint hook still calls the marker', () => {
    expect(MAP).toMatch(/__remarkSaved/);
  });
});

// ── G ─────────────────────────────────────────────────────────────────────
describe('G · the restore and the drawer render race, so BOTH ends mark', () => {
  it('the drawer render calls the marker', () => {
    expect(MAP).toMatch(/buildTabs\(\);[\s\S]{0,180}window\.__markDrawerSaved&&window\.__markDrawerSaved\(\)/);
  });

  it('the shortlist restore ALSO calls the marker, for when it lands second', () => {
    // Measured in a real browser: the drawer's detail fetch normally resolves
    // FIRST, so a drawer-render-only hook ran against an empty __anonSaved and
    // the Save control stayed on "Start pursuit" while the card was correct.
    const fn = MAP.slice(MAP.indexOf('function _markSaved(ids){'), MAP.indexOf('window.__remarkSaved=function()'));
    expect(fn).toMatch(/window\.__markDrawerSaved&&window\.__markDrawerSaved\(\)/);
  });

  it('marking the drawer twice is idempotent and still writes nothing', () => {
    const b = saveBtn();
    const first = runDrawerMark({ id: NID }, [NID], [b]);
    const second = runDrawerMark({ id: NID }, [NID], [b]);
    expect(b.dataset.saved).toBe('1');
    expect(b.textContent).toBe('\u2713 Saved');
    expect(first.posts).toEqual([]);
    expect(second.posts).toEqual([]);
  });
});
