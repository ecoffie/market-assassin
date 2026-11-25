/**
 * Map drawer pasted screenshots — the REAL drawer script (ASK_MINDY_JS) in jsdom.
 * Paste exists only when the server capability says so; a screenshot is redrawn on a canvas (≤ 1568 px), goes
 * with exactly ONE question as images:[{media_type,data}], and is never kept: not in history, storage, the
 * next turn or a card (opportunity) chat. A server refusal gives back the typed text and the screenshot.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'node:util';
import { JSDOM } from 'jsdom';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const SHOT = 'U0NSRUVOU0hPVA=='; // base64 of the stub canvas output "SCREENSHOT"

function drawerScript(): string {
  const a = MAP.indexOf('const ASK_MINDY_JS = `<script>');
  const b = MAP.indexOf('</script>`;', a);
  return MAP.slice(a + 'const ASK_MINDY_JS = `<script>'.length, b).replace(/\\\\/g, '\\');
}
function token(email: string): string {
  return Buffer.from(JSON.stringify({ email, exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '') + '.sig';
}

function boot(opts: { caps: boolean; chatStatus?: number; refusal?: unknown; bigUntil?: { type: string; q?: number; width: number } }) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><aside id="amk" aria-hidden="true"><div id="amkCtx"></div><button id="amkX"></button>'
    + '<div id="amkBody"></div><div class="amk-foot"><div class="amk-in"><textarea id="amkIn"></textarea><button id="amkSend"></button></div></div></aside></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const store: Record<string, string> = { mi_beta_auth_token: token('pro@example.com') };
  const session: Record<string, string> = {};
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  Object.defineProperty(w, 'sessionStorage', { value: { getItem: (k: string) => session[k] ?? null, setItem: (k: string, v: string) => { session[k] = v; }, removeItem: (k: string) => { delete session[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  w.__mindyViewCtx = () => ({ count: 3, scope: 'all' });
  // Image pipeline stubs: decode → canvas draw → re-encode. The encoded bytes are the canvas's, never the file's.
  const drawn: number[][] = [];
  w.createImageBitmap = (async () => ({ width: 3136, height: 1000, close() {} })) as never;
  const C = (w as unknown as { HTMLCanvasElement: typeof HTMLCanvasElement }).HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  C.getContext = () => ({ drawImage: (_s: unknown, x: number, y: number, ww: number, hh: number) => drawn.push([x, y, ww, hh]) });
  const encodes: Array<[string, number | undefined, number]> = [];
  C.toBlob = function (this: HTMLCanvasElement, cb: (b: Blob) => void, type: string, q?: number) {
    encodes.push([type, q, this.width]);
    const big = opts.bigUntil ? !(type === opts.bigUntil.type && q === opts.bigUntil.q && this.width === opts.bigUntil.width) : false;
    cb(new (w as unknown as { Blob: typeof Blob }).Blob([big ? new Uint8Array(900 * 1024 + 1) : 'SCREENSHOT'], { type }));
  };
  (w as unknown as { URL: typeof URL }).URL.createObjectURL = () => 'blob:local/1';
  (w as unknown as { URL: typeof URL }).URL.revokeObjectURL = () => {};

  const chats: Array<Record<string, unknown>> = [];
  const pending: Promise<unknown>[] = [];
  w.fetch = vi.fn((url: string, init: { method?: string; body?: unknown }) => {
    let p: Promise<unknown>;
    if (url.startsWith('/api/app/chat/capabilities')) p = Promise.resolve({ ok: true, status: 200, json: async () => ({ screenshots: opts.caps }) });
    else if (url.startsWith('/api/app/vault/doc-access')) p = Promise.resolve({ ok: true, status: 200, json: async () => ({ uploads: false }) });
    else if (url === '/api/app/chat') {
      chats.push(JSON.parse(String(init.body)));
      const st = opts.chatStatus ?? 200;
      if (st !== 200) p = Promise.resolve({ ok: false, status: st, body: null, json: async () => opts.refusal ?? {} });
      else {
        const enc = new NodeTextEncoder();
        const text = ['{"type":"token","content":"That is EFS Digital."}', '{"type":"done"}'].map((e) => `data: ${e}\n\n`).join('');
        p = Promise.resolve({ ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } }), json: async () => ({}) });
      }
    } else p = Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    pending.push(p.catch(() => undefined));
    return p;
  }) as never;
  w.eval(drawerScript());
  const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const doc = w.document;
  const input = () => doc.getElementById('amkIn') as HTMLTextAreaElement;
  const File_ = (w as unknown as { File: typeof File }).File;
  async function paste(types: string[]) {
    await settle();
    const ev = new w.Event('paste', { bubbles: true, cancelable: true });
    const files = types.map((t) => new File_(['raw-bytes-with-exif'], 'x', { type: t }));
    Object.defineProperty(ev, 'clipboardData', { value: { items: files.map((f) => ({ kind: 'file', getAsFile: () => f })), files } });
    input().dispatchEvent(ev);
    await settle();
    return ev;
  }
  async function ask(text: string) {
    input().value = text;
    input().dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
  }
  return { w, doc, chats, store, session, drawn, encodes, paste, ask, settle, input };
}

describe('Map drawer pasted screenshots', () => {
  it('without the server capability there is no paste row and a paste is left alone', async () => {
    const b = boot({ caps: false });
    const ev = await b.paste(['image/png']);
    expect(ev.defaultPrevented).toBe(false);
    expect(b.doc.querySelector('[data-testid="amk-shots"]')).toBeNull();
    await b.ask('hello');
    expect(b.chats[0].images).toBeUndefined();
  });

  it('a screenshot is downscaled, sent once as images:[{media_type,data}], and only a marker is kept', async () => {
    const b = boot({ caps: true });
    const ev = await b.paste(['image/png']);
    expect(ev.defaultPrevented).toBe(true);
    expect(b.drawn[0]).toEqual([0, 0, 1568, 500]);
    expect(b.doc.querySelectorAll('[data-testid="amk-shot-remove"]').length).toBe(1);

    await b.ask('Who is this company?');
    expect(b.chats[0].images).toEqual([{ media_type: 'image/png', data: SHOT }]);
    expect(b.chats[0].message).toBe('Who is this company?');
    expect(b.doc.getElementById('amkBody')!.textContent).toContain('[screenshot attached]');
    expect(b.doc.querySelectorAll('[data-testid="amk-shot-remove"]').length).toBe(0);

    await b.ask('What do they sell?');
    expect(b.chats[1].images).toBeUndefined();
    expect(JSON.stringify(b.chats[1].history)).toContain('[screenshot attached]');
    expect(JSON.stringify(b.chats[1])).not.toContain(SHOT);
    expect(JSON.stringify(b.store) + JSON.stringify(b.session)).not.toContain(SHOT);
    expect(JSON.stringify(b.chats)).not.toContain('raw-bytes-with-exif');
  });

  it('a screenshot with nothing typed asks a plain default question', async () => {
    const b = boot({ caps: true });
    await b.paste(['image/png']);
    await b.ask('');
    expect(b.chats[0].message).toMatch(/screenshot/i);
    expect(b.chats[0].images).toHaveLength(1);
  });

  it('at most 3; unsupported types get a plain note', async () => {
    const b = boot({ caps: true });
    await b.paste(['image/png', 'image/jpeg']);
    await b.paste(['image/webp', 'image/png']);
    expect(b.doc.querySelectorAll('[data-testid="amk-shot-remove"]').length).toBe(3);
    expect(b.doc.querySelector('.amk-shot-note')!.textContent).toMatch(/up to 3/);
    const c = boot({ caps: true });
    await c.paste(['image/gif']);
    expect(c.doc.querySelectorAll('[data-testid="amk-shot-remove"]').length).toBe(0);
    expect(c.doc.querySelector('.amk-shot-note')!.textContent).toMatch(/PNG, JPEG or WebP/);
  });

  it('a server refusal gives back the typed text and the screenshot with a plain note', async () => {
    const b = boot({ caps: true, chatStatus: 413 });
    await b.paste(['image/png']);
    await b.ask('Research EFS Digital');
    expect(b.input().value).toBe('Research EFS Digital');
    expect(b.doc.querySelectorAll('[data-testid="amk-shot-remove"]').length).toBe(1);
    expect(b.doc.querySelector('.amk-shot-note')!.textContent).toMatch(/still here/);
    expect(b.doc.getElementById('amkBody')!.textContent).not.toContain('[screenshot attached]');
  });

  it("the server's refusal message is shown as plain text", async () => {
    const b = boot({ caps: true, chatStatus: 400, refusal: { error: 'images_invalid', message: 'Up to 3 screenshots can be sent with one message.' } });
    await b.paste(['image/png']);
    await b.ask('q');
    expect(b.doc.querySelector('.amk-shot-note')!.textContent).toBe('Up to 3 screenshots can be sent with one message.');
    expect(b.input().value).toBe('q');
  });

  it('steps JPEG quality, then the edge, until a screenshot fits ~900 KB', async () => {
    const b = boot({ caps: true, bigUntil: { type: 'image/jpeg', q: 0.62, width: 1280 } });
    await b.paste(['image/png']);
    expect(b.encodes[0]).toEqual(['image/png', undefined, 1568]);
    expect(b.encodes[b.encodes.length - 1]).toEqual(['image/jpeg', 0.62, 1280]);
    await b.ask('q');
    expect((b.chats[0].images as Array<{ media_type: string }>)[0].media_type).toBe('image/jpeg');
  });

  it('a screenshot that cannot get under the target is refused in plain English', async () => {
    const b = boot({ caps: true, bigUntil: { type: 'never', width: 0 } });
    await b.paste(['image/png']);
    expect(b.doc.querySelectorAll('[data-testid="amk-shot-remove"]').length).toBe(0);
    expect(b.doc.querySelector('.amk-shot-note')!.textContent).toMatch(/too large to send/);
  });
});
