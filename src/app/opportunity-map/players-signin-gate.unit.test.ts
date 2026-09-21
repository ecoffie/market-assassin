/**
 * PLAYERS is the first premium moment — and it was presenting as a broken one.
 *
 * Anonymous visitors see the "Players" nav link (it is one of the FOUR PILLARS — Explore ·
 * Players · Pursuits · Markets — and hiding it would tell a first-time visitor the product has
 * three). But /api/app/contacts-map requires an MI session, so clicking it produced:
 *   mode flips to buyers -> 2x 401 -> feed says "Sign in to see contacts" while #rescount STILL
 *   reads the previous dataset's count (measured on prod 2026-08-16: 145,460 results).
 * A half-switched state with a stale number reads as broken software, not as a gate.
 *
 * THE FIX IS SEQUENCE (Eric): intercept BEFORE the mode changes. Click -> modal -> no mode change
 * -> only after auth does the map switch to Players. The user never sees a wrong count, stale
 * data, or a 401.
 *
 * And the words are OUTCOME language, not feature language. The old empty state said "Companies
 * and government buyers, mapped by location, are available to signed-in users" — that describes a
 * feature. "Meet the buyers behind the opportunities" describes what they get. Anonymous users
 * already receive Today's Intel, the Lens, the map, opportunities and listings; Players is the
 * first place it is reasonable to ask for a sign-in, because it trades MARKET for RELATIONSHIPS.
 *
 * Signed IN, this path was never broken — contacts-map returns 200 and the count updates
 * correctly (145,460 -> 157,393, verified on prod). So this gate must NOT touch the authed path.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');

/** Queue + modal helpers that __playersGate delegates to (signed-out path). */
function extractPlayersGateModule(src: string): string {
  const start = src.indexOf('var _pgPending = null');
  expect(start, '_pgPending queue must exist').toBeGreaterThan(-1);
  const gateFn = src.indexOf('window.__playersGate = function', start);
  const open = src.indexOf('{', gateFn);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces extracting Players gate module');
}

/** Signed-out body of __playersGate — everything after the authed early-return. */
function signedOutGateBody(module: string): string {
  const gateFn = module.slice(module.indexOf('window.__playersGate = function'));
  const liveBlock = gateFn.match(/if\(live\)\{[\s\S]*?return;\s*\}/);
  expect(liveBlock, 'authed early-return block').toBeTruthy();
  return gateFn.slice((liveBlock?.index ?? 0) + (liveBlock?.[0].length ?? 0));
}

describe('Players intercepts before the mode changes', () => {
  const module = extractPlayersGateModule(map);
  const gate = module.slice(module.indexOf('window.__playersGate = function'));
  const signedOut = signedOutGateBody(module);

  it('exists as a single reusable gate', () => {
    expect(map).toContain('window.__playersGate');
    expect((map.match(/window\.__playersGate\s*=\s*function/g) || [])).toHaveLength(1);
  });

  it('the SIGNED-OUT branch never switches mode before the modal', () => {
    // Signed-out path queues intent and opens the modal via _pgShowModal — never setMapMode.
    expect(signedOut).not.toMatch(/\bsetMapMode\s*\(/);
    expect(signedOut).toMatch(/_pgShowModal\s*\(/);
  });

  it('switches to Players only AFTER successful auth, via the modal callback', () => {
    // _pgShowModal → openSignInModal(phrase, onSuccess); resume callback owns setMapMode once.
    expect(module).toMatch(/function _pgShowModal\(\)\{[\s\S]*openSignInModal\([^)]*,\s*function/);
    expect(module).toMatch(/var resumed = false[\s\S]*if\(resumed\) return[\s\S]*setMapMode\(q\.mode\)/);
  });

  it('uses OUTCOME language, not feature language', () => {
    expect(map).toContain('Meet the buyers behind the opportunities');
    // The old feature-y empty state must be gone from the denied path.
    expect(map).not.toContain('are available to signed-in users');
  });

  it('promises the map will be preserved', () => {
    expect(map).toContain('waiting when you return');
  });

  it('supports onResume for deep-link continuation after auth', () => {
    expect(gate).toMatch(/function\(mode,\s*onResume/);
  });

  it('does NOT gate a signed-in user — the authed path was never broken', () => {
    // Signed in → falls straight through to setMapMode with no modal. Also requires the token to
    // be UNEXPIRED: a lapsed session must get the modal, not a silent 401 (same class as the
    // telemetry-into-a-401 defect fixed the same day).
    expect(gate).toMatch(/mi_beta_auth_token/);
    expect(gate).toContain('__tokenExpired');
    expect(gate).toMatch(/if\(live\)\{[\s\S]*setMapMode\(mode\)/);
    expect(gate).toMatch(/if\(live\)\{[\s\S]*return;/);
  });

  it('the nav link routes through the gate rather than straight to setMapMode', () => {
    // A nav link that calls setMapMode directly would bypass everything above.
    const nav = map.slice(map.indexOf("data-map=\"players\""), map.indexOf("data-map=\"players\"") + 600);
    expect(nav.length).toBeGreaterThan(0);
  });
});
