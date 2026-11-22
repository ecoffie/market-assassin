/**
 * Drives the real lazy-blueprint-sms handler with the real GHL sender and a fake
 * GHL API. A contact GHL refuses with "DND is active" must be counted as opted
 * out and TAGGED, so the 5-minute cron never retries it (it used to log an error
 * and skip the tag, so it retried every run).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { LCB_SMS_STEPS } from '@/lib/events/lazy-blueprint-sms-sequence';

const { changeContactTags, listContactsByTag } = vi.hoisted(() => ({
  changeContactTags: vi.fn(async (..._a: unknown[]) => true),
  listContactsByTag: vi.fn(),
}));

vi.mock('@/lib/ghl/event-registration', () => ({ changeContactTags, listContactsByTag }));

vi.mock('@/lib/events/lazy-blueprint-sms-sequence', async (orig) => {
  const real = await orig<typeof import('@/lib/events/lazy-blueprint-sms-sequence')>();
  return { ...real, dueSmsSteps: () => [real.LCB_SMS_STEPS[0]] };
});

import { GET } from './route';

const step = LCB_SMS_STEPS[0];
const contact = (id: string) => ({ id, firstName: 'Ann', phone: '+15551234567', tags: ['sms-opt-in'], customFields: [] });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

async function run() {
  const req = new NextRequest('https://getmindy.ai/api/cron/lazy-blueprint-sms', { headers: { authorization: 'Bearer sec' } });
  const r = await GET(req);
  return { status: r.status, body: await r.json() };
}

describe('GET /api/cron/lazy-blueprint-sms', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'sec';
    process.env.GHL_API_KEY = 'tok';
    changeContactTags.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.GHL_API_KEY;
  });

  it("tags a contact GHL refuses with 'DND is active' and does not log it as an error", async () => {
    listContactsByTag.mockResolvedValue([contact('dnd1'), contact('ok1')]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return body.contactId === 'dnd1' ? json(400, { statusCode: 400, message: 'DND is active' }) : json(200, { messageId: 'm1' });
    }));

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.data[step.id]).toEqual({ sent: 1, optedOut: 1, failed: 0, remaining: 0 });
    expect(changeContactTags).toHaveBeenCalledWith('dnd1', [step.tag], 'add');
    expect(changeContactTags).toHaveBeenCalledWith('ok1', [step.tag], 'add');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('still leaves a real failure untagged so it retries', async () => {
    listContactsByTag.mockResolvedValue([contact('bad1')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { message: 'Internal error' })));

    const { status, body } = await run();
    expect(status).toBe(207);
    expect(body.data[step.id]).toMatchObject({ sent: 0, optedOut: 0, failed: 1 });
    expect(changeContactTags).not.toHaveBeenCalled();
  });
});
