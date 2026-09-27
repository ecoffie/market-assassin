/**
 * SAVE TRUTH (P0-C, Learn repair board 2026-09-26).
 *
 * Invariant: a persistence failure can never appear as persistence success.
 *
 * The drawer action-bar Save wrote "Saved" BEFORE any request and swallowed every
 * failure. Its open/forecast/DLA branch posted `{email, noticeId}` to /api/pipeline,
 * which requires `user_email` + `title` — so every signed-in action-bar save of those
 * kinds returned 400 while the button said "Saved". The in-body save functions had a
 * quieter version of the same bug: they decided success from the parsed BODY
 * (`!d.error`), so a non-JSON 500/502 parsed to `{}` and read as success.
 *
 * These tests EXECUTE the real client source extracted from route.ts against a fake
 * DOM + fake fetch, so a behaviour change fails them — not just a text change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function slice(start: string, end: string) {
  const a = MAP.indexOf(start);
  if (a < 0) throw new Error(`marker not found: ${start}`);
  const b = MAP.indexOf(end, a);
  if (b < 0) throw new Error(`end marker not found: ${end}`);
  // Backslashes are doubled inside the TS template literal; undo that.
  return MAP.slice(a, b).replace(/\\\\/g, '\\');
}

// The action-bar block: _auth() … __resetOppSave (inclusive of the shared helpers).
const ACTION_BAR = slice('  function _auth(){', '  var _share=document.getElementById');
const IN_BODY = ['Recompete', 'Company', 'Buyer'].map((k) =>
  slice(`  window.saveCurrent${k}=function(btn){`, '\n  };') + '\n  };',
);

type Resp = { status: number; body?: unknown; nonJson?: boolean } | 'network';

function tokenFor(email: string) {
  const p = Buffer.from(JSON.stringify({ email })).toString('base64').replace(/=+$/, '');
  return `${p}.sig`;
}

function harness(kind: string | undefined, resp: Resp, signedIn = true) {
  const span = { textContent: 'Save' };
  const classes = new Set<string>();
  const btn = {
    dataset: {} as Record<string, string>,
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) },
    querySelector: () => span,
    onclick: null as null | (() => void),
  };
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (resp === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: () => (resp.nonJson ? Promise.reject(new SyntaxError('Unexpected token <')) : Promise.resolve(resp.body ?? {})),
    });
  };
  const store: Record<string, string> = signedIn ? { mi_beta_auth_token: tokenFor('pat@example.com') } : {};
  const win: Record<string, unknown> = { requireSignIn: () => (signedIn ? { t: store.mi_beta_auth_token, em: 'pat@example.com' } : null) };
  const doc = { getElementById: (id: string) => (id === 'oppSave' ? btn : null) };
  const run = new Function(
    'document', 'localStorage', 'fetch', 'window', 'atob', 'location',
    `var CUR=null;\n${ACTION_BAR}\n${IN_BODY.join('\n')}\n` +
      'return { setCur: function(c){ CUR=c; }, getCur: function(){ return CUR; } };',
  );
  const api = run(
    doc,
    { getItem: (k: string) => store[k] ?? null },
    fetchFn,
    win,
    (s: string) => Buffer.from(s, 'base64').toString('binary'),
    { href: '' },
  ) as { setCur: (c: unknown) => void };
  api.setCur({ kind, id: 'X1', title: 'Some listing', department: 'NAVY', naics: '541512', solicitation: 'N001', deadline: '2026-10-01' });
  return { btn, span, classes, calls, win, api };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('action-bar Save never reports a failure as success', () => {
  for (const kind of [undefined, 'forecast', 'recompete', 'company', 'buyer']) {
    for (const resp of [{ status: 400, body: { error: 'user_email and title are required' } }, { status: 401, body: { error: 'Unauthorized' } }, { status: 404, body: { error: 'User not found' } }, { status: 500, nonJson: true }, 'network'] as Resp[]) {
      it(`kind=${kind ?? 'open'} · ${resp === 'network' ? 'network error' : resp.status} → not "Saved"`, async () => {
        const h = harness(kind, resp);
        h.btn.onclick!();
        // Nothing may claim success before the server answers.
        expect(h.span.textContent).not.toBe('Saved');
        expect(h.classes.has('done')).toBe(false);
        await flush(); await flush();
        expect(h.span.textContent).not.toMatch(/Saved/);
        expect(h.classes.has('done')).toBe(false);
        expect(h.span.textContent).toMatch(/Couldn.t save/);
      });
    }
  }

  it('says "Saving…" in flight and "Saved" only after a 2xx', async () => {
    const h = harness(undefined, { status: 200, body: { success: true, opportunity: { id: 'p1' } } });
    h.btn.onclick!();
    expect(h.span.textContent).toBe('Saving…');
    await flush(); await flush();
    expect(h.span.textContent).toBe('Saved');
    expect(h.classes.has('done')).toBe(true);
  });

  it('409 reads as "Already saved"', async () => {
    const h = harness(undefined, { status: 409, body: { error: 'Opportunity already in pipeline' } });
    h.btn.onclick!(); await flush(); await flush();
    expect(h.span.textContent).toBe('Already saved');
  });

  it('an open/forecast save sends the body /api/pipeline actually requires', async () => {
    for (const kind of [undefined, 'forecast']) {
      const h = harness(kind, { status: 200, body: { success: true } });
      h.btn.onclick!(); await flush();
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0].url).toBe('/api/pipeline');
      expect(h.calls[0].body).toMatchObject({ user_email: 'pat@example.com', title: 'Some listing', notice_id: 'X1' });
      expect(h.calls[0].body).not.toHaveProperty('email');
      expect(h.calls[0].body).not.toHaveProperty('noticeId');
    }
  });

  it('a verdict for a record the drawer already left does not paint the new record', async () => {
    const h = harness(undefined, { status: 200, body: { success: true } });
    h.btn.onclick!();
    (h.win.__resetOppSave as () => void)();
    h.api.setCur({ id: 'OTHER', title: 'Another', department: 'VA' });
    await flush(); await flush();
    expect(h.span.textContent).toBe('Save');
    expect(h.classes.has('done')).toBe(false);
  });

  it('signed-out click sends nothing and claims nothing', async () => {
    const h = harness(undefined, { status: 200 }, false);
    h.btn.onclick!(); await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.span.textContent).toBe('Save');
  });
});

describe('in-body saves decide success by HTTP status, not body shape', () => {
  const cases: [string, string][] = [['recompete', 'saveCurrentRecompete'], ['company', 'saveCurrentCompany'], ['buyer', 'saveCurrentBuyer']];
  for (const [kind, fn] of cases) {
    it(`${fn}: a non-JSON 500 is not a save`, async () => {
      const h = harness(kind, { status: 500, nonJson: true });
      const b = { dataset: {} as Record<string, string>, textContent: '', classList: { add() {} } };
      (h.win[fn] as (b: unknown) => void)(b); await flush(); await flush();
      expect(b.textContent).toBe('Try again');
      expect(b.dataset.saved).toBeUndefined();
    });
    it(`${fn}: 404 (no settings row) is not a save`, async () => {
      const h = harness(kind, { status: 404, body: { error: 'User not found. Please set up your alert preferences first.' } });
      const b = { dataset: {} as Record<string, string>, textContent: '', classList: { add() {} } };
      (h.win[fn] as (b: unknown) => void)(b); await flush(); await flush();
      expect(b.textContent).toBe('Try again');
    });
  }
});

describe('one body builder', () => {
  it('the action bar builds no request body of its own', () => {
    const handler = slice("  if(_save)_save.onclick=function(){", '  window.__resetOppSave=');
    expect(handler).not.toMatch(/JSON\.stringify/);
    expect(handler).toMatch(/postSave\(a\)/);
  });
});
