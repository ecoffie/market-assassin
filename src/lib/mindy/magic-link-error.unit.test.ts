/**
 * Mindy Day: a user connecting ChatGPT got "invalid" from the emailed sign-in link and only got in
 * with a password. Two causes, both covered here:
 *  1. A used / superseded / expired link lands on /app with an error hash, which /app ignored.
 *  2. The connect (consent) tab only sees a sign-in made in the SAME browser, and never said so.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { magicLinkErrorMessage, MAGIC_LINK_INVALID_MESSAGE } from './magic-link-error';

const root = join(__dirname, '..', '..', '..');
const appPage = readFileSync(join(root, 'src/app/app/page.tsx'), 'utf8');
const authorizePage = readFileSync(join(root, 'src/app/oauth/authorize/page.tsx'), 'utf8');

describe('magicLinkErrorMessage', () => {
  it('explains the Supabase otp_expired redirect hash', () => {
    expect(
      magicLinkErrorMessage('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
    ).toBe(MAGIC_LINK_INVALID_MESSAGE);
  });
  it('handles an error hash without a leading #, and a bare error_code', () => {
    expect(magicLinkErrorMessage('error=access_denied')).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(magicLinkErrorMessage('#error_code=otp_expired')).toBe(MAGIC_LINK_INVALID_MESSAGE);
  });
  it('never treats a successful sign-in hash as an error', () => {
    expect(magicLinkErrorMessage('#access_token=abc&type=magiclink&refresh_token=x')).toBeNull();
  });
  it('is null for an empty or unrelated hash', () => {
    expect(magicLinkErrorMessage('')).toBeNull();
    expect(magicLinkErrorMessage('#')).toBeNull();
    expect(magicLinkErrorMessage(undefined)).toBeNull();
    expect(magicLinkErrorMessage('#section=vault')).toBeNull();
  });
  it('points to both ways forward: a new link or the password', () => {
    expect(MAGIC_LINK_INVALID_MESSAGE).toContain('Request a new link');
    expect(MAGIC_LINK_INVALID_MESSAGE).toContain('sign in with your password');
  });
});

describe('call sites', () => {
  it('/app reads the hash on mount, shows the message, and strips the hash', () => {
    expect(appPage).toContain("import { magicLinkErrorMessage } from '@/lib/mindy/magic-link-error';");
    const idx = appPage.indexOf('magicLinkErrorMessage(window.location.hash)');
    expect(idx).toBeGreaterThan(-1);
    const block = appPage.slice(idx, idx + 300);
    expect(block).toContain('setAuthError(linkError)');
    expect(block).toContain('window.history.replaceState');
  });
  it('/app renders authError on the sign-in form', () => {
    expect(appPage).toMatch(/\{authError && \(/);
  });
  it('the connect consent page says an emailed link must be opened in the same browser', () => {
    const waiting = authorizePage.indexOf('Waiting for sign-in…');
    expect(waiting).toBeGreaterThan(-1);
    expect(authorizePage.slice(waiting)).toContain(
      'Using an emailed sign-in link? Open it in this same browser, or sign in with your password instead.',
    );
  });
});
