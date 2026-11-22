import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isGhlSmsOptOut, sendSmsToContact } from './sms';

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('isGhlSmsOptOut', () => {
  it('treats STOP/unsubscribed and DND refusals as opt-outs', () => {
    expect(isGhlSmsOptOut({ canonicalCode: 'CONVERSATIONS_MSG_UNSUBSCRIBED_SMS' })).toBe(true);
    expect(isGhlSmsOptOut({ message: 'Contact has unsubscribed from SMS' })).toBe(true);
    expect(isGhlSmsOptOut({ message: 'DND is active' })).toBe(true);
    expect(isGhlSmsOptOut({ message: 'Cannot send message as DND is active for SMS.' })).toBe(true);
  });

  it('does not treat real failures as opt-outs', () => {
    expect(isGhlSmsOptOut({ message: 'Invalid phone number' })).toBe(false);
    expect(isGhlSmsOptOut({ message: 'The token is not authorized for this scope.' })).toBe(false);
    expect(isGhlSmsOptOut({})).toBe(false);
    expect(isGhlSmsOptOut(null)).toBe(false);
  });
});

describe('sendSmsToContact', () => {
  beforeEach(() => { process.env.GHL_API_KEY = 'tok'; });
  afterEach(() => { delete process.env.GHL_API_KEY; });

  it("reports GHL's 'DND is active' refusal as optedOut", async () => {
    const f = vi.fn(async () => res(400, { statusCode: 400, message: 'DND is active' })) as unknown as typeof fetch;
    const r = await sendSmsToContact('c1', 'hi', f);
    expect(r).toMatchObject({ success: false, contactId: 'c1', optedOut: true, error: 'DND is active' });
  });

  it('keeps a real failure as a failure', async () => {
    const f = vi.fn(async () => res(500, { message: 'Internal error' })) as unknown as typeof fetch;
    const r = await sendSmsToContact('c1', 'hi', f);
    expect(r).toMatchObject({ success: false, optedOut: false, error: 'Internal error' });
  });
});
