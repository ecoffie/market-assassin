import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

// The two paid / outward side effects: the chat engine (LLM) and Slack's chat.postMessage.
const generateChatResponse = vi.fn(async () => ({ response: 'answer', model: 'test' }));
vi.mock('@/lib/briefings/chat/engine', () => ({ generateChatResponse }));
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

const SECRET = 'route-test-signing-secret';
const now = () => Math.floor(Date.now() / 1000);
const sign = (b: string, ts: number) => 'v0=' + createHmac('sha256', SECRET).update(`v0:${ts}:${b}`).digest('hex');

let seq = 0;
const mention = () => JSON.stringify({
  type: 'event_callback', event_id: `Ev${Date.now()}${seq++}`,
  event: { type: 'app_mention', user: 'U1', channel: 'C1', text: '<@B1> what is open?', ts: '1.1' },
});
const post = async (rawBody: string, headers: Record<string, string>) => {
  const { POST } = await import('./route');
  return POST(new Request('https://getmindy.ai/api/slack/events', { method: 'POST', body: rawBody, headers }));
};
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
  process.env.SLACK_SIGNING_SECRET = SECRET;
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.SLACK_SIGNING_SECRET; });

describe('Slack events webhook rejects unverifiable requests with zero provider cost', () => {
  const cases: Array<[string, () => [string, Record<string, string>]]> = [
    ['unsigned', () => [mention(), {}]],
    ['malformed signature', () => [mention(), { 'x-slack-request-timestamp': String(now()), 'x-slack-signature': 'garbage' }]],
    ['tampered body', () => { const b = mention(); const ts = now(); return [b.replace('open', 'closed'), { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sign(b, ts) }]; }],
    ['replayed (stale timestamp)', () => { const b = mention(); const ts = now() - 600; return [b, { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sign(b, ts) }]; }],
    ['unsigned url_verification', () => [JSON.stringify({ type: 'url_verification', challenge: 'x' }), {}]],
  ];
  for (const [name, mk] of cases) {
    it(`${name} → 401, no LLM call, no Slack post`, async () => {
      const [b, h] = mk();
      const res = await post(b, h);
      await settle();
      expect(res.status).toBe(401);
      expect(generateChatResponse).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it('fails closed when SLACK_SIGNING_SECRET is unset, even for a request signed with the old secret', async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const b = mention(); const ts = now();
    const res = await post(b, { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sign(b, ts) });
    await settle();
    expect(res.status).toBe(401);
    expect(generateChatResponse).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a correctly signed url_verification returns the challenge', async () => {
    const b = JSON.stringify({ type: 'url_verification', challenge: 'abc123' }); const ts = now();
    const res = await post(b, { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sign(b, ts) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'abc123' });
  });

  it('a correctly signed app_mention is processed (LLM + reply), exactly as before', async () => {
    const b = mention(); const ts = now();
    const res = await post(b, { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sign(b, ts) });
    await settle();
    expect(res.status).toBe(200);
    expect(generateChatResponse).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('chat.postMessage'))).toBe(true);
  });
});
