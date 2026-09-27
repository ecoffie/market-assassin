/**
 * /api/app/engagement identity contract.
 *
 *   - A real email is accepted ONLY with a session token that covers it (#1232).
 *   - The body email is a CLAIM; it can never create identity on its own.
 *   - A rejection is logged (source + reason), because the silent version of this 401
 *     erased five weeks of signed-in /app telemetry.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const logEngagement = vi.fn(async (event: unknown) => { void event; return { success: true }; });
vi.mock('@/lib/engagement', async (orig) => {
  const real = await orig<typeof import('@/lib/engagement')>();
  return { ...real, logEngagement: (a: unknown) => logEngagement(a) };
});

let POST: typeof import('./route').POST;
let createMIAuthSessionToken: typeof import('@/lib/two-factor-session').createMIAuthSessionToken;

beforeAll(async () => {
  process.env.TWO_FACTOR_SECRET = process.env.TWO_FACTOR_SECRET || 'unit-test-secret';
  ({ POST } = await import('./route'));
  ({ createMIAuthSessionToken } = await import('@/lib/two-factor-session'));
});

function req(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/app/engagement', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const EVENT = { eventType: 'page_view', eventSource: 'pipeline', metadata: { panel: 'pipeline' } };

describe('POST /api/app/engagement', () => {
  beforeEach(() => { logEngagement.mockClear(); });

  it('rejects a real email with no token (the beacon shape) and logs the rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await POST(req({ email: 'user@example.com', ...EVENT }));
    expect(res.status).toBe(401);
    expect(logEngagement).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[app/engagement] rejected unauthenticated event',
      expect.objectContaining({ event_source: 'pipeline', had_token: false }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('user@example.com');
    warn.mockRestore();
  });

  it('accepts the same event with the session token, attributed to the token identity', async () => {
    const token = createMIAuthSessionToken('user@example.com');
    const res = await POST(req({ email: 'user@example.com', ...EVENT }, { 'x-mi-auth-token': token }));
    expect(res.status).toBe(200);
    expect(logEngagement).toHaveBeenCalledWith(expect.objectContaining({ userEmail: 'user@example.com', eventSource: 'pipeline' }));
  });

  it('never lets the body email override the session: a token for A cannot write as B', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const token = createMIAuthSessionToken('a@example.com');
    const res = await POST(req({ email: 'b@example.com', ...EVENT }, { 'x-mi-auth-token': token }));
    expect(res.status).toBe(401);
    expect(logEngagement).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still accepts a well-formed anonymous id without a token', async () => {
    const res = await POST(req({ email: 'anon:123e4567-e89b-12d3-a456-426614174000', ...EVENT }));
    expect(res.status).toBe(200);
    expect(logEngagement).toHaveBeenCalledTimes(1);
  });
});
