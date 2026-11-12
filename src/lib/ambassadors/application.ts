/**
 * Mindy Ambassadors — the public application (getmindy.ai/ambassadors).
 * Validation and the Slack notification. Storage lives in ./store.ts.
 */
import { postSlackMessage } from '@/lib/slack/post-message';

import { AUDIENCE_SIZES } from './constants';

export { AUDIENCE_SIZES };

export interface AmbassadorApplication {
  name: string;
  email: string;
  company: string;
  role: string;
  linkedinUrl?: string;
  websiteUrl?: string;
  audienceSize: string;
  audience: string;
  why: string;
  promotePlan: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i;

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\r/g, '').trim().slice(0, max) : '';
}

function cleanUrl(v: unknown): string | undefined {
  let s = clean(v, 300);
  if (!s) return undefined;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return URL_RE.test(s) ? s : '__invalid__';
}

/** Validate + normalize a raw body. Returns the application or the fields that need fixing. */
export function parseAmbassadorApplication(body: unknown): { ok: true; app: AmbassadorApplication } | { ok: false; errors: string[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const app: AmbassadorApplication = {
    name: clean(b.name, 120),
    email: clean(b.email, 200).toLowerCase(),
    company: clean(b.company, 160),
    role: clean(b.role, 120),
    linkedinUrl: cleanUrl(b.linkedinUrl),
    websiteUrl: cleanUrl(b.websiteUrl),
    audienceSize: clean(b.audienceSize, 40),
    audience: clean(b.audience, 1500),
    why: clean(b.why, 2000),
    promotePlan: clean(b.promotePlan, 2000),
  };
  const errors: string[] = [];
  if (!app.name) errors.push('name');
  if (!EMAIL_RE.test(app.email)) errors.push('email');
  if (!app.role) errors.push('role');
  if (app.linkedinUrl === '__invalid__') errors.push('linkedinUrl');
  if (app.websiteUrl === '__invalid__') errors.push('websiteUrl');
  if (!(AUDIENCE_SIZES as readonly string[]).includes(app.audienceSize)) errors.push('audienceSize');
  if (app.audience.length < 10) errors.push('audience');
  if (app.why.length < 10) errors.push('why');
  if (app.promotePlan.length < 10) errors.push('promotePlan');
  return errors.length ? { ok: false, errors } : { ok: true, app };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function ambassadorSlackMessage(a: AmbassadorApplication): { text: string; blocks: unknown[] } {
  const text = `New ambassador application: ${a.name}${a.company ? ` (${a.company})` : ''}`;
  const link = (u?: string) => (u ? `<${u}|${esc(u.replace(/^https?:\/\//, ''))}>` : '—');
  return {
    text,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🎖️ ${text}`.slice(0, 150), emoji: true } },
      {
        type: 'section',
        fields: [
          `*Name*\n${esc(a.name)}`,
          `*Email*\n${esc(a.email)}`,
          `*Role*\n${esc(a.role)}`,
          `*Company*\n${a.company ? esc(a.company) : '—'}`,
          `*LinkedIn*\n${link(a.linkedinUrl)}`,
          `*Website*\n${link(a.websiteUrl)}`,
          `*Audience size*\n${esc(a.audienceSize)}`,
        ].map((t) => ({ type: 'mrkdwn', text: t })),
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Who they reach*\n${esc(a.audience).slice(0, 2800)}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*Why they want in*\n${esc(a.why).slice(0, 2800)}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*How they would share Mindy*\n${esc(a.promotePlan).slice(0, 2800)}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Ambassadors form · getmindy.ai/ambassadors · approve or reject from /api/admin/ambassadors' }] },
    ],
  };
}

/** Best effort: the application is already saved, so a Slack failure never fails the request. */
export async function notifySlackOfApplication(a: AmbassadorApplication): Promise<boolean> {
  const { text, blocks } = ambassadorSlackMessage(a);
  const channel = process.env.SLACK_SALES_CHANNEL || process.env.SLACK_OPS_CHANNEL || process.env.SEO_SLACK_CHANNEL;
  try {
    if (process.env.SLACK_BOT_TOKEN && channel) {
      const r = await postSlackMessage({ channel, text, blocks });
      if (r.ok) return true;
    }
    const url = process.env.SLACK_LEAD_WEBHOOK_URL;
    if (url) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, blocks }) });
      return res.ok;
    }
  } catch (err) {
    console.error('[ambassadors] slack notify failed:', (err as Error).message);
  }
  return false;
}
