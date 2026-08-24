/**
 * The open-redirect guard on the post-auth destination. `next` comes from a URL the user can
 * edit, so it is untrusted input on a path we are about to navigate to.
 *
 * THE RULE (Bucket A item 4): an explicit SAFE next wins; otherwise /today. A bad `next`
 * falls back rather than erroring — it should send the user somewhere sensible, never to an
 * attacker's site and never to a dead end.
 */
import { describe, it, expect } from 'vitest';
import { safeNext, isSafeNext, withNext, DEFAULT_POST_AUTH_PATH } from './safe-next';

describe('safeNext — keeps genuine Maps destinations', () => {
  for (const p of [
    '/opportunity-map/pursuits',
    '/opportunity-map/vault',
    '/opportunity-map/saved',
    '/opportunity-map?opp=abc123',
    '/today',
    '/opportunity-map/proposal?pursuit=9f2',
  ]) {
    it(`keeps ${p}`, () => expect(safeNext(p)).toBe(p));
  }
});

describe('safeNext — rejects anything that could leave the site', () => {
  const attacks: Array<[string, string]> = [
    ['https://evil.com', 'absolute URL'],
    ['http://evil.com/x', 'absolute http'],
    ['//evil.com', 'protocol-relative'],
    ['/\\evil.com', 'backslash protocol-relative'],
    ['/foo\\bar', 'embedded backslash'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['evil.com', 'bare host'],
    ['', 'empty'],
    ['   ', 'whitespace'],
  ];
  for (const [raw, label] of attacks) {
    it(`rejects ${label}`, () => expect(safeNext(raw)).toBe(DEFAULT_POST_AUTH_PATH));
  }

  it('rejects control characters rather than navigating to them', () => {
    // Built from char codes, never typed literally — writing raw control bytes into source
    // is how NUL ended up embedded in safe-next.ts on the first attempt.
    const withNul = '/opportunity-map' + String.fromCharCode(0) + '/evil';
    const withEsc = '/opportunity-map' + String.fromCharCode(27) + '/evil';
    expect(safeNext(withNul)).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext(withEsc)).toBe(DEFAULT_POST_AUTH_PATH);
  });

  it('rejects null/undefined', () => {
    expect(safeNext(null)).toBe(DEFAULT_POST_AUTH_PATH);
    expect(safeNext(undefined)).toBe(DEFAULT_POST_AUTH_PATH);
  });
});

describe('safeNext — never sends a NEW user back into the legacy /app', () => {
  // The entire point of item 4: a signup that started in Maps must not finish in /app.
  for (const p of ['/app', '/app?panel=vault', '/app/onboarding', '//app', '/App?panel=x']) {
    it(`rejects ${p}`, () => expect(safeNext(p)).toBe(DEFAULT_POST_AUTH_PATH));
  }
  it('does NOT reject a path that merely starts with the letters "app"', () => {
    expect(safeNext('/application-status')).toBe('/application-status');
  });
});

describe('the fallback is the Maps front door, not /app', () => {
  it('DEFAULT_POST_AUTH_PATH is a Maps path', () => {
    expect(DEFAULT_POST_AUTH_PATH.startsWith('/app')).toBe(false);
    expect(DEFAULT_POST_AUTH_PATH.startsWith('/')).toBe(true);
  });
  it('an explicit safe next WINS over the fallback', () => {
    expect(safeNext('/opportunity-map/vault')).not.toBe(DEFAULT_POST_AUTH_PATH);
  });
});

describe('isSafeNext / withNext', () => {
  it('isSafeNext agrees with safeNext', () => {
    expect(isSafeNext('/opportunity-map/pursuits')).toBe(true);
    expect(isSafeNext('https://evil.com')).toBe(false);
    expect(isSafeNext('/app')).toBe(false);
    expect(isSafeNext('')).toBe(false);
  });
  it('withNext appends only a safe next, and encodes it', () => {
    expect(withNext('/x', '/opportunity-map/vault')).toBe('/x?next=%2Fopportunity-map%2Fvault');
    expect(withNext('/x?a=1', '/today')).toBe('/x?a=1&next=%2Ftoday');
  });
  it('withNext leaves the url untouched for an unsafe or absent next', () => {
    expect(withNext('/x', 'https://evil.com')).toBe('/x');
    expect(withNext('/x', '/app')).toBe('/x');
    expect(withNext('/x', null)).toBe('/x');
  });
});
