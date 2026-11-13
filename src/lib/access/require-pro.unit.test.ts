/**
 * requirePro — the server gate for Players, M-Win, map CRM save and the proposal workspace
 * (owner decision 2026-11-13: "Pro and trial only"). Signed out → 401, signed in but not Pro →
 * 402 pro_required, Pro / Team / trial / staff → allowed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const session = vi.hoisted(() => ({ email: null as string | null }));
const access = vi.hoisted(() => ({ level: 'free' as 'pro' | 'free', throws: false }));

vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: () =>
    session.email
      ? { ok: true, session: { valid: true, email: session.email } }
      : { ok: false, response: new Response(JSON.stringify({ success: false }), { status: 401 }) },
}));
vi.mock('@/lib/access/resolve-access', () => ({
  resolveAccess: async () => {
    if (access.throws) throw new Error('db down');
    return { level: access.level, source: access.level === 'pro' ? 'stripe' : 'free', trialEndsAt: null };
  },
}));

import { requirePro, isProEmail, PRO_REQUIRED_BODY } from './require-pro';

const req = () => new NextRequest('https://getmindy.ai/api/x');

beforeEach(() => { session.email = null; access.level = 'free'; access.throws = false; });

describe('requirePro', () => {
  it('signed out → 401', async () => {
    const r = await requirePro(req());
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(401); expect(r.response.status).toBe(401); }
  });

  it('signed in, free → 402 pro_required with the trial message', async () => {
    session.email = 'free@example.com';
    const r = await requirePro(req());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(402);
      expect(r.response.status).toBe(402);
      const body = await r.response.json();
      expect(body).toEqual(PRO_REQUIRED_BODY);
      expect(body.error).toBe('pro_required');
      expect(body.upgrade_url).toBe('/pricing');
      expect(body.message).toMatch(/14-day free trial/);
    }
  });

  it('Pro (paid, Team or an active trial — all resolve to level pro) → allowed, email from the token', async () => {
    session.email = 'pro@example.com';
    access.level = 'pro';
    const r = await requirePro(req());
    expect(r).toEqual({ ok: true, email: 'pro@example.com' });
  });

  it('staff pass without a Pro entitlement', async () => {
    session.email = 'someone@getmindy.ai';
    const r = await requirePro(req());
    expect(r.ok).toBe(true);
  });

  it('an access-lookup error locks the feature, never grants it', async () => {
    session.email = 'free@example.com';
    access.throws = true;
    expect(await isProEmail('free@example.com')).toBe(false);
  });

  it('empty / malformed email is never Pro', async () => {
    expect(await isProEmail('')).toBe(false);
    expect(await isProEmail('not-an-email')).toBe(false);
  });
});
