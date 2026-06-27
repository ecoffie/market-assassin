import { sendEmail } from '@/lib/send-email';

/**
 * Mindy Launch POST-WEBINAR Founders Lifetime offer — sent after the June 27
 * live launch wraps. This is the offer email (pricing lives HERE, never in the
 * pre-event reminders).
 *
 * Grounded in the launch close slide:
 *   - To do what Mindy does → $280,000+/yr (BD data sub + proposal writer +
 *     capture manager + market analyst).
 *   - PRO $149/mo · TEAM $499/mo.
 *   - Founders Lifetime $4,997 → $2,997 because you showed up for Mindy Day
 *     (save $2,000), only 100 seats, ends Saturday June 27. → getmindy.ai/lifetime
 *
 * Sent through the guarded sendEmail() FROM the verified mail.getmindy.ai domain
 * (inbox delivery). NOT transactional (it's promotional), so it respects the
 * suppression list + daily cap like other Mindy marketing.
 */

const LIFETIME_URL = 'https://getmindy.ai/lifetime';

/**
 * The 4-phase offer sequence. Headline deadline is "tonight" (matches the deck),
 * then an HONEST extension through Monday — framed as a real extension, not a
 * fake-reset deadline.
 */
type LifetimePhase = 'deal' | 'lastcall' | 'extension' | 'finalclose';

const P = (s: string) =>
  `<p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 16px;">${s}</p>`;

/**
 * Each phase does a DIFFERENT job so the sequence never repeats itself:
 *   deal       — the offer + the math (here's what we showed you)
 *   lastcall   — kill the risk objection (30-day money-back + try it free now)
 *   extension  — permission + "pays for itself in ~20 months, then free forever"
 *   finalclose — short loss-framing (after tonight it's monthly only)
 * Only verifiable facts: $149/mo, 2997÷149≈20 months, 30-day money-back, free trial.
 */
const PHASE_COPY: Record<LifetimePhase, {
  subject: (n: string) => string;
  badge: string;
  deadlineLine: string;
  /** Body above the offer card. */
  intro: (n: string) => string;
  /** Body below the offer card (ends before the Eric sign-off). */
  outro: string;
}> = {
  deal: {
    subject: (n) => `${n}, your Mindy Founders Lifetime deal — ends tonight`,
    badge: 'Mindy Day Founders Deal · Ends tonight',
    deadlineLine: 'Today only — through tonight, Saturday, June 27.',
    intro: (n) =>
      P(`${n} — thanks for being there today.`) +
      P(`To do by hand what Mindy does &mdash; a market analyst, a capture manager, a proposal writer, a BD-data subscription &mdash; runs <strong style="color:#0f172a;">$280,000+ a year</strong>. Mindy is <strong style="color:#0f172a;">$149/month</strong>.`) +
      P(`Because you showed up for Mindy Day, you can skip the monthly entirely and own it for life:`),
    outro:
      P(`Prefer monthly? <strong style="color:#0f172a;">Pro $149/mo</strong> or <strong style="color:#0f172a;">Team $499/mo</strong> (your whole shop) &mdash; both there too. But the lifetime price is a Mindy Day thing, and it ends with today.`),
  },
  lastcall: {
    subject: (n) => `${n}, one worry stopping you? (it's risk-free)`,
    badge: 'Risk-Free · Ends at midnight tonight',
    deadlineLine: 'Founders price ends at midnight tonight, June 27.',
    intro: (n) =>
      P(`${n} &mdash; if you&rsquo;re on the fence about the Founders Lifetime, it&rsquo;s almost always the same worry: &ldquo;will it actually work for <em>my</em> business?&rdquo;`) +
      P(`So let&rsquo;s take the risk off the table completely:`) +
      P(`&bull;&nbsp; <strong style="color:#0f172a;">30-day money-back guarantee.</strong> Claim your seat, use Mindy on your real pipeline, and if it&rsquo;s not for you, email us inside 30 days for a full refund.`) +
      P(`&bull;&nbsp; <strong style="color:#0f172a;">Try it free right now.</strong> Mindy&rsquo;s live at getmindy.ai &mdash; run your own NAICS or a contract you care about before you decide.`),
    outro:
      P(`You can&rsquo;t really lose here: try it free, claim it risk-free, and keep it for life. But the Founders price goes at midnight.`),
  },
  extension: {
    subject: (n) => `${n}, you asked — extended (and it pays for itself)`,
    badge: 'Extended · Final seats',
    deadlineLine: 'Extended — final seats, through tonight (Monday, June 29).',
    intro: (n) =>
      P(`${n} &mdash; a few of you needed a day to think it over. Fair. $2,997 once is a real decision, so we extended the Founders price through tonight.`) +
      P(`Here&rsquo;s the math that makes it easy: at <strong style="color:#0f172a;">$149/month</strong>, you&rsquo;d cross $2,997 in about <strong style="color:#0f172a;">20 months</strong> &mdash; and keep paying every month after. Pay once now, and everything past month 20 is free, for life.`) +
      P(`Still want to kick the tires? Mindy&rsquo;s free to try at getmindy.ai, and the lifetime seat is 30-day money-back. Here it is:`),
    outro:
      P(`This is a genuine extension &mdash; and the last one. When the final seats go, the lifetime price goes with them.`),
  },
  finalclose: {
    subject: (n) => `Final hours, ${n} — lifetime closes tonight`,
    badge: 'Final hours · Closes at midnight',
    deadlineLine: 'Closes for good at midnight tonight (Monday, June 29).',
    intro: (n) =>
      P(`${n} &mdash; last call, for real this time.`) +
      P(`After tonight, lifetime goes away and Mindy is monthly only. At $149/mo you&rsquo;d pass $2,997 in about 20 months &mdash; and never stop paying. Lock it in once, tonight, and you&rsquo;re done:`),
    outro:
      P(`Still 30-day money-back, so the only real risk is letting the price close. After midnight, it&rsquo;s gone.`),
  },
};

