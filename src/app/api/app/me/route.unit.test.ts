import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';
import { MI_AUTH_COOKIE } from '@/lib/mindy/mi-auth-constants';
import { GET } from './route';

beforeAll(() => {
  process.env.TWO_FACTOR_SECRET = 'me-route-unit-test-secret';
});

describe('GET /api/app/me', () => {
  it('resolves identity from the mi_auth cookie with no email query', async () => {
    const token = createMIAuthSessionToken('eric@govcongiants.com');
    const req = new NextRequest('https://getmindy.ai/api/app/me', {
      headers: { cookie: `${MI_AUTH_COOKIE}=${token}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe('eric@govcongiants.com');
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('picture');
  });

  it('resolves identity from the HMAC header with no email query', async () => {
    const token = createMIAuthSessionToken('header@example.com');
    const req = new NextRequest('https://getmindy.ai/api/app/me', {
      headers: { 'x-mi-auth-token': token },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe('header@example.com');
  });

  it('401s when there is no session', async () => {
    const req = new NextRequest('https://getmindy.ai/api/app/me');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
