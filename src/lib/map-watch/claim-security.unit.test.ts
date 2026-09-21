/**
 * #1600 SECURITY — the claim path.
 *
 * THE DEFECT THAT WAS FOUND IN REVIEW: `action='claim'` accepted an arbitrary
 * `email` from the request body and set `alerts_enabled = true` on it. Any
 * holder of an anon uuid could therefore point Mindy's alert email at a
 * victim's address. These tests pin the fix: the recipient is DERIVED from a
 * verified MI session and can never be named by the caller.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkWatchPayload, MAX_ANON_WATCHES, MAX_FILTER_BYTES } from './anon-watch';

const ROUTE = readFileSync(join(process.cwd(), 'src/app/api/app/map-watch/route.ts'), 'utf8');
const LIB = readFileSync(join(process.cwd(), 'src/lib/map-watch/anon-watch.ts'), 'utf8');
const CRON = readFileSync(join(process.cwd(), 'src/app/api/cron/saved-search-alerts/route.ts'), 'utf8');
const MAP = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

describe('an unauthenticated caller cannot name an alert recipient', () => {
  it('the claim branch requires a verified MI session', () => {
    const claim = ROUTE.slice(ROUTE.indexOf("body.action === 'claim'"), ROUTE.indexOf('const { owner, refusal }'));
    expect(claim).toMatch(/requireMIAuthSession\(request\)/);
    expect(claim).toMatch(/if \(!session\.ok\) return session\.response/);
  });

  it('the account email comes FROM the session, never from the body', () => {
    const claim = ROUTE.slice(ROUTE.indexOf("body.action === 'claim'"), ROUTE.indexOf('const { owner, refusal }'));
    expect(claim).toMatch(/const verifiedEmail = session\.session\.email/);
    expect(claim).toMatch(/claimAnonWatch\(db\(\), anonId, verifiedEmail\)/);
    // the body's email must not reach the claim
    expect(claim).not.toMatch(/claimAnonWatch\([^)]*\bemail\b\s*\)/);
  });

  it('an anon id can never be treated as an account', () => {
    expect(LIB).toMatch(/if \(isAnonId\(e\)\) return \{ ok: false[^}]*anon id is not an account/);
  });
});

describe('anonymous rows cannot enter an email send', () => {
  it('anonymous watches are written with alerts_enabled=false', () => {
    expect(LIB).toMatch(/alerts_enabled: !anon/);
  });

  it('the alert cron ALSO excludes anon owners — second lock', () => {
    expect(CRON).toMatch(/\.not\('user_email', 'like', 'anon:%'\)/);
  });

  it('the exclusion sits in the shared due-scope, not one call site', () => {
    const scope = CRON.slice(CRON.indexOf('function applyDueSavedSearchScope'), CRON.indexOf('function applyDueSavedSearchScope') + 900);
    expect(scope).toMatch(/alerts_enabled', true/);
    expect(scope).toMatch(/anon:%/);
  });
});

describe('unauthenticated writes are bounded', () => {
  it('uses the repo\'s existing KV rate limiter, not a new mechanism', () => {
    expect(ROUTE).toMatch(/from '@\/lib\/rate-limit'/);
    expect(ROUTE).toMatch(/checkRateLimit\(`mapwatch:ip:/);
    expect(ROUTE).toMatch(/checkRateLimit\(`mapwatch:anon:/);
  });

  it('bounds rows per anon identity', () => {
    expect(ROUTE).toMatch(/held >= MAX_ANON_WATCHES/);
    expect(MAX_ANON_WATCHES).toBeGreaterThan(0);
  });

  it('an unverifiable count REFUSES rather than allowing an unbounded write', () => {
    expect(ROUTE).toMatch(/held == null[\s\S]{0,180}could not verify watch count/);
  });

  it('rejects a malformed or oversized payload', () => {
    expect(checkWatchPayload([], null, null).ok).toBe(false);
    expect(checkWatchPayload({}, [], null).ok).toBe(false);
    expect(checkWatchPayload({}, null, 42).ok).toBe(false);
    expect(checkWatchPayload({}, null, 'x'.repeat(300)).ok).toBe(false);
    expect(checkWatchPayload({ big: 'x'.repeat(MAX_FILTER_BYTES + 10) }, null, null).ok).toBe(false);
  });

  it('accepts an ordinary payload', () => {
    expect(checkWatchPayload({ naics: '541512' }, { w: -1, s: 1, e: 2, n: 3 }, 'My market').ok).toBe(true);
  });
});

describe('value still comes before sign-in', () => {
  it('the anonymous SAVE does not require a session', () => {
    const h = MAP.slice(MAP.indexOf('_ss.onclick=function()'));
    const anonBlock = h.slice(h.indexOf('var _aid=_anonId()'), h.indexOf("_ss.textContent='\\u2713 Watching'"));
    expect(anonBlock).not.toMatch(/requireSignIn/);
  });

  it('sign-in is only offered AFTER the save, for alerts', () => {
    const h = MAP.slice(MAP.indexOf('_ss.onclick=function()'));
    const saveIdx = h.indexOf("body:JSON.stringify({anonId:_aid");
    const signInIdx = h.indexOf("requireSignIn('get alerts for this market'");
    expect(signInIdx).toBeGreaterThan(saveIdx);
  });

  it('the client never sends an email on claim', () => {
    const helper = MAP.slice(MAP.indexOf('window.__claimAnonWatches=function()'), MAP.indexOf('window.savePursuit=function'));
    expect(helper).toMatch(/action:'claim',anonId:aid/);
    expect(helper).not.toMatch(/email:_?em2?/);
  });

  it('only a verified claim emits watch_claimed', () => {
    const helper = MAP.slice(MAP.indexOf('window.__claimAnonWatches=function()'), MAP.indexOf('window.savePursuit=function'));
    expect(helper).toMatch(/c\.claimed>0[\s\S]{0,120}watch_claimed/);
  });
});
