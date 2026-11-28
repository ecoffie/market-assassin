import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const auth = vi.hoisted(() => ({ ok: true }));
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => (auth.ok ? { authenticated: true, email } : { authenticated: false })) }));

const get = async (email?: string) => {
  const { GET } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await GET(new Request(`http://localhost/api/app/chat/capabilities${email ? `?email=${encodeURIComponent(email)}` : ''}`) as any);
  return { status: res.status, body: await res.json() };
};

const FLAGS = ['ASK_MINDY_RESEARCH_MODE', 'ASK_MINDY_RESEARCH_MODE_ALLOWLIST', 'ASK_MINDY_APP_ACTIONS', 'ASK_MINDY_APP_ACTIONS_ALLOWLIST'];
beforeEach(() => { auth.ok = true; for (const k of FLAGS) delete process.env[k]; });
afterEach(() => { for (const k of FLAGS) delete process.env[k]; });

describe('GET /api/app/chat/capabilities', () => {
  it('screenshots: true only when research mode is on for this verified user', async () => {
    expect(await get('a@b.com')).toEqual({ status: 200, body: { success: true, screenshots: false, actions: false, connected_files: false } });
    process.env.ASK_MINDY_RESEARCH_MODE = 'true'; process.env.ASK_MINDY_RESEARCH_MODE_ALLOWLIST = 'a@b.com';
    expect(await get('a@b.com')).toEqual({ status: 200, body: { success: true, screenshots: true, actions: false, connected_files: false } });
    expect((await get('c@d.com')).body.screenshots).toBe(false);
  });
  it('actions: true only when app actions are on for this verified user (flag + allowlist)', async () => {
    process.env.ASK_MINDY_APP_ACTIONS_ALLOWLIST = 'a@b.com';
    expect((await get('a@b.com')).body.actions).toBe(false); // allowlisted but flag off
    process.env.ASK_MINDY_APP_ACTIONS = 'true';
    expect(await get('a@b.com')).toEqual({ status: 200, body: { success: true, screenshots: false, actions: true, connected_files: false } });
    expect((await get('c@d.com')).body.actions).toBe(false);
  });
  it('unverified or missing email: no screenshots, no actions', async () => {
    process.env.ASK_MINDY_APP_ACTIONS = 'true'; process.env.ASK_MINDY_APP_ACTIONS_ALLOWLIST = '*';
    auth.ok = false;
    expect(await get('a@b.com')).toMatchObject({ status: 401, body: { screenshots: false, actions: false } });
    expect(await get()).toMatchObject({ status: 400, body: { screenshots: false, actions: false } });
  });
});
