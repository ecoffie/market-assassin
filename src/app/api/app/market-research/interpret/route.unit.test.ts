import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';
import { POST } from './route';

beforeAll(() => {
  process.env.TWO_FACTOR_SECRET = 'mrr-workspace-unit-test-secret';
});

function authHeaders(email = 'ko@example.mil') {
  return {
    'content-type': 'application/json',
    'x-mi-auth-token': createMIAuthSessionToken(email),
  };
}

describe('market research interpret authorization', () => {
  it('rejects unauthenticated interpretation', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/app/market-research/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'SABER at Vandenberg' }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('requires a question when authenticated', async () => {
    process.env.TWO_FACTOR_SECRET = process.env.TWO_FACTOR_SECRET || 'mrr-workspace-unit-test-secret';
    const response = await POST(
      new NextRequest('http://localhost/api/app/market-research/interpret', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ question: '' }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
