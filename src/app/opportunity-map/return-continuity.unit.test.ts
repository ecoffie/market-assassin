/**
 * WORKSTREAM A — RETURN CONTINUITY.
 *
 * Two defects, one file.
 *
 * 1. THE ANONYMOUS SAVE WAS UNREACHABLE. #1601 put the anonymous shortlist on
 *    `window.savePursuit`, which has ZERO call sites. Measured on the SERVING
 *    production page 2026-09-21: "savePursuit" occurs exactly twice (its own
 *    definition and its own sign-in retry callback) while "saveCurrentOpp"
 *    occurs 13 times — every live Save / Start-pursuit / Track button in the
 *    drawer calls saveCurrentOpp, which had no anonymous branch. Production
 *    agrees: `anonymous_shortlist` held 0 rows and `shortlist_saved` had fired
 *    0 times, ever.
 *
 * 2. THE MAP REMEMBERED WHERE, NEVER WHAT. `mi_map_last_view` restores the
 *    viewport, but filters / horizons / query / dataset reset to defaults on
 *    every load — so yesterday's "Navy + 541512 + Virginia" had to be rebuilt
 *    by hand. 8,096 of 9,315 30-day users are one-day-only.
 *
 * These tests EXECUTE the real source extracted from route.ts (the map ships
 * its client JS as TS template literals, so nothing here is importable) rather
 * than asserting on its text, so a change in behaviour fails them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');

/** The client JS lives in a TS template literal, so `\\'` in the file is `\'` in the browser. */
const cook = (s: string) => s.replace(/\\\\/g, '\\');

const NID = '313550655dcd4916a7700cb5c8f0ab68';   // sam_opportunities.notice_id (32 hex)
const SOL = 'FA670326Q0015';                       // solicitation_number
const ANON = 'anon:57b9d751-9451-40c8-9f3e-2b1c4d5e6f70';

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE REACHABLE ANONYMOUS SAVE  (DRAWER_JS · window.saveCurrentOpp)
// ─────────────────────────────────────────────────────────────────────────────

function anonDrawerBranch() {
  const src = MAP.slice(MAP.indexOf('window.saveCurrentOpp=function(btn,done){'));
  return cook(src.slice(0, src.indexOf("var a=window.requireSignIn('save this to your pursuits');")));
}

function runDrawerSave(
  CUR: Record<string, unknown> | null,
  opts: { signedIn?: boolean; done?: boolean; anonId?: string } = {},
) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const tracked: { action: string; props: Record<string, unknown> }[] = [];
  const labels: string[] = [];
  const btn: Record<string, unknown> = { dataset: {} as Record<string, string> };
  let signInCalled = false;

  const src = anonDrawerBranch()
    .replace('window.saveCurrentOpp=function(btn,done){', 'function __run(btn,done){')
    + '  __signIn(); }\n';

  const fn = new Function(
    'btn', 'done', 'CUR', 'tok', 'email', 'setBtnLabel', 'fetch', 'window', '__signIn',
    src + '; return __run(btn,done);',
  );

  const win: Record<string, unknown> = {
    __anonSaved: Object.create(null),
    __anonId: () => (opts.anonId === undefined ? ANON : opts.anonId),
    __remarkSaved: () => {},
    __track: (_kind: string, action: string, props: Record<string, unknown>) => tracked.push({ action, props }),
  };

  fn(
    btn,
    opts.done ? () => {} : undefined,
    CUR,
    () => (opts.signedIn ? 'tok.tok.tok' : null),
    () => (opts.signedIn ? 'a@b.com' : ''),
    (_b: unknown, t: string) => labels.push(t),
    (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({ json: () => Promise.resolve({ success: true, duplicate: false }) });
    },
    win,
    () => { signInCalled = true; },
  );
  return { sent, tracked, labels, btn, win, signInCalled };
}

/** A real SAM listing drawer: render() sets CUR to the opportunity-detail row. */
const SAM_CUR = { id: NID, solicitation: SOL, title: 'Cable Fiber Install', department: 'DEPT OF THE AIR FORCE' };