export async function sendMindyLaunchLifetimeEmail(params: {
  to: string;
  name: string;
  phase?: LifetimePhase;
}): Promise<boolean> {
  const firstName = (params.name || '').split(' ')[0] || 'there';
  const phase = params.phase ?? 'deal';
  const copy = PHASE_COPY[phase];

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>Mindy Founders Lifetime — today only</title></head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Lifetime access to Mindy for a one-time price — only through tonight. $4,997 → $2,997 because you showed up.</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 16px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
      <tr><td style="background: linear-gradient(135deg, #1e3a8a 0%, #6d28d9 55%, #7c3aed 100%); padding: 38px 32px; text-align: center;">
        <div style="display: inline-block; background-color: rgba(255,255,255,0.2); color: #ffffff; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; padding: 6px 14px; border-radius: 999px; margin-bottom: 16px;">${copy.badge}</div>
        <h1 style="color: #ffffff; font-size: 28px; line-height: 1.25; font-weight: 800; margin: 0;">Mindy, for life &mdash; one time.</h1>
      </td></tr>
      <tr><td style="padding: 30px 32px 8px;">
        ${copy.intro(firstName)}
      </td></tr>
      <tr><td style="padding: 8px 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f3ff; border: 2px solid #ddd6fe; border-radius: 12px;"><tr><td style="padding: 28px 24px; text-align: center;">
          <p style="color: #5b21b6; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 10px;">Founders Lifetime &middot; only 100 seats</p>
          <p style="margin: 0 0 4px;"><span style="color: #94a3b8; font-size: 20px; font-weight: 700; text-decoration: line-through;">$4,997</span> &nbsp; <span style="color: #0f172a; font-size: 38px; font-weight: 800;">$2,997</span></p>
          <p style="color: #475569; font-size: 14px; margin: 0 0 18px;">once &mdash; Mindy is yours for life. <strong style="color:#0f172a;">You save $2,000.</strong></p>
          <a href="${LIFETIME_URL}" style="display: inline-block; background-color: #7c3aed; color: #ffffff; padding: 18px 44px; border-radius: 10px; text-decoration: none; font-weight: 800; font-size: 18px;">Claim Your Lifetime Seat</a>
          <p style="color: #64748b; font-size: 13px; margin: 16px 0 0; line-height: 1.6;">${copy.deadlineLine}<br><a href="${LIFETIME_URL}" style="color:#7c3aed;text-decoration:none;">getmindy.ai/lifetime</a></p>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding: 26px 32px 8px;">
        ${copy.outro}
        <p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 4px;">Talk soon,</p>
        <p style="color: #0f172a; font-size: 16px; line-height: 1.5; font-weight: 700; margin: 16px 0 0;">Eric Coffie</p>
        <p style="color: #64748b; font-size: 14px; margin: 2px 0 0;">Founder, GovCon Giants</p>
      </td></tr>
      <tr><td style="padding: 28px 32px; text-align: center;">
        <p style="color: #94a3b8; font-size: 11px; margin: 0;"><a href="https://getmindy.ai" style="color: #7c3aed; text-decoration: none;">getmindy.ai</a> &middot; GovCon Giants</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return sendEmail({
    to: params.to,
    subject: copy.subject(firstName),
    html,
    from: `"Mindy" <${process.env.EMAIL_FROM || 'mindy@mail.getmindy.ai'}>`,
    emailType: 'mindy_launch_lifetime',
    eventSource: 'mindy_launch',
    tags: { stream: 'mindy_launch' },
  });
}
