/**
 * Ask Mindy on opportunity cards — the REAL drawer script (ASK_MINDY_JS) run in jsdom.
 * Pins the browser half: only the notice id is sent, the map-view preamble is not, each opportunity keeps its
 * own thread, credits and sources render, out-of-credits explains itself, sign-in resumes the question, and
 * the existing map-view chat is unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { JSDOM } from 'jsdom';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const NID = '6ba812a7e0284f79bc44c4932777c340';
const NID2 = 'd5a962ec18be46f9be23b66777921929';

function drawerScript(): string {
  const a = MAP.indexOf('const ASK_MINDY_JS = `<script>');
  const b = MAP.indexOf('</script>`;', a);
  expect(a).toBeGreaterThan(-1);
  return MAP.slice(a + 'const ASK_MINDY_JS = `<script>'.length, b).replace(/\\\\/g, '\\');
}
function token(email: string): string {
  const p = Buffer.from(JSON.stringify({ email, exp: Date.now() + 3_600_000 })).toString('base64').replace(/=+$/, '');
  return p + '.sig';
}
type Reply = { status?: number; events?: Array<Record<string, unknown>>; json?: unknown };

function boot(opts: { signedIn?: boolean; replies?: Reply[] } = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="amkOv"></div><div id="amk" aria-hidden="true"><div id="amkCtx"></div><button id="amkX"></button>'
    + '<div id="amkBody"></div><textarea id="amkIn"></textarea><button id="amkSend"></button></div></body></html>',
    { url: 'https://getmindy.ai/opportunity-map', runScripts: 'outside-only' },
  );
  const w = dom.window as unknown as Record<string, unknown> & Window & { eval: (s: string) => unknown };
  const store: Record<string, string> = {};
  if (opts.signedIn !== false) store.mi_beta_auth_token = token('free@example.com');
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  w.TextDecoder = NodeTextDecoder as never;
  const tracked: Array<[string, string, unknown]> = [];
  w.__track = (a: string, b: string, c: unknown) => { tracked.push([a, b, c]); };
  const signIns: Array<{ phrase: string; cb: () => void }> = [];
  w.openSignInModal = (phrase: string, cb: () => void) => { signIns.push({ phrase, cb }); };
  w.__mindyViewCtx = () => ({ count: 12, scope: 'all', q: 'janitorial', state: 'CA' });
  const calls: Array<Record<string, unknown>> = [];
  const replies = [...(opts.replies ?? [])];
  const pending: Promise<unknown>[] = [];
  w.fetch = vi.fn((_u: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body));
    const r = replies.shift() ?? { events: [{ type: 'session', sessionId: '11111111-2222-4333-8444-555555555555' }, { type: 'token', content: 'Due Dec 4.' }, { type: 'done' }] };
    const status = r.status ?? 200;
    const enc = new NodeTextEncoder();
    const text = (r.events ?? []).map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    const bodyStream = new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } });
    const p = Promise.resolve({ status, ok: status >= 200 && status < 300, body: bodyStream, json: async () => r.json ?? {} });
    pending.push(p);
    return p;
  }) as never;
  w.eval(drawerScript());
  const settle = async () => { for (let i = 0; i < 6; i++) { await Promise.all(pending); await new Promise((r) => setTimeout(r, 0)); } };
  const doc = w.document;
  return { w, doc, store, calls, tracked, signIns, settle, body: () => doc.getElementById('amkBody')!, ctx: () => doc.getElementById('amkCtx')!.textContent || '' };
}
const OPP = { id: NID, title: 'Janitorial Services, Building 12', deadline: '2026-12-04T17:00:00Z' };

describe('opening a card conversation', () => {
  it('pins the opportunity and shows opportunity starters', () => {
    const t = boot();
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    expect(t.doc.getElementById('amk')!.classList.contains('amk-card')).toBe(true);
    expect(t.ctx()).toContain('About: Janitorial Services, Building 12');
    expect(t.ctx()).toContain('due 2026-12-04');
    expect(t.body().textContent).toContain('Ask about this opportunity');
    expect(t.body().textContent).toContain('Who held this before?');
    expect(t.tracked.some((e) => e[1] === 'card_chat_open')).toBe(true);
  });
  it('a malformed id does nothing', () => {
    const t = boot();
    (t.w.__askAboutOpp as (o: unknown) => void)({ id: 'W912PL26Q0042', title: 'x' });
    expect(t.doc.getElementById('amk')!.classList.contains('amk-card')).toBe(false);
  });
});

describe('asking', () => {
  it('sends only the question and the notice id (no map-view preamble, no client facts)', async () => {
    const t = boot();
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    (t.body().querySelector('.amk-chips button') as HTMLButtonElement).click();
    await t.settle();
    expect(t.calls[0].context).toEqual({ kind: 'opportunity', notice_id: NID });
    expect(String(t.calls[0].message)).not.toContain('[Current map view');
    expect(JSON.stringify(t.calls[0])).not.toContain('Janitorial Services, Building 12');
    expect(t.tracked.some((e) => e[1] === 'card_chat_ask')).toBe(true);
  });
  it('renders the answer, its source, and the credits left', async () => {
    const t = boot({ replies: [{ events: [
      { type: 'session', sessionId: '11111111-2222-4333-8444-555555555555' }, { type: 'token', content: 'Due Dec 4.' },
      { type: 'citations', sources: [{ title: 'SAM.gov notice W912PL26Q0042', url: 'https://sam.gov/opp/x/view' }] },
      { type: 'credits', charged: 10, balance: 90 }, { type: 'done' },
    ] }] });
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    (t.w.document.getElementById('amkIn') as HTMLTextAreaElement).value = 'When is it due?';
    (t.doc.getElementById('amkSend') as HTMLButtonElement).click();
    await t.settle();
    const txt = t.body().textContent || '';
    expect(txt).toContain('Due Dec 4.');
    expect(txt).toContain('Source: SAM.gov notice W912PL26Q0042');
    expect(txt).toContain('10 credits used');
    expect(txt).toContain('90 credits left');
  });
  it('out of credits (402): says what an answer costs and what they hold, with a Pro link', async () => {
    const t = boot({ replies: [{ status: 402, json: { error: 'credits_required', balance: 4, credits_per_answer: 10 } }] });
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    (t.w.document.getElementById('amkIn') as HTMLTextAreaElement).value = 'q';
    (t.doc.getElementById('amkSend') as HTMLButtonElement).click();
    await t.settle();
    const txt = t.body().textContent || '';
    expect(txt).toContain('out of free credits');
    expect(txt).toContain('uses 10 credits and you have 4');
    expect(t.body().querySelector('a[href="/market-intelligence"]')).not.toBeNull();
  });
});

describe('continuity: each opportunity keeps its own thread', () => {
  it('reopening the same card restores its conversation; another card starts fresh; ids stay per card', async () => {
    const t = boot();
    const open = t.w.__askAboutOpp as (o: unknown) => void;
    open(OPP);
    (t.w.document.getElementById('amkIn') as HTMLTextAreaElement).value = 'When is it due?';
    (t.doc.getElementById('amkSend') as HTMLButtonElement).click();
    await t.settle();
    expect(JSON.parse(t.store['mindy_card_chat:' + NID]).sessionId).toBe('11111111-2222-4333-8444-555555555555');
    open({ id: NID2, title: 'Other' });
    expect(t.body().textContent).toContain('Ask about this opportunity');
    open(OPP);
    expect(t.body().textContent).toContain('When is it due?');
    expect(t.body().textContent).toContain('Due Dec 4.');
    (t.w.document.getElementById('amkIn') as HTMLTextAreaElement).value = 'And the set-aside?';
    (t.doc.getElementById('amkSend') as HTMLButtonElement).click();
    await t.settle();
    expect(t.calls.at(-1)!.sessionId).toBe('11111111-2222-4333-8444-555555555555');
    expect((t.calls.at(-1)!.history as unknown[]).length).toBe(2);
  });
});

describe('sign-in and the existing map-view chat', () => {
  it('a signed-out visitor is asked to sign in, and the question is sent after sign-in', async () => {
    const t = boot({ signedIn: false });
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    (t.w.document.getElementById('amkIn') as HTMLTextAreaElement).value = 'When is it due?';
    (t.doc.getElementById('amkSend') as HTMLButtonElement).click();
    expect(t.signIns[0].phrase).toBe('ask Mindy about this opportunity');
    expect(t.calls).toHaveLength(0);
    t.store.mi_beta_auth_token = token('new@example.com');
    t.signIns[0].cb();
    await t.settle();
    expect(t.calls[0]).toMatchObject({ email: 'new@example.com', message: 'When is it due?', context: { kind: 'opportunity', notice_id: NID } });
  });
  it('opening the general drawer leaves card mode and sends customer words only (no map preamble)', async () => {
    const t = boot();
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    (t.w.openAskMindy as (s?: string) => void)();
    expect(t.doc.getElementById('amk')!.classList.contains('amk-card')).toBe(false);
    (t.w.document.getElementById('amkIn') as HTMLTextAreaElement).value = 'Who buys the most here?';
    (t.doc.getElementById('amkSend') as HTMLButtonElement).click();
    await t.settle();
    expect(t.calls[0]).not.toHaveProperty('context');
    expect(String(t.calls[0].message)).toBe('Who buys the most here?');
  });
});

describe('the card invitation and the flag', () => {
  it('the invitation is gated on the flag and a real notice id; workflow buttons are unchanged', () => {
    const a = MAP.indexOf('  function actions(o){');
    const src = MAP.slice(a, MAP.indexOf('  // ── DLA/DIBBS bid drawer', a));
    expect(src).toContain('!!window.__CARD_CHAT_ENABLED && /^[0-9a-f]{32}$/.test(');
    expect(src).toContain('Ask Mindy about this opportunity');
    for (const kept of ['Start pursuit', 'Generate proposal', 'View on SAM']) expect(src).toContain(kept);
  });
  it('the flag script is rendered into the page from the server flag', () => {
    expect(MAP).toContain("const CARD_CHAT_FLAG_JS = '<script>window.__CARD_CHAT_ENABLED=' + String(isCardChatEnabled()) + ';</script>';");
    expect(MAP).toMatch(/CARD_CHAT_FLAG_JS \+ SAFE_MARKDOWN_SCRIPT \+ ASK_MINDY_JS/);
  });
  it('phones get a full-width card chat sheet', () => {
    expect(MAP).toContain("'@media(max-width:640px){.amk.amk-card{width:100vw}}'");
    // never the bare .card class: the map styles .card (listing cards) incl. a :hover transform
    const js = MAP.slice(MAP.indexOf('const ASK_MINDY_JS'), MAP.indexOf('</script>`;', MAP.indexOf('const ASK_MINDY_JS')));
    expect(js).not.toMatch(/classList\.(add|remove|toggle)\('card'\)/);
  });
});

describe('charge once per question: the browser reuses a question\'s turn id', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const S = '11111111-2222-4333-8444-555555555555';
  const askCard = async (t: ReturnType<typeof boot>, q: string) => {
    (t.w.document.getElementById('amkIn') as HTMLTextAreaElement).value = q;
    (t.doc.getElementById('amkSend') as HTMLButtonElement).click();
    await t.settle();
  };
  const pending = (t: ReturnType<typeof boot>) => JSON.parse(t.store['mindy_card_chat:' + NID] || '{}').pending ?? null;

  it('every card question gets its own turn id; a completed answer clears it; map-view chat sends none', async () => {
    const t = boot();
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    await askCard(t, 'When is it due?');
    await askCard(t, 'Is it set aside?');
    expect(String(t.calls[0].turn_id)).toMatch(UUID);
    expect(String(t.calls[1].turn_id)).toMatch(UUID);
    expect(t.calls[0].turn_id).not.toBe(t.calls[1].turn_id);
    expect(t.calls[0].replay_only).toBeUndefined();
    expect(pending(t)).toBeNull();
    (t.w.openAskMindy as () => void)();
    await askCard(t, 'Who buys here?');
    expect(t.calls[2].turn_id).toBeUndefined();
  });

  it('the connection drops (no done event): the question stays pending; "Get the answer" resends the SAME turn id', async () => {
    const t = boot({ replies: [
      { events: [{ type: 'session', sessionId: S }, { type: 'token', content: 'Due Dec' }] }, // stream cut, no done
      { events: [{ type: 'session', sessionId: S }, { type: 'token', content: 'Due Dec 4.' }, { type: 'replayed', charged: 0 }, { type: 'done' }] },
    ] });
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    await askCard(t, 'When is it due?');
    const first = t.calls[0].turn_id;
    expect(pending(t)).toEqual({ turnId: first, q: 'When is it due?' });
    expect(t.body().textContent).toContain('The connection dropped before the answer finished.');
    const btn = [...t.body().querySelectorAll('.amk-act button')].find((b) => b.textContent === 'Get the answer') as HTMLButtonElement;
    btn.click();
    await t.settle();
    expect(t.calls[1]).toMatchObject({ turn_id: first, message: 'When is it due?' });
    expect(t.body().textContent).toContain('Saved answer · no extra credits');
    expect(t.body().querySelectorAll('.amk-msg.u').length).toBe(1); // the question is not duplicated on screen
    expect(pending(t)).toBeNull();
  });

  it('refresh/reopen with a pending question fetches the saved answer (replay only, same turn id) and keeps it', async () => {
    const t = boot({ replies: [
      { events: [{ type: 'session', sessionId: S }, { type: 'token', content: 'Due Dec 4.' }, { type: 'citations', sources: [{ title: 'SAM.gov notice W912PL26Q0042', url: null }] }, { type: 'replayed', charged: 0 }, { type: 'done' }] },
    ] });
    const TID = '0a0a0a0a-1111-4222-8333-444444444444';
    t.store['mindy_card_chat:' + NID] = JSON.stringify({ sessionId: S, history: [], pending: { turnId: TID, q: 'When is it due?' } });
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    await t.settle();
    expect(t.calls[0]).toMatchObject({ turn_id: TID, replay_only: true, message: 'When is it due?', sessionId: S });
    const txt = t.body().textContent || '';
    expect(txt).toContain('Due Dec 4.');
    expect(txt).toContain('Saved answer · no extra credits');
    expect(pending(t)).toBeNull();
    expect(JSON.parse(t.store['mindy_card_chat:' + NID]).history).toEqual([{ role: 'user', content: 'When is it due?' }, { role: 'assistant', content: 'Due Dec 4.' }]);
  });

  it('reopen finds the answer never finished (404 turn_not_completed): says it was not charged and offers to ask again with the same id', async () => {
    const t = boot({ replies: [{ status: 404, json: { error: 'turn_not_completed' } }] });
    const TID = '0a0a0a0a-1111-4222-8333-444444444444';
    t.store['mindy_card_chat:' + NID] = JSON.stringify({ sessionId: S, history: [], pending: { turnId: TID, q: 'When is it due?' } });
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    await t.settle();
    expect(t.body().textContent).toContain('This answer did not finish, so it was not charged.');
    ([...t.body().querySelectorAll('.amk-act button')].find((b) => b.textContent === 'Get the answer') as HTMLButtonElement).click();
    await t.settle();
    expect(t.calls[1]).toMatchObject({ turn_id: TID, message: 'When is it due?' });
    expect(t.calls[1].replay_only).toBeUndefined();
  });

  it('the same question is still being answered elsewhere (409): waits, then fetches the saved answer with the same id', async () => {
    const t = boot({ replies: [
      { status: 409, json: { error: 'turn_in_progress', retry_after: 1 } },
      { events: [{ type: 'session', sessionId: S }, { type: 'token', content: 'Due Dec 4.' }, { type: 'replayed', charged: 0 }, { type: 'done' }] },
    ] });
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    await askCard(t, 'When is it due?');
    expect(t.calls).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 1100));
    await t.settle();
    expect(t.calls[1]).toMatchObject({ turn_id: t.calls[0].turn_id, replay_only: true });
    expect(t.body().textContent).toContain('Due Dec 4.');
    expect(t.body().querySelectorAll('.amk-msg.u').length).toBe(1);
  });

  it('an answer that failed on the server is not kept as pending (asking again is a new, free-until-answered question)', async () => {
    const t = boot({ replies: [{ events: [{ type: 'session', sessionId: S }, { type: 'error', message: "Mindy couldn't answer right now. Nothing was wrong with your question. Please try again in a moment." }, { type: 'done' }] }] });
    (t.w.__askAboutOpp as (o: unknown) => void)(OPP);
    await askCard(t, 'When is it due?');
    expect(t.body().textContent).toContain("Mindy couldn't answer right now. Nothing was wrong with your question. Please try again in a moment."); // a customer-safe message (customer-errors.ts) is shown as is
    expect(pending(t)).toBeNull();
  });
});
