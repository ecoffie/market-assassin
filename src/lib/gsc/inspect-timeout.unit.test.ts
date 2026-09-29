import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ token: async () => 'tok' as string | null }));
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getAccessToken() {
      return auth.token();
    }
  },
}));

type Handler = (url: string, init?: RequestInit) => Promise<Response>;
let handler: Handler;

beforeEach(() => {
  vi.resetModules();
  auth.token = async () => 'tok';
  vi.stubGlobal('fetch', ((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch);
});
afterEach(() => vi.unstubAllGlobals());

const sites = () => new Response(JSON.stringify({ siteEntry: [{ siteUrl: 'sc-domain:getmindy.ai' }] }), { status: 200 });
const hangUntilAborted = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

describe('gscInspectUrl timeout', () => {
  it('a stalled inspection request returns a transient timeout (status 0) and is aborted', async () => {
    let signal: AbortSignal | undefined;
    handler = async (url, init) => {
      if (url.includes('/webmasters/v3/sites')) return sites();
      signal = init?.signal ?? undefined;
      return hangUntilAborted(init);
    };
    const { gscInspectUrl } = await import('./client');
    const started = Date.now();
    const r = await gscInspectUrl('https://getmindy.ai/a', { timeoutMs: 50 });
    expect(r).toEqual({ ok: false, status: 0, error: 'timed out after 50ms' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(signal?.aborted).toBe(true);
  });

  it('a stalled token fetch is bounded by the same deadline', async () => {
    auth.token = () => new Promise(() => {});
    handler = async () => sites();
    const { gscInspectUrl } = await import('./client');
    await expect(gscInspectUrl('https://getmindy.ai/a', { timeoutMs: 50 })).resolves.toMatchObject({ ok: false, status: 0 });
  });

  it('returns the inspection result normally, and defaults to a finite timeout', async () => {
    handler = async (url) =>
      url.includes('/webmasters/v3/sites')
        ? sites()
        : new Response(JSON.stringify({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } }), { status: 200 });
    const { gscInspectUrl, GSC_INSPECT_TIMEOUT_MS } = await import('./client');
    expect(await gscInspectUrl('https://getmindy.ai/a')).toEqual({ ok: true, result: { verdict: 'PASS' } });
    expect(GSC_INSPECT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(GSC_INSPECT_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('keeps HTTP errors distinct from timeouts', async () => {
    handler = async (url) => (url.includes('/webmasters/v3/sites') ? sites() : new Response('quota', { status: 429 }));
    const { gscInspectUrl } = await import('./client');
    expect(await gscInspectUrl('https://getmindy.ai/a', { timeoutMs: 1_000 })).toEqual({ ok: false, status: 429, error: 'quota' });
  });
});
