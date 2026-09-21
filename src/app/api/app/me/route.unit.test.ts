import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => null,
}));

beforeAll(() => {
  process.env.TWO_FACTOR_SECRET = 'me-route-unit-test-secret';
});

describe('GET /api/app/me', () => {
  it('resolves identity from the HMAC header with no email query', async () => {
    const { GET } = await import('./route');
    const token = createMIAuthSessionToken('header@example.com');
    const req = new NextRequest('https://getmindy.ai/api/app/me', {
      headers: { 'x-mi-auth-token': token },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe('header@example.com');
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('picture');
  });

  it('401s when there is no session', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('https://getmindy.ai/api/app/me');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
