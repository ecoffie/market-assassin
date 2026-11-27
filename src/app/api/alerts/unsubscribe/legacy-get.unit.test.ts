/**
 * Legacy /api/alerts/unsubscribe?email=<anyone> no longer unsubscribes anyone: it writes nothing and, only for an
 * address we hold a settings row for, emails that address its own signed link at most once per 24 h.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ hasRow: true, recentSends: 0, writes: [] as string[], sendEmail: vi.fn(async () => true) }));
vi.mock('@/lib/send-email', () => ({ sendEmail: h.sendEmail }));
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn() }));
vi.mock('@/lib/onboarding/ensure-free-settings-row', () => ({ ensureFreeSettingsRow: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, eq: () => b,
        gte: async () => ({ count: h.recentSends, error: null }),
        update: () => { h.writes.push(table); return b; },
        upsert: async () => { h.writes.push(table); return { error: null }; },
        then: (res: (v: unknown) => void) => res({ count: table === 'user_notification_settings' ? (h.hasRow ? 1 : 0) : 0, error: null }),
      });
      return b;
    },
  }),
}));
process.env.EMAIL_ACTION_SECRET = 'test-secret';

import { GET } from './route';

const get = (qs: string) => {
  const url = new URL(`https://getmindy.ai/api/alerts/unsubscribe?${qs}`);
  const r = new Request(url) as unknown as Parameters<typeof GET>[0];
  (r as unknown as { nextUrl: URL }).nextUrl = url;
  return GET(r);
};

beforeEach(() => { h.hasRow = true; h.recentSends = 0; h.writes.length = 0; h.sendEmail.mockClear(); });

describe('legacy GET ?email=', () => {
  it('writes nothing; emails the owner a signed link; the page never confirms the address exists', async () => {
    const r = await get('email=Pat%40Example.com');
    expect(await r.text()).toContain('Check your inbox');
    expect(h.writes).toEqual([]);
    expect(h.sendEmail).toHaveBeenCalledOnce();
    const arg = (h.sendEmail.mock.calls[0] as unknown as [{ to: string; html: string; transactional: boolean; emailType: string }])[0];
    expect(arg).toMatchObject({ to: 'pat@example.com', transactional: true, emailType: 'unsubscribe_link' });
    expect(arg.html).toMatch(/\/api\/unsubscribe\?e=/);
  });
  it('no settings row → no email (never mails arbitrary addresses), same page', async () => {
    h.hasRow = false;
    expect(await (await get('email=stranger%40x.com')).text()).toContain('Check your inbox');
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
  it('throttled to one link per address per 24 h', async () => {
    h.recentSends = 1;
    await get('email=pat%40example.com');
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
  it('a GET carrying signed e/t is forwarded to /api/unsubscribe (303)', async () => {
    const r = await get('e=abc&t=def&s=daily_alert');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toMatch(/\/api\/unsubscribe\?e=abc&t=def&s=daily_alert$/);
  });
});
