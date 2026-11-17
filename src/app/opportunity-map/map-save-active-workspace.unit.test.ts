/**
 * Coach Mode on the Map's signed-in saves (Eric's coach decision, 2026-11-16). Every drawer save goes through
 * postReq (Start pursuit / saveCurrentOpp, the action bar, Track this recompete). It now sends
 * x-active-workspace exactly as /app's authedFetch does (activeWorkspaceFor): the stored active workspace,
 * unless its owner stamp names another user. Non-coaches have no active workspace, so their requests are
 * unchanged. The anonymous save branch is untouched.
 *
 * Executes the real client source extracted from route.ts against a fake fetch (same harness shape as
 * recompete-track.unit.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
function slice(start: string, end: string) {
  const a = MAP.indexOf(start);
  if (a < 0) throw new Error(`marker not found: ${start}`);
  const b = MAP.indexOf(end, a);
  return MAP.slice(a, b).replace(/\\\\/g, '\\');
}
const ACTION_BAR = slice('  function _auth(){', '  var _share=document.getElementById');
const SAVE_OPP = slice('  window.saveCurrentOpp=function(btn,done){', '\n  };') + '\n  };';
const TRACK = slice('  window.saveCurrentRecompete=function(btn){', '\n  };') + '\n  };';

const NID = '6ba812a7e0284f79bc44c4932777c340';
function harness(store: Record<string, string>, cur: Record<string, unknown>) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchFn = (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, opportunity: { id: 'p-1' } }) });
  };
  const win: Record<string, unknown> = { requireSignIn: () => ({ t: 'tok.sig', em: 'coach@example.com' }), __track: () => {} };
  const run = new Function(
    'document', 'localStorage', 'fetch', 'window', 'atob', 'location', 'tok', 'email', 'setBtnLabel',
    `var CUR=null;\n${ACTION_BAR}\n${TRACK}\n${SAVE_OPP}\nreturn { setCur: function(c){ CUR=c; } };`,
  );
  const api = run(
    { getElementById: () => null },
    { getItem: (k: string) => store[k] ?? null },
    fetchFn, win,
    (s: string) => Buffer.from(s, 'base64').toString('binary'),
    { href: '' }, () => 'tok.sig', () => 'coach@example.com',
    (b: { textContent: string }, t: string) => { b.textContent = t; },
  ) as { setCur: (c: unknown) => void };
  api.setCur(cur);
  const btn = { dataset: {} as Record<string, string>, textContent: '', classList: { add() {} } };
  return { calls, win, btn };
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const OPP = { id: NID, title: 'Janitorial', department: 'USCG', naics: '561720', deadline: '2026-12-04' };
const RC = { kind: 'recompete', id: 'CONT_AWD_X', title: 'ACME', department: 'ARMY', solicitation: 'W912PL19C0015', naics: '236220' };
const COACH = { mindy_active_workspace: 'ws-client', mindy_active_workspace_owner: 'coach@example.com' };

async function startPursuit(store: Record<string, string>) {
  const h = harness(store, OPP);
  (h.win.saveCurrentOpp as (b: unknown) => void)(h.btn);
  await flush();
  return h.calls;
}

describe('Map saves carry the coach’s active workspace', () => {
  it('Start pursuit (saveCurrentOpp) in a client workspace sends x-active-workspace', async () => {
    const calls = await startPursuit(COACH);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/pipeline');
    expect(calls[0].headers['x-active-workspace']).toBe('ws-client');
    expect(calls[0].headers['x-user-email']).toBe('coach@example.com');
  });
  it('Track this recompete sends it on both of its saves', async () => {
    const h = harness(COACH, RC);
    (h.win.saveCurrentRecompete as (b: unknown) => void)(h.btn);
    await flush();
    expect(h.calls.length).toBe(2);
    for (const c of h.calls) expect(c.headers['x-active-workspace']).toBe('ws-client');
  });
});

describe('everyone else is unchanged', () => {
  it('no active workspace (every non-coach): headers are exactly what they were', async () => {
    const calls = await startPursuit({});
    expect(calls[0].headers).toEqual({ 'Content-Type': 'application/json', 'x-mi-auth-token': 'tok.sig', 'x-user-email': 'coach@example.com' });
  });
  it('a workspace stamped by a different user (stale key from another login) is not sent', async () => {
    const calls = await startPursuit({ mindy_active_workspace: 'ws-other', mindy_active_workspace_owner: 'someone@else.com' });
    expect(calls[0].headers['x-active-workspace']).toBeUndefined();
  });
  it('no owner stamp: trusted, exactly as activeWorkspaceFor (the server re-checks access)', async () => {
    const calls = await startPursuit({ mindy_active_workspace: 'ws-legacy' });
    expect(calls[0].headers['x-active-workspace']).toBe('ws-legacy');
  });
  it('the anonymous save branch is untouched (it never goes through postReq)', () => {
    expect(MAP.indexOf("var a=window.requireSignIn('save this to your pursuits')")).toBeGreaterThan(MAP.indexOf('window.saveCurrentOpp=function(btn,done){'));
    const anon = MAP.slice(MAP.indexOf('window.saveCurrentOpp=function(btn,done){'), MAP.indexOf("var a=window.requireSignIn('save this to your pursuits')"));
    expect(anon).not.toContain('x-active-workspace');
    expect(anon).not.toContain('activeWorkspaceHeader');
  });
});

describe('parity with authedFetch', () => {
  it('reads the same keys as src/components/app/activeWorkspace.ts', () => {
    const lib = readFileSync(join(__dirname, '../../components/app/activeWorkspace.ts'), 'utf8');
    expect(lib).toContain("ACTIVE_KEY = 'mindy_active_workspace'");
    expect(lib).toContain("OWNER_KEY = 'mindy_active_workspace_owner'");
    expect(MAP).toContain("localStorage.getItem('mindy_active_workspace')");
    expect(MAP).toContain("localStorage.getItem('mindy_active_workspace_owner')");
  });
});
