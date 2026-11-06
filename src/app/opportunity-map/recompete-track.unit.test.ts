/**
 * "Track this recompete" must reach My Pursuits.
 *
 * saveCurrentRecompete said "✓ Tracked" and its sign-in prompt said "save this to your
 * pursuits", but it only wrote the Favorites snapshot (user_saved_opportunities via
 * /api/opportunities/save) — no user_pipeline row ever existed. It now ALSO creates the pursuit
 * through /api/pipeline (createCanonicalPursuit), keyed on the PIID so the app's Recompetes panel
 * and the map dedupe on UNIQUE(user_email, notice_id). "Draft capture strategy" (saveCurrentOpp
 * with a done callback) takes the same pursuit request so it gets a pursuit id.
 *
 * Executes the real client source extracted from route.ts against a fake fetch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidSamNoticeId } from '@/lib/sam/utils';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function slice(start: string, end: string) {
  const a = MAP.indexOf(start);
  if (a < 0) throw new Error(`marker not found: ${start}`);
  const b = MAP.indexOf(end, a);
  if (b < 0) throw new Error(`end marker not found: ${end}`);
  return MAP.slice(a, b).replace(/\\\\/g, '\\');
}

const ACTION_BAR = slice('  function _auth(){', '  var _share=document.getElementById');
const TRACK = slice('  window.saveCurrentRecompete=function(btn){', '\n  };') + '\n  };';
const SAVE_OPP = slice('  window.saveCurrentOpp=function(btn,done){', '\n  };') + '\n  };';

type R = { status: number; body?: unknown };

function harness(byUrl: Record<string, R>, cur: Record<string, unknown>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const tracked: { name: string; props: Record<string, unknown> }[] = [];
  const fetchFn = (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = byUrl[url] ?? { status: 500 };
    return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: () => Promise.resolve(r.body ?? {}) });
  };
  const win: Record<string, unknown> = {
    requireSignIn: () => ({ t: 'tok.sig', em: 'pat@example.com' }),
    __track: (_e: string, name: string, props: Record<string, unknown>) => tracked.push({ name, props }),
  };
  const run = new Function(
    'document', 'localStorage', 'fetch', 'window', 'atob', 'location', 'tok', 'email', 'setBtnLabel',
    `var CUR=null;\n${ACTION_BAR}\n${TRACK}\n${SAVE_OPP}\nreturn { setCur: function(c){ CUR=c; } };`,
  );
  const api = run(
    { getElementById: () => null },
    { getItem: () => null },
    fetchFn,
    win,
    (s: string) => Buffer.from(s, 'base64').toString('binary'),
    { href: '' },
    () => 'tok.sig',
    () => 'pat@example.com',
    (b: { textContent: string }, t: string) => { b.textContent = t; },
  ) as { setCur: (c: unknown) => void };
  api.setCur(cur);
  const btn = { dataset: {} as Record<string, string>, textContent: '', classList: { add() {} } };
  return { calls, tracked, win, btn };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const RC = {
  kind: 'recompete', id: 'CONT_AWD_W912PL19C0015_9700_-NONE-_-NONE-', title: 'ACME BUILDERS LLC',
  department: 'DEPT OF THE ARMY', solicitation: 'W912PL19C0015', naics: '236220', deadline: '2027-03-31',
  uiLink: 'https://www.usaspending.gov/search?query=W912PL19C0015',
};
const OK_FAV = { '/api/opportunities/save': { status: 200, body: { success: true } } };

describe('Track this recompete creates a pursuit', () => {
  it('writes BOTH the Favorites snapshot and a /api/pipeline pursuit', async () => {
    const h = harness({ ...OK_FAV, '/api/pipeline': { status: 200, body: { success: true, opportunity: { id: 'p-1' } } } }, RC);
    (h.win.saveCurrentRecompete as (b: unknown) => void)(h.btn);
    await flush(); await flush();
    expect(h.calls.map((c) => c.url).sort()).toEqual(['/api/opportunities/save', '/api/pipeline']);
    const fav = h.calls.find((c) => c.url === '/api/opportunities/save')!;
    expect(fav.body).toMatchObject({ email: 'pat@example.com', noticeId: RC.id, source: 'recompete_map' });
    const pur = h.calls.find((c) => c.url === '/api/pipeline')!;
    expect(pur.body).toMatchObject({
      user_email: 'pat@example.com', notice_id: 'W912PL19C0015', agency: 'DEPT OF THE ARMY',
      naics_code: '236220', source: 'recompete_map', external_url: RC.uiLink,
    });
    expect(pur.body.title).toBe('Recompete: ACME BUILDERS LLC · W912PL19C0015');
    // The contract EXPIRY is not a bid deadline — never sent as one.
    expect(pur.body).not.toHaveProperty('response_deadline');
    expect(h.btn.textContent).toBe('✓ Tracked');
    expect(h.btn.dataset.saved).toBe('1');
    expect(h.btn.dataset.pursuitId).toBe('p-1');
    expect(h.tracked.find((t) => t.name === 'pursuit_started')?.props).toMatchObject({ kind: 'recompete' });
  });

  it('the PIID it keys on survives the pursuit writer (the contract_id would be nulled → duplicates)', () => {
    expect(isValidSamNoticeId('W912PL19C0015')).toBe(true);
    expect(isValidSamNoticeId(RC.id)).toBe(false);
  });

  it('strips a vehicle rollup "(+N more)" suffix from the PIID', async () => {
    const h = harness({ ...OK_FAV, '/api/pipeline': { status: 200, body: { success: true } } }, { ...RC, solicitation: 'W912PL19C0015 (+3 more)' });
    (h.win.saveCurrentRecompete as (b: unknown) => void)(h.btn);
    await flush(); await flush();
    expect(h.calls.find((c) => c.url === '/api/pipeline')!.body.notice_id).toBe('W912PL19C0015');
  });

  it('an existing pursuit (409) reads "In pursuits" and fires no pursuit_started', async () => {
    const h = harness({ ...OK_FAV, '/api/pipeline': { status: 409, body: { opportunity: { id: 'p-9' } } } }, RC);
    (h.win.saveCurrentRecompete as (b: unknown) => void)(h.btn);
    await flush(); await flush();
    expect(h.btn.textContent).toBe('✓ In pursuits');
    expect(h.btn.dataset.pursuitId).toBe('p-9');
    expect(h.tracked.find((t) => t.name === 'pursuit_started')).toBeUndefined();
  });

  it('a failed pursuit write never says "Tracked" and stays retryable', async () => {
    const h = harness({ ...OK_FAV, '/api/pipeline': { status: 500 } }, RC);
    (h.win.saveCurrentRecompete as (b: unknown) => void)(h.btn);
    await flush(); await flush();
    expect(h.btn.textContent).not.toMatch(/Tracked|In pursuits/);
    expect(h.btn.textContent).toMatch(/retry pursuit/);
    expect(h.btn.dataset.saved).toBeUndefined();
  });

  it('no PIID → no pursuit is attempted (nothing to dedupe on); the Favorite still saves', async () => {
    const h = harness({ ...OK_FAV }, { ...RC, solicitation: '' });
    (h.win.saveCurrentRecompete as (b: unknown) => void)(h.btn);
    await flush(); await flush();
    expect(h.calls.map((c) => c.url)).toEqual(['/api/opportunities/save']);
    expect(h.btn.textContent).toBe('✓ Saved');
  });

  it('the action-bar Save for a recompete still writes only the Favorite', () => {
    // saveReq is unchanged for a recompete: the Saved page reads it.
    const fn = slice('  function saveReq(a){', '  function saveOutcome(r)');
    expect(fn).toMatch(/if\(k==='recompete'\)return \{url:'\/api\/opportunities\/save'/);
  });
});

describe('"Draft capture strategy" on a recompete gets a pursuit id', () => {
  it('saveCurrentOpp(btn, done) on a recompete posts the pursuit request and hands back its id', async () => {
    const h = harness({ '/api/pipeline': { status: 200, body: { success: true, opportunity: { id: 'p-7' } } } }, RC);
    let got: [boolean, string] | null = null;
    (h.win.saveCurrentOpp as (b: unknown, d: (ok: boolean, pid: string) => void) => void)(h.btn, (ok, pid) => { got = [ok, pid]; });
    await flush(); await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe('/api/pipeline');
    expect(h.calls[0].body).toMatchObject({ notice_id: 'W912PL19C0015', source: 'recompete_map' });
    expect(got).toEqual([true, 'p-7']);
  });

  it('a SAM listing still goes through the shared saveReq body', async () => {
    const h = harness({ '/api/pipeline': { status: 200, body: { success: true, opportunity: { id: 'p-2' } } } },
      { id: '006d77f604a74dd0a16c99d041e6c032', title: 'Some listing', department: 'NAVY', naics: '541512', deadline: '2026-12-01' });
    (h.win.saveCurrentOpp as (b: unknown, d: () => void) => void)(h.btn, () => {});
    await flush(); await flush();
    expect(h.calls[0].body).toMatchObject({ notice_id: '006d77f604a74dd0a16c99d041e6c032', source: 'opportunity_map' });
  });
});
