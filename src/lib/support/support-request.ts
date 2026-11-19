/**
 * "Get help" support requests → the Mindy team.
 *
 * Used by the help widget on every page (src/lib/support/help-widget.ts) and the /support page.
 *
 * Delivery order (first that works wins):
 *   1. SLACK_BOT_TOKEN → chat.postMessage to SLACK_SUPPORT_CHANNEL
 *      (falls back to SLACK_OPS_CHANNEL, then SLACK_SALES_CHANNEL — channels the bot already posts to)
 *   2. SLACK_LEAD_WEBHOOK_URL
 *   3. Email to the team inbox (SUPPORT_INBOX, default admin@getmindy.ai) through shared sendEmail()
 * A request is never reported as sent unless one of these accepted it. If none did, the caller
 * must show the customer the email fallback.
 *
 * This only notifies the TEAM. It never emails the customer (CLAUDE.md rule 8).
 */
import { postSlackMessage } from '@/lib/slack/post-message';
import { sendEmail } from '@/lib/send-email';

import { SUPPORT_INBOX_DEFAULT, SUPPORT_TOPICS } from './support-topics';

export { SUPPORT_INBOX_DEFAULT, SUPPORT_TOPICS };

export interface SupportRequestInput {
  name?: string;
  email: string;
  topic: string;
  message: string;
  /** Path the customer was on when they asked (no query string). */
  page?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

/** Like clean(), but keeps line breaks so a customer's steps stay readable. */
function cleanMessage(v: unknown): string {
  return typeof v === 'string'
    ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 4000)
    : '';
}

/** Keep only the path: a query string can carry tokens or search terms we don't want in Slack. */
function cleanPage(v: unknown): string {
  const s = clean(v, 300);
  if (!s.startsWith('/')) return '';
  return s.split(/[?#]/)[0].slice(0, 200);
}

/** Validate + normalize a raw body. Returns the input or a list of field errors. */
export function parseSupportRequest(body: unknown): { ok: true; input: SupportRequestInput } | { ok: false; errors: string[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const input: SupportRequestInput = {
    name: clean(b.name, 120) || undefined,
    email: clean(b.email, 200).toLowerCase(),
    topic: clean(b.topic, 60),
    message: cleanMessage(b.message),
    page: cleanPage(b.page) || undefined,
  };
  const errors: string[] = [];
  if (!EMAIL_RE.test(input.email)) errors.push('email');
  if (!(SUPPORT_TOPICS as readonly string[]).includes(input.topic)) errors.push('topic');
  if (input.message.length < 5) errors.push('message');
  return errors.length ? { ok: false, errors } : { ok: true, input };
}

/** Slack mrkdwn escaping: only &, <, > are special. */
export function slackEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function supportBlocks(i: SupportRequestInput): { text: string; blocks: unknown[] } {
  const e = slackEscape;
  const who = i.name ? `${i.name} (${i.email})` : i.email;
  const text = `Help request: ${i.topic} from ${who}`;
  const fields = [
    `*From*\n${i.name ? e(i.name) + '\n' : ''}<mailto:${encodeURIComponent(i.email).replace(/%40/g, '@')}|${e(i.email)}>`,
    `*Topic*\n${e(i.topic)}`,
  ];
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `🛟 ${text}`.slice(0, 150), emoji: true } },
    { type: 'section', fields: fields.map((t) => ({ type: 'mrkdwn', text: t })) },
    { type: 'section', text: { type: 'mrkdwn', text: `*Message*\n${e(i.message).slice(0, 2900)}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Get help · getmindy.ai${i.page ? ` · on ${e(i.page)}` : ''} · goal: first reply within 1 business day` }] },
  ];
  return { text, blocks };
}

export function supportEmail(i: SupportRequestInput): { subject: string; html: string; text: string } {
  const subject = `[Help] ${i.topic} — ${i.email}`.slice(0, 200);
  const head = [`From: ${i.name ? `${i.name} <${i.email}>` : i.email}`, `Topic: ${i.topic}`];
  if (i.page) head.push(`Page: ${i.page}`);
  const text = [...head, '', i.message, '', 'Reply to this email to answer the customer.'].join('\n');
  const html = `<p><b>From:</b> ${htmlEscape(i.name ? `${i.name} <${i.email}>` : i.email)}<br><b>Topic:</b> ${htmlEscape(i.topic)}${i.page ? `<br><b>Page:</b> ${htmlEscape(i.page)}` : ''}</p>`
    + `<p style="white-space:pre-wrap">${htmlEscape(i.message)}</p>`
    + `<p style="color:#5b6470">Reply to this email to answer the customer.</p>`;
  return { subject, html, text };
}

export async function deliverSupportRequest(i: SupportRequestInput): Promise<{ ok: boolean; via?: string; error?: string }> {
  const { text, blocks } = supportBlocks(i);
  const channel = process.env.SLACK_SUPPORT_CHANNEL || process.env.SLACK_OPS_CHANNEL || process.env.SLACK_SALES_CHANNEL;
  const errors: string[] = [];

  if (process.env.SLACK_BOT_TOKEN && channel) {
    try {
      const r = await postSlackMessage({ channel, text, blocks });
      if (r.ok) return { ok: true, via: `bot:${channel}` };
      errors.push(`bot:${r.error}`);
    } catch (err) {
      errors.push(`bot:${(err as Error).message}`);
    }
  }

  const url = process.env.SLACK_LEAD_WEBHOOK_URL;
  if (url) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, blocks }) });
      if (res.ok) return { ok: true, via: 'webhook' };
      errors.push(`webhook:HTTP ${res.status}`);
    } catch (err) {
      errors.push(`webhook:${(err as Error).message}`);
    }
  }

  // Last resort: the team inbox. Reply-To is the customer so "Reply" answers them directly.
  try {
    const mail = supportEmail(i);
    const sent = await sendEmail({
      to: process.env.SUPPORT_INBOX || SUPPORT_INBOX_DEFAULT,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo: i.email,
      emailType: 'support_request',
      eventSource: 'help_widget',
      transactional: true,
    });
    if (sent) return { ok: true, via: 'email' };
    errors.push('email:not accepted');
  } catch (err) {
    errors.push(`email:${(err as Error).message}`);
  }

  return { ok: false, error: errors.join('; ') || 'no delivery target configured' };
}
