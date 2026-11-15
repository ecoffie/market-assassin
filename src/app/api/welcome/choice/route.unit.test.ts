/**
 * /api/welcome/choice records activity only for a VERIFIED session identity (2026-11-14). It used to take the
 * email from the request body with no auth, so anyone could write onboarding activity onto any account.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const logEngagement = vi.fn<(e: unknown) => Promise<{ success: boolean }>>(async () => ({ success: true }));
const resolveMcpEmail = vi.fn<(r: unknown) => Promise<string | null>>(async () => null);
vi.mock('@/lib/engagement', () => ({
  logEngagement: (e: unknown) => logEngagement(e),
  EventTypes: { ONBOARDING_STEP: 'onboarding_step' },
  EventSources: { ONBOARDING: 'onboarding' },
}));
vi.mock('@/lib/mcp/session-identity', () => ({ resolveMcpEmail: (r: unknown) => resolveMcpEmail(r) }));

import { POST } from './route';

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('https://getmindy.ai/api/welcome/choice', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

describe('POST /api/welcome/choice', () => {
  beforeEach(() => { logEngagement.mockClear(); resolveMcpEmail.mockReset(); resolveMcpEmail.mockResolvedValue(null); });

  it('a body-supplied email without a session records nothing (still 200)', async () => {
    const res = await POST(req({ choice: 'explore_map', email: 'victim@acme.io' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, recorded: false, reason: 'unverified' });
    expect(logEngagement).not.toHaveBeenCalled();
  });

  it('no identity at all is anonymous, not recorded', async () => {
    const res = await POST(req({ choice: 'connect_mcp' }));
    expect((await res.json()).reason).toBe('anonymous');
    expect(logEngagement).not.toHaveBeenCalled();
  });

  it('a verified session records under the SESSION email, ignoring the body email', async () => {
    resolveMcpEmail.mockResolvedValue('owner@acme.io');
    const res = await POST(req({ choice: 'personalize_company', email: 'victim@acme.io' }, { 'x-mi-auth-token': 'tok' }));
    expect(await res.json()).toEqual({ success: true, recorded: true });
    expect(logEngagement).toHaveBeenCalledTimes(1);
    expect((logEngagement.mock.calls[0][0] as { userEmail: string }).userEmail).toBe('owner@acme.io');
  });

  it('an unknown choice is still rejected', async () => {
    resolveMcpEmail.mockResolvedValue('owner@acme.io');
    const res = await POST(req({ choice: 'nope' }));
    expect(res.status).toBe(400);
    expect(logEngagement).not.toHaveBeenCalled();
  });
});
