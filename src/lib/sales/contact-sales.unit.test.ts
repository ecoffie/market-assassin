import { afterEach, describe, expect, it, vi } from 'vitest';
import { contactSalesBlocks, parseContactSales, sendContactSalesToSlack, slackEscape } from './contact-sales';

const good = { name: 'Jane Doe', email: 'Jane@Acme.com', company: 'Acme', teamSize: '2–10', interest: 'Team plan', message: 'We bid on VA roofing.' };

describe('contact sales form', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('accepts a complete form and lower-cases the email', () => {
    const r = parseContactSales(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.email).toBe('jane@acme.com');
  });

  it('names every missing or invalid field', () => {
    const r = parseContactSales({ email: 'nope', teamSize: 'huge' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sort()).toEqual(['company', 'email', 'interest', 'message', 'name', 'teamSize']);
  });

  it('escapes Slack markup so a visitor cannot inject links or mentions', () => {
    expect(slackEscape('<!channel> & <http://x|y>')).toBe('&lt;!channel&gt; &amp; &lt;http://x|y&gt;');
    const { blocks } = contactSalesBlocks({ ...good, message: '<!here> hi' });
    expect(JSON.stringify(blocks)).not.toContain('<!here>');
  });

  it('reports failure when no Slack target is configured (never a silent success)', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '');
    vi.stubEnv('SLACK_LEAD_WEBHOOK_URL', '');
    const r = await sendContactSalesToSlack(parseContactSales(good).ok ? (parseContactSales(good) as { input: never }).input : (null as never));
    expect(r.ok).toBe(false);
  });

  it('falls back to the leads webhook when the bot post fails', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    vi.stubEnv('SLACK_SALES_CHANNEL', '#sales');
    vi.stubEnv('SLACK_LEAD_WEBHOOK_URL', 'https://hooks.example/leads');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('slack.com/api/chat.postMessage')) return new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }));
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const parsed = parseContactSales(good);
    if (!parsed.ok) throw new Error('bad fixture');
    const r = await sendContactSalesToSlack(parsed.input);
    expect(r).toMatchObject({ ok: true, via: 'webhook:leads' });
  });
});
