import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const auth = vi.hoisted(() => ({ ok: true }));
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => (auth.ok ? { authenticated: true, email } : { authenticated: false })) }));

const get = async (email?: string) => {
  const { GET } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await GET(new Request(`http://localhost/api/app/chat/capabilities${email ? `?email=${encodeURIComponent(email)}` : ''}`) as any);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => { auth.ok = true; delete process.env.ASK_MINDY_RESEARCH_MODE; delete process.env.ASK_MINDY_RESEARCH_MODE_ALLOWLIST; });
afterEach(() => { delete process.env.ASK_MINDY_RESEARCH_MODE; delete process.env.ASK_MINDY_RESEARCH_MODE_ALLOWLIST; });

describe('GET /api/app/chat/capabilities', () => {
  it('screenshots: true only when research mode is on for this verified user', async () => {
    expect(await get('a@b.com')).toEqual({ status: 200, body: { success: true, screenshots: false } });
    process.env.ASK_MINDY_RESEARCH_MODE = 'true'; process.env.ASK_MINDY_RESEARCH_MODE_ALLOWLIST = 'a@b.com';
    expect(await get('a@b.com')).toEqual({ status: 200, body: { success: true, screenshots: true } });
    expect((await get('c@d.com')).body.screenshots).toBe(false);
  });
  it('unverified or missing email: no screenshots', async () => {
    auth.ok = false;
    expect(await get('a@b.com')).toMatchObject({ status: 401, body: { screenshots: false } });
    expect(await get()).toMatchObject({ status: 400, body: { screenshots: false } });
  });
});
