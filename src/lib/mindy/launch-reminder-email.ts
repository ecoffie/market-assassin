import { sendEmail } from '@/lib/send-email';
import { MINDY_DAY } from '@/lib/mindy/mindy-day';

/**
 * Mindy Launch DAY-OF reminder emails — see MINDY_DAY for the current date/time.
 *
 * Sent through the GUARDED sendEmail() FROM the Resend-verified mail.getmindy.ai
 * domain (same sender as the confirmation) so it lands in the inbox. The funnels
 * path (alerts@govcongiants.com) is NOT Resend-verified and gets spam-filtered —
 * these reminders deliberately route through here instead.
 *
 * Two variants:
 *   'reminder' — punchy: header + Zoom link card + one line + sign-off (the 7:30 AM send)
 *   'live'     — ultra-short "we're live, jump in" (the 9:55 AM send)
 *
 * Marked transactional: it's the join link for an event the person registered for.
 * The Zoom details are hardcoded (one-time dated event, fixed public link).
 */

const ZOOM_URL = 'https://us06web.zoom.us/j/89280506481?pwd=zFol5CPiXUW5PtO51FhDlwbuWrLQVi.1';
const ZOOM_MEETING_ID = '892 8050 6481';
const ZOOM_PASSCODE = '206225';

export async function sendMindyLaunchReminderEmail(params: {
  to: string;
  name: string;
  variant?: 'reminder' | 'live';
}): Promise<boolean> {
  const firstName = (params.name || '').split(' ')[0] || 'there';

  if (params.variant === 'live') {
    const liveHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>We're live — join the Mindy Launch now</title></head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">We're going live right now — tap to join the Mindy Launch.</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 16px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
      <tr><td style="background: linear-gradient(135deg, #1e3a8a 0%, #6d28d9 55%, #7c3aed 100%); padding: 36px 32px; text-align: center;">
        <div style="display: inline-block; background-color: rgba(255,255,255,0.2); color: #ffffff; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; padding: 6px 14px; border-radius: 999px; margin-bottom: 16px;">&#128308;&nbsp; We&rsquo;re live now</div>
        <h1 style="color: #ffffff; font-size: 28px; line-height: 1.25; font-weight: 800; margin: 0;">We&rsquo;re live, ${firstName} &mdash; jump in.</h1>
      </td></tr>
      <tr><td style="padding: 32px; text-align: center;">
        <a href="${ZOOM_URL}" style="display: inline-block; background-color: #7c3aed; color: #ffffff; padding: 18px 44px; border-radius: 10px; text-decoration: none; font-weight: 800; font-size: 18px;">Join Now</a>
        <p style="color: #64748b; font-size: 13px; margin: 18px 0 0; line-height: 1.6;">Meeting ID: <strong style="color:#0f172a;">${ZOOM_MEETING_ID}</strong> &nbsp;&middot;&nbsp; Passcode: <strong style="color:#0f172a;">${ZOOM_PASSCODE}</strong></p>
        <p style="color: #94a3b8; font-size: 12px; margin: 14px 0 0;"><a href="${ZOOM_URL}" style="color:#7c3aed;text-decoration:none;word-break:break-all;">${ZOOM_URL}</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    return sendEmail({
      to: params.to,
      subject: `🔴 We're live — join the Mindy Launch now`,
      html: liveHtml,
      from: `"Mindy" <${process.env.EMAIL_FROM || 'mindy@mail.getmindy.ai'}>`,
      emailType: 'mindy_launch_reminder',
      eventSource: 'mindy_launch',
      transactional: true,
      tags: { stream: 'mindy_launch' },
    });
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>The Mindy Launch is today — your join link is inside</title></head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">The Mindy Launch starts today at 10 AM ET. Your Zoom link, Meeting ID, and passcode are inside.</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 16px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
      <tr><td style="background: linear-gradient(135deg, #1e3a8a 0%, #6d28d9 55%, #7c3aed 100%); padding: 36px 32px; text-align: center;">
        <div style="display: inline-block; background-color: rgba(255,255,255,0.2); color: #ffffff; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; padding: 6px 14px; border-radius: 999px; margin-bottom: 16px;">&#9679;&nbsp; Today &middot; 10 AM ET</div>
        <h1 style="color: #ffffff; font-size: 28px; line-height: 1.25; font-weight: 800; margin: 0;">The Mindy Launch is today.</h1>
      </td></tr>
      <tr><td style="padding: 30px 32px 8px;">
        <p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 16px;">${firstName} &mdash; we go live at <strong style="color:#0f172a;">10 AM ET</strong>. Here&rsquo;s your link:</p>
      </td></tr>
      <tr><td style="padding: 0 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f3ff; border: 2px solid #ddd6fe; border-radius: 12px;"><tr><td style="padding: 26px 24px; text-align: center;">
          <p style="color: #1e293b; font-size: 18px; font-weight: 800; margin: 0 0 4px;">${MINDY_DAY.dateLabel.replace(', 2026', '')}</p>
          <p style="color: #475569; font-size: 14px; margin: 0 0 16px;">10:00 AM &ndash; 1:00 PM ET</p>
          <a href="${ZOOM_URL}" style="display: inline-block; background-color: #7c3aed; color: #ffffff; padding: 18px 40px; border-radius: 10px; text-decoration: none; font-weight: 800; font-size: 18px;">Join on Zoom</a>
          <p style="color: #64748b; font-size: 13px; margin: 18px 0 0; line-height: 1.6;">Meeting ID: <strong style="color:#0f172a;">${ZOOM_MEETING_ID}</strong> &nbsp;&middot;&nbsp; Passcode: <strong style="color:#0f172a;">${ZOOM_PASSCODE}</strong></p>
          <p style="color: #64748b; font-size: 13px; margin: 8px 0 0; line-height: 1.6;">Or paste this in your browser:<br><a href="${ZOOM_URL}" style="color:#7c3aed;text-decoration:none;word-break:break-all;">${ZOOM_URL}</a></p>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding: 24px 32px 8px;">
        <p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 16px;">Bring one real keyword from your industry &mdash; we&rsquo;ll run live searches on it. Can&rsquo;t stay? Join when you can; you&rsquo;ll get the recording.</p>
        <p style="color: #334155; font-size: 16px; line-height: 1.65; margin: 0 0 4px;">See you at 10,</p>
        <p style="color: #0f172a; font-size: 16px; line-height: 1.5; font-weight: 700; margin: 16px 0 0;">Eric Coffie</p>
        <p style="color: #64748b; font-size: 14px; margin: 2px 0 0;">GovCon Giants</p>
      </td></tr>
      <tr><td style="padding: 28px 32px; text-align: center;">
        <p style="color: #94a3b8; font-size: 11px; margin: 0;"><a href="https://getmindy.ai" style="color: #7c3aed; text-decoration: none;">getmindy.ai</a> &middot; GovCon Giants</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return sendEmail({
    to: params.to,
    subject: `${firstName}, the Mindy Launch starts today at 10 AM ET — your link is inside`,
    html,
    from: `"Mindy" <${process.env.EMAIL_FROM || 'mindy@mail.getmindy.ai'}>`,
    emailType: 'mindy_launch_reminder',
    eventSource: 'mindy_launch',
    transactional: true,
    tags: { stream: 'mindy_launch' },
  });
}
