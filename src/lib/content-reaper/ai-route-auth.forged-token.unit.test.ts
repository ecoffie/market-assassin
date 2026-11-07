import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Real identity verifier (no api-auth mock): a forged / garbage Mindy session token must not pass.
const callLLM = vi.fn();
vi.mock('@/lib/llm/call-llm', () => ({ callLLM }));
const hasContentGeneratorAccess = vi.fn(async () => true);
vi.mock('@/lib/access-codes', () => ({ hasContentGeneratorAccess }));

describe('forged session tokens are rejected by the real verifier', () => {
  for (const token of ['forged', 'eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImJ1eWVyQGV4YW1wbGUuY29tIn0.AAAA', 'buyer@example.com']) {
    it(`x-mi-auth-token=${token.slice(0, 12)}… → 401, no entitlement lookup, no LLM call`, async () => {
      const { POST } = await import('@/app/api/generate-graphic/route');
      const res = await POST(new NextRequest('https://getmindy.ai/api/generate-graphic', {
        method: 'POST', body: JSON.stringify({ postContent: 'hello' }),
        headers: { 'content-type': 'application/json', 'x-mi-auth-token': token },
      }));
      expect(res.status).toBe(401);
      expect(hasContentGeneratorAccess).not.toHaveBeenCalled();
      expect(callLLM).not.toHaveBeenCalled();
    });
  }
});
