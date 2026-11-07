import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The Content Reaper AI helper routes called the LLM for any anonymous caller. Every rejected
 * request below must return BEFORE callLLM — a rejection costs nothing.
 */
const callLLM = vi.fn(async () => ({ text: '{"quote":"q","slides":[]}', provider: 'test' }));
vi.mock('@/lib/llm/call-llm', () => ({ callLLM }));

const identity = { current: null as null | { email: string; method: string } };
vi.mock('@/lib/api-auth', () => ({ getVerifiedIdentity: vi.fn(async () => identity.current) }));
const entitled = { current: true };
vi.mock('@/lib/access-codes', () => ({ hasContentGeneratorAccess: vi.fn(async () => entitled.current) }));
const allowed = { current: true };
vi.mock('@/lib/rate-limit', async (orig) => {
  const real = await orig<typeof import('@/lib/rate-limit')>();
  return { ...real, checkRateLimit: vi.fn(async (_k: string, limit: number) => ({ allowed: allowed.current, remaining: 0, limit, resetAt: Math.floor(Date.now() / 1000) + 60 })) };
});

const ROUTES = {
  graphic: () => import('@/app/api/generate-graphic/route'),
  carousel: () => import('@/app/api/convert-post-to-carousel/route'),
  quote: () => import('@/app/api/generate-quote/route'),
} as const;

const post = async (route: keyof typeof ROUTES, body: unknown, headers: Record<string, string> = {}) => {
  const { POST } = await ROUTES[route]();
  return POST(new NextRequest(`https://getmindy.ai/api/x`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }));
};

beforeEach(() => {
  vi.clearAllMocks();
  identity.current = null; entitled.current = true; allowed.current = true;
  process.env.GROQ_API_KEY = 'x';
});

for (const route of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
  describe(`${route}`, () => {
    it('anonymous → 401 with a sign-in URL, no LLM call', async () => {
      const res = await post(route, { postContent: 'hello' });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ auth_required: true, signInUrl: '/app?next=%2Fcontent-generator%2F' });
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('a body-supplied email is not identity → 401, no LLM call', async () => {
      const res = await post(route, { postContent: 'hello', email: 'buyer@example.com' });
      expect(res.status).toBe(401);
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('malformed JSON from an anonymous caller → 401 (auth runs before parsing), no LLM call', async () => {
      const { POST } = await ROUTES[route]();
      const res = await POST(new NextRequest('https://getmindy.ai/api/x', { method: 'POST', body: '{not json', headers: { 'content-type': 'application/json' } }));
      expect(res.status).toBe(401);
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('verified but NOT entitled → 403, no LLM call', async () => {
      identity.current = { email: 'free@example.com', method: 'mi_session' };
      entitled.current = false;
      const res = await post(route, { postContent: 'hello' });
      expect(res.status).toBe(403);
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('over the daily limit → 429, no LLM call', async () => {
      identity.current = { email: 'buyer@example.com', method: 'mi_session' };
      allowed.current = false;
      const res = await post(route, { postContent: 'hello' });
      expect(res.status).toBe(429);
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('oversized input → 413, no LLM call', async () => {
      identity.current = { email: 'buyer@example.com', method: 'mi_session' };
      const res = await post(route, { postContent: 'x'.repeat(10_001) });
      expect(res.status).toBe(413);
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('verified + entitled + within limits → the LLM is called exactly once', async () => {
      identity.current = { email: 'buyer@example.com', method: 'mi_session' };
      const res = await post(route, { postContent: 'A real LinkedIn post about federal contracting.', postTitle: 't', slideCount: 5 });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(callLLM).toHaveBeenCalledTimes(1);
    });
  });
}
