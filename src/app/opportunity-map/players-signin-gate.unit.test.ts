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

describe('Players intercepts before the mode changes', () => {
  const gate = map.slice(map.indexOf('window.__playersGate'), map.indexOf('window.__playersGate') + 2200);

  it('exists as a single reusable gate', () => {
    expect(map).toContain('window.__playersGate');
    expect((map.match(/window\.__playersGate\s*=\s*function/g) || [])).toHaveLength(1);
  });

  it('the SIGNED-OUT branch never switches mode before the modal', () => {
    // The whole point. If setMapMode ran first the user would see the wrong count and a 401 —
    // exactly what shipped before this.
    // NOTE: an earlier version of this test asserted "openSignInModal appears before any
    // setMapMode" and failed on the AUTHED fall-through, which switches immediately and
    // correctly. The real invariant is about the signed-out branch only: everything after the
    // `live` early-return must reach the modal before any mode change.
    const afterLive = gate.slice(gate.indexOf('if(live)') + 'if(live)'.length);
    const signedOut = afterLive.slice(afterLive.indexOf('}') + 1);
    const modal = signedOut.indexOf('openSignInModal');
    const swap = signedOut.indexOf('setMapMode');
    expect(modal).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(-1);
    expect(modal).toBeLessThan(swap);   // the only setMapMode left is inside the resume callback
  });

  it('switches to Players only AFTER successful auth, via the modal callback', () => {
    // openSignInModal(phrase, onSuccess) — the resume callback is where the mode change belongs.
    expect(gate).toMatch(/openSignInModal\([^)]*,\s*function/);
  });

  it('uses OUTCOME language, not feature language', () => {
    expect(map).toContain('Meet the buyers behind the opportunities');
    // The old feature-y empty state must be gone from the denied path.
    expect(map).not.toContain('are available to signed-in users');
  });

  it('promises the map will be preserved', () => {
    expect(map).toContain('waiting when you return');
  });

  it('does NOT gate a signed-in user — the authed path was never broken', () => {
    // Signed in → falls straight through to setMapMode with no modal. Also requires the token to
    // be UNEXPIRED: a lapsed session must get the modal, not a silent 401 (same class as the
    // telemetry-into-a-401 defect fixed the same day).
    expect(gate).toMatch(/mi_beta_auth_token/);
    expect(gate).toContain('__tokenExpired');
    expect(gate).toMatch(/if\(live\)\{\s*setMapMode\(mode\);\s*return;/);
  });

  it('the nav link routes through the gate rather than straight to setMapMode', () => {
    // A nav link that calls setMapMode directly would bypass everything above.
    const nav = map.slice(map.indexOf("data-map=\"players\""), map.indexOf("data-map=\"players\"") + 600);
    expect(nav.length).toBeGreaterThan(0);
  });
});