describe('the anonymous save is reachable from the button users actually click', () => {
  it('saveCurrentOpp posts the CANONICAL notice id for a signed-out SAM listing', async () => {
    const { sent, signInCalled } = runDrawerSave(SAM_CUR);
    await new Promise((r) => setTimeout(r, 0));
    expect(signInCalled).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/app/shortlist');
    expect(sent[0].body.noticeId).toBe(NID);
    // Never a solicitation number: 99.0% of open SAM rows have nid !== sol, and sol is not unique.
    expect(JSON.stringify(sent[0].body)).not.toContain(SOL);
  });

  it('sends ONLY anonId + noticeId — the browser cannot manufacture opportunity metadata', async () => {
    const { sent } = runDrawerSave(SAM_CUR);
    await new Promise((r) => setTimeout(r, 0));
    expect(Object.keys(sent[0].body).sort()).toEqual(['anonId', 'noticeId']);
  });

  it('a save is NOT a pursuit — the label says Saved, never Tracked / In pursuits', async () => {
    const { labels } = runDrawerSave(SAM_CUR);
    await new Promise((r) => setTimeout(r, 0));
    const final = labels[labels.length - 1];
    expect(final).toContain('Saved');
    expect(final).not.toMatch(/Tracked|pursuit/i);
  });

  it('emits shortlist_saved with the canonical notice id, and never pursuit_started', async () => {
    const { tracked } = runDrawerSave(SAM_CUR);
    await new Promise((r) => setTimeout(r, 0));
    const ev = tracked.find((t) => t.action === 'shortlist_saved');
    expect(ev).toBeTruthy();
    expect(ev!.props.notice_id).toBe(NID);
    expect(ev!.props.anonymous).toBe(true);
    expect(tracked.find((t) => t.action === 'pursuit_started')).toBeUndefined();
  });
});

describe('only a SAM listing with a canonical notice id is eligible', () => {
  const fallsThrough = async (CUR: Record<string, unknown>) => {
    const r = runDrawerSave(CUR);
    await new Promise((x) => setTimeout(x, 0));
    expect(r.sent).toHaveLength(0);
    expect(r.signInCalled).toBe(true);   // unchanged from before this branch existed
  };

  it('a DLA/DIBBS drawer is not shortlisted (its id is a solicitation number)', () =>
    fallsThrough({ id: SOL, isDla: true, dibbsUrl: 'https://dibbs.bsm.dla.mil/x' }));
  it('a recompete drawer is not shortlisted (PIID, no sam_opportunities row)', () =>
    fallsThrough({ kind: 'recompete', id: 'W912PL20D0007' }));
  it('a forecast drawer is not shortlisted (fc- id)', () =>
    fallsThrough({ kind: 'forecast', id: 'fc-12345' }));
  it('a company drawer is not shortlisted (UEI)', () =>
    fallsThrough({ kind: 'company', id: 'ZQGGHJH74DW7' }));
  it('a buyer drawer is not shortlisted (federal_contacts id)', () =>
    fallsThrough({ kind: 'buyer', id: '91827' }));
  it('a non-canonical id is refused rather than coerced', () =>
    fallsThrough({ id: 'not-a-notice-id' }));
});

describe('the branch leaves every other contract alone', () => {
  it('a signed-in user still takes the pipeline path', async () => {
    const r = runDrawerSave(SAM_CUR, { signedIn: true });
    await new Promise((x) => setTimeout(x, 0));
    expect(r.sent).toHaveLength(0);
    expect(r.signInCalled).toBe(true);
  });

  it('callers passing a done callback (openProposalWorkspace / startCapture) are untouched', async () => {
    // Those flows use the save as a means to reach a SIGNED-IN destination, so an
    // anonymous shortlist row there would strand the user with no pursuit id.
    const r = runDrawerSave(SAM_CUR, { done: true });
    await new Promise((x) => setTimeout(x, 0));
    expect(r.sent).toHaveLength(0);
    expect(r.signInCalled).toBe(true);
  });

  it('no anon id (localStorage blocked) falls through to sign-in, never a fabricated id', async () => {
    const r = runDrawerSave(SAM_CUR, { anonId: '' });
    await new Promise((x) => setTimeout(x, 0));
    expect(r.sent).toHaveLength(0);
    expect(r.signInCalled).toBe(true);
  });
});

