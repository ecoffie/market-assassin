import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  authed: true,
  scope: { kind: 'own', email: 'owner@acme.com' } as Record<string, unknown>,
  token: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => (h.authed ? { authenticated: true, email } : { authenticated: false })) }));
vi.mock('@/lib/chat/chat-acting-scope', () => ({ resolveChatActingScope: vi.fn(async () => h.scope) }));
vi.mock('@/lib/connected-apps/store', async (orig) => ({ ...(await orig<typeof import('@/lib/connected-apps/store')>()), accessTokenFor: h.token }));

const ENV = ['CONNECTED_APPS', 'CONNECTED_APPS_ALLOWLIST', 'CONNECTED_APPS_STATE_SECRET', 'CONNECTED_APPS_TOKEN_ENC_KEY', 'NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_PICKER_KEY', 'NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_APP_ID'] as const;
const saved: Record<string, string | undefined> = {};
const connection = { id: 'conn-1', provider: 'google', connected_email: 'owner@acme.com', display_name: null, granted_scopes: [], status: 'connected', created_at: '' };

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.CONNECTED_APPS = 'true';
  process.env.CONNECTED_APPS_ALLOWLIST = 'owner@acme.com';
  process.env.CONNECTED_APPS_STATE_SECRET = 'state-secret-test-0123456789abcdef0123';
  process.env.CONNECTED_APPS_TOKEN_ENC_KEY = 'token-key-test-0123456789abcdef01234567';
  process.env.NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_PICKER_KEY = 'picker-key';
  process.env.NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_APP_ID = '1234567890';
  h.authed = true;
  h.scope = { kind: 'own', email: 'owner@acme.com' };
  h.token.mockReset();
  h.token.mockImplementation(async () => ({ ok: true, token: 'access-tok', provider: 'google', connection }));
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

const post = (path: string, body: unknown) => new NextRequest(`https://getmindy.ai/api/app/connected-apps/${path}`, { method: 'POST', body: JSON.stringify(body) });
const meta = (o: Record<string, unknown> = {}) => vi.fn(async () => new Response(JSON.stringify({ id: 'g1', name: 'Cap Statement', mimeType: 'application/vnd.google-apps.document', webViewLink: 'https://docs.google.com/d/g1', ...o })));

describe('POST /selections', () => {
  it('returns a handle bound to the acting scope, connection and file', async () => {
    vi.stubGlobal('fetch', meta());
    const { POST } = await import('./selections/route');
    const j = await (await POST(post('selections', { email: 'owner@acme.com', connection_id: 'conn-1', file_id: 'g1' }))).json();
    const { verifyFileHandle } = await import('@/lib/connected-apps/files');
    expect(verifyFileHandle(j.file_handle, 'own:owner@acme.com', 'owner@acme.com')).toMatchObject({ ok: true, handle: { connectionId: 'conn-1', fileId: 'g1', provider: 'google' } });
    expect(verifyFileHandle(j.file_handle, 'ws:other', 'owner@acme.com').ok).toBe(false);
    expect(verifyFileHandle(j.file_handle, 'own:owner@acme.com', 'someone-else@acme.com').ok).toBe(false);
    expect(j.file).toMatchObject({ name: 'Cap Statement', connected_account: 'owner@acme.com' });
    expect(h.token).toHaveBeenCalledWith('own:owner@acme.com', 'owner@acme.com', 'conn-1');
  });
  it('an unreadable type is refused (415) and no handle is issued', async () => {
    vi.stubGlobal('fetch', meta({ name: 'logo.png', mimeType: 'image/png' }));
    const { POST } = await import('./selections/route');
    const r = await POST(post('selections', { email: 'owner@acme.com', connection_id: 'conn-1', file_id: 'g1' }));
    expect(r.status).toBe(415);
    expect((await r.json()).file_handle).toBeUndefined();
  });
  it('a connection outside the acting scope is 404; a dead one is 409', async () => {
    const { POST } = await import('./selections/route');
    h.token.mockImplementationOnce(async () => ({ ok: false, reason: 'not_found' }));
    expect((await POST(post('selections', { email: 'owner@acme.com', connection_id: 'x', file_id: 'g1' }))).status).toBe(404);
    h.token.mockImplementationOnce(async () => ({ ok: false, reason: 'reauth_needed' }));
    expect((await POST(post('selections', { email: 'owner@acme.com', connection_id: 'conn-1', file_id: 'g1' }))).status).toBe(409);
  });
  it('gates: unauthenticated 401, flag off 404, unconfirmed workspace 409, no secrets 503', async () => {
    const { POST } = await import('./selections/route');
    const b = { email: 'owner@acme.com', connection_id: 'conn-1', file_id: 'g1' };
    h.authed = false;
    expect((await POST(post('selections', b))).status).toBe(401);
    h.authed = true;
    process.env.CONNECTED_APPS_ALLOWLIST = 'other@x.com';
    expect((await POST(post('selections', b))).status).toBe(404);
    process.env.CONNECTED_APPS_ALLOWLIST = 'owner@acme.com';
    h.scope = { kind: 'unavailable', email: 'owner@acme.com' };
    expect((await POST(post('selections', b))).status).toBe(409);
    h.scope = { kind: 'own', email: 'owner@acme.com' };
    delete process.env.CONNECTED_APPS_TOKEN_ENC_KEY;
    expect((await POST(post('selections', b))).status).toBe(503);
  });
});

