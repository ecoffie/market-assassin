/**
 * Trial onboarding sequence for Mindy Pro / Team free trials (2026-11-13).
 *
 * Day 0  — welcome (sent from the Stripe checkout webhook when the subscription is trialing)
 * Day 1  — book a free 15-minute setup call (sent only once MINDY_SETUP_CALL_URL is set)
 * Day 3  — find who holds the contract now (recompetes)
 * Day 7  — halfway: save a pursuit + reply with questions
 * Day 11 — what Mindy found + the charge reminder (trial-reminder-email.ts). Sent by Stripe's
 *          trial_will_end webhook AND by the daily cron as a fallback; one KV claim covers both.
 *
 * Same white-card look as the trial reminder. Every send is claimed in KV per subscription +
 * step so webhook retries and repeated cron runs never send twice.
 */
import { kv } from '@vercel/kv';
import { sendEmail } from '@/lib/send-email';

const LOGO_URL = 'https://getmindy.ai/brand/mindy-logo-3d.png';
const APP = 'https://getmindy.ai/app';
const SUPPORT_EMAIL = 'admin@getmindy.ai';

export type TrialStep = 'day0' | 'day1' | 'day3' | 'day7';
export const TRIAL_STEP_DAYS: Record<TrialStep, number> = { day0: 0, day1: 1, day3: 3, day7: 7 };

export type TrialContext = {
  email: string;
  firstName?: string | null;
  planLabel: string;        // "Mindy Pro" / "Mindy Team"
  amountUsd: number;        // charged when the trial ends
  interval: 'month' | 'year';
  trialEnd: Date;
};

const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

type Body = {
  subject: string;
  heading: string;
  intro: string;                       // plain text, escaped
  steps?: Array<{ title: string; text: string }>;
  note?: string;
  cta: { label: string; url: string };
};

function hi(c: TrialContext) {
  const n = (c.firstName || '').trim();
  return n ? `Hi ${n},` : 'Hi,';
}

function content(step: TrialStep, c: TrialContext): Body {
  const ends = fmtDate(c.trialEnd);
  const price = `${fmtUsd(c.amountUsd)}/${c.interval === 'year' ? 'yr' : 'mo'}`;
  switch (step) {
    case 'day0':
      return {
        subject: `Welcome to your ${c.planLabel} trial`,
        heading: 'Your free trial has started',
        intro: `${hi(c)} you now have full ${c.planLabel} for 14 days, free. Your trial ends ${ends}. You won't be charged before then, and we'll email you 3 days before it ends.`,
        steps: [
          { title: 'Tell Mindy what you sell', text: 'Add your keywords and NAICS codes so your daily alerts match your business.' },
          { title: 'Open your opportunities', text: 'See open bids, upcoming buys and expiring contracts in your market.' },
          { title: 'Connect Mindy to your AI', text: 'Use Mindy inside Claude or ChatGPT at getmindy.ai/mcp.' },
        ],
        note: `After the trial: ${price}. Cancel anytime in Settings.`,
        cta: { label: 'Set up my profile', url: `${APP}?panel=settings` },
      };
    case 'day1':
      return {
        subject: 'Book your free 15-minute Mindy setup call',
        heading: 'Let us set Mindy up for you',
        intro: `${hi(c)} want to get the most out of your trial? Book a free 15-minute call with our team. We'll set Mindy up for your business so the right contracts come to you.`,
        steps: [
          { title: 'Your alerts, tuned', text: 'We pick the keywords and NAICS codes that match what you sell.' },
          { title: 'Your market, mapped', text: 'See who buys what you sell and which contracts are coming up.' },
          { title: 'Your questions, answered', text: 'Ask anything about Mindy or winning federal work.' },
        ],
        note: 'Free during your trial. Pick any time that works for you.',
        cta: { label: 'Book my call', url: process.env.MINDY_SETUP_CALL_URL || `${APP}?panel=settings` },
      };
    case 'day3':
      return {
        subject: 'See who holds the contract now',
        heading: 'Find contracts coming back up',
        intro: `${hi(c)} most contracts get bid again. Mindy shows which ones in your market expire in the next 12 months, who holds them now, and what they're worth.`,
        steps: [
          { title: 'Open Recompetes', text: 'Filter to your NAICS codes.' },
          { title: 'Pick one to track', text: 'You get months of warning before the bid posts.' },
        ],
        cta: { label: 'Open Recompetes', url: `${APP}?panel=recompetes` },
      };
    case 'day7':
      return {
        subject: 'You\'re halfway through your trial',
        heading: 'One week left',
        intro: `${hi(c)} you're halfway through your ${c.planLabel} trial. It ends ${ends}.`,
        steps: [
          { title: 'Track a pursuit', text: 'Save one opportunity to your pipeline and follow it to the bid.' },
          { title: 'Research a buyer', text: 'Run a market report to see who buys what you sell.' },
          { title: 'Stuck on anything?', text: 'Just reply to this email. A real person reads it.' },
        ],
        cta: { label: 'Open my pipeline', url: `${APP}?panel=pipeline` },
      };
  }
}

