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

const PHASE_COPY: Record<LifetimePhase, {
  subject: (n: string) => string;
  badge: string;
  deadlineLine: string;
  opener: (n: string) => string;
  ps: string;
}> = {
  deal: {
    subject: (n) => `${n}, your Mindy Founders Lifetime deal — ends tonight`,
    badge: 'Mindy Day Founders Deal · Ends tonight',
    deadlineLine: 'Today only — through tonight, Saturday, June 27.',
    opener: (n) => `${n} — thanks for being there today.`,
    ps: 'Only 100 founders get this. Once the seats are gone, or the day ends, the lifetime price is gone',
  },
  lastcall: {
    subject: (n) => `Last call, ${n} — Mindy Founders Lifetime ends at midnight`,
    badge: 'Last Call · Ends at midnight tonight',
    deadlineLine: 'Final hours — the Founders price ends at midnight tonight (June 27).',
    opener: (n) => `${n} — quick one before the day closes out.`,
    ps: 'This is the last email tonight. At midnight the lifetime price is gone',
  },
  extension: {
    subject: (n) => `${n}, you asked — Founders Lifetime extended (final seats)`,
    badge: 'Extended · Final seats',
    deadlineLine: 'A few of you asked for more time, so we extended it — but only through tonight, Monday June 29.',
    opener: (n) => `${n} — a few of you needed a day to think it over, and I get it. $2,997 once is a real decision.`,
    ps: "This is a genuine extension — and the last one. When the final seats go, that's it",
  },
  finalclose: {
    subject: (n) => `Final hours, ${n} — Mindy Founders Lifetime closes tonight`,
    badge: 'Final hours · Closes at midnight',
    deadlineLine: 'This is it — the Founders price closes for good at midnight tonight (Monday, June 29).',
    opener: (n) => `${n} — last call, for real this time.`,
    ps: 'After tonight the lifetime option is gone — it goes back to monthly only',
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
        <p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 16px;">${copy.opener(firstName)}</p>
        <p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 16px;">To do by hand what Mindy does for you &mdash; a market analyst, a capture manager, a proposal writer, and a BD-data subscription &mdash; you&rsquo;d spend <strong style="color:#0f172a;">$280,000+ a year</strong>. Mindy is <strong style="color:#0f172a;">$149/month</strong>. A market analyst, a capture manager, and a proposal writer that never sleep &mdash; and never make up a number.</p>
        <p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 4px;">Because you showed up for Mindy Day, you can skip the monthly entirely:</p>
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
        <p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 16px;">Prefer monthly? That&rsquo;s here too &mdash; <strong style="color:#0f172a;">Pro $149/mo</strong> (one seat) or <strong style="color:#0f172a;">Team $499/mo</strong> (your whole shop). But the lifetime price is a Mindy Day thing, and it ends with today.</p>
        <p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 16px;">A solo shop that competes like a prime &mdash; the firepower of a BD department, for the price of a phone bill.</p>
        <p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 4px;">Talk soon,</p>
        <p style="color: #0f172a; font-size: 16px; line-height: 1.5; font-weight: 700; margin: 16px 0 0;">Eric Coffie</p>
        <p style="color: #64748b; font-size: 14px; margin: 2px 0 0;">Founder, GovCon Giants</p>
        <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 18px 0 0;"><strong style="color:#0f172a;">P.S.</strong> ${copy.ps} &mdash; <a href="${LIFETIME_URL}" style="color:#7c3aed;text-decoration:none;">grab yours now</a>.</p>
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