describe('POST /picker-token', () => {
  it('returns only a short-lived access token, never cached, plus the public Picker values', async () => {
    const { POST } = await import('./picker-token/route');
    const r = await POST(post('picker-token', { email: 'owner@acme.com', connection_id: 'conn-1' }));
    expect(r.headers.get('cache-control')).toBe('no-store');
    const j = await r.json();
    expect(j).toEqual({ provider: 'google', access_token: 'access-tok', connection_id: 'conn-1', connected_account: 'owner@acme.com', developer_key: 'picker-key', app_id: '1234567890' });
    expect(JSON.stringify(j)).not.toMatch(/refresh/i);
  });
  it('Google Picker without its key/app id is 503', async () => {
    delete process.env.NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_APP_ID;
    const { POST } = await import('./picker-token/route');
    expect((await POST(post('picker-token', { email: 'owner@acme.com', connection_id: 'conn-1' }))).status).toBe(503);
  });
});

describe('POST /browse (OneDrive chooser)', () => {
  const ms = { ...connection, provider: 'microsoft' };
  it('lists the own OneDrive through the server; the Microsoft token is never returned', async () => {
    h.token.mockImplementation(async () => ({ ok: true, token: 'ms-secret-token', provider: 'microsoft', connection: ms }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ value: [{ id: 'f1', name: 'Cap.pdf', size: 5, file: { mimeType: 'application/pdf' } }] }))));
    const { POST } = await import('./browse/route');
    const r = await POST(post('browse', { email: 'owner@acme.com', connection_id: 'conn-1', q: 'cap' }));
    const j = await r.json();
    expect(j.items).toEqual([{ id: 'f1', name: 'Cap.pdf', kind: 'file', size: 5, modified: null }]);
    expect(JSON.stringify(j)).not.toContain('ms-secret-token');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('a Google connection is refused (drive.file uses Google Picker; Mindy does not list a Google drive)', async () => {
    const { POST } = await import('./browse/route');
    expect((await POST(post('browse', { email: 'owner@acme.com', connection_id: 'conn-1' }))).status).toBe(400);
  });
});

describe('POST /picker-token is Google-only', () => {
  it('a Microsoft connection gets no token in the browser', async () => {
    h.token.mockImplementation(async () => ({ ok: true, token: 'ms-secret-token', provider: 'microsoft', connection: { ...connection, provider: 'microsoft' } }));
    const { POST } = await import('./picker-token/route');
    const r = await POST(post('picker-token', { email: 'owner@acme.com', connection_id: 'conn-1' }));
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain('ms-secret-token');
  });
});

describe('shared client workspace: every connection route is bound to the calling coach', () => {
  const coachB = () => { h.scope = { kind: 'client', email: 'coach-b@x.com', workspaceId: 'w-9', vaultEmail: 'v' }; process.env.CONNECTED_APPS_ALLOWLIST = 'coach-b@x.com'; };
  const body = { email: 'coach-b@x.com', connection_id: 'conn-of-coach-a', file_id: 'f1' };
  it.each(['selections', 'browse', 'picker-token'] as const)('%s asks the store for the caller\'s own connection only', async (route) => {
    coachB();
    h.token.mockImplementation(async () => ({ ok: false, reason: 'not_found' }));
    const mod = await import(`./${route}/route`);
    const r = await mod.POST(post(route, body));
    expect(h.token).toHaveBeenLastCalledWith('ws:w-9', 'coach-b@x.com', 'conn-of-coach-a');
    expect(r.status).toBe(404);
  });
});
