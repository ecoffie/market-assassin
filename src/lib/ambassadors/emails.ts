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
<p style="margin:0 0 14px;">We received your application to the Mindy Ambassador Program. We read every application and we answer either way.</p>
<p style="margin:0;">We are starting with 15 and opening to 50 after the first quarter.</p>`);
  const text = `Thanks, ${first(name)}.\n\nWe received your application to the Mindy Ambassador Program. We read every application and we answer either way.\n\nWe are starting with 15 and opening to 50 after the first quarter.\n\nQuestions? ${SUPPORT_EMAIL}\nGovCon Giants AI · getmindy.ai`;
  return { subject, html, text };
}

/** The exact disclosure wording from Section 6 of the program document. */
export const DISCLOSURE_WORDING = 'Mindy gives me free access to their platform as part of their ambassador program.';

export function renderApproved(name: string, referralLink: string): { subject: string; html: string; text: string } {
  const subject = "You're a Mindy Ambassador";
  const btn = (href: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr><td style="border-radius:9px;background:${NAVY};"><a href="${href}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${label}</a></td></tr></table>`;
  const html = shell(subject, `
<h1 style="margin:0 0 12px;font-size:22px;color:#12161d;">Welcome aboard, ${esc(first(name))}.</h1>
<p style="margin:0 0 14px;">You are now a Mindy Ambassador. Your twelve months start today. Sign in with this email address.</p>
${btn('https://getmindy.ai/opportunity-map', 'Open Mindy')}
<p style="margin:0 0 8px;"><strong>Every month:</strong> four public posts, one a week, each showing a real action you took in Mindy and what came of it. Tag Mindy on every post.</p>
<p style="margin:0 0 8px;"><strong>Disclose on every post</strong>, near the top, in plain words:</p>
<p style="margin:0 0 14px;padding:12px 14px;background:#f4f6fa;border-radius:8px;font-style:italic;">"${DISCLOSURE_WORDING}"</p>
<p style="margin:0 0 14px;">If you link to Mindy in a post, you can use your own link: <a href="${esc(referralLink)}" style="color:${NAVY};">${esc(referralLink)}</a></p>
<p style="margin:0;">The full program, including the claim limits and terms, is at <a href="https://getmindy.ai/ambassadors" style="color:${NAVY};">getmindy.ai/ambassadors</a>.</p>`);
  const text = `Welcome aboard, ${first(name)}.\n\nYou are now a Mindy Ambassador. Your twelve months start today. Sign in with this email address: https://getmindy.ai/opportunity-map\n\nEvery month: four public posts, one a week, each showing a real action you took in Mindy and what came of it. Tag Mindy on every post.\n\nDisclose on every post, near the top, in plain words:\n"${DISCLOSURE_WORDING}"\n\nIf you link to Mindy in a post, you can use your own link: ${referralLink}\n\nThe full program, including the claim limits and terms: https://getmindy.ai/ambassadors\n\nQuestions? ${SUPPORT_EMAIL}\nGovCon Giants AI · getmindy.ai`;
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
