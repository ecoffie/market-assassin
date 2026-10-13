/**
 * Email-action signing secret + rotation (2026-10-13).
 *
 * Pins the rollout sequence:
 *   0. today (EMAIL_ACTION_SECRET unset): behaviour unchanged — links signed and verified with ADMIN_PASSWORD;
 *   1. set EMAIL_ACTION_SECRET: new links use it; links already in inboxes (ADMIN_PASSWORD) still verify;
 *   2. EMAIL_ACTION_ACCEPT_ADMIN_LEGACY=off after the 7-day window: legacy links rejected, and rotating
 *      ADMIN_PASSWORD no longer touches any email link;
 *   3. a later rotation of the dedicated secret uses EMAIL_ACTION_SECRET_PREVIOUS.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { generateEmailToken, verifyEmailToken } from '@/lib/api-auth';
import { emailLinkToken, emailActionVerificationSecrets, hexEquals } from './email-action-secret';
import { mintSaveAction, verifySaveAction } from '@/lib/pipeline/email-save-token';

const KEYS = ['EMAIL_ACTION_SECRET', 'EMAIL_ACTION_SECRET_PREVIOUS', 'EMAIL_ACTION_ACCEPT_ADMIN_LEGACY', 'ADMIN_PASSWORD'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const EMAIL = 'buyer@example.org';
const ADMIN = 'admin-password-value';
const DEDICATED = 'dedicated-email-action-secret';

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  process.env.ADMIN_PASSWORD = ADMIN;
});
afterAll(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const now = () => Math.floor(Date.now() / 1000);

describe('step 0 — nothing configured yet: behaviour unchanged', () => {
  it('signs with ADMIN_PASSWORD and verifies', () => {
    const { token, ts } = generateEmailToken(EMAIL);
    expect(token).toBe(emailLinkToken(ADMIN, EMAIL, ts));
    expect(verifyEmailToken(EMAIL, token, ts).authenticated).toBe(true);
  });

  it('the legacy switch cannot lock out the only secret in use', () => {
    process.env.EMAIL_ACTION_ACCEPT_ADMIN_LEGACY = 'off';
    expect(emailActionVerificationSecrets()).toEqual([ADMIN]);
    const { token, ts } = generateEmailToken(EMAIL);
    expect(verifyEmailToken(EMAIL, token, ts).authenticated).toBe(true);
  });
});

describe('step 1 — EMAIL_ACTION_SECRET set', () => {
  it('new links are signed with the dedicated secret, not the admin password', () => {
    process.env.EMAIL_ACTION_SECRET = DEDICATED;
    const { token, ts } = generateEmailToken(EMAIL);
    expect(token).toBe(emailLinkToken(DEDICATED, EMAIL, ts));
    expect(token).not.toBe(emailLinkToken(ADMIN, EMAIL, ts));
    expect(verifyEmailToken(EMAIL, token, ts).authenticated).toBe(true);
  });

  it('links already in inboxes (signed with ADMIN_PASSWORD) keep working during the window', () => {
    const ts = now() - 3600;
    const legacy = emailLinkToken(ADMIN, EMAIL, ts);
    process.env.EMAIL_ACTION_SECRET = DEDICATED;
    expect(verifyEmailToken(EMAIL, legacy, ts).authenticated).toBe(true);
  });

  it('an email-save confirmation form minted before the switch still verifies', () => {
    const form = mintSaveAction(EMAIL, 'notice:abc'); // signed with ADMIN_PASSWORD
    process.env.EMAIL_ACTION_SECRET = DEDICATED;
    expect(verifySaveAction(form, form.sig)).toEqual({ ok: true });
    const fresh = mintSaveAction(EMAIL, 'notice:abc');  // signed with DEDICATED
    expect(verifySaveAction(fresh, fresh.sig)).toEqual({ ok: true });
  });
});

describe('step 2 — legacy acceptance turned off after the window', () => {
  beforeEach(() => {
    process.env.EMAIL_ACTION_SECRET = DEDICATED;
    process.env.EMAIL_ACTION_ACCEPT_ADMIN_LEGACY = 'off';
  });

  it('ADMIN_PASSWORD-signed links are rejected', () => {
    const ts = now();
    expect(verifyEmailToken(EMAIL, emailLinkToken(ADMIN, EMAIL, ts), ts)).toMatchObject({ authenticated: false, error: 'Invalid token' });
    expect(emailActionVerificationSecrets()).toEqual([DEDICATED]);
  });

  it('rotating ADMIN_PASSWORD no longer affects any email link', () => {
    const { token, ts } = generateEmailToken(EMAIL);
    process.env.ADMIN_PASSWORD = 'a-brand-new-admin-password';
    expect(verifyEmailToken(EMAIL, token, ts).authenticated).toBe(true);
    delete process.env.ADMIN_PASSWORD;
    expect(verifyEmailToken(EMAIL, token, ts).authenticated).toBe(true);
  });
});

describe('step 3 — rotating the dedicated secret itself', () => {
  it('EMAIL_ACTION_SECRET_PREVIOUS keeps old links valid', () => {
    process.env.EMAIL_ACTION_SECRET = DEDICATED;
    process.env.EMAIL_ACTION_ACCEPT_ADMIN_LEGACY = 'off';
    const { token, ts } = generateEmailToken(EMAIL);
    process.env.EMAIL_ACTION_SECRET = 'next-dedicated-secret';
    process.env.EMAIL_ACTION_SECRET_PREVIOUS = DEDICATED;
    expect(verifyEmailToken(EMAIL, token, ts).authenticated).toBe(true);
    delete process.env.EMAIL_ACTION_SECRET_PREVIOUS;
    expect(verifyEmailToken(EMAIL, token, ts).authenticated).toBe(false);
  });
});

describe('verification hardening', () => {
  it('compares in constant time and rejects malformed tokens', () => {
    expect(hexEquals('abcd', 'abcd')).toBe(true);
    expect(hexEquals('abcd', 'abce')).toBe(false);
    expect(hexEquals('abcd', 'abcd00')).toBe(false);
    expect(hexEquals('zz', 'zz')).toBe(false);
    const ts = now();
    expect(verifyEmailToken(EMAIL, 'not-a-token', ts).authenticated).toBe(false);
  });

  it('expired links still fail before any signature check', () => {
    const ts = now() - 2 * 86400;
    expect(verifyEmailToken(EMAIL, emailLinkToken(ADMIN, EMAIL, ts), ts)).toMatchObject({ authenticated: false, error: 'Link expired' });
  });
});
