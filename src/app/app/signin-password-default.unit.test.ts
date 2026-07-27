/**
 * Password is the DEFAULT sign-in mode (Eric 2026-07-27) — mature-SaaS pattern (password primary,
 * magic-link/SSO as alternatives). Was magic-link-first. Guards the default so it doesn't silently
 * flip back, and confirms the alternatives (magic-link toggle + Forgot-password) are still present.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('sign-in defaults to password', () => {
  it('usePasswordSignIn initializes to true (password form shows first)', () => {
    expect(src).toMatch(/const \[usePasswordSignIn, setUsePasswordSignIn\] = useState\(true\)/);
    expect(src).not.toMatch(/const \[usePasswordSignIn, setUsePasswordSignIn\] = useState\(false\)/);
  });
  it('magic-link is still reachable as the alternative ("sign-in link instead")', () => {
    expect(src).toContain('Email me a sign-in link instead');
  });
  it('Forgot password link is present on the password form', () => {
    expect(src).toContain('Forgot password?');
    expect(src).toContain('href="/app/forgot-password"');
  });
});
