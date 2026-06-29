import { sendEmail } from '@/lib/send-email';

/**
 * Mindy Day "Earn Your Way In" — the APEX referral offer (slide 123 of the
 * launch deck). Sent to Mindy Day registrants who did NOT purchase over the
 * weekend. Make one warm intro to your local APEX Accelerator / SBDC / Economic
 * Development Office → we credit your account a full year of Pro ($1,788).
 *
 * Sent through the guarded sendEmail() FROM the verified mail.getmindy.ai domain
 * (inbox delivery), same path as the lifetime offer. Promotional, so it respects
 * the suppression list + daily cap.
 */

const CLAIM_CC = 'eric@govcongiants.com';

const P = (s: string) =>
  `<p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 16px;">${s}</p>`;

// A compact, copy-paste intro template rendered as a bordered "script" card.
const templateCard = (label: string, subjectLine: string, bodyHtml: string) =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; margin: 0 0 16px;"><tr><td style="padding: 18px 20px;">
      <p style="color: #047857; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 10px;">${label}</p>
      <p style="color: #0f172a; font-size: 14px; margin: 0 0 8px;"><strong>Subject:</strong> ${subjectLine}</p>
      <div style="color: #334155; font-size: 14px; line-height: 1.6;">${bodyHtml}</div>
    </td></tr></table>`;

const TEMPLATE_A = templateCard(
  'If you HAVE used Mindy',
  'Quick intro — a tool your clients should see',
  `Hi [Counselor],<br><br>
   I've been using <strong>Mindy</strong> from GovCon Giants — an AI tool that helps small businesses find and pursue the right federal contracts. It's been a real time-saver, and it feels like something a lot of the businesses you work with could use.<br><br>
   I'm looping in <strong>Eric Coffie</strong> (cc'd), who founded it. Would you be open to a short 20–30 min call to see if it's useful for your clients?<br><br>
   Thanks!<br>[Your Name]`,
);

const TEMPLATE_B = templateCard(
  "Haven't tried Mindy yet? Use this",
  'Quick intro — a resource worth a look for your clients',
  `Hi [Counselor],<br><br>
   I wanted to connect you with something I came across through GovCon Giants — an AI tool called <strong>Mindy</strong> that helps small businesses find and pursue federal contracts.<br><br>
   It looks like exactly the kind of resource the businesses you support could use, so I'm introducing you to <strong>Eric Coffie</strong> (cc'd), who founded it.<br><br>
   Eric — meet [Counselor], who counsels small businesses on government contracting locally. Open to a short 20–30 min call?<br><br>
   Thanks!<br>[Your Name]`,
);

export async function sendMindyApexOfferEmail(params: {
  to: string;
  name: string;
}): Promise<boolean> {
  const firstName = (params.name || '').split(' ')[0] || 'there';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>Earn a full year of Mindy Pro</title></head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Not going lifetime today? Make one intro to your local APEX Accelerator and we'll credit your account a full year of Pro — $1,788.</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 16px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
      <tr><td style="background: linear-gradient(135deg, #1e3a8a 0%, #6d28d9 55%, #7c3aed 100%); padding: 38px 32px; text-align: center;">
        <div style="display: inline-block; background-color: rgba(255,255,255,0.2); color: #ffffff; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; padding: 6px 14px; border-radius: 999px; margin-bottom: 16px;">Mindy Day &middot; Earn Your Way In</div>
        <h1 style="color: #ffffff; font-size: 28px; line-height: 1.25; font-weight: 800; margin: 0;">Not going lifetime today?<br>Earn your way in.</h1>
      </td></tr>
      <tr><td style="padding: 30px 32px 8px;">
        ${P(`${firstName} — thanks for being part of Mindy Day.`)}
        ${P(`Here's a way to get Mindy <strong style="color:#0f172a;">Pro free for a full year</strong> without paying a cent: <strong style="color:#0f172a;">introduce me to your local APEX Accelerator, SBDC, or Economic Development Office.</strong>`)}
        ${P(`These offices help thousands of small businesses win government contracts — exactly who Mindy is built for. Set up one meeting for me, and your account gets credited a full year of Pro.`)}
      </td></tr>
      <tr><td style="padding: 8px 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ecfdf5; border: 2px solid #a7f3d0; border-radius: 12px;"><tr><td style="padding: 26px 24px; text-align: center;">
          <p style="color: #047857; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 10px;">Your reward</p>
          <p style="color: #0f172a; font-size: 30px; font-weight: 800; margin: 0 0 4px;">A full year of Pro</p>
          <p style="color: #475569; font-size: 15px; margin: 0 0 8px;"><strong style="color:#0f172a;">$1,788 in savings.</strong></p>
          <p style="color: #047857; font-size: 14px; margin: 0; line-height: 1.6;">Just <strong>CC ${CLAIM_CC}</strong> on the intro to claim it.</p>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding: 26px 32px 0;">
        ${P(`<strong style="color:#0f172a;">It takes 5 minutes.</strong> Pick your local office, send one of the emails below, and CC me. That's it.`)}
        ${TEMPLATE_A}
        ${TEMPLATE_B}
        ${P(`Replace the brackets, hit send, and you're done. I'll take it from there.`)}
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
    subject: `${firstName}, earn a full year of Mindy Pro ($1,788) — one intro`,
    html,
    from: `"Mindy" <${process.env.EMAIL_FROM || 'mindy@mail.getmindy.ai'}>`,
    emailType: 'mindy_apex_offer',
    eventSource: 'mindy_launch',
    tags: { stream: 'mindy_launch' },
  });
}
