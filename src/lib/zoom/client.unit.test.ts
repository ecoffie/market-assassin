import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addZoomRegistrant, getZoomAttendance, resetZoomTokenCache } from './client';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('Zoom client', () => {
  beforeEach(() => {
    process.env.ZOOM_ACCOUNT_ID = 'acc';
    process.env.ZOOM_CLIENT_ID = 'id';
    process.env.ZOOM_CLIENT_SECRET = 'sec';
    resetZoomTokenCache();
  });
  afterEach(() => { delete process.env.ZOOM_ACCOUNT_ID; delete process.env.ZOOM_CLIENT_ID; delete process.env.ZOOM_CLIENT_SECRET; });

  it('gets a token, registers, and returns the personal join link', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes('oauth') ? json({ access_token: 't', expires_in: 3600 }) : json({ join_url: 'https://zoom.us/w/1?tk=abc', registrant_id: 'r1' }, 201);
    }) as unknown as typeof fetch;
    const r = await addZoomRegistrant('webinar', '123', { email: 'a@x.com', firstName: 'A' }, f);
    expect(r).toEqual({ joinUrl: 'https://zoom.us/w/1?tk=abc', registrantId: 'r1' });
    expect(calls[1]).toBe('https://api.zoom.us/v2/webinars/123/registrants');
  });

  it('sums time per email across rejoins and pages', async () => {
    let n = 0;
    const f = vi.fn(async (url: string) => {
      if (url.includes('oauth')) return json({ access_token: 't', expires_in: 3600 });
      n++;
      return n === 1
        ? json({ participants: [{ user_email: 'A@x.com', duration: 100 }, { user_email: '', duration: 50 }], next_page_token: 'p2' })
        : json({ participants: [{ user_email: 'a@x.com', duration: 30 }], next_page_token: '' });
    }) as unknown as typeof fetch;
    const r = await getZoomAttendance('meeting', '9', f);
    expect(r.participants).toEqual([{ email: 'a@x.com', seconds: 130 }]);
    expect(r.withoutEmail).toBe(1);
  });
});