describe('scope safety — DRAWER_JS cannot see the viewport block helpers', () => {
  it('reaches the anon id through window.__anonId, never a bare _anonId()/_uemail()', () => {
    const branch = anonDrawerBranch().replace(/^\s*\/\/.*$/gm, '');
    expect(branch).toContain('window.__anonId');
    expect(branch).not.toMatch(/[^.\w]_uemail\(\)/);
    expect(branch).not.toMatch(/[^.\w]_anonId\(\)/);
  });
});

describe('saved marks survive a feed repaint', () => {
  it('SAVE_JS exposes __remarkSaved and the settled-pass observer calls it', () => {
    expect(MAP).toContain('window.__remarkSaved=function()');
    const emit = MAP.slice(MAP.indexOf('function _emitCardsShown()'), MAP.indexOf('function _installCardImpressions()'));
    expect(emit).toContain('window.__remarkSaved');
    // It must run BEFORE the dedupe early-return: a repaint of the SAME cards is not a
    // new impression, but it IS new DOM that still needs marking.
    expect(emit.indexOf('__remarkSaved')).toBeLessThan(emit.indexOf('_lastKey'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. RETURN CONTINUITY  (VIEWPORT_JS writer + BOOT restorer)
// ─────────────────────────────────────────────────────────────────────────────

/** The real __mapStateMeaningful predicate, extracted and made callable. */
function meaningful(): (f: unknown, mode?: string) => boolean {
  const start = MAP.indexOf('window.__mapStateMeaningful=function(f,mode){');
  const end = MAP.indexOf('function _rememberMapState()', start);
  const src = cook(MAP.slice(start, end)).replace('window.__mapStateMeaningful=', 'var __m=') + '; return __m;';
  return new Function(src)() as (f: unknown, mode?: string) => boolean;
}

describe('a default map is not a session', () => {
  const m = meaningful();
  // _mapState() always emits horizons, and the boot default is open-only.
  const DEFAULT = { horizons: { open: true, recompete: false, forecast: false } };

  it('the empty default is NOT meaningful — so it can never overwrite a real memory', () => {
    // This is exactly what the boot fetchView produces BEFORE any restore lands.
    expect(m(DEFAULT, 'open')).toBe(false);
    expect(m({}, 'open')).toBe(false);
    expect(m(null, 'open')).toBe(false);
  });

  it('a real market IS meaningful', () => {
    expect(m({ ...DEFAULT, agency: 'NAVY' }, 'open')).toBe(true);
    expect(m({ ...DEFAULT, naics: '541512' }, 'open')).toBe(true);
    expect(m({ ...DEFAULT, state: 'VA' }, 'open')).toBe(true);
    expect(m({ ...DEFAULT, q: 'fiber optic' }, 'open')).toBe(true);
    expect(m({ ...DEFAULT, setAside: 'SBA' }, 'open')).toBe(true);
    expect(m({ ...DEFAULT, office: 'W912PL' }, 'open')).toBe(true);
    expect(m({ ...DEFAULT, postedDays: '7' }, 'open')).toBe(true);
  });

  it('a non-default horizon set is meaningful on its own', () => {
    expect(m({ horizons: { open: true, recompete: false, forecast: true } }, 'open')).toBe(true);
    expect(m({ horizons: { open: false, recompete: true, forecast: false } }, 'open')).toBe(true);
  });

  it('an empty array / false / empty string is not a filter', () => {
    expect(m({ ...DEFAULT, agency: '', fullOpen: false, naics: '' }, 'open')).toBe(false);
  });

  it('never claims to remember something __applySavedSearch cannot give back', () => {
    // THE HONESTY RULE. If a key counts as "meaningful" but the restorer drops it, the
    // map reopens unfiltered while the pill still says "picked up where you left off".
    //  · strategy — _mapState stores it comma-JOINED, and __applySavedSearch copies only
    //    keys present on its FILT reset literal, which has no 'strategy'. (Worse: a
    //    string would reach _buildOppUrl's FILT.strategy.join, which needs an array.)
    //  · fsc — lives on window.__fscFilter, not FILT, and dla mode is never stored.
    expect(m({ ...DEFAULT, strategy: 'repeat_buyer,closes_soon' }, 'open')).toBe(false);
    expect(m({ ...DEFAULT, fsc: '5820' }, 'open')).toBe(false);
  });

  it('every meaningful key is one the restorer actually restores', () => {
    // Read both lists out of the real source and prove the predicate is a SUBSET of
    // what __applySavedSearch resets — so this cannot drift apart silently.
    const keys = (cook(MAP.slice(
      MAP.indexOf("var keys=['agency'"),
      MAP.indexOf('for(var i=0;i<keys.length;i++)'),
    )).match(/'([a-zA-Z]+)'/g) || []).map((x) => x.replace(/'/g, ''));
    expect(keys.length).toBeGreaterThan(15);
    const reset = MAP.slice(MAP.indexOf("FILT={ scope:'all'", MAP.indexOf('window.__applySavedSearch=function')));
    const resetKeys = new Set((reset.slice(0, reset.indexOf('};')).match(/(\w+)\s*:/g) || []).map((x) => x.replace(/\s*:/, '')));
    resetKeys.add('q');   // restored explicitly into Q + #zsearchInput
    for (const k of keys) expect(resetKeys.has(k), `"${k}" is remembered but never restored`).toBe(true);
  });
});

describe('only datasets __applySavedSearch can restore WHOLE are remembered', () => {
  const writer = cook(MAP.slice(
    MAP.indexOf('function _rememberMapState(){'),
    MAP.indexOf('window.__forgetMapState=function()'),
  ));
  it('companies / buyers / dla are excluded (sign-in gate · unrepresented FSC filter)', () => {
    expect(writer).toContain("if(mode!=='open'&&mode!=='recompete')return;");
  });
  it('bbox is deliberately not stored — mi_map_last_view already owns the viewport', () => {
    const stored = writer.slice(writer.indexOf('localStorage.setItem'));
    expect(stored).toContain('mode:mode');
    expect(stored).toContain('filters:f');
    expect(stored).not.toContain('bbox');
  });
  it('the writer is hooked to fetchView, the one seam every state change funnels through', () => {
    const at = MAP.indexOf('function fetchView(opts){');
    expect(at).toBeGreaterThan(0);
    // the scheduler hands off to _fetchViewNow, whose first action is the memory write
    const now = MAP.indexOf('function _fetchViewNow(t0){', at);
    expect(now).toBeGreaterThan(at);
    expect(MAP.slice(now, now + 900)).toContain('window.__rememberMapState()');
  });
});

/** The boot restorer, extracted and made runnable against fake globals. */
function restorerSrc() {
  const start = MAP.indexOf('  // ── RETURN CONTINUITY: pick up the market you left');
  expect(start).toBeGreaterThan(0);
  const marker = '\n  }catch(e){} })();';
  const end = MAP.indexOf(marker, start) + marker.length;
  return cook(MAP.slice(start, end));
}

function runRestore(search: string, stored: unknown) {
  const applied: unknown[] = [];
  const tracked: { action: string; props: Record<string, unknown> }[] = [];
  const el = () => ({
    style: { cssText: '' }, setAttribute() {}, appendChild() {}, remove() {},
    textContent: '', onclick: null as unknown,
  });
  const win: Record<string, unknown> = {
    __applySavedSearch: (ss: unknown) => applied.push(ss),
    __mapStateMeaningful: meaningful(),
    __track: (_k: string, action: string, props: Record<string, unknown>) => tracked.push({ action, props }),
    __STATE_NAMES: { VA: 'Virginia' },
  };
  const doc = { querySelector: () => ({ appendChild() {} }), createElement: () => el(), body: { appendChild() {} } };
  const ls = { getItem: (k: string) => (k === 'mi_map_last_search' && stored != null ? JSON.stringify(stored) : null) };
  new Function('location', 'localStorage', 'window', 'document', 'setTimeout', restorerSrc())(
    { search }, ls, win, doc, (f: () => void) => f(),
  );
  return { applied, tracked };
}

const YESTERDAY = () => ({
  mode: 'open',
  filters: { agency: 'NAVY', naics: '541512', state: 'VA', horizons: { open: true, recompete: false, forecast: false } },
  t: Date.now() - 20 * 3600 * 1000,
});

describe('the remembered market comes back', () => {
  it('a bare visit restores yesterday’s market through __applySavedSearch', () => {
    const { applied } = runRestore('', YESTERDAY());
    expect(applied).toHaveLength(1);
    const ss = applied[0] as { mode: string; filters: Record<string, unknown>; bbox?: unknown };
    expect(ss.mode).toBe('open');
    expect(ss.filters.agency).toBe('NAVY');
    expect(ss.filters.naics).toBe('541512');
    expect(ss.filters.state).toBe('VA');
    // The viewport belongs to mi_map_last_view — a second writer moving the map
    // after boot is the documented race that once emptied it.
    expect(ss.bbox).toBeUndefined();
  });

  it('fires returning_session_restored, honestly labelled', () => {
    const { tracked } = runRestore('', YESTERDAY());
    const ev = tracked.find((t) => t.action === 'returning_session_restored');
    expect(ev).toBeTruthy();
    expect(ev!.props.returning).toBe(true);
    expect(ev!.props.age_hours).toBe(20);
    expect(String(ev!.props.restored)).toContain('NAVY');
  });

  it('a reload seconds later is restored but NOT counted as a return', () => {
    const fresh = { ...YESTERDAY(), t: Date.now() - 30 * 1000 };
    const { applied, tracked } = runRestore('', fresh);
    expect(applied).toHaveLength(1);
    expect(tracked[0].props.returning).toBe(false);
  });
});

describe('the memory never fights an explicit link', () => {
  const stored = YESTERDAY();
  // RECORD links: the record was already chosen for this reader upstream, so a
  // remembered NAICS/state at the destination could only delete it.
  it.each(['?opp=' + NID, '?company=ZQGGHJH74DW7', '?buyer=91827', '?recompete=W912PL20D0007', '?forecast=fc-1'])(
    'a record link (%s) restores nothing', (qs) => {
      expect(runRestore(qs, stored).applied).toHaveLength(0);
    });
  // MARKET links already say which market to open.
  it.each(['?ss=abc', '?agency=DEPT%20OF%20DEFENSE', '?naics=236220', '?state=FL', '?strategy=repeat_buyer',
    '?q=fiber', '?posted=7', '?mode=recompete', '?horizon=forecast', '?office=W912PL', '?subAgency=NAVY', '?embed=1'])(
    'a scope link (%s) restores nothing', (qs) => {
      expect(runRestore(qs, stored).applied).toHaveLength(0);
    });
  it('an unrelated param (?src=email) still restores', () => {
    expect(runRestore('?src=email', stored).applied).toHaveLength(1);
  });
});

describe('unknown is not a memory', () => {
  it('no stored state restores nothing', () => {
    expect(runRestore('', null).applied).toHaveLength(0);
  });
  it('a state older than 30 days is a fossil, not a session', () => {
    const old = { ...YESTERDAY(), t: Date.now() - 31 * 24 * 3600 * 1000 };
    expect(runRestore('', old).applied).toHaveLength(0);
  });
  it('an UNDATED state is unknown, not fresh', () => {
    expect(runRestore('', { mode: 'open', filters: { agency: 'NAVY' } }).applied).toHaveLength(0);
  });
  it('an empty remembered market restores nothing and claims nothing', () => {
    const empty = { mode: 'open', filters: { horizons: { open: true, recompete: false, forecast: false } }, t: Date.now() };
    const { applied, tracked } = runRestore('', empty);
    expect(applied).toHaveLength(0);
    expect(tracked).toHaveLength(0);
  });
  it('a companies/buyers state written by an older build is downgraded, never gate-popped', () => {
    const co = { mode: 'companies', filters: { agency: 'NAVY' }, t: Date.now() };
    const ss = runRestore('', co).applied[0] as { mode: string };
    expect(ss.mode).toBe('open');
  });
});
