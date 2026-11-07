/**
 * "Contact sales" form → the team's Slack.
 *
 * Delivery order (first that works wins):
 *   1. SLACK_BOT_TOKEN → chat.postMessage to SLACK_SALES_CHANNEL
 *      (falls back to SLACK_OPS_CHANNEL, then SEO_SLACK_CHANNEL — the channels the bot already posts to)
 *   2. SLACK_LEAD_WEBHOOK_URL (the #leads webhook)
 * If nothing delivers, the caller gets ok:false and must show the visitor the email fallback.
 * A request is never reported as sent unless Slack accepted it.
 */
import { postSlackMessage } from '@/lib/slack/post-message';

export const TEAM_SIZES = ['Just me', '2–10', '11–50', '51–200', '200+'] as const;
export const INTERESTS = ['Team plan', 'Enterprise / API', 'Government agency', 'Partnership', 'Something else'] as const;

export interface ContactSalesInput {
  name: string;
  email: string;
  company: string;
  teamSize: string;
  interest: string;
  phone?: string;
  message: string;
  page?: string;
  /** e.g. 'upgrade25' — an existing member upgrading (25% off the first month). */
  offer?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

/** Validate + normalize a raw body. Returns the input or a list of field errors. */
export function parseContactSales(body: unknown): { ok: true; input: ContactSalesInput } | { ok: false; errors: string[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const input: ContactSalesInput = {
    name: clean(b.name, 120),
    email: clean(b.email, 200).toLowerCase(),
    company: clean(b.company, 160),
    teamSize: clean(b.teamSize, 20),
    interest: clean(b.interest, 40),
    phone: clean(b.phone, 40) || undefined,
    message: clean(typeof b.message === 'string' ? b.message.replace(/\r/g, '') : '', 3000),
    page: clean(b.page, 200) || undefined,
    offer: clean(b.offer, 40) || undefined,
  };
  const errors: string[] = [];
  if (!input.name) errors.push('name');
  if (!EMAIL_RE.test(input.email)) errors.push('email');
  if (!input.company) errors.push('company');
  if (!(TEAM_SIZES as readonly string[]).includes(input.teamSize)) errors.push('teamSize');
  if (!(INTERESTS as readonly string[]).includes(input.interest)) errors.push('interest');
  if (input.message.length < 5) errors.push('message');
  return errors.length ? { ok: false, errors } : { ok: true, input };
}

/** Slack mrkdwn escaping: only &, <, > are special. */
export function slackEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function contactSalesBlocks(i: ContactSalesInput): { text: string; blocks: unknown[] } {
  const e = slackEscape;
  const text = `New sales request from ${i.name} (${i.company})`;
  const fields = [
    `*Name*\n${e(i.name)}`,
    `*Email*\n<mailto:${encodeURIComponent(i.email).replace(/%40/g, '@')}|${e(i.email)}>`,
    `*Company*\n${e(i.company)}`,
    `*Team size*\n${e(i.teamSize)}`,
    `*Interested in*\n${e(i.interest)}`,
    `*Phone*\n${i.phone ? e(i.phone) : '—'}`,
  ];
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `💼 ${text}`.slice(0, 150), emoji: true } },
    { type: 'section', fields: fields.map((t) => ({ type: 'mrkdwn', text: t })) },
    ...(i.offer === 'upgrade25' ? [{ type: 'section', text: { type: 'mrkdwn', text: '*Upgrade offer:* existing member upgrading. Give 25% off the first month.' } }] : []),
    { type: 'section', text: { type: 'mrkdwn', text: `*What they need*\n${e(i.message).slice(0, 2800)}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Contact sales form · getmindy.ai${i.page ? ` · from ${e(i.page)}` : ''} · reply to them by email` }] },
  ];
  return { text, blocks };
}

export async function sendContactSalesToSlack(i: ContactSalesInput): Promise<{ ok: boolean; via?: string; error?: string }> {
  const { text, blocks } = contactSalesBlocks(i);
  const channel = process.env.SLACK_SALES_CHANNEL || process.env.SLACK_OPS_CHANNEL || process.env.SEO_SLACK_CHANNEL;
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
      if (res.ok) return { ok: true, via: 'webhook:leads' };
      errors.push(`webhook:HTTP ${res.status}`);
    } catch (err) {
      errors.push(`webhook:${(err as Error).message}`);
    }
  }
  return { ok: false, error: errors.join('; ') || 'no slack target configured' };
}
