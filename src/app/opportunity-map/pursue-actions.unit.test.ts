/**
 * The forecast "Should I pursue this?" moves — three defects from Eric's screenshots, 2026-08-13.
 *
 * 1. TRACK SILENTLY 500'd. saveCurrentOpp posted `solicitation_number`, which user_pipeline has
 *    NEVER had, so PostgREST rejected the insert (PGRST204) and the button said "Try again". It
 *    only appeared to work when the value was undefined, because JSON.stringify drops those keys
 *    — which is why the failure looked intermittent rather than total. Measured against prod:
 *    payload WITH the field -> 500; payload without -> 200.
 * 2. THE BUTTON ATE ITS OWN MARKUP. The moves are rich buttons (title div + description div), and
 *    btn.textContent flattened them to one bare word — the lone "Try again" in the screenshot.
 * 3. "START CAPTURE" WENT NOWHERE USEFUL. It linked to /app?panel=proposals&notice=<id>, but /app
 *    reads only reset/setup/signup/panel/email — never `notice` — so the id was dropped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const api = readFileSync(join(__dirname, '../api/pipeline/route.ts'), 'utf8');
const appPage = readFileSync(join(__dirname, '../app/page.tsx'), 'utf8');

function fnBody(s: string, name: string): string {
  const start = s.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const open = s.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe('tracking a buy actually saves', () => {
  it('never posts solicitation_number — user_pipeline has no such column', () => {
    // Both call sites (popup save + drawer save) posted it. The column list is
    // notice_id/title/agency/naics_code/response_deadline/... — verified against the live table.
    expect(map).not.toContain('solicitation_number');
    // notice_id IS the key and must survive.
    expect(map).toContain('notice_id:CUR.id');
    expect(map).toContain('notice_id:o.sol');
  });

  it('the API drops an unknown column instead of 500ing the save', () => {
    // A save is the wrong place to be strict: losing a user's pursuit because a field name
    // drifted is worse than ignoring the field. Covers BOTH error shapes.
    expect(api).toContain("error.code === '42703' || error.code === 'PGRST204'");
    expect(api).toContain('delete (body as unknown as Record<string, unknown>)[col]');
    // Bounded, and it can only ever REMOVE keys — it cannot widen what gets written.
    expect(api).toContain('attempt < 5');
    expect(api).toContain('if (!col || !(col in body)) break;');
  });
});

describe('a rich move button keeps its title and description', () => {
  // Execute the shipped helper against a stub that mimics the real markup.
  const setBtnLabel = (() => {
    const body = fnBody(map, 'setBtnLabel');
    // eslint-disable-next-line no-new-func
    return new Function(`${body}; return setBtnLabel;`)() as (b: unknown, t: string) => void;
  })();

  it('writes into the title div, leaving the description intact', () => {
    const title = { textContent: 'Track it' };
    const btn = { textContent: 'Track itGet a heads-up…', querySelector: (s: string) => (s === '.fc-move-t' ? title : null) };
    setBtnLabel(btn, 'Saving…');
    expect(title.textContent).toBe('Saving…');
    // The button's own textContent must NOT be overwritten — that is what erased the description.
    expect(btn.textContent).toBe('Track itGet a heads-up…');
  });

  it('still sets plain buttons the old way', () => {
    const plain = { textContent: 'Start pursuit', querySelector: () => null };
    setBtnLabel(plain, '✓ Tracked');
    expect(plain.textContent).toBe('✓ Tracked');
  });
});

describe('"Start capture" goes somewhere real', () => {
  it('the forecast moves track + open pursuits rather than linking to proposals', () => {
    // For a FORECAST the proposal workspace is the wrong destination regardless of deep-linking:
    // the card's own words are "there is no bid to win yet". Capture = track it, then work it.
    const moves = map.slice(map.indexOf("var moves='<div class=\"fc-moves\">"), map.indexOf('var inner=\'<div class="pursue locked">'));
    expect(moves).not.toContain('panel=proposals&notice=');
    expect(moves).toContain('onclick="startCapture(this)"');
    // The ?notice= param is no longer dropped either — /app reads it now and ProposalsPanel
    // resolves it to the user's pursuit. (Covered in depth by notice-deeplink.unit.test.ts; this
    // assertion used to state the OPPOSITE as proof of the bug, and is flipped deliberately.)
    expect(appPage).toContain("searchParams.get('notice')");
  });

  it('tracks first, then opens the pursuits tracker', () => {
    const capture = map.slice(map.indexOf('window.startCapture=function'), map.indexOf('window.startCapture=function') + 500);
    expect(capture).toContain('saveCurrentOpp(btn,function(ok)');
    expect(capture).toContain("if(!ok)return;");          // a failed save must not open an empty panel
    expect(capture).toContain("/app?panel=pipeline");
    expect(map).toContain('onclick="startCapture(this)"');
  });

  it('saveCurrentOpp reports back so callers can chain', () => {
    const save = map.slice(map.indexOf('window.saveCurrentOpp=function'), map.indexOf('window.saveCurrentOpp=function') + 1400);
    expect(save).toContain('function(btn,done)');
    expect(save).toContain('done(true)');
    expect(save).toContain('done(false)');
    // Already-saved is a SUCCESS for chaining — the item is in pursuits either way.
    expect(save).toContain("done(btn.dataset.saved==='1')");
  });
});
