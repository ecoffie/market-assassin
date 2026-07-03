import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMIApiHeaders, authedFetch } from './authHeaders';

/**
 * authedFetch is the fix for the "Missing two-factor session" error class
 * (memory: authed_fetch_401_class). Two behaviors MUST hold or the whole class
 * comes back: (1) it always attaches the MI auth header, and (2) on a 401 it
 * re-mints the token via /api/auth/refresh-mi-session and retries ONCE.
 */

const TOKEN = 'tok_abc.sig';

beforeEach(() => {
  // jsdom-free: stub the two browser globals authHeaders touches.
  const store: Record<string, string> = { mi_beta_auth_token: TOKEN };
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } });
  vi.stubGlobal('localStorage', (globalThis as any).window.localStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getMIApiHeaders', () => {
  it('attaches the auth token + user email header', () => {
    const h = getMIApiHeaders('user@example.com') as Headers;
    expect(h.get('x-mi-auth-token')).toBe(TOKEN);
    expect(h.get('x-user-email')).toBe('user@example.com');
  });

  it('merges an init header (e.g. Content-Type) without dropping auth', () => {
    const h = getMIApiHeaders('user@example.com', { 'Content-Type': 'application/json' }) as Headers;
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('x-mi-auth-token')).toBe(TOKEN);
  });
});

describe('authedFetch', () => {
  it('sends the auth header on the first request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authedFetch('/api/app/workspace', 'user@example.com');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const hdrs = init.headers as Headers;
    expect(hdrs.get('x-mi-auth-token')).toBe(TOKEN);
  });

  it('does NOT retry on a 200 (happy path = exactly one call)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch('/api/app/workspace', 'user@example.com');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('on 401 → re-mints via refresh-mi-session, stores the new token, retries once', async () => {
    const NEW_TOKEN = 'tok_fresh.sig';
    const fetchMock = vi.fn()
      // 1st: the gated call 401s (expired token)
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      // 2nd: the refresh call succeeds and hands back a new token
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessionToken: NEW_TOKEN }), { status: 200 }))
      // 3rd: the retried gated call now succeeds
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch('/api/app/workspace', 'user@example.com');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // the refresh endpoint was hit
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh-mi-session');
    // the fresh token was persisted for future calls
    expect((globalThis as any).localStorage.getItem('mi_beta_auth_token')).toBe(NEW_TOKEN);
  });

  it('retries at most ONCE — a still-401 after refresh returns the 401 (no infinite loop)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessionToken: 'tok_new.sig' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('still unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch('/api/app/workspace', 'user@example.com');

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3); // original + refresh + one retry, then stop
  });

  it('if the refresh itself fails, falls through with the original 401 (no throw)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('nope', { status: 500 })); // refresh dies
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch('/api/app/workspace', 'user@example.com');

    expect(res.status).toBe(401);
    // original + refresh attempt, but NO retry (refresh wasn't ok)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
