import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENV = { ...process.env };

async function load() {
  vi.resetModules();
  return (await import('./ops-alert')).sendOpsAlert;
}

describe('sendOpsAlert channel routing', () => {
  beforeEach(() => {
    for (const k of ['SLACK_BOT_TOKEN','SLACK_OPS_CHANNEL','SEO_SLACK_CHANNEL','SLACK_OPS_WEBHOOK_URL','SLACK_LEAD_WEBHOOK_URL']) delete process.env[k];
    vi.restoreAllMocks();
  });
  afterEach(() => { process.env = { ...ENV }; });

  it('NEVER posts to #seo when no ops channel is set (the 2026-08-21 PII leak)', async () => {
    // The old default was `SLACK_OPS_CHANNEL || SEO_SLACK_CHANNEL || '#seo'`, which sent
    // customer emails + purchase amounts into a 14-member content channel.
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: async () => ({ ok: true }) } as never);
    const sendOpsAlert = await load();
    await sendOpsAlert({ subject: 'customer list', html: 'a@b.com $6,000' });
    const targets = fetchSpy.mock.calls.map((c) => JSON.stringify(c[1] ?? {}));
    expect(targets.some((t) => t.includes('#seo'))).toBe(false);
  });

  it('does NOT inherit SEO_SLACK_CHANNEL', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SEO_SLACK_CHANNEL = '#seo';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: async () => ({ ok: true }) } as never);
    const sendOpsAlert = await load();
    await sendOpsAlert({ subject: 'x', html: 'y' });
    const targets = fetchSpy.mock.calls.map((c) => JSON.stringify(c[1] ?? {}));
    expect(targets.some((t) => t.includes('#seo'))).toBe(false);
  });

  it('posts to SLACK_OPS_CHANNEL when explicitly set', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_OPS_CHANNEL = '#mindy-alerts';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: async () => ({ ok: true }) } as never);
    const sendOpsAlert = await load();
    const r = await sendOpsAlert({ subject: 'x', html: 'y' });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(fetchSpy.mock.calls[0][1])).toContain('#mindy-alerts');
  });

  it('drops the alert (loudly) rather than guessing a channel', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sendOpsAlert = await load();
    const r = await sendOpsAlert({ subject: 'nowhere to go', html: 'x' });
    expect(r.ok).toBe(false);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('DROPPED');
  });
});
