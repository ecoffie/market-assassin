/**
 * The Map's Save-search control must serve ANONYMOUS visitors.
 *
 * Measured over 30 days: 8,583 people used the Opportunity Map and only 329
 * were signed in — 8,254 (96%) anonymous. Only 41 users have EVER saved a
 * search, and 87% of all users visit one day and never return.
 *
 * The old handler sent every signed-out click to a sign-in modal, then demanded
 * a name via window.prompt BEFORE delivering any value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

describe('an anonymous click saves instead of hitting a wall', () => {
  it('posts to the anonymous watch endpoint with the anon id', () => {
    expect(SRC).toMatch(/fetch\('\/api\/app\/map-watch'/);
    expect(SRC).toMatch(/anonId:_aid/);
  });

  it('mints the anon id BEFORE falling back to the sign-in modal', () => {
    const handler = SRC.slice(SRC.indexOf('_ss.onclick=function()'));
    const anonMint = handler.indexOf('var _aid=_anonId()');
    const modalIdx = handler.indexOf('openSignInModal');
    expect(anonMint).toBeGreaterThan(-1);
    expect(modalIdx).toBeGreaterThan(-1);
    // The modal survives ONLY as the fallback for a browser where localStorage
    // is unavailable and no anon id can be minted.
    expect(anonMint).toBeLessThan(modalIdx);
    expect(handler.slice(anonMint, modalIdx)).toMatch(/if\(!_aid\)/);
  });

  it('captures the SAME state the signed-in path captures', () => {
    const h = SRC.slice(SRC.indexOf('_ss.onclick=function()'));
    const anon = h.slice(0, h.indexOf("var name=window.prompt"));
    for (const bit of ['FILT', 'horizons', 'map.getBounds()', 'mode:MODE']) {
      expect(anon).toContain(bit);
    }
  });

  it('does not prompt for a name before saving — the name is derived', () => {
    const h = SRC.slice(SRC.indexOf('_ss.onclick=function()'));
    const anonBlock = h.slice(h.indexOf('var _aid=_anonId()'), h.indexOf("_ss.textContent='Saving…'"));
    expect(anonBlock).not.toMatch(/window\.prompt/);
  });
});

describe('it never implies alerts it will not send', () => {
  it('the alerts offer comes AFTER the save and routes through verified sign-in', () => {
    const h = SRC.slice(SRC.indexOf('_ss.onclick=function()'));
    const saveIdx = h.indexOf("body:JSON.stringify({anonId:_aid");
    const askIdx = h.indexOf("requireSignIn('get alerts for this market'");
    expect(saveIdx).toBeGreaterThan(-1);
    expect(askIdx).toBeGreaterThan(saveIdx);
    // The old flow collected an arbitrary address by prompt — that is the
    // email-abuse path and must not come back.
    expect(h).not.toMatch(/Add your email to get alerted/);
  });

  it('the success label says Watching, not Alerts on', () => {
    const h = SRC.slice(SRC.indexOf('_ss.onclick=function()'));
    expect(h).toMatch(/_ss\.textContent='\\u2713 Watching'/);
  });

  it('only a successful claim reports alerts on', () => {
    const h = SRC.slice(SRC.indexOf('_ss.onclick=function()'));
    expect(h).toMatch(/c\.claimed>0.*_ssMsg\('\\u2713 Alerts on'\)/s);
  });
});

describe('adoption is measurable', () => {
  it('emits watch_created and watch_claimed', () => {
    expect(SRC).toMatch(/_track\('tool_use','watch_created'/);
    expect(SRC).toMatch(/_track\('tool_use','watch_claimed'/);
  });
  it('marks the anonymous watch as anonymous in telemetry', () => {
    expect(SRC).toMatch(/watch_created',\{anonymous:true/);
  });
});

describe('the signed-in path is untouched', () => {
  it('still uses /api/app/saved-searches with its auth headers', () => {
    expect(SRC).toMatch(/fetch\('\/api\/app\/saved-searches',\{method:'POST'/);
    expect(SRC).toMatch(/'x-mi-auth-token':t/);
  });
});
