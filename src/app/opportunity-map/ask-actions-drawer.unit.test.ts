/**
 * Ask Mindy controls the Map (beta) — the REAL drawer script in jsdom. An {type:'action'} stream event runs through
 * the function behind today's button (spied here), shows "<what changed> · Beta · Undo", and Undo restores the exact
 * snapshot. Only when the server capability says actions are on; invalid actions are rejected whole; ≤3 per turn.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'node:util';
import { JSDOM } from 'jsdom';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
function drawerScript(): string {
  const a = MAP.indexOf('const ASK_MINDY_JS = `<script>');
  const b = MAP.indexOf('</script>`;', a);
  return MAP.slice(a + 'const ASK_MINDY_JS = `<script>'.length, b).replace(/\\\\/g, '\\');
}
const token = (email: string) => Buffer.from(JSON.stringify({ email, exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '') + '.sig';
const SNAP = { mode: 'open', filters: { q: 'roofing', horizons: { open: true, recompete: false, forecast: false } }, bbox: { w: -100, s: 30, e: -80, n: 40 } };

function boot(opts: { actions: boolean }) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><aside id="amk" aria-hidden="true"><div class="amk-hd"><div id="amkCtx"></div><button id="amkX"></button></div>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn"></textarea><button id="amkSend"></button></div></div></aside></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const store: Record<string, string> = { mi_beta_auth_token: token('pro@example.com') };
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__mindyViewCtx = () => ({ count: 3, scope: 'all' });
  // The existing map functions behind today's buttons — spied.
  const applied: unknown[] = [];
  w.__applySavedSearch = vi.fn((ss: unknown) => { applied.push(JSON.parse(JSON.stringify(ss))); });
  w.__mapSnapshot = () => JSON.parse(JSON.stringify(SNAP));
  w.__horizons = { open: true, recompete: false, forecast: false };
  w.toggleHorizon = vi.fn();
  w.__isolateHorizon = vi.fn();
  w.__mapNationalView = vi.fn();
  w.openOppDrawer = vi.fn();
  w.__STATE_CENTROIDS = { FL: [28.6, -82.4] };
  w.__STATE_NAMES = { FL: 'Florida', GA: 'Georgia' };
  const tracked: Array<Record<string, unknown>> = [];
  w.__track = (_c: string, ev: string, p: Record<string, unknown>) => { if (ev === 'ask_mindy_action') tracked.push(p); };
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const enc = new NodeTextEncoder();
  w.fetch = vi.fn((url: string) => {
    if (url.startsWith('/api/app/chat/capabilities')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, screenshots: false, actions: opts.actions }) });
    if (url !== '/api/app/chat' && url.startsWith('/api/app/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ uploads: false, suggestions: [] }) });
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    return Promise.resolve({ ok: true, status: 200, body: stream, json: async () => ({}) });
  }) as never;
  w.eval(drawerScript());
  const doc = w.document;
  const tick = () => new Promise((r) => setTimeout(r, 15));
  const push = async (e: Record<string, unknown>) => { ctrl!.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); await tick(); await tick(); };
  const end = async () => { ctrl!.close(); await tick(); await tick(); };
  const send = async (q: string) => { await tick(); (doc.getElementById('amkIn') as HTMLTextAreaElement).value = q; (doc.getElementById('amkSend') as HTMLButtonElement).click(); await tick(); };
  (w as unknown as { openAskMindy: () => void }).openAskMindy();
  const notes = () => [...doc.querySelectorAll('[data-testid="amk-action-note"]')].map((n) => n.textContent);
  return { w, doc, push, end, send, applied, tracked, notes };
}
const act = (name: string, args: Record<string, unknown>, id = 'x' + Math.random().toString(36).slice(2, 8)) => ({ type: 'action', id, name, args });

describe('Ask Mindy controls the Map', () => {
  it('apply_view merges onto the current view through __applySavedSearch; the note says what changed · Beta · Undo; Undo restores the snapshot', async () => {
    const t = boot({ actions: true });
    await t.send('show VA construction work in Florida');
    await t.push(act('map.apply_view', { q: 'construction', filters: { state: 'FL', agency: 'Department of Veterans Affairs' } }));
    expect(t.applied[0]).toEqual({ mode: 'open', filters: { q: 'construction', horizons: { open: true, recompete: false, forecast: false }, state: 'FL', agency: 'Department of Veterans Affairs' } });
    expect(t.notes()[0]).toBe('Filtered to "construction" · Florida · Department of Veterans Affairs · Beta · Undo');
    (t.doc.querySelector('[data-testid="amk-action-undo"]') as HTMLButtonElement).click();
    expect(t.applied[1]).toEqual(SNAP);
    expect(t.doc.querySelector('[data-testid="amk-action-undo"]')!.textContent).toBe('Undone');
    expect(t.tracked.map((p) => p.outcome)).toEqual(['ran', 'undone']);
  });

  it('replace:true starts from a clean view; horizons merge; recompete mode passes through', async () => {
    const t = boot({ actions: true });
    await t.send('q');
    await t.push(act('map.apply_view', { replace: true, filters: { naics: '236220' }, horizons: { recompete: true }, mode: 'recompete' }));
    expect(t.applied[0]).toEqual({ mode: 'recompete', filters: { naics: '236220', horizons: { open: true, recompete: true, forecast: false } } });
  });

  it('search, horizons and go_to call the existing functions', async () => {
    const t = boot({ actions: true });
    await t.send('q');
    await t.push(act('map.search', { q: 'cybersecurity' }));
    expect((t.applied[0] as { filters: { q: string } }).filters.q).toBe('cybersecurity');
    await t.push(act('map.set_horizons', { isolate: 'forecast' }));
    expect(t.w.__isolateHorizon).toHaveBeenCalledWith('forecast');
    await t.push(act('map.go_to', { state: 'FL' }));
    const bb = (t.applied[1] as { bbox: Record<string, number> }).bbox;
    expect(bb.s).toBeLessThan(28.6); expect(bb.n).toBeGreaterThan(28.6);
    expect(t.notes()).toEqual(['Filtered to "cybersecurity" · Beta · Undo', 'Showing Coming soon · Beta · Undo', 'Zoomed to Florida · Beta · Undo']);
  });

  it('only one Undo is live: the previous action loses its Undo', async () => {
    const t = boot({ actions: true });
    await t.send('q');
    await t.push(act('map.search', { q: 'roofing' }));
    await t.push(act('map.search', { q: 'paving' }));
    const undos = [...t.doc.querySelectorAll('[data-testid="amk-action-undo"]')] as HTMLButtonElement[];
    expect(undos[0].disabled).toBe(true);
    expect(undos[1].disabled).toBe(false);
  });

  it('an invalid action is rejected whole with one plain note and nothing changes', async () => {
    const t = boot({ actions: true });
    await t.send('q');
    await t.push(act('map.apply_view', { filters: { onclick: 'alert(1)' } }));
    await t.push(act('map.drop_tables', {}));
    expect(t.applied).toEqual([]);
    expect(t.notes()).toEqual(['Mindy suggested a change this page can’t make · Beta']);
    expect(t.tracked.map((p) => p.outcome)).toEqual(['rejected:invalid', 'rejected:invalid']);
  });

  it('at most 3 actions run per turn', async () => {
    const t = boot({ actions: true });
    await t.send('q');
    for (const q of ['aa', 'bb', 'cc', 'dd']) await t.push(act('map.search', { q }));
    expect(t.applied).toHaveLength(3);
  });

  it('without the server capability, actions are ignored entirely', async () => {
    const t = boot({ actions: false });
    await t.send('q');
    await t.push(act('map.search', { q: 'cybersecurity' }));
    await t.push({ type: 'token', content: 'Answer.' });
    await t.end();
    expect(t.applied).toEqual([]);
    expect(t.notes()).toEqual([]);
  });

  it('open_record waits for the answer and opens only an id this turn returned; national view uses the existing control', async () => {
    const t = boot({ actions: true });
    await t.send('q');
    await t.push(act('map.open_record', { notice_id: '0009f2dae25541e4a2782d4807461bd0' }));
    await t.push(act('map.open_record', { notice_id: 'injected0000000000000000000000ff' }));
    await t.push(act('map.go_to', { national: true }));
    expect(t.w.openOppDrawer).not.toHaveBeenCalled(); // not before the answer is in
    await t.push({ type: 'token', content: 'Start with [the Navy recompete](/opportunity-map?opp=0009f2dae25541e4a2782d4807461bd0).' });
    await t.push({ type: 'done' });
    await t.end();
    expect(t.w.openOppDrawer).toHaveBeenCalledTimes(1);
    expect(t.w.openOppDrawer).toHaveBeenCalledWith('0009f2dae25541e4a2782d4807461bd0');
    expect(t.w.__mapNationalView).toHaveBeenCalled();
    expect(t.notes()).toEqual(['Showing the whole country · Beta · Undo', 'Opened the opportunity · Beta']);
    expect(t.tracked.map((p) => p.outcome)).toEqual(['ran', 'ran', 'rejected:unsourced']);
  });
});

