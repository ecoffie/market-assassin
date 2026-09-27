/**
 * The signed-in engagement transport must carry the MI auth token.
 *
 * Regression for 2026-08-21 → 09-26: /api/app/engagement began requiring strong auth
 * (#1232) while every /app panel tracker still used navigator.sendBeacon, which cannot
 * set a header. sendBeacon returns true once the request is QUEUED, so the 401 was never
 * seen and pipeline / forecasts / settings / market_research / onboarding telemetry read
 * zero for five weeks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('sendAppEngagement', () => {
  let store: Record<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let beaconMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = {};
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    beaconMock = vi.fn(() => true);
    const localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
    };
    vi.stubGlobal('window', { localStorage });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { sendBeacon: beaconMock });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a keepalive fetch carrying x-mi-auth-token — never a beacon', async () => {
    const token = `${b64url({ email: 'user@example.com' })}.sig`;
    store.mi_beta_auth_token = token;
    const { sendAppEngagement } = await import('./track');

    sendAppEngagement('user@example.com', { eventType: 'page_view', eventSource: 'pipeline', metadata: { panel: 'pipeline' } });

    expect(beaconMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/mindy/engagement');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect((init.headers as Headers).get('x-mi-auth-token')).toBe(token);
    expect(JSON.parse(init.body)).toEqual({
      email: 'user@example.com', eventType: 'page_view', eventSource: 'pipeline', metadata: { panel: 'pipeline' },
    });
  });

  it('sends NOTHING without a session token — it would 401, and identity is never invented', async () => {
    const { sendAppEngagement } = await import('./track');
    sendAppEngagement('user@example.com', { eventType: 'page_view', eventSource: 'pipeline' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beaconMock).not.toHaveBeenCalled();
  });

  it('useAppTracker routes through the authenticated transport', async () => {
    store.mi_beta_auth_token = `${b64url({ email: 'user@example.com' })}.sig`;
    vi.doMock('react', () => ({ useCallback: (fn: unknown) => fn }));
    const { useAppTracker } = await import('./track');
    const track = useAppTracker('user@example.com');
    track('tool_use', 'forecasts', { action: 'search' });
    expect(beaconMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1].headers as Headers).get('x-mi-auth-token')).toBeTruthy();
    vi.doUnmock('react');
  });
});
