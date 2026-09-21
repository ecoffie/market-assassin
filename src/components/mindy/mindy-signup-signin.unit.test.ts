/**
 * The home-page widget (MindySignupForm) shows a REAL inline email+password sign-in when in
 * 'signin' mode — co-equal with /app (Eric 2026-07-27), not a "go to /app" link.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'MindySignupForm.tsx'), 'utf8');

describe('home-page sign-in has a real inline password form', () => {
  it('signin mode renders an email + password form (not a route-to-/app link)', () => {
    expect(src).toContain('handlePasswordSignIn');
    expect(src).toContain("type={showPassword ? 'text' : 'password'}");
    // the old "Sign in with email →" route-only link is gone
    expect(src).not.toContain('Sign in with email →');
  });
  it('posts to the same login endpoint /app uses + persists the session token', () => {
    expect(src).toContain('/api/auth/mindy-login');
    expect(src).toContain("localStorage.setItem('mi_beta_auth_token'");
  });
  it('MFA accounts hand off to /app (no duplicated OTP machinery)', () => {
    expect(src).toContain('data.mfaRequired');
    expect(src).toContain('/app?email=');
  });
  it('has a Forgot password link', () => {
    expect(src).toContain('/app/forgot-password');
  });
});
