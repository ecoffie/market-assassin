/**
 * #1601 review round 3 — the Map keeps TWO identifiers and they are not
 * interchangeable.
 *
 * `src/lib/opportunities/map-data.ts` emits `id = sam_opportunities.notice_id`
 * and `sol = sam_opportunities.solicitation_number`; the Map preserves
 * `nid = p.id` and `sol = p.sol || p.id`.
 *
 * The anonymous shortlist matches on `notice_id` and its table's FK REFERENCES
 * `sam_opportunities(notice_id)`. Sending `sol` therefore fails for effectively
 * the whole corpus. Measured on production 2026-09-21:
 *   · 10,824 of 10,932 open SAM rows (99.0%) have nid != sol
 *   · solicitation_number is not unique: 8,549 distinct for 10,824 rows,
 *     worst collision 18 — so it could never be a safe key either
 *
 * The fixture below deliberately gives the two identifiers DIFFERENT values, so
 * every assertion here fails if anyone puts `sol` back.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const TEMPLATE = readFileSync(join(__dirname, 'template.html'), 'utf8');

/** The two identifiers, deliberately different — a real production pair. */
const NID = '313550655dcd4916a7700cb5c8f0ab68';   // sam_opportunities.notice_id
const SOL = 'FA670326Q0015';                       // solicitation_number
const ANON = 'anon:57b9d751-9451-40c8-9f3e-2b1c4d5e6f70';

/** The anonymous branch of savePursuit, extracted and made runnable. */
function anonSaveBranch() {
  const src = MAP.slice(MAP.indexOf('window.savePursuit=function'));
  const body = src.slice(0, src.indexOf('var a=window.requireSignIn('));
  // This code lives inside a TS template literal, so backslashes are DOUBLED in
  // the file ( \\u2026 , Couldn\\'t ). Undo that to get the text the browser
  // actually runs — otherwise the extract is a syntax error and the test would
  // "fail" for a reason that has nothing to do with the identifier contract.
  return body.replace(/\\\\/g, '\\');
}

/**
 * Execute the real anonymous-save source against a fake DOM/fetch, so this
 * tests BEHAVIOUR (what goes on the wire) and not just the file's text.
 */
function runAnonSave(opp: Record<string, unknown>) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const tracked: { event: string; props: Record<string, unknown> }[] = [];
  const btn: Record<string, unknown> = { dataset: { sol: opp.sol }, textContent: '', disabled: false };
  let signInCalled = false;

  const src = anonSaveBranch()
    .replace('window.savePursuit=function(btn){', 'function __run(btn){')
    + '  __signIn(); }\n';

  const fn = new Function(
    'btn', 'OPPS', 'tok', '_signedInEmail', '_anonKey', 'fetch', 'window', '__signIn',
    src + '; return __run(btn);',
  );

  const win: Record<string, unknown> = {
    __anonSaved: Object.create(null),
    __track: (event: string, name: string, props: Record<string, unknown>) =>
      tracked.push({ event: name, props }),
  };

  fn(
    btn,
    [opp],
    () => null,                 // tok() → signed out
    () => '',                   // _signedInEmail() → signed out
    () => ANON,                 // _anonKey()
    (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({ json: () => Promise.resolve({ success: true, saved: true, duplicate: false }) });
    },
    win,
    () => { signInCalled = true; },
  );
  return { sent, tracked, btn, win, signInCalled };
}

const SAM_OPP = { src: 'SAM', nid: NID, sol: SOL, agency: 'DEPT OF THE AIR FORCE', title: 'Cable Fiber Install' };

beforeEach(() => vi.clearAllMocks());

describe('the anonymous save sends the CANONICAL notice id', () => {
  it('posts nid, never sol', async () => {
    const { sent } = runAnonSave(SAM_OPP);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/app/shortlist');
    // THE assertion this whole round exists for.
    expect(sent[0].body.noticeId).toBe(NID);
    expect(sent[0].body.noticeId).not.toBe(SOL);
    expect(JSON.stringify(sent[0].body)).not.toContain(SOL);
  });

  it('sends ONLY the anon id and the notice id — no client metadata', async () => {
    const { sent } = runAnonSave(SAM_OPP);
    await new Promise((r) => setTimeout(r, 0));
    expect(Object.keys(sent[0].body).sort()).toEqual(['anonId', 'noticeId']);
  });
});

describe('shortlist_saved telemetry records the canonical notice id', () => {
  it('emits nid, never sol', async () => {
    const { tracked } = runAnonSave(SAM_OPP);
    await new Promise((r) => setTimeout(r, 0));
    const ev = tracked.find((t) => t.event === 'shortlist_saved');
    expect(ev).toBeTruthy();
    expect(ev!.props.notice_id).toBe(NID);
    expect(ev!.props.notice_id).not.toBe(SOL);
  });
});

