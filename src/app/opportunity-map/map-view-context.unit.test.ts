/**
 * Ask Mindy vs Map (2026-11-19): Map and Ask are separate tools.
 *
 * Pin-state helpers (__mindyViewStates) still power the map itself. Ask messages must NOT
 * inject map viewport geography — that bound Mid-Atlantic pins into company market research.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { JSDOM } from 'jsdom';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const unescape = (s: string) => s.replace(/\\\\/g, '\\');

function slice(startMarker: string, endMarker: string): string {
  const a = MAP.indexOf(startMarker);
  const b = MAP.indexOf(endMarker, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return unescape(MAP.slice(a, b));
}

type Pin = { lat?: number; lng?: number; state?: string; loc?: string };
type ViewStates = (pins: Pin[], bounds: unknown) => Array<{ state: string; pins: number }>;

function viewStatesFn(): ViewStates {
  const src = slice('  function pinState(p){', '  window.__mindyViewCtx = function(){');
  const win: Record<string, unknown> = {};
  new Function('window', src)(win);
  return win.__mindyViewStates as ViewStates;
}
// Mid-Atlantic bounds (roughly Richmond VA to central NJ).
const bounds = { contains: ([lat, lng]: [number, number]) => lat >= 37 && lat <= 40.6 && lng >= -79 && lng <= -74 };

describe('__mindyViewStates (VIEWPORT_JS)', () => {
  it('counts the states of plotted pins inside the bounds, most first, from state or "City, ST"', () => {
    const f = viewStatesFn();
    const pins: Pin[] = [
      { lat: 38.9, lng: -77.0, loc: 'Arlington, VA' },
      { lat: 38.8, lng: -77.1, loc: 'Alexandria, VA' },
      { lat: 39.3, lng: -76.6, loc: 'Baltimore, MD' },
      { lat: 39.9, lng: -75.2, state: 'PA' },
      { lat: 37.5, lng: -77.4, loc: 'Richmond, VA' },
      { lat: 33.5, lng: -86.8, loc: 'Birmingham, AL' }, // outside the view
      { lat: 38.9, lng: -77.0, loc: 'Washington' }, // no state: not counted, never guessed
      { loc: 'Norfolk, VA' }, // no coordinates: not plotted
    ];
    expect(f(pins, bounds)).toEqual([{ state: 'VA', pins: 3 }, { state: 'MD', pins: 1 }, { state: 'PA', pins: 1 }]);
  });
  it('returns [] with no pins or no usable bounds (never invents a place)', () => {
    const f = viewStatesFn();
    expect(f([], bounds)).toEqual([]);
    expect(f([{ lat: 38.9, lng: -77, state: 'VA' }], null)).toEqual([]);
  });
  it('keeps at most 6 states', () => {
    const f = viewStatesFn();
    const pins = ['VA', 'MD', 'PA', 'DE', 'NJ', 'DC', 'WV', 'NY'].map((s, i) => ({ lat: 38 + i * 0.1, lng: -76, state: s }));
    expect(f(pins, bounds)).toHaveLength(6);
  });
  it('the live view context publishes viewStates', () => {
    expect(MAP).toMatch(/viewStates: viewStates,/);
  });
});

function boot(ctx: Record<string, unknown>) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><div id="amk" aria-hidden="true"><div id="amkCtx"></div><button id="amkX"></button>'
    + '<div id="amkBody"></div><textarea id="amkIn"></textarea><button id="amkSend"></button></div></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const p = Buffer.from(JSON.stringify({ email: 'pro@example.com', exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '');
  const store: Record<string, string> = { mi_beta_auth_token: `${p}.sig` };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__track = () => {};
  w.__mindyViewCtx = () => ctx;
  const calls: Array<Record<string, unknown>> = [];
  const pending: Promise<unknown>[] = [];
  w.fetch = vi.fn((u: string, init: { body: string }) => {
    if (u === '/api/app/chat') calls.push(JSON.parse(init.body));
    const enc = new NodeTextEncoder();
    const text = [{ type: 'token', content: 'ok' }, { type: 'done' }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    const pr = Promise.resolve({ status: 200, ok: true, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), json: async () => ({}) });
    pending.push(pr);
    return pr;
  }) as never;
  w.eval(slice('const ASK_MINDY_JS = `<script>', '</script>`;').slice('const ASK_MINDY_JS = `<script>'.length));
  const ask = async (q: string) => {
    (w.openAskMindy as () => void)();
    (w.document.getElementById('amkIn') as HTMLTextAreaElement).value = q;
    (w.document.getElementById('amkSend') as HTMLButtonElement).click();
    for (let i = 0; i < 6; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); }
    return String(calls[calls.length - 1]?.message ?? '');
  };
  return { w, ask, ctx: () => w.document.getElementById('amkCtx')!.textContent || '' };
}

const MID_ATLANTIC = { count: 853, capped: true, scope: 'open', state: '', viewStates: [{ state: 'VA', pins: 312 }, { state: 'MD', pins: 140 }, { state: 'PA', pins: 90 }] };

describe('Ask Mindy does not inject map viewport (ASK_MINDY_JS)', () => {
  it('sends only the customer words — no Current map view preamble', async () => {
    const t = boot(MID_ATLANTIC);
    const msg = await t.ask('Which agencies buy the most in this view?');
    expect(msg).toBe('Which agencies buy the most in this view?');
    expect(msg).not.toContain('[Current map view');
    expect(msg).not.toContain('VA, MD, PA');
    expect(t.ctx()).toBe('');
  });
  it('a state-filtered map still does not bind Ask', async () => {
    const t = boot({ count: 40, scope: 'open', state: 'CA', viewStates: [{ state: 'CA', pins: 40 }] });
    const msg = await t.ask('Who buys here?');
    expect(msg).toBe('Who buys here?');
    expect(msg).not.toContain('filtered to CA');
  });
  it('placeholder is Ask Mindy, not "this view"', () => {
    expect(MAP).toMatch(/placeholder="Ask Mindy&hellip;"/);
  });
});