export function renderTrialStep(step: TrialStep, c: TrialContext): { subject: string; html: string; text: string } {
  const b = content(step, c);
  const stepsHtml = (b.steps || []).map((s, i) => `
          <tr><td style="padding:0 0 14px;vertical-align:top;width:34px;">
            <div style="width:26px;height:26px;border-radius:13px;background:#efe9fd;color:#7c3aed;font-size:13px;font-weight:700;text-align:center;line-height:26px;">${i + 1}</div>
          </td><td style="padding:0 0 14px;font-size:15px;line-height:1.5;color:#3f4754;"><strong style="color:#12161d;">${esc(s.title)}</strong><br>${esc(s.text)}</td></tr>`).join('');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.subject)}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e9ee;">
      <tr><td style="padding:22px 28px 20px;border-bottom:1px solid #eef0f4;">
        <img src="${LOGO_URL}" width="38" height="38" alt="Mindy" style="vertical-align:middle;border:0;display:inline-block;">
        <span style="vertical-align:middle;color:#12161d;font-size:22px;font-weight:700;padding-left:10px;">Mindy</span>
      </td></tr>
      <tr><td style="padding:30px 28px;">
        <h1 style="margin:0 0 12px;font-size:23px;line-height:1.25;color:#12161d;">${esc(b.heading)}</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3f4754;">${esc(b.intro)}</p>
        ${stepsHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">${stepsHtml}
        </table>` : ''}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 ${b.note ? '18px' : '0'};"><tr><td style="border-radius:9px;background:#7c3aed;">
          <a href="${b.cta.url}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${esc(b.cta.label)} &rarr;</a>
        </td></tr></table>
        ${b.note ? `<p style="margin:0;font-size:13px;line-height:1.55;color:#6b7280;">${esc(b.note)}</p>` : ''}
      </td></tr>
      <tr><td style="padding:20px 28px 26px;border-top:1px solid #eef0f4;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#9aa2b0;">Questions? Reply to this email or write <a href="mailto:${SUPPORT_EMAIL}" style="color:#7c3aed;text-decoration:none;">${SUPPORT_EMAIL}</a><br>GovCon Giants AI · getmindy.ai</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = [
    b.heading, '', b.intro, '',
    ...(b.steps || []).map((s, i) => `${i + 1}. ${s.title} — ${s.text}`),
    ...(b.steps?.length ? [''] : []),
    `${b.cta.label}: ${b.cta.url}`,
    ...(b.note ? ['', b.note] : []),
    '', `Questions? Reply or write ${SUPPORT_EMAIL}`, 'GovCon Giants AI · getmindy.ai',
  ].join('\n');
  return { subject: b.subject, html, text };
}

/** Which step is due for a trial that started at `trialStart` (null = nothing due today). */
export function dueStep(trialStart: Date, nowMs: number): TrialStep | null {
  const days = Math.floor((nowMs - trialStart.getTime()) / 86_400_000);
  for (const s of ['day7', 'day3', 'day1'] as const) {
    // Send on the step's day, or catch up one day late if a run was missed.
    if (days === TRIAL_STEP_DAYS[s] || days === TRIAL_STEP_DAYS[s] + 1) return s;
  }
  return null;
}

/** Send one step once per subscription. Throws on a send failure (claim released for retry). */
export async function sendTrialStepEmail(subscriptionId: string, step: TrialStep, c: TrialContext): Promise<'sent' | 'duplicate'> {
  const key = `trial-onboarding:${subscriptionId}:${step}`;
  let claimed = true;
  try {
    claimed = (await kv.set(key, 1, { nx: true, ex: 30 * 86400 })) === 'OK';
  } catch (err) {
    console.warn('[trial-onboarding] KV claim failed; sending anyway', err);
  }
  if (!claimed) return 'duplicate';
  const m = renderTrialStep(step, c);
  try {
    await sendEmail({
      to: c.email, subject: m.subject, html: m.html, text: m.text,
      emailType: `trial_onboarding_${step}`, eventSource: 'trial_onboarding', transactional: true,
    });
  } catch (err) {
    try { await kv.del(key); } catch { /* best effort */ }
    throw err;
  }
  return 'sent';
}

/** True when the day-1 call email has a real booking link to send people to. */
export function hasBookingUrl(): boolean {
  return !!process.env.MINDY_SETUP_CALL_URL;
}

type SubLike = {
  status: string;
  trial_start?: number | null;
  trial_end?: number | null;
  metadata?: Record<string, string> | null;
  items: { data: Array<{ price?: { id?: string; unit_amount?: number | null; recurring?: { interval?: string } | null } | null }> };
};

/** Email context from a trialing subscription. null when it isn't a usable trial. */
export function trialContextFromSubscription(sub: SubLike, email: string, firstName?: string | null): TrialContext | null {
  if (sub.status !== 'trialing' || !sub.trial_end || !email) return null;
  const item = sub.items.data[0];
  const amount = (item?.price?.unit_amount ?? 0) / 100;
  if (!(amount > 0)) return null;
  const tier = sub.metadata?.tier || '';
  const priceId = item?.price?.id || '';
  const team = tier.startsWith('team') || priceId === 'price_1TZxaaK5zyiZ50PBzhQJ1Pk8' || priceId === 'price_1Uaz3WK5zyiZ50PBKQY8W1WX' || priceId === 'price_1TZxcAK5zyiZ50PBcBg0ZvoV';
  return {
    email,
    firstName: firstName || null,
    planLabel: team ? 'Mindy Team' : 'Mindy Pro',
    amountUsd: amount,
    interval: item?.price?.recurring?.interval === 'year' ? 'year' : 'month',
    trialEnd: new Date(sub.trial_end * 1000),
  };
}

export const firstNameOf = (name?: string | null) => (name || '').trim().split(/\s+/)[0] || null;

type Sb = {
  from(table: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/**
 * What Mindy found for this person since the trial started. Returns null if ANY read fails —
 * the email then shows its plain version, never a fabricated 0.
 */
export async function readTrialFound(sb: Sb, email: string, since: Date): Promise<import('./trial-reminder-email').TrialFound | null> {
  const e = email.toLowerCase().trim();
  const sinceDate = since.toISOString().slice(0, 10);
  try {
    const alerts = await sb.from('alert_log')
      .select('opportunities_count')
      .eq('user_email', e)
      .eq('delivery_status', 'sent')
      .gte('alert_date', sinceDate)
      .limit(1000);
    if (alerts.error || !Array.isArray(alerts.data)) return null;
    const pipeline = await sb.from('user_pipeline')
      .select('id', { count: 'exact', head: true })
      .eq('user_email', e)
      .gte('created_at', since.toISOString());
    if (pipeline.error || pipeline.count == null) return null;
    const rows = alerts.data as Array<{ opportunities_count: number | null }>;
    return {
      alertsSent: rows.length,
      opportunitiesMatched: rows.reduce((s, r) => s + (Number(r.opportunities_count) || 0), 0),
      pursuitsSaved: pipeline.count,
    };
  } catch {
    return null;
  }
}
