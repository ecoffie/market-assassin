import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerContactForEvent } from './event-registration';

const reg = { firstName: 'Ann', lastName: 'Lee', email: 'Ann@Example.com', phone: '(555) 123-4567', smsConsent: true };
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const bad = (status: number) => new Response('nope', { status });

type Call = { method: string; url: string; body: Record<string, unknown> };
function fake(route: (c: Call, i: number) => Response) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const c = { method: String(init?.method || 'GET'), url, body: init?.body ? JSON.parse(String(init.body)) : {} };
    calls.push(c);
    return route(c, calls.length - 1);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('registerContactForEvent', () => {
  beforeEach(() => { process.env.GHL_API_KEY = 'tok'; process.env.GHL_LOCATION_ID = 'loc'; });
  afterEach(() => { delete process.env.GHL_API_KEY; delete process.env.GHL_LOCATION_ID; });

  it('updates the contact that owns the EMAIL, then adds the tag and note', async () => {
    const { f, calls } = fake((c) => (c.url.includes('/search/duplicate') ? ok({ contact: { id: 'c1' } }) : ok({ contact: { id: 'c1' } })));
    const r = await registerContactForEvent(reg, { tags: ['MD Lazy Contractors Blueprint'], source: 'x', note: 'n', fetchImpl: f });
    expect(r).toEqual({ ok: true, contactId: 'c1' });
    expect(calls[0].url).toContain('/contacts/search/duplicate?locationId=loc&email=ann%40example.com');
    expect(calls[1]).toMatchObject({ method: 'PUT', url: expect.stringMatching(/\/contacts\/c1$/) });
    expect(calls[1].body).toMatchObject({ email: 'ann@example.com', phone: '+15551234567' });
    expect(calls[1].body.locationId).toBeUndefined();
    expect(calls[2]).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/contacts\/c1\/tags$/), body: { tags: ['MD Lazy Contractors Blueprint'] } });
    expect(calls[3].url).toMatch(/\/contacts\/c1\/notes$/);
  });

  it('creates a new contact when the email is new, and drops a phone GHL refuses', async () => {
    const { f, calls } = fake((c, i) => {
      if (c.url.includes('/search/duplicate')) return ok({ contact: null });
      if (c.method === 'POST' && c.url.endsWith('/contacts/')) return c.body.phone ? bad(400) : ok({ contact: { id: 'new1' } });
      return ok({});
    });
    const r = await registerContactForEvent(reg, { tags: ['t'], source: 'x', fetchImpl: f });
    expect(r).toEqual({ ok: true, contactId: 'new1' });
    const creates = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/contacts/'));
    expect(creates).toHaveLength(2);
    expect(creates[0].body).toMatchObject({ locationId: 'loc', email: 'ann@example.com', phone: '+15551234567' });
    expect(creates[1].body.phone).toBeUndefined();
  });

  it('fails when the tag write fails (no tag = no workflow)', async () => {
    const { f } = fake((c) => (c.url.endsWith('/tags') ? bad(422) : ok({ contact: { id: 'c1' } })));
    const r = await registerContactForEvent(reg, { tags: ['t'], source: 'x', fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tag 422/);
  });

  it('fails clearly when GHL is not configured', async () => {
    delete process.env.GHL_API_KEY;
    expect(await registerContactForEvent(reg, { tags: ['t'], source: 'x' })).toEqual({ ok: false, error: 'GHL not configured' });
  });
});
