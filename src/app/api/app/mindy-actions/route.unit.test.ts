/**
 * The server never performs an unconfirmed write, and session auth runs before anything else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { ok: true } as { ok: boolean; response?: Response },
  createSavedSearch: vi.fn(),
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }));
vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: () => h.auth }));
vi.mock('@/lib/app/workspace', () => ({
  getAppSupabase: () => ({ from: () => ({}) }),
  recordAppActivity: vi.fn(async () => {}),
  resolveActiveWorkspace: vi.fn(async () => ({ workspaceId: 'ws', asClient: false })),
  clientNotificationEmail: () => 'c@x',
}));
vi.mock('@/lib/saved-searches', () => ({ createSavedSearch: h.createSavedSearch, updateSavedSearch: vi.fn() }));
vi.mock('@/lib/pipeline/create-pursuit', () => ({ createCanonicalPursuit: vi.fn() }));
vi.mock('@/lib/pipeline/remove-pursuit', () => ({ removeOwnedPursuit: vi.fn() }));

import { POST } from './route';

const req = (body: unknown) => new Request('https://getmindy.ai/api/app/mindy-actions', { method: 'POST', body: JSON.stringify(body) }) as unknown as Parameters<typeof POST>[0];
const SAVE = { email: 'pat@example.com', action_id: 'a1', name: 'save_search', args: { name: 'n', filters: {} } };

beforeEach(() => {
  h.auth = { ok: true };
  h.createSavedSearch.mockReset();
  h.createSavedSearch.mockResolvedValue({ ok: true, data: { search: { id: 's', name: 'n', alerts_enabled: true, alert_frequency: 'daily' }, idempotent: false } });
});

describe('POST /api/app/mindy-actions', () => {
  it('rejects an unconfirmed write and writes nothing', async () => {
    for (const confirmed of [undefined, false, 'true', 1]) {
      const r = await POST(req({ ...SAVE, confirmed }));
      expect(r.status).toBe(400);
      expect((await r.json()).error_code).toBe('confirmation_required');
    }
    expect(h.createSavedSearch).not.toHaveBeenCalled();
  });
  it('auth failure returns the session response before anything else', async () => {
    h.auth = { ok: false, response: new Response('{}', { status: 401 }) };
    const r = await POST(req({ ...SAVE, confirmed: true }));
    expect(r.status).toBe(401);
    expect(h.createSavedSearch).not.toHaveBeenCalled();
  });
  it('an unknown action is refused', async () => {
    const r = await POST(req({ ...SAVE, name: 'delete_everything', confirmed: true }));
    expect(r.status).toBe(400);
    expect((await r.json()).error_code).toBe('invalid_action');
  });
  it('a confirmed save runs through the saved-search service', async () => {
    const r = await POST(req({ ...SAVE, confirmed: true }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, action_id: 'a1', message: "Saved 'n' · daily alerts" });
    expect(h.createSavedSearch).toHaveBeenCalledOnce();
  });
});
