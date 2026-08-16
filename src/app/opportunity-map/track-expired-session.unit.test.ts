/**
 * Telemetry from an EXPIRED session was fired and silently dropped.
 *
 * _track() gated on "is there a token?" — not "is it still valid?". An expired token still
 * decodes (the payload is readable; only the signature and exp are the server's business), so
 * _uemail() returns a real email, _track proceeds, POSTs, and the route 401s via
 * verifyUserOwnsEmail. The event is lost with no error surfaced anywhere.
 *
 * WHY THIS MATTERS FOR DEMO DAY (2026-08-22): the MI session TTL is exactly 30 days, and there
 * are 1,164 users dormant 31-120 days against 1,282 active in the last 30 (measured 2026-08-16).
 * Every dormant user holds an expired token. If the demo brings them back, roughly HALF of
 * returning sessions would have fired telemetry into a 401 — losing exactly the map-state data
 * that this telemetry exists to collect, during the one week it matters most.
 *
 * tokenExpired() already existed for the M-Win drawer (route.ts ~5452), which learned this the
 * hard way: "this says sign in but we are already logged in" (Eric 2026-08-13). _track simply
 * never used it. Reusing it rather than writing a second expiry check — the drift class this
 * codebase keeps hitting.
 *
 * NOTE: _uemail() itself is NOT broken. It decodes a real 2-segment MI token correctly
 * (verified against createMIAuthSessionToken). An earlier claim that it was "fragile" came from
 * a probe that set the token to a literal 't' — the test was wrong, not the code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const track = map.slice(map.indexOf('function _track('), map.indexOf('window.__track=_track'));

describe('_track refuses to fire on a dead session', () => {
  it('checks token EXPIRY, not just presence', () => {
    expect(track).toContain('tokenExpired');
  });

  it('returns before building the payload — no wasted state snapshot', () => {
    // The expiry guard must sit above the _mapState() call, or an expired session still pays
    // for a full snapshot before being dropped.
    const guard = track.indexOf('tokenExpired');
    const snapshot = track.indexOf('_mapState()');
    expect(guard).toBeGreaterThan(-1);
    expect(snapshot).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(snapshot);
  });

  it('has exactly ONE implementation, shared across script blocks', () => {
    // _track lives in VIEWPORT_JS and the M-Win drawer in DRAWER_JS — separate <script> IIFEs,
    // so a local cannot be shared. The implementation is a window.* bridge and the drawer
    // aliases it. One body, so the two callers cannot drift on what "expired" means.
    const impls = map.match(/__tokenExpired\s*=\s*function/g) || [];
    expect(impls).toHaveLength(1);
    // And no one re-implements it with a second inline exp check.
    expect(map.match(/function tokenExpired\(/g) || []).toHaveLength(0);
    expect(map).toContain('typeof window.__tokenExpired');
  });

  it('still refuses a signed-out session and a missing token', () => {
    expect(track).toContain('if(!em) return');
    expect(track).toContain('if(!tk) return');
  });
});
