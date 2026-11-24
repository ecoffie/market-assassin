import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  authed: true,
  scope: { kind: 'own', email: 'owner@acme.com' } as Record<string, unknown>,
  save: vi.fn(),
  list: vi.fn(async () => []),
  disconnect: vi.fn(async () => 'disconnected'),
}));

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => (h.authed ? { authenticated: true, email } : { authenticated: false, error: 'no' })) }));
vi.mock('@/lib/chat/chat-acting-scope', () => ({ resolveChatActingScope: vi.fn(async () => h.scope) }));
vi.mock('@/lib/connected-apps/store', async (orig) => ({ ...(await orig<typeof import('@/lib/connected-apps/store')>()), saveConnection: h.save, listConnections: h.list, disconnect: h.disconnect }));

const ENV = ['CONNECTED_APPS', 'CONNECTED_APPS_ALLOWLIST', 'CONNECTED_APPS_STATE_SECRET', 'CONNECTED_APPS_TOKEN_ENC_KEY', 'CONNECTED_APPS_GOOGLE_CLIENT_ID', 'CONNECTED_APPS_GOOGLE_CLIENT_SECRET', 'CONNECTED_APPS_MICROSOFT_CLIENT_ID', 'CONNECTED_APPS_MICROSOFT_CLIENT_SECRET'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.CONNECTED_APPS = 'true';
  process.env.CONNECTED_APPS_ALLOWLIST = 'owner@acme.com';
  process.env.CONNECTED_APPS_STATE_SECRET = 'state-secret-test-0123456789abcdef0123';
  process.env.CONNECTED_APPS_TOKEN_ENC_KEY = 'token-key-test-0123456789abcdef01234567';
  process.env.CONNECTED_APPS_GOOGLE_CLIENT_ID = 'g-id';
  process.env.CONNECTED_APPS_GOOGLE_CLIENT_SECRET = 'g-secret';
  delete process.env.CONNECTED_APPS_MICROSOFT_CLIENT_ID;
  delete process.env.CONNECTED_APPS_MICROSOFT_CLIENT_SECRET;
  h.authed = true;
  h.scope = { kind: 'own', email: 'owner@acme.com' };
  h.save.mockReset();
  h.save.mockImplementation(async (a: { provider: string }) => ({ id: 'conn-1', provider: a.provider, connected_email: 'owner@acme.com', display_name: null, granted_scopes: [], status: 'connected', created_at: '' }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post = (body: unknown) => new NextRequest('https://getmindy.ai/api/app/connected-apps/start', { method: 'POST', body: JSON.stringify(body) });
const startBody = { email: 'owner@acme.com', provider: 'google', capabilities: ['file'], returnTo: '/app?panel=ask' };

/** Start a flow; returns the state and the binding cookie the starting browser received. */
async function start(): Promise<{ state: string; cookie: string }> {
  const { POST } = await import('./start/route');
  const res = await POST(post(startBody));
  const state = new URL((await res.json()).authorize_url).searchParams.get('state')!;
  return { state, cookie: res.cookies.get('mindy_ca_bind')!.value };
}

describe('POST /start', () => {
  it('flag off → 404, unauthenticated → 401, unconfigured provider → 503', async () => {
    const { POST } = await import('./start/route');
    h.authed = false;
    expect((await POST(post(startBody))).status).toBe(401);
    h.authed = true;
    process.env.CONNECTED_APPS_ALLOWLIST = 'someone@else.com';
    expect((await POST(post(startBody))).status).toBe(404);
    process.env.CONNECTED_APPS_ALLOWLIST = 'owner@acme.com';
    expect((await POST(post({ ...startBody, provider: 'microsoft' }))).status).toBe(503);
  });
  it('missing dedicated secrets → 503, never a fallback', async () => {
    const { POST } = await import('./start/route');
    delete process.env.CONNECTED_APPS_TOKEN_ENC_KEY;
    process.env.ADMIN_PASSWORD = 'x'.repeat(40);
    expect((await POST(post(startBody))).status).toBe(503);
    delete process.env.ADMIN_PASSWORD;
  });
  it('sets an HttpOnly, Secure, SameSite=Lax binding cookie scoped to the callback', async () => {
    const { POST } = await import('./start/route');
    const res = await POST(post(startBody));
    const c = res.headers.get('set-cookie') || '';
    expect(c).toMatch(/mindy_ca_bind=/);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toMatch(/Path=\/api\/app\/connected-apps\/callback/);
  });
  it('mail and calendar capabilities are not grantable in this slice', async () => {
    const { POST } = await import('./start/route');
    expect((await POST(post({ ...startBody, capabilities: ['draft', 'calendar'] }))).status).toBe(400);
  });
  it('returns the access note for the provider', async () => {
    const { POST } = await import('./start/route');
    process.env.CONNECTED_APPS_MICROSOFT_CLIENT_ID = 'm-id';
    process.env.CONNECTED_APPS_MICROSOFT_CLIENT_SECRET = 'm-secret';
    const j = await (await POST(post({ ...startBody, provider: 'microsoft' }))).json();
    expect(j.access_note).toMatch(/all of the files in your OneDrive/);
  });
  it('returns the consent URL with PKCE and only the requested capability', async () => {
    const { POST } = await import('./start/route');
    const j = await (await POST(post(startBody))).json();
    const u = new URL(j.authorize_url);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toContain('drive.file');
    expect(u.searchParams.get('scope')).not.toContain('gmail');
  });
  it('an unconfirmed workspace refuses', async () => {
    const { POST } = await import('./start/route');
    h.scope = { kind: 'unavailable', email: 'owner@acme.com' };
    expect((await POST(post(startBody))).status).toBe(409);
  });
  it('binds a client workspace into the state', async () => {
    h.scope = { kind: 'client', email: 'owner@acme.com', workspaceId: 'w-9', vaultEmail: 'v' };
    const { verifyState } = await import('@/lib/connected-apps/oauth');
    const { state, cookie } = await start();
    const v = verifyState(state, cookie);
    expect(v.ok && v.payload.scopeKey).toBe('ws:w-9');
  });
});

describe('GET /callback', () => {
  const cb = (q: string, cookie?: string) => new NextRequest(`https://getmindy.ai/api/app/connected-apps/callback?${q}`, cookie ? { headers: { cookie: `mindy_ca_bind=${cookie}` } } : undefined);
  const okFetch = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('token')
    ? new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid' }))
    : new Response(JSON.stringify({ sub: 'g-123', email: 'Owner@Acme.com', name: 'Owner' })))));
  const loc = (r: Response) => new URL(r.headers.get('location')!);

  it('a tampered or missing state changes nothing', async () => {
    const { GET } = await import('./callback/route');
    const r = await GET(cb('code=x&state=bogus.sig'));
    expect(loc(r).searchParams.get('reason')).toBe('invalid_state');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('a forwarded link opened with NO binding cookie connects nothing', async () => {
    const { state } = await start();
    okFetch();
    const { GET } = await import('./callback/route');
    const r = await GET(cb(`code=c1&state=${encodeURIComponent(state)}`));
    expect(loc(r).searchParams.get('reason')).toBe('browser_mismatch');
    expect(h.save).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a forwarded link opened with ANOTHER browser's cookie connects nothing", async () => {
    const { state } = await start();
    const other = await start();
    okFetch();
    const { GET } = await import('./callback/route');
    const r = await GET(cb(`code=c1&state=${encodeURIComponent(state)}`, other.cookie));
    expect(loc(r).searchParams.get('reason')).toBe('browser_mismatch');
    expect(h.save).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a cancelled consent returns to the conversation with the reason, no save', async () => {
    const { state, cookie } = await start();
    const { GET } = await import('./callback/route');
    const r = await GET(cb(`error=access_denied&state=${encodeURIComponent(state)}`, cookie));
    expect(loc(r).pathname).toBe('/app');
    expect(loc(r).searchParams.get('reason')).toBe('access_denied');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('success: server-side exchange, provider identity, saved under the scope from the state', async () => {
    h.scope = { kind: 'client', email: 'owner@acme.com', workspaceId: 'w-9', vaultEmail: 'v' };
    const { state, cookie } = await start();
    okFetch();
    const { GET } = await import('./callback/route');
    const r = await GET(cb(`code=c1&state=${encodeURIComponent(state)}`, cookie));
    expect(loc(r).searchParams.get('connect')).toBe('ok');
    // One use: the binding cookie is cleared.
    expect(r.headers.get('set-cookie') || '').toMatch(/mindy_ca_bind=;.*Max-Age=0/i);
    expect(loc(r).searchParams.get('panel')).toBe('ask');
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ scopeKey: 'ws:w-9', ownerEmail: 'owner@acme.com', provider: 'google', accountId: 'g-123', email: 'owner@acme.com' }));
  });

  it('a provider failure is a sanitized reason, never a token or body', async () => {
    const { state, cookie } = await start();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'secret detail' }), { status: 400 })));
    const { GET } = await import('./callback/route');
    const r = await GET(cb(`code=c1&state=${encodeURIComponent(state)}`, cookie));
    expect(loc(r).searchParams.get('reason')).toBe('invalid_grant');
    expect(r.headers.get('location')).not.toContain('secret');
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe('GET / DELETE', () => {
  it('list and disconnect run in the acting scope only', async () => {
    const { GET, DELETE } = await import('./route');
    await GET(new NextRequest('https://getmindy.ai/api/app/connected-apps?email=owner@acme.com'));
    expect(h.list).toHaveBeenCalledWith('own:owner@acme.com', 'owner@acme.com');
    await DELETE(new NextRequest('https://getmindy.ai/api/app/connected-apps', { method: 'DELETE', body: JSON.stringify({ email: 'owner@acme.com', id: 'conn-1' }) }));
    expect(h.disconnect).toHaveBeenCalledWith('own:owner@acme.com', 'owner@acme.com', 'conn-1');
  });
  it('in a client workspace, list and disconnect are bound to the calling coach, not just the workspace', async () => {
    h.scope = { kind: 'client', email: 'coach-b@x.com', workspaceId: 'w-9', vaultEmail: 'v' };
    process.env.CONNECTED_APPS_ALLOWLIST = 'coach-b@x.com';
    const { GET, DELETE } = await import('./route');
    await GET(new NextRequest('https://getmindy.ai/api/app/connected-apps?email=coach-b@x.com'));
    expect(h.list).toHaveBeenLastCalledWith('ws:w-9', 'coach-b@x.com');
    await DELETE(new NextRequest('https://getmindy.ai/api/app/connected-apps', { method: 'DELETE', body: JSON.stringify({ email: 'coach-b@x.com', id: 'conn-of-coach-a' }) }));
    expect(h.disconnect).toHaveBeenLastCalledWith('ws:w-9', 'coach-b@x.com', 'conn-of-coach-a');
  });
});