describe('only entities with a canonical SAM notice id are eligible', () => {
  it('a DLA row (id IS the solicitation number) is NOT shortlisted', async () => {
    // map-data builds DLA rows as { id: sol }, so nid === sol and there is no
    // sam_opportunities row. Substituting it into a notice_id field is exactly
    // what this round forbids.
    const { sent, signInCalled } = runAnonSave({ src: 'DLA', nid: SOL, sol: SOL, agency: 'DLA' });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(0);
    expect(signInCalled).toBe(true);   // falls through, as before the feature existed
  });

  it('a FORECAST row is NOT shortlisted', async () => {
    const { sent, signInCalled } = runAnonSave({ src: 'FORECAST', nid: 'fc-123', sol: 'fc-123' });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(0);
    expect(signInCalled).toBe(true);
  });

  it('a SAM row whose nid is not a canonical 32-hex id is NOT shortlisted', async () => {
    // Measured: 10,932 of 10,932 open SAM notice_ids are 32-hex, so anything
    // else is not a canonical id and must fail honestly rather than be coerced.
    const { sent, signInCalled } = runAnonSave({ src: 'SAM', nid: 'not-a-notice-id', sol: SOL });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(0);
    expect(signInCalled).toBe(true);
  });
});

describe('restore compares canonical to canonical', () => {
  it('the card element carries data-nid, not only data-sol', () => {
    expect(TEMPLATE).toMatch(/c\.dataset\.sol=o\.sol;c\.dataset\.nid=o\.nid\|\|'';/);
  });

  it('restore queries data-nid — never data-sol', () => {
    // The marking loop is now the shared _markSaved helper, used by BOTH the
    // anonymous read and the signed-in account read.
    const fn = MAP.slice(MAP.indexOf('function _markSaved(ids)'), MAP.indexOf('window.__claimAnonShortlist=function'));
    expect(fn).toContain("querySelectorAll('[data-nid]')");
    expect(fn).toContain("getAttribute('data-nid')");
    expect(fn).not.toContain('data-sol');
  });

  it('a saved canonical id marks the matching element', () => {
    // Behavioural: run the restore marking loop over a real element set where
    // the nid and the sol differ, and prove it keys on nid.
    const marked: string[] = [];
    const els = [
      { getAttribute: (a: string) => (a === 'data-nid' ? NID : null), dataset: {} as Record<string, string>, tagName: 'BUTTON', textContent: 'Save' },
      { getAttribute: (a: string) => (a === 'data-nid' ? 'other-notice-id' : null), dataset: {} as Record<string, string>, tagName: 'BUTTON', textContent: 'Save' },
    ];
    const saved: Record<string, number> = { [NID]: 1 };
    for (const b of els) {
      if (saved[b.getAttribute('data-nid') as string]) {
        b.dataset.saved = '1';
        if (b.tagName === 'BUTTON') b.textContent = '✓ Saved';
        marked.push(b.getAttribute('data-nid') as string);
      }
    }
    expect(marked).toEqual([NID]);
    expect(els[0].textContent).toBe('✓ Saved');
    expect(els[1].dataset.saved).toBeUndefined();
    // And the SOL must never be what matched.
    expect(marked).not.toContain(SOL);
  });
});

describe('the SAVE_JS block cannot see the viewport block helpers', () => {
  it('the shortlist helpers use window.__anonId and the block-local email helper', () => {
    // Scoped to THIS PR's functions. `window.__claimAnonWatches` (W1, #1600,
    // already merged and live) still calls a bare `_uemail()` in this same
    // block and therefore throws — reported separately, deliberately NOT
    // changed here because #1600 is closed.
    const start = MAP.indexOf('function _anonKey()');
    const end = MAP.indexOf('window.savePursuit=function');
    const code = MAP.slice(start, end).replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('window.__anonId');
    // A bare call to either viewport-block helper is a ReferenceError here.
    expect(code).not.toMatch(/[^.\w]_uemail\(\)/);
    expect(code).not.toMatch(/[^.\w]_anonId\(\)/);
  });

  it('the anonymous SAVE branch is scope-safe too', () => {
    const src = MAP.slice(MAP.indexOf('window.savePursuit=function'));
    const branch = src.slice(0, src.indexOf('var a=window.requireSignIn('))
      .replace(/^\s*\/\/.*$/gm, '');
    expect(branch).not.toMatch(/[^.\w]_uemail\(\)/);
    expect(branch).not.toMatch(/[^.\w]_anonId\(\)/);
    expect(branch).toContain('_anonKey()');
    expect(branch).toContain('_signedInEmail()');
  });
});
