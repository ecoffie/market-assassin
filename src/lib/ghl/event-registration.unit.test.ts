import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerContactForEvent } from './event-registration';

const reg = { firstName: 'Ann', lastName: 'Lee', email: 'Ann@Example.com', phone: '(555) 123-4567', smsConsent: true };

describe('registerContactForEvent', () => {
  beforeEach(() => {
    process.env.GHL_API_KEY = 'tok';
    process.env.GHL_LOCATION_ID = 'loc';
  });
  afterEach(() => {
    delete process.env.GHL_API_KEY;
    delete process.env.GHL_LOCATION_ID;
  });

  it('upserts without tags, then adds the event tag additively', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body || '{}')) });
      return new Response(JSON.stringify({ contact: { id: 'c1' } }), { status: 200 });
    }) as unknown as typeof fetch;

    const r = await registerContactForEvent(reg, { tags: ['MD Lazy Contractors Blueprint'], source: 'x', note: 'n', fetchImpl });
    expect(r).toEqual({ ok: true, contactId: 'c1' });
    expect(calls[0].url).toMatch(/\/contacts\/upsert$/);
    expect(calls[0].body).toMatchObject({ locationId: 'loc', email: 'ann@example.com', phone: '+15551234567' });
    expect(calls[0].body.tags).toBeUndefined();
    expect(calls[1].url).toMatch(/\/contacts\/c1\/tags$/);
    expect(calls[1].body).toEqual({ tags: ['MD Lazy Contractors Blueprint'] });
    expect(calls[2].url).toMatch(/\/contacts\/c1\/notes$/);
  });

  it('fails when the tag write fails (no tag = no workflow)', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      return n === 1
        ? new Response(JSON.stringify({ contact: { id: 'c1' } }), { status: 200 })
        : new Response('nope', { status: 422 });
    }) as unknown as typeof fetch;
    const r = await registerContactForEvent(reg, { tags: ['t'], source: 'x', fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tag 422/);
  });

  it('fails clearly when GHL is not configured', async () => {
    delete process.env.GHL_API_KEY;
    const r = await registerContactForEvent(reg, { tags: ['t'], source: 'x' });
    expect(r).toEqual({ ok: false, error: 'GHL not configured' });
  });
});
