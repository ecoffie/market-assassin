import { beforeAll, describe, expect, it } from 'vitest';
import { createTwoFactorSessionToken } from '@/lib/two-factor-session';
import {
  credentialForSetupSave,
  isLoginChallenge,
  isMiSessionToken,
  isSessionFailureMessage,
  isSupabaseAccessJwt,
  parseSetupDraft,
  serializeSetupDraft,
} from './setup-session';

describe('setup save uses the authenticated session, not the login challenge', () => {
  beforeAll(() => {
    process.env.TWO_FACTOR_SECRET = 'setup-session-unit-test-secret';
  });

  it('an email-code session token is an MI session, and the 6-digit code is not', () => {
    const session = createTwoFactorSessionToken('cwhitlock1953@gmail.com');
    expect(isMiSessionToken(session)).toBe(true);
    expect(isSupabaseAccessJwt(session)).toBe(false);
    expect(isLoginChallenge('464696')).toBe(true);
    expect(isMiSessionToken('464696')).toBe(false);
    expect(credentialForSetupSave({ storedMiToken: '464696' }).kind).toBe('missing');
    expect(credentialForSetupSave({ storedMiToken: session })).toEqual({
      kind: 'mi-session',
      token: session,
    });
  });

  it('a Supabase JWT must be exchanged, never forwarded as the two-factor session', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue';
    expect(isSupabaseAccessJwt(jwt)).toBe(true);
    expect(isMiSessionToken(jwt)).toBe(false);
    expect(credentialForSetupSave({ supabaseAccessToken: jwt }).kind).toBe('needs-exchange');
  });

  it('a stored MI session wins over a leftover Supabase JWT', () => {
    const session = createTwoFactorSessionToken('user@example.com');
    const jwt = 'aaa.bbb.ccc';
    const cred = credentialForSetupSave({ storedMiToken: session, supabaseAccessToken: jwt });
    expect(cred).toEqual({ kind: 'mi-session', token: session });
  });

  it('Invalid two-factor session is a session failure, not a bad code', () => {
    expect(isSessionFailureMessage('Invalid two-factor session')).toBe(true);
    expect(isSessionFailureMessage('Missing two-factor session')).toBe(true);
    expect(isSessionFailureMessage('Invalid verification code')).toBe(false);
    expect(isSessionFailureMessage('Code expired or not found. Request a new code.')).toBe(false);
  });

  it('a setup draft round-trips so expiry recovery can restore entered fields', () => {
    const raw = serializeSetupDraft({
      savedAt: '2026-09-15T18:20:00.000Z',
      email: 'cwhitlock1953@gmail.com',
      businessDescription: 'construction management',
      step: 5,
      next: '/oauth/authorize?client_id=x',
    });
    expect(parseSetupDraft(raw)?.businessDescription).toBe('construction management');
    expect(parseSetupDraft(raw)?.next).toContain('/oauth/authorize');
    expect(parseSetupDraft('not-json')).toBeNull();
  });
});
