import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePendingNext, oauthOnboardingRedirect, PENDING_NEXT_TTL_MS, readPendingNext, signInHref, signInReturnPath } from './sign-in-return';

describe('signInReturnPath — password / email-code sign-in returns to a SAFE next only', () => {
  it('a Learn tutorial is preserved exactly', () => {
    expect(signInReturnPath('/learn/find-your-buyers')).toBe('/learn/find-your-buyers');
    expect(signInReturnPath('/welcome/company?next=/learn')).toBe('/welcome/company?next=/learn');
  });
  it.each([
    'https://evil.com', '//evil.com', '/\\evil.com', '/\nevil', 'javascript:alert(1)',
    '/app', '/app/onboarding', '/briefings', '', null, undefined,
  ])('rejects %s → stay on /app (null)', (raw) => {
    expect(signInReturnPath(raw as string | null | undefined)).toBeNull();
  });
});

describe('signInHref — the one sign-in link builder', () => {
  it('carries a safe next', () => {
    expect(signInHref('/learn/find-your-buyers')).toBe('/app?next=%2Flearn%2Ffind-your-buyers');
  });
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', '/app/x', null])('drops %s', (raw) => {
    expect(signInHref(raw as string | null)).toBe('/app');
  });
});

describe('oauthOnboardingRedirect — Google/Microsoft carry next only when safeNext accepts it', () => {
  const O = 'https://getmindy.ai';
  it('keeps a tutorial', () => {
    expect(oauthOnboardingRedirect(O, '/learn/find-your-buyers')).toBe(`${O}/app/onboarding?next=%2Flearn%2Ffind-your-buyers`);
  });
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', null])('drops %s', (raw) => {
    expect(oauthOnboardingRedirect(O, raw as string | null)).toBe(`${O}/app/onboarding`);
  });
});

describe('/app wires the return for every sign-in method', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/app/page.tsx'), 'utf8');
  it('password sign-in and the email-code (2FA) verify both return to next after loading the profile', () => {
    const hits = src.match(/await loadUserProfile\(normalizedEmail\);\n\s*returnToNextAfterSignIn\(\);/g) || [];
    expect(hits.length).toBe(2);
  });
  it('the onboarding redirect wins over next', () => {
    expect(src).toMatch(/leavingForOnboardingRef\.current = true;\n\s*window\.location\.href = WELCOME_PATH;/);
    expect(src).toContain('leavingForOnboardingRef.current) return;');
  });
  it('OAuth uses the shared guard, not the old inline startsWith check', () => {
    expect(src).toContain('oauthOnboardingRedirect(window.location.origin');
    expect(src).not.toContain("raw.startsWith('/') && !raw.startsWith('//')");
  });
});

// Review (2026-10-25): try to get an off-site destination past the guard. The oracle is the WHATWG
// URL parser — the same one `location.href = x` uses — so a trick it normalises (it STRIPS tab/CR/LF,
// which would turn "/\t/evil.com" into "//evil.com") is caught here even if a string check missed it.
describe('redirect guard cannot be bypassed', () => {
  const ORIGIN = 'https://getmindy.ai';
  const attacks = [
    '//evil.com', '///evil.com', '/\\evil.com', '\\/evil.com', '/\\/evil.com', ' //evil.com', '\t//evil.com',
    '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\u0000/evil.com', '/\u007f/evil.com',
    'https://evil.com', 'HTTPS://evil.com', 'http:/evil.com', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)',
    'data:text/html,x', '//evil.com@getmindy.ai', '/.//evil.com', '/%2F%2Fevil.com', '/%5Cevil.com',
    '/　/evil.com', '/／/evil.com', '/learn/../..//evil.com', '/@evil.com', 'evil.com', '#//evil.com',
  ];
  it.each(attacks)('%j never leaves getmindy.ai (return path, sign-in link, OAuth, magic-link memory)', (raw) => {
    const dest = signInReturnPath(raw);
    if (dest !== null) expect(new URL(dest, ORIGIN).origin).toBe(ORIGIN);
    const href = signInHref(raw);
    expect(new URL(href, ORIGIN).origin).toBe(ORIGIN);
    const carried = new URL(href, ORIGIN).searchParams.get('next');
    if (carried !== null) expect(new URL(carried, ORIGIN).origin).toBe(ORIGIN);
    const oauthNext = new URL(oauthOnboardingRedirect(ORIGIN, raw)).searchParams.get('next');
    if (oauthNext !== null) expect(new URL(oauthNext, ORIGIN).origin).toBe(ORIGIN);
    const pending = readPendingNext(JSON.stringify({ next: raw, at: 1000 }), 2000);
    if (pending !== null) expect(new URL(pending, ORIGIN).origin).toBe(ORIGIN);
  });
  it('the classic tab/newline smuggle is rejected outright, not just neutralised', () => {
    for (const raw of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com']) expect(signInReturnPath(raw)).toBeNull();
  });
});

describe('magic link: destination remembered in this browser only', () => {
  it('stores a safe next and reads it back once within the hour', () => {
    const v = encodePendingNext('/learn/should-i-bid', 1000)!;
    expect(readPendingNext(v, 1000 + 59 * 60 * 1000)).toBe('/learn/should-i-bid');
  });
  it('expires after the hour, rejects future stamps and junk', () => {
    const v = encodePendingNext('/learn/should-i-bid', 1000)!;
    expect(readPendingNext(v, 1000 + PENDING_NEXT_TTL_MS + 1)).toBeNull();
    expect(readPendingNext(JSON.stringify({ next: '/learn/x', at: 5000 }), 1000)).toBeNull();
    for (const junk of ['', 'not json', '{"next":5,"at":1}', '{"at":1}', 'null']) expect(readPendingNext(junk, 2)).toBeNull();
  });
  it('never stores an unsafe next, and re-validates a tampered stored value', () => {
    expect(encodePendingNext('//evil.com', 1)).toBeNull();
    expect(encodePendingNext('/app', 1)).toBeNull();
    expect(readPendingNext(JSON.stringify({ next: '//evil.com', at: 1 }), 2)).toBeNull();
  });
  it('/app stores it when the link is requested and only the magic-link landing reads it', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/app/page.tsx'), 'utf8');
    expect(src).toContain('localStorage.setItem(PENDING_NEXT_KEY, pendingNext)');
    expect(src).toMatch(/window\.history\.replaceState\(null, '', `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\);\n\s*returnToNextAfterSignIn\(\{ fromMagicLink: true \}\);/);
    expect((src.match(/fromMagicLink: true/g) || []).length).toBe(1);
    expect(src).toContain('localStorage.removeItem(PENDING_NEXT_KEY)');
  });
});
