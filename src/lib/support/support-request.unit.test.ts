import { afterEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn();
vi.mock('@/lib/send-email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
const postSlackMessage = vi.fn();
vi.mock('@/lib/slack/post-message', () => ({ postSlackMessage: (...a: unknown[]) => postSlackMessage(...a) }));

import { deliverSupportRequest, parseSupportRequest, supportBlocks, supportEmail } from './support-request';
import { helpWidgetScript } from './help-widget';

const good = { email: 'Jane@Acme.com', name: 'Jane', topic: 'Something is broken', message: 'The map\nwill not load.', page: '/opportunity-map?q=secret&token=abc' };
const input = () => { const r = parseSupportRequest(good); if (!r.ok) throw new Error('bad fixture'); return r.input; };

describe('support request', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); sendEmail.mockReset(); postSlackMessage.mockReset(); });

  it('accepts a valid request, lower-cases the email, keeps line breaks, strips the query string', () => {
    const i = input();
    expect(i.email).toBe('jane@acme.com');
    expect(i.message).toBe('The map\nwill not load.');
    expect(i.page).toBe('/opportunity-map');
  });

  it('names every missing or invalid field; name is optional', () => {
    const r = parseSupportRequest({ email: 'nope', topic: 'whatever', message: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sort()).toEqual(['email', 'message', 'topic']);
    expect(parseSupportRequest({ ...good, name: '' }).ok).toBe(true);
  });

  it('drops a page that is not a site path', () => {
    const r = parseSupportRequest({ ...good, page: 'https://evil.example/x' });
    expect(r.ok && r.input.page).toBeFalsy();
  });

  it('escapes Slack markup so a customer cannot inject links or mentions', () => {
    const { blocks } = supportBlocks({ ...input(), message: '<!channel> <http://x|y>' });
    const s = JSON.stringify(blocks);
    expect(s).not.toContain('<!channel>');
    expect(s).not.toContain('<http://x|y>');
  });

  it('escapes HTML in the email fallback', () => {
    const { html } = supportEmail({ ...input(), message: '<script>x</script>' });
    expect(html).not.toContain('<script>');
  });

  it('delivers to Slack first when the bot is configured', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'x');
    vi.stubEnv('SLACK_SUPPORT_CHANNEL', 'C123');
    postSlackMessage.mockResolvedValue({ ok: true });
    const r = await deliverSupportRequest(input());
    expect(r).toEqual({ ok: true, via: 'bot:C123' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to the team inbox, with Reply-To set to the customer, never to the customer', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '');
    vi.stubEnv('SLACK_LEAD_WEBHOOK_URL', '');
    sendEmail.mockResolvedValue(true);
    const r = await deliverSupportRequest(input());
    expect(r).toEqual({ ok: true, via: 'email' });
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.to).toBe('admin@getmindy.ai');
    expect(arg.replyTo).toBe('jane@acme.com');
  });

  it('reports failure when nothing accepted it (never a silent success)', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '');
    vi.stubEnv('SLACK_LEAD_WEBHOOK_URL', '');
    sendEmail.mockResolvedValue(false);
    const r = await deliverSupportRequest(input());
    expect(r.ok).toBe(false);
  });
});

describe('help widget script', () => {
  it('is valid JavaScript and has no raw </script> breakout', () => {
    const s = helpWidgetScript();
    expect(() => new Function(s)).not.toThrow();
    expect(s.toLowerCase()).not.toContain('</script');
  });

  it('posts to /api/support and skips admin, the support page and embeds', () => {
    const s = helpWidgetScript();
    expect(s).toContain('/api/support');
    expect(s).toContain('admin|support|oauth');
    expect(s).toContain('embed=');
  });
});
