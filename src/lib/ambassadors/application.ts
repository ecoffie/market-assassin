/**
 * Mindy Ambassadors — the public application (getmindy.ai/ambassadors).
 * Validation and the Slack notification. Storage lives in ./store.ts.
 * The program itself (requirements, expectations, terms) is the owner's Ambassador Program
 * document; the page at src/app/ambassadors/page.tsx states it.
 */
import { postSlackMessage } from '@/lib/slack/post-message';

import { ATTESTATION, UEI_RE, normalizeUei } from './constants';

export { ATTESTATION, UEI_RE };

/**
 * The application asks for exactly the five things in Section 9 of the Ambassador Program
 * document, plus a name, an email and the attestation:
 *   1. a link to where you post        → postUrl
 *   2. your company name and UEI       → company, uei
 *   3. the last event you attended     → lastEvent
 *   4. the pursuit in motion right now → pursuit
 *   5. what you would want to find out → wantToFind
 */
export interface AmbassadorApplication {
  name: string;
  email: string;
  postUrl: string;
  company: string;
  uei: string;
  lastEvent: string;
  pursuit: string;
  wantToFind: string;
  /** Ticked "I meet all six requirements and will disclose on every post." */
  attested: true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i;

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\r/g, '').trim().slice(0, max) : '';
}

/** A one-line answer: newlines collapse to spaces. */
function line(v: unknown, max: number): string {
  return clean(v, max).replace(/\s*\n\s*/g, ' ');
}

function cleanUrl(v: unknown): string {
  let s = clean(v, 300);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return URL_RE.test(s) ? s : '__invalid__';
}

const isChecked = (v: unknown) => v === true || v === 'on' || v === 'true' || v === 'yes';

/** Validate + normalize a raw body. Returns the application or the fields that need fixing. */
export function parseAmbassadorApplication(body: unknown): { ok: true; app: AmbassadorApplication } | { ok: false; errors: string[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const fields = {
    name: line(b.name, 120),
    email: line(b.email, 200).toLowerCase(),
    postUrl: cleanUrl(b.postUrl),
    company: line(b.company, 160),
    uei: normalizeUei(line(b.uei, 40)),
    lastEvent: line(b.lastEvent, 300),
    pursuit: line(b.pursuit, 400),
    wantToFind: line(b.wantToFind, 400),
  };
  const errors: string[] = [];
  if (!fields.name) errors.push('name');
  if (!EMAIL_RE.test(fields.email)) errors.push('email');
  if (!fields.postUrl || fields.postUrl === '__invalid__') errors.push('postUrl');
  if (!fields.company) errors.push('company');
  if (!UEI_RE.test(fields.uei)) errors.push('uei');
  if (fields.lastEvent.length < 3) errors.push('lastEvent');
  if (fields.pursuit.length < 10) errors.push('pursuit');
  if (fields.wantToFind.length < 10) errors.push('wantToFind');
  if (!isChecked(b.attested)) errors.push('attested');
  return errors.length ? { ok: false, errors } : { ok: true, app: { ...fields, attested: true } };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function ambassadorSlackMessage(a: AmbassadorApplication): { text: string; blocks: unknown[] } {
  const text = `New ambassador application: ${a.name} (${a.company})`;
  const link = (u: string) => `<${u}|${esc(u.replace(/^https?:\/\//, ''))}>`;
  return {
    text,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🎖️ ${text}`.slice(0, 150), emoji: true } },
      {
        type: 'section',
        fields: [
          `*Name*\n${esc(a.name)}`,
          `*Email*\n${esc(a.email)}`,
          `*Company*\n${esc(a.company)}`,
          `*UEI*\n${esc(a.uei)}`,
          `*Where they post*\n${link(a.postUrl)}`,
          `*Last event attended*\n${esc(a.lastEvent)}`,
        ].map((t) => ({ type: 'mrkdwn', text: t })),
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Pursuit in motion*\n${esc(a.pursuit).slice(0, 2800)}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*What they want to find out*\n${esc(a.wantToFind).slice(0, 2800)}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Attested: meets all six requirements, will disclose on every post · getmindy.ai/ambassadors · approve or reject from /api/admin/ambassadors' }] },
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
