/**
 * One introductory grant per account, at registration (2026-11-14). The decision is pure and tested here;
 * the "only one grant across Maps, App and MCP" guarantee is the database's and is tested against the real
 * function in registration-grant.pglite.unit.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const grantSignupCreditsIfFirst = vi.fn();
vi.mock('./credits', () => ({ grantSignupCreditsIfFirst: (...a: unknown[]) => grantSignupCreditsIfFirst(...a) }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn(); } }));

import {
  registrationGrantDecision, registrationGrantSince, grantRegistrationCreditsIfEligible,
  scheduleRegistrationGrant, REGISTRATION_GRANT_WINDOW_DAYS,
} from './registration-grant';

const SINCE = new Date('2026-12-01T00:00:00Z');
const NOW = new Date('2026-12-10T00:00:00Z');

describe('registrationGrantSince — off unless a valid cutover is set', () => {
  it.each([[undefined], [''], ['  '], ['not-a-date']])('%s → null (feature off)', (v) => {
    expect(registrationGrantSince({ SIGNUP_GRANT_AT_REGISTRATION_SINCE: v as string | undefined })).toBeNull();
  });
  it('a valid ISO timestamp → that date', () => {
    expect(registrationGrantSince({ SIGNUP_GRANT_AT_REGISTRATION_SINCE: '2026-12-01T00:00:00Z' })?.toISOString()).toBe(SINCE.toISOString());
  });
});

describe('registrationGrantDecision', () => {
  const d = (email: string | null, created: string | null, since: Date | null = SINCE) =>
    registrationGrantDecision(email, created, { now: NOW, since });
  it('feature off → disabled, whatever the account', () => {
    expect(d('new@example.com', '2026-12-09T00:00:00Z', null)).toBe('disabled');
  });
  it('a new account inside its window → eligible', () => {
    expect(d('New@Example.com', '2026-12-09T00:00:00Z')).toBe('eligible');
  });
  it('an account created exactly at the cutover → eligible', () => {
    expect(d('a@b.com', SINCE.toISOString())).toBe('eligible');
  });
  it('an existing account (created before the cutover) is never granted retroactively', () => {
    expect(d('old@example.com', '2026-07-01T00:00:00Z')).toBe('existing_account');
  });
  it('outside the registration window → no grant from a later session refresh', () => {
    const late = registrationGrantDecision('a@b.com', '2026-12-01T00:00:00Z', {
      now: new Date(SINCE.getTime() + (REGISTRATION_GRANT_WINDOW_DAYS + 1) * 86_400_000), since: SINCE,
    });
    expect(late).toBe('outside_registration_window');
  });
  it('unknown creation time is NOT treated as new', () => {
    expect(d('a@b.com', null)).toBe('unknown_created_at');
    expect(d('a@b.com', 'garbage')).toBe('unknown_created_at');
  });
  it('anonymous device ids and non-emails are refused', () => {
    expect(d('anon:11111111-2222-4333-8444-555555555555', '2026-12-09T00:00:00Z')).toBe('invalid_email');
    expect(d('', '2026-12-09T00:00:00Z')).toBe('invalid_email');
  });
});

describe('grantRegistrationCreditsIfEligible', () => {
  beforeEach(() => { grantSignupCreditsIfFirst.mockReset(); vi.unstubAllEnvs(); });

  it('eligible → calls the SAME signup grant, without the MCP welcome email', async () => {
    vi.stubEnv('SIGNUP_GRANT_AT_REGISTRATION_SINCE', new Date(Date.now() - 86_400_000).toISOString());
    grantSignupCreditsIfFirst.mockResolvedValue(100);
    const r = await grantRegistrationCreditsIfEligible('new@example.com', new Date().toISOString());
    expect(r).toEqual({ granted: 100, decision: 'eligible' });
    expect(grantSignupCreditsIfFirst).toHaveBeenCalledWith('new@example.com', { sendWelcome: false });
  });

  it('feature off → no database call at all', async () => {
    const r = await grantRegistrationCreditsIfEligible('new@example.com', new Date().toISOString());
    expect(r.decision).toBe('disabled');
    expect(grantSignupCreditsIfFirst).not.toHaveBeenCalled();
  });

  it('a grant failure never throws into sign-in', async () => {
    vi.stubEnv('SIGNUP_GRANT_AT_REGISTRATION_SINCE', new Date(Date.now() - 86_400_000).toISOString());
    grantSignupCreditsIfFirst.mockRejectedValue(new Error('db down'));
    await expect(grantRegistrationCreditsIfEligible('new@example.com', new Date().toISOString())).resolves.toEqual({ granted: 0, decision: 'eligible' });
  });

  it('scheduling for an existing account does not reach the grant', () => {
    vi.stubEnv('SIGNUP_GRANT_AT_REGISTRATION_SINCE', new Date().toISOString());
    scheduleRegistrationGrant('old@example.com', '2026-01-01T00:00:00Z');
    expect(grantSignupCreditsIfFirst).not.toHaveBeenCalled();
  });
});

describe('wiring: every verified sign-in seam schedules the grant with the account creation time', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it.each([
    ['src/app/api/auth/mi-session/route.ts', 'scheduleRegistrationGrant(auth.email, auth.createdAt ?? null)'],
    ['src/app/api/auth/mi-login/route.ts', 'scheduleRegistrationGrant(email, authData.user.created_at ?? null)'],
    ['src/app/api/auth/mindy-complete-signup/route.ts', 'scheduleRegistrationGrant(auth.email, auth.createdAt ?? null)'],
  ])('%s', (file, call) => {
    expect(src(file)).toContain(call);
  });
  it('the MCP paths still grant (and still send the MCP welcome email)', () => {
    expect(src('src/app/oauth/token/route.ts')).toMatch(/grantSignupCreditsIfFirst\(record\.user_email\)/);
    expect(src('src/app/api/mcp/keys/route.ts')).toMatch(/grantSignupCreditsIfFirst\(auth\.email\)/);
    expect(src('src/app/mcp/[transport]/route.ts')).toMatch(/grantSignupCreditsIfFirst\(identity\.userEmail\)/);
  });
});
