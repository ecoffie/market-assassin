/**
 * Trial-ending reminder, sent BY MINDY (not Stripe) through the shared sendEmail() — Resend,
 * mail.getmindy.ai. Triggered by Stripe's `customer.subscription.trial_will_end` webhook,
 * which Stripe fires 3 days before a trial ends. The pricing page promises this email
 * ("We remind you before you're charged"), so it must exist and must fire once.
 */
import { kv } from '@vercel/kv';
import { sendEmail } from '@/lib/send-email';

const LOGO_URL = 'https://getmindy.ai/brand/mindy-logo-3d.png';
const BILLING_URL = 'https://getmindy.ai/app?panel=settings';
const SUPPORT_EMAIL = 'admin@getmindy.ai';

export type TrialReminder = {
  email: string;
  planLabel: string;        // "Mindy Pro" / "Mindy Team"
  amountUsd: number;        // charged when the trial ends
  interval: 'month' | 'year';
  trialEnd: Date;
};

const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function renderTrialReminder(r: TrialReminder): { subject: string; html: string; text: string } {
  const when = fmtDate(r.trialEnd);
  const price = `${fmtUsd(r.amountUsd)}/${r.interval === 'year' ? 'yr' : 'mo'}`;
  const subject = `Your ${r.planLabel} trial ends ${when}`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e9ee;">
      <tr><td style="padding:22px 28px 20px;border-bottom:1px solid #eef0f4;">
        <img src="${LOGO_URL}" width="38" height="38" alt="Mindy" style="vertical-align:middle;border:0;display:inline-block;">
        <span style="vertical-align:middle;color:#12161d;font-size:22px;font-weight:700;padding-left:10px;">Mindy</span>
      </td></tr>
      <tr><td style="padding:30px 28px;">
        <h1 style="margin:0 0 12px;font-size:23px;line-height:1.25;color:#12161d;">Your free trial ends in 3 days</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3f4754;">Your <strong>${r.planLabel}</strong> trial ends on <strong>${when}</strong>. After that, the card on file will be charged <strong>${price}</strong> and your access keeps going without a break.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f7f7fb;border-radius:10px;">
          <tr><td style="padding:14px 16px;font-size:14px;color:#3f4754;">Plan</td><td style="padding:14px 16px;font-size:14px;color:#12161d;text-align:right;font-weight:600;">${r.planLabel}</td></tr>
          <tr><td style="padding:0 16px 14px;font-size:14px;color:#3f4754;">First charge</td><td style="padding:0 16px 14px;font-size:14px;color:#12161d;text-align:right;font-weight:600;">${price} on ${when}</td></tr>
        </table>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3f4754;">Nothing to do if you're staying. Don't want to continue? Cancel before ${when} and you won't be charged.</p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:9px;background:#7c3aed;">
          <a href="${BILLING_URL}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Manage my plan &rarr;</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:20px 28px 26px;border-top:1px solid #eef0f4;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#9aa2b0;">Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:#7c3aed;text-decoration:none;">${SUPPORT_EMAIL}</a><br>GovCon Giants AI · getmindy.ai</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = `Your free trial ends in 3 days\n\nYour ${r.planLabel} trial ends on ${when}. After that, the card on file will be charged ${price}.\n\nNothing to do if you're staying. Cancel before ${when} and you won't be charged: ${BILLING_URL}\n\nQuestions? ${SUPPORT_EMAIL}\nGovCon Giants AI · getmindy.ai`;
  return { subject, html, text };
}

/**
 * Send once per subscription trial (Stripe retries webhooks, so a KV claim keys the send on
 * the subscription id + trial end). Throws on a send failure so the webhook returns non-2xx and
 * Stripe retries; the claim is released first so the retry can send.
 */
export async function sendTrialReminderEmail(subscriptionId: string, r: TrialReminder): Promise<'sent' | 'duplicate'> {
  const key = `trial-reminder:${subscriptionId}:${Math.floor(r.trialEnd.getTime() / 1000)}`;
  let claimed = true;
  try {
    claimed = (await kv.set(key, 1, { nx: true, ex: 30 * 86400 })) === 'OK';
  } catch (err) {
    console.warn('[trial-reminder] KV claim failed; sending anyway', err);
  }
  if (!claimed) return 'duplicate';
  const m = renderTrialReminder(r);
  try {
    await sendEmail({
      to: r.email, subject: m.subject, html: m.html, text: m.text,
      emailType: 'trial_ending_reminder', eventSource: 'stripe_trial_will_end', transactional: true,
    });
  } catch (err) {
    try { await kv.del(key); } catch { /* best effort */ }
    throw err;
  }
  return 'sent';
}

/** Plan label from the subscription's price id or tier metadata. */
export function trialPlanLabel(priceId: string | undefined, tier: string | undefined): string {
  if (tier?.startsWith('team') || priceId === 'price_1TZxaaK5zyiZ50PBzhQJ1Pk8' || priceId === 'price_1Uaz3WK5zyiZ50PBKQY8W1WX') return 'Mindy Team';
  return 'Mindy Pro';
}
