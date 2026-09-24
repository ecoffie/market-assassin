/**
 * Maps P1/P2 feedback (2026-09-24): never make the user wonder whether Mindy heard them, and never let an
 * old answer masquerade as the new one. These pin the TIMING TIERS, the HONESTY of each progress row, the
 * Mindy Intel rules, the controller in a real DOM (newest round wins; cancelled work never reports), and the
 * wiring in route.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import {
  MF_TIMING, MF_PURE_JS_FOR_TESTS, MARKET_FEEDBACK_JS, MARKET_FEEDBACK_MAP_HTML, MARKET_BOOT_HTML, MF_HORIZON_LABEL,
} from './market-feedback';
import { MINDY_INTEL } from '@/lib/maps/mindy-intel';

type View = { bar: boolean; stale: boolean; local: boolean; panel: boolean; intel: boolean; boot: boolean; bootIntel: boolean; err: boolean };
type Row = { s: string; v: string };
const pure = new Function(`${MF_PURE_JS_FOR_TESTS}; return { mfView, mfRowText, mfPickIntel };`)() as {
  mfView: (r: Record<string, unknown> | null, now: number, T: typeof MF_TIMING) => View;
  mfRowText: (h: Record<string, unknown> | null) => Row;
  mfPickIntel: (cards: typeof MINDY_INTEL, enabled: string[], seen: string[], k: number) => { id: string } | null;
};
const T = MF_TIMING;
const round = (o: Record<string, unknown> = {}) => ({ kind: 'market', boot: false, stale: true, t0: 0, settled: false, painted: false, useful: false, failed: 0, h: {}, ...o });

describe('timing tiers — what appears when (measured from the ACTION)', () => {
  it('a market change is acknowledged at 0 ms, with nothing heavy before LOCAL', () => {
    const v = pure.mfView(round(), 0, T);
    expect(v.bar).toBe(true);
    expect(v.stale).toBe(true);
    expect(v.local || v.panel || v.intel || v.boot).toBe(false);
  });
  it.each([
    [T.LOCAL - 1, { local: false, panel: false, intel: false }],
    [T.LOCAL, { local: true, panel: false, intel: false }],
    [T.BRANDED - 1, { local: true, panel: false, intel: false }],
    [T.BRANDED, { local: true, panel: true, intel: false }],
    [T.RICH - 1, { panel: true, intel: false }],
    [T.RICH, { panel: true, intel: true }],
  ])('at %i ms: %o', (ms, want) => {
    expect(pure.mfView(round(), ms as number, T)).toMatchObject(want);
  });
  it('a pan gets only the bar, and only after LOCAL — never the Updating panel', () => {
    expect(pure.mfView(round({ kind: 'pan', stale: false }), T.LOCAL - 1, T).bar).toBe(false);
    expect(pure.mfView(round({ kind: 'pan', stale: false }), T.LOCAL, T).bar).toBe(true);
    expect(pure.mfView(round({ kind: 'pan', stale: false }), 10_000, T)).toMatchObject({ panel: false, intel: false, local: false });
  });
  it('a settled round shows nothing — result readiness always wins', () => {
    expect(pure.mfView(round({ settled: true, painted: true }), 5000, T)).toMatchObject({ bar: false, stale: false, panel: false, intel: false, err: false });
  });
  it('the old market stays marked OLD until NEW content paints; an all-failed update says so', () => {
    expect(pure.mfView(round({ painted: true }), 400, T).stale).toBe(false);
    const failed = pure.mfView(round({ settled: true, painted: false, failed: 3 }), 2000, T);
    expect(failed.stale).toBe(true);
    expect(failed.err).toBe(true);
    // a round that never had old content on screen has nothing to keep marked
    expect(pure.mfView(round({ stale: false, settled: true, failed: 3 }), 2000, T)).toMatchObject({ stale: false, err: false });
  });
  it('Building your market replaces the Updating panel on first entry and ends on the first USEFUL paint', () => {
    const b = round({ boot: true, stale: false });
    expect(pure.mfView(b, 1500, T)).toMatchObject({ boot: true, panel: false, local: false });
    expect(pure.mfView(b, T.BOOT_INTEL - 1, T).bootIntel).toBe(false);
    expect(pure.mfView(b, T.BOOT_INTEL, T).bootIntel).toBe(true);
    // a horizon painted pins → boot is over even though others are still loading; remaining progress moves to the panel
    const useful = pure.mfView(round({ boot: true, stale: false, painted: true, useful: true }), 1500, T);
    expect(useful).toMatchObject({ boot: false, panel: true });
    // settled (even with zero pins) or the failsafe also end it
    expect(pure.mfView(round({ boot: true, settled: true }), 900, T).boot).toBe(false);
    expect(pure.mfView(b, T.FAILSAFE, T).boot).toBe(false);
  });
});

describe('progress rows — a horizon is done only when ITS request completed, and never lies about a number', () => {
  it('pending/waiting carry no number', () => {
    expect(pure.mfRowText({ s: 'pending' })).toEqual({ s: 'pending', v: '' });
    expect(pure.mfRowText(null)).toEqual({ s: 'waiting', v: '' });
  });
  it('an error is an error — never zero', () => {
    expect(pure.mfRowText({ s: 'error' })).toEqual({ s: 'error', v: 'couldn’t load' });
  });
  it('unavailable / needs_scope / unknown are states, never 0', () => {
    expect(pure.mfRowText({ s: 'unavailable', total: null }).v).toBe('not covered');
    expect(pure.mfRowText({ s: 'needs_scope', total: null }).v).toBe('add what you sell');
    expect(pure.mfRowText({ s: 'unknown', total: null }).v).toBe('count unavailable');
    for (const s of ['unavailable', 'needs_scope', 'unknown', 'error']) expect(pure.mfRowText({ s, total: 0 }).v).not.toMatch(/^0/);
  });
  it('a measured zero IS shown as 0; partial is labelled', () => {
    expect(pure.mfRowText({ s: 'ok', total: 0 })).toEqual({ s: 'done', v: '0' });
    expect(pure.mfRowText({ s: 'ok', total: 1234 }).v).toBe((1234).toLocaleString());
    expect(pure.mfRowText({ s: 'partial', total: 27 }).v).toBe('27 (partial)');
  });
});

describe('Mindy Intel — a small, accurate content system', () => {
  it('cards are short, factual and unique', () => {
    const ids = new Set<string>();
    for (const c of MINDY_INTEL) {
      expect(ids.has(c.id)).toBe(false); ids.add(c.id);
      expect(c.text.length).toBeLessThanOrEqual(170);
      expect((c.text.match(/[.!?](\s|$)/g) || []).length).toBeLessThanOrEqual(2);
      expect(c.text).not.toMatch(/!|guarantee|#1|world.class|amazing|crush|win more|\bnever miss\b/i);
      for (const h of c.horizons) expect(['open', 'recompete', 'forecast']).toContain(h);
    }
    expect(MINDY_INTEL.length).toBeGreaterThanOrEqual(4);
  });
  it('a card about a horizon is never shown while that horizon is hidden', () => {
    for (let k = 0; k < 10; k++) {
      const c = pure.mfPickIntel(MINDY_INTEL, ['open'], [], k)!;
      const card = MINDY_INTEL.find((x) => x.id === c.id)!;
      expect(card.horizons.length === 0 || card.horizons.includes('open')).toBe(true);
    }
  });
  it('unseen cards come first, in authored order; rotation is deterministic', () => {
    const all = ['open', 'recompete', 'forecast'];
    const first = pure.mfPickIntel(MINDY_INTEL, all, [], 0)!.id;
    expect(first).toBe(MINDY_INTEL[0].id);
    const seen = [MINDY_INTEL[0].id];
    expect(pure.mfPickIntel(MINDY_INTEL, all, seen, 0)!.id).not.toBe(MINDY_INTEL[0].id);
    expect(pure.mfPickIntel(MINDY_INTEL, all, [], 1)!.id).toBe(pure.mfPickIntel(MINDY_INTEL, all, [], 1)!.id);
  });
});

// ── The controller in a real DOM ───────────────────────────────────────────────────────────────────
function page(withBoot = false) {
  // OPPS mirrors the page's top-level `const OPPS` (the list currently on screen).
  const html = '<!doctype html><html><body><script>let OPPS=[{},{}];</script><div class="app">' + (withBoot ? MARKET_BOOT_HTML : '')
    + '<section class="panel"><div class="sortrow"><div class="rescount" id="rescount"><b>128,791</b> results</div></div><div class="feed" id="feed"><div>card</div></div></section>'
    + '<div class="mapwrap"><div id="map"><div class="leaflet-pane leaflet-marker-pane"></div><div class="leaflet-pane leaflet-overlay-pane"></div></div><div class="mapcount" id="mapCount">3,165 of 128,791</div>'
    + MARKET_FEEDBACK_MAP_HTML + '</div></div>'
    + MARKET_FEEDBACK_JS + '</body></html>';
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const raw = dom.window as unknown as Window & { __mf: Record<string, (...a: unknown[]) => void>; __mfLog: Array<{ ev: string }>; __mfFlushNow: () => void };
  // DOM writes are batched into one flush per frame; tests flush after every report to read the result.
  const mf = new Proxy(raw.__mf, { get: (t, k: string) => (...a: unknown[]) => { const r = t[k](...a); raw.__mfFlushNow(); return r; } });
  const w = { __mf: mf, __mfLog: raw.__mfLog, raw };
  return { w, d: dom.window.document };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('controller — newest action wins; cancelled work never reports', () => {
  it('begin marks the old market as old at once: pins, list and both counts, and puts "Updating your market…" in place of the count', () => {
    const { w, d } = page();
    w.__mf.begin({ gen: 1, enabled: ['open', 'recompete'], kind: 'market', stale: true, q: 'ai governance' });
    expect(d.getElementById('mfbBar')!.classList.contains('on')).toBe(true);
    expect((d.querySelector('.leaflet-marker-pane') as HTMLElement).style.opacity).toBe('0.28');
    expect((d.getElementById('feed') as HTMLElement).style.opacity).toBe('0.38');
    expect((d.getElementById('rescount') as HTMLElement).style.opacity).toBe('0');
    expect((d.getElementById('mapCount') as HTMLElement).style.opacity).toBe('0');
    expect(d.getElementById('mfbUpd')!.textContent).toBe('Updating your market…');
    // stale via INLINE opacity only — never a body/pane class (measured: class toggles cost 18–260 ms on a 3k-pin map)
    expect(d.body.className).toBe('');
  });
  it('a result from a superseded round is ignored; only the current round advances progress', () => {
    const { w } = page();
    w.__mf.begin({ gen: 1, enabled: ['open', 'recompete'], kind: 'market', stale: true });
    w.__mf.begin({ gen: 2, enabled: ['open', 'recompete'], kind: 'market', stale: true });
    w.__mf.horizon(1, 'open', { s: 'ok', total: 99 });           // old round — must not count
    w.__mf.paint(1, { settled: true, painted: true, pins: 5 });   // old round — must not clear anything
    const log = w.__mfLog.map((x) => x.ev);
    expect(log.filter((e) => e === 'horizon')).toHaveLength(0);
    expect(log).not.toContain('settled');
    w.__mf.horizon(2, 'open', { s: 'ok', total: 27 });
    expect(w.__mfLog.filter((x) => x.ev === 'horizon')).toHaveLength(1);
  });
  it('the new content painting clears the old-market marks; settling clears the bar', () => {
    const { w, d } = page();
    w.__mf.begin({ gen: 3, enabled: ['open'], kind: 'market', stale: true });
    w.__mf.horizon(3, 'open', { s: 'ok', total: 27 });
    w.__mf.paint(3, { settled: true, painted: true, pins: 27 });
    expect((d.getElementById('feed') as HTMLElement).style.opacity).toBe('');
    expect((d.getElementById('rescount') as HTMLElement).style.opacity).toBe('');
    expect(d.getElementById('mfbBar')!.classList.contains('on')).toBe(false);
    expect(d.getElementById('mfbPanel')!.classList.contains('on')).toBe(false);
  });
  it('the Updating panel appears only after BRANDED, and each row is done only when its horizon reported', async () => {
    const { w, d } = page();
    w.__mf.begin({ gen: 4, enabled: ['open', 'recompete', 'forecast'], kind: 'market', stale: true });
    expect(d.getElementById('mfbPanel')!.classList.contains('on')).toBe(false);
    w.__mf.horizon(4, 'forecast', { s: 'unavailable', total: null });
    w.__mf.horizon(4, 'open', { s: 'error' });
    await wait(T.BRANDED + 60);
    w.raw.__mfFlushNow();
    expect(d.getElementById('mfbPanel')!.classList.contains('on')).toBe(true);
    const rows = [...d.querySelectorAll('#mfbRows .mfb-row')].map((r) => [r.getAttribute('data-s'), r.textContent]);
    expect(rows).toEqual([
      ['error', MF_HORIZON_LABEL.open + 'couldn’t load'],
      ['pending', MF_HORIZON_LABEL.recompete],
      ['note', MF_HORIZON_LABEL.forecast + 'not covered'],
    ]);
    w.__mf.paint(4, { settled: true, painted: false, pins: 0 });   // every horizon done, nothing new painted
  });
  it('an update that fails with the old market on screen keeps it marked old and says so', () => {
    const { w, d } = page();
    w.__mf.begin({ gen: 5, enabled: ['open'], kind: 'market', stale: true });
    w.__mf.horizon(5, 'open', { s: 'error' });
    w.__mf.paint(5, { settled: true, painted: false, pins: 0 });
    expect(d.getElementById('mfbErr')!.hidden).toBe(false);
    expect((d.getElementById('feed') as HTMLElement).style.opacity).toBe('0.38');
  });
  it('ack() acknowledges before the round exists and keeps the ACTION time as t0', () => {
    const { w, d } = page();
    w.__mf.ack();
    expect(d.getElementById('mfbBar')!.classList.contains('on')).toBe(true);
    expect((d.getElementById('feed') as HTMLElement).style.opacity).toBe('0.38');
    w.__mf.begin({ gen: 6, enabled: ['open'], kind: 'pan', stale: false });
    // an acknowledged action stays a market change even if the dispatch looked like a pan
    const begin = w.__mfLog.find((x) => x.ev === 'begin') as unknown as { x: { kind: string } };
    expect(begin.x.kind).toBe('market');
  });
  it('idle (Players map) clears everything and ends the boot transition', () => {
    const { w, d } = page(true);
    w.__mf.idle();
    expect(d.getElementById('mfbBoot')!.classList.contains('out')).toBe(true);
  });
  it('Building your market: stages for hidden horizons disappear; it ends on the first useful paint', () => {
    const { w, d } = page(true);
    w.__mf.begin({ gen: 7, enabled: ['open', 'forecast'], kind: 'market', stale: false, q: 'cybersecurity' });
    expect(d.querySelector('[data-st="intent"]')!.getAttribute('data-s')).toBe('done');
    expect((d.querySelector('[data-st="recompete"]') as HTMLElement).hidden).toBe(true);
    expect(d.getElementById('mfbBootQ')!.textContent).toBe('“cybersecurity”');
    w.__mf.horizon(7, 'open', { s: 'ok', total: 12 });
    expect(d.querySelector('[data-st="open"]')!.getAttribute('data-s')).toBe('done');
    expect(d.querySelector('[data-st="open"] .mfb-v')!.textContent).toBe('12');
    expect(d.querySelector('[data-st="forecast"]')!.getAttribute('data-s')).toBe('pending');
    expect(d.getElementById('mfbBoot')!.classList.contains('out')).toBe(false);
    w.__mf.paint(7, { settled: false, painted: true, pins: 12 });
    expect(d.getElementById('mfbBoot')!.classList.contains('out')).toBe(true);
  });
});

describe('wiring in route.ts', () => {
  const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
  it('every round reports begin → horizon → paint; the Players map and an empty horizon set report idle', () => {
    expect(src).toContain("window.__mf.begin({gen:gen,enabled:_enabled,kind:_intentChanged?'market':'pan',stale:_staleOnScreen,q:Q});");
    expect(src).toMatch(/window\.__mf\.horizon\(gen,m,r\.failed\?\{s:'error'/);
    expect(src).toContain('window.__mf.paint(round.gen,{settled:round.pending===0,painted:!!round.painted');
    expect(src).toMatch(/if\(isContactMode\(MODE\)\)\{\s*if\(window\.__mf\)window\.__mf\.idle\(\);/);
    expect(src).toContain('if(_enabled.length===0){ _fetchGen++; if(window.__mf)window.__mf.idle();');
  });
  it('Enter acknowledges in the event itself and commits in the next task (the acknowledgement paints first)', () => {
    expect(src).toMatch(/if\(window\.__mf\)window\.__mf\.ack\(\);\s*setTimeout\(function\(\)\{ Q=v; window\.__syncQueryUrl\(true\); fetchView\(\); \},0\);/);
    // the search panel's intent handler is deferred the same way, so it still runs AFTER the raw commit
    expect(src).toContain("input.addEventListener('keydown',function(e){ if(e.key==='Enter'){ var q=(input.value||'').trim(); setTimeout(function(){ if(q){ pushRecent(q);");
  });
  it('every non-pan fetchView is acknowledged and yields a frame before dispatch; a pan is tagged at its source', () => {
    expect(src).toContain("if(!(opts&&opts.pan)&&window.__mf)window.__mf.ack();");
    expect(src).toContain("requestAnimationFrame(function(){ _fvTimer=setTimeout(run,0); });");
    expect(src).toContain("t=setTimeout(function(){ fetchView({pan:true}); },450);");
  });
  it('the feedback script is injected BEFORE VIEWPORT_JS; the boot transition only on the full page (never ?embed=)', () => {
    expect(src).toContain('MARKET_FEEDBACK_JS + VIEWPORT_JS');
    const embedBranch = src.slice(src.indexOf('  if (embed) {'), src.indexOf('  } else {', src.indexOf('  if (embed) {')));
    expect(embedBranch).not.toContain('MARKET_BOOT_HTML');
    expect(src).toContain("ZTOP_HTML + MARKET_BOOT_HTML");
  });
});

describe('opportunity drawer — section-level loading (P1C)', () => {
  const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
  it('the shell shows the known facts plus titled skeletons — never a drawer-wide "Loading full details"', () => {
    expect(src).not.toContain('Loading full details');
    expect(src).toContain("'<div id=\"oppShellRest\">'+secSkel(ICON_TARGET+' Should I pursue this?',2)+secSkel('Opportunity intelligence',4)+secSkel('Market Intelligence',3)+secSkel('Buyer intelligence',2)+'</div>'");
    expect(src).toContain("'<div id=\"intelBox\">'+secSkel('Market Intelligence',3)+secSkel('Buyer intelligence',2)+'</div>'");
  });
  it('a failed detail fetch keeps the known facts on screen and fails only the pending part', () => {
    const n = src.split("if(_pin&&_rest){ _rest.innerHTML=oskErrHTML('the full details',nid); return; }").length - 1;
    expect(n).toBe(2);   // both the non-success response and the network error
  });
  it('an intel failure still fills "Should I pursue this?" (never an empty or forever-loading section)', () => {
    expect(src).toContain("fillMWinTop({grounded:false}); fillPursue({grounded:false},d.opp&&d.opp.id,d.opp,null,_pin);");
  });
});
