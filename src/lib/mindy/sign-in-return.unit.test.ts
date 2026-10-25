import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { oauthOnboardingRedirect, signInReturnPath } from './sign-in-return';

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
