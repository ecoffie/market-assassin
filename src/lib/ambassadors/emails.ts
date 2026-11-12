/**
 * Mindy Ambassadors — transactional emails: "application received" and "you're approved".
 * Sent through the shared sendEmail() (Resend, mail.getmindy.ai). Never throw to the caller.
 */
import { sendEmail } from '@/lib/send-email';

const SUPPORT_EMAIL = 'admin@getmindy.ai';
const NAVY = '#1B3A6B';

function shell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e9ee;">
<tr><td style="background:${NAVY};padding:18px 28px;"><img src="https://getmindy.ai/brand/mindy-logo-3d.png" alt="Mindy" width="32" height="32" style="vertical-align:middle;border:0;"> <span style="color:#ffffff;font-size:17px;font-weight:700;vertical-align:middle;margin-left:8px;">Mindy Ambassadors</span></td></tr>
<tr><td style="padding:30px 28px;font-size:15px;line-height:1.6;color:#3f4754;">${body}</td></tr>
<tr><td style="padding:18px 28px 24px;border-top:1px solid #eef0f4;font-size:12px;line-height:1.6;color:#8a92a0;">Questions? Just reply, or email <a href="mailto:${SUPPORT_EMAIL}" style="color:${NAVY};">${SUPPORT_EMAIL}</a>.<br>GovCon Giants AI · getmindy.ai</td></tr>
</table></td></tr></table></body></html>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const first = (name: string) => (name.trim().split(/\s+/)[0] || 'there');

export function renderApplicationReceived(name: string): { subject: string; html: string; text: string } {
  const subject = 'We got your Mindy Ambassador application';
  const html = shell(subject, `
<h1 style="margin:0 0 12px;font-size:22px;color:#12161d;">Thanks, ${esc(first(name))}.</h1>
<p style="margin:0 0 14px;">We received your application to the Mindy Ambassadors program. Our team reviews every application by hand, and we will email you with a decision.</p>
<p style="margin:0;">If you are approved, you get unlimited Mindy, a direct line to the product team, and your own referral link to earn from.</p>`);
  const text = `Thanks, ${first(name)}.\n\nWe received your application to the Mindy Ambassadors program. Our team reviews every application by hand, and we will email you with a decision.\n\nIf you are approved, you get unlimited Mindy, a direct line to the product team, and your own referral link to earn from.\n\nQuestions? ${SUPPORT_EMAIL}\nGovCon Giants AI · getmindy.ai`;
  return { subject, html, text };
}

export function renderApproved(name: string, referralLink: string): { subject: string; html: string; text: string } {
  const subject = "You're a Mindy Ambassador";
  const btn = (href: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr><td style="border-radius:9px;background:${NAVY};"><a href="${href}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${label}</a></td></tr></table>`;
  const html = shell(subject, `
<h1 style="margin:0 0 12px;font-size:22px;color:#12161d;">Welcome aboard, ${esc(first(name))}.</h1>
<p style="margin:0 0 14px;">You are now a Mindy Ambassador. Here is what that means:</p>
<p style="margin:0 0 8px;"><strong>1. Unlimited Mindy.</strong> Your account has Mindy Pro, and you are never charged credits, in the app or in your AI. Sign in with this email address.</p>
${btn('https://getmindy.ai/opportunity-map', 'Open Mindy')}
<p style="margin:0 0 14px;"><strong>2. Your feedback shapes the product.</strong> Reply to this email any time with what works, what doesn't and what you wish Mindy did. You'll go straight to the team building it.</p>
<p style="margin:0 0 8px;"><strong>3. Your referral link.</strong> Share it with your audience. Everyone who signs up through it is tracked to you. We'll share the earnings details with you soon.</p>
<p style="margin:0 0 18px;padding:12px 14px;background:#f4f6fa;border-radius:8px;font-family:Menlo,monospace;font-size:14px;word-break:break-all;"><a href="${esc(referralLink)}" style="color:${NAVY};">${esc(referralLink)}</a></p>
<p style="margin:0;">Thank you for helping contractors find and win federal work.</p>`);
  const text = `Welcome aboard, ${first(name)}.\n\nYou are now a Mindy Ambassador:\n\n1. Unlimited Mindy. Your account has Mindy Pro, and you are never charged credits, in the app or in your AI. Sign in with this email address: https://getmindy.ai/opportunity-map\n\n2. Your feedback shapes the product. Reply to this email any time with what works, what doesn't and what you wish Mindy did.\n\n3. Your referral link. Share it with your audience. Everyone who signs up through it is tracked to you. We'll share the earnings details with you soon.\n${referralLink}\n\nThank you for helping contractors find and win federal work.\n\nQuestions? ${SUPPORT_EMAIL}\nGovCon Giants AI · getmindy.ai`;
  return { subject, html, text };
}

async function send(to: string, r: { subject: string; html: string; text: string }, emailType: string): Promise<boolean> {
  try {
    return await sendEmail({ to, subject: r.subject, html: r.html, text: r.text, replyTo: SUPPORT_EMAIL, emailType, eventSource: 'ambassadors', transactional: true });
  } catch (err) {
    console.error(`[ambassadors] ${emailType} email failed:`, to, (err as Error).message);
    return false;
  }
}

export const sendApplicationReceivedEmail = (to: string, name: string) => send(to, renderApplicationReceived(name), 'ambassador_application_received');
export const sendApprovedEmail = (to: string, name: string, referralLink: string) => send(to, renderApproved(name, referralLink), 'ambassador_approved');
