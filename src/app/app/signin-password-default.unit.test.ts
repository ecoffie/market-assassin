/**
 * Sign-in: password is the primary, ALWAYS-VISIBLE form — co-equal with magic-link/OAuth, NOT a
 * toggle (Eric 2026-07-27). The old "Sign in with a password" reveal-toggle + the separate
 * magic-link-only view are gone; magic-link is now an inline "one-time sign-in link" button under
 * the password fields.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('sign-in shows password as the primary always-on form', () => {
  it('defaults to the password form (usePasswordSignIn = true)', () => {
    expect(src).toMatch(/const \[usePasswordSignIn, setUsePasswordSignIn\] = useState\(true\)/);
  });
  it('the "Sign in with a password" reveal-toggle is GONE (no view to toggle to)', () => {
    expect(src).not.toContain('Sign in with a password');
    expect(src).not.toContain('Email me a sign-in link instead');
  });
  it('the separate magic-link-only input form is GONE (magic_email removed)', () => {
    expect(src).not.toContain('magic_email');
  });
  it('magic-link is a CO-EQUAL inline alternative on the password form', () => {
    expect(src).toContain('Email me a one-time sign-in link');
    // it fires the magic-link request with the already-typed email (no view swap)
    const idx = src.indexOf('Email me a one-time sign-in link');
    expect(src.slice(Math.max(0, idx - 400), idx)).toContain('requestMagicLinkSignIn(pendingEmail)');
  });
  it('Forgot password link stays on the password form', () => {
    expect(src).toContain('Forgot password?');
    expect(src).toContain('href="/app/forgot-password"');
  });
});
