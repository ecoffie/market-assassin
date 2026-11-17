import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const register = vi.fn();
vi.mock('@/lib/ghl/event-registration', () => ({ registerContactForEvent: (...a: unknown[]) => register(...a) }));

import { POST } from './route';
import { EVENT_PLAN_GHL_TAG, EVENT_PLAN_TEMPLATE_URL } from '@/lib/events/event-action-plan';

const post = (body: unknown) => POST(new NextRequest('http://x/api/event-action-plan', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/event-action-plan', () => {
  beforeEach(() => { register.mockReset(); register.mockResolvedValue({ ok: true }); });

  it('tags the contact and returns the template URL', async () => {
    const res = await post({ firstName: 'Ana', email: 'ANA@example.com', eventName: 'Industry Day' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, templateUrl: EVENT_PLAN_TEMPLATE_URL });
    const [reg, opts] = register.mock.calls[0];
    expect(reg.email).toBe('ana@example.com');
    expect(opts.tags).toContain(EVENT_PLAN_GHL_TAG);
    expect(opts.note).toContain('Preparing for: Industry Day');
  });

  it('rejects a missing name or bad email without writing to GHL', async () => {
    expect((await post({ email: 'a@b.co' })).status).toBe(400);
    expect((await post({ firstName: 'A', email: 'nope' })).status).toBe(400);
    expect(register).not.toHaveBeenCalled();
  });

  it('fails the sign-up when GHL fails, so no lead is silently lost', async () => {
    register.mockResolvedValue({ ok: false, error: 'down' });
    const res = await post({ firstName: 'A', email: 'a@b.co' });
    expect(res.status).toBe(502);
    expect((await res.json()).success).toBe(false);
  });

  it('honeypot: answers success but writes nothing', async () => {
    const res = await post({ firstName: 'Bot', email: 'b@b.co', website: 'spam.example' });
    expect(res.status).toBe(200);
    expect(register).not.toHaveBeenCalled();
  });
});
