/**
 * Registration confirmation for The Lazy Contractor's Blueprint.
 *
 * Sent by the register route right after the GHL write succeeds, through the shared
 * sendEmail() (Resend, mail.getmindy.ai — the only allowed Mindy sender). Transactional:
 * the registrant expects it in direct response to signing up.
 *
 * The join link is NOT here (it isn't set yet); this email confirms the seat, adds the
 * event to their calendar, and says the link comes before we go live.
 */
import { sendEmail } from '@/lib/send-email';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Sat Nov 28, 2026 · 11:00 AM–3:00 PM ET (EST, UTC-5) = 16:00–20:00 UTC. */
export const LAZY_BLUEPRINT_CALENDAR_DATES = '20261128T160000Z/20261128T200000Z';

export function lazyBlueprintCalendarUrl(): string {
  return (
    'https://www.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(`${EVENT.title} — Free Live Event`) +
    '&dates=' + LAZY_BLUEPRINT_CALENDAR_DATES +
    '&details=' +
    encodeURIComponent(
      `Free live event with Eric Coffie: the easiest way to win federal contracts, with Mindy doing the heavy lifting.\n\nShow up live to get $50 in free Mindy credits.\n\nWe'll email your join link before we go live.\n\nhttps://getmindy.ai${EVENT.path}`,
    ) +
    '&location=' + encodeURIComponent('Live online')
  );
}

export function renderLazyBlueprintConfirmation(
  firstName: string,
  joinUrl?: string | null,
): { subject: string; html: string; text: string } {
  const name = esc((firstName || '').trim() || 'there');
  const cal = lazyBlueprintCalendarUrl();
  const when = `${EVENT.dateLabel}${EVENT.timeLabel ? ` at ${EVENT.timeLabel}` : ''}`;
  const subject = `You're in for ${EVENT.title} (${EVENT.shortDate})`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#FBFAF7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#12100E;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBFAF7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border:1px solid #DCD8CF;">
        <tr><td style="background-color:#1B3A6B;padding:28px 32px;text-align:center;">
          <img src="https://getmindy.ai/brand/mindy-logo-3d.png" alt="Mindy" width="48" height="48" style="display:block;margin:0 auto 12px;">
          <p style="margin:0 0 8px;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">You&rsquo;re registered</p>
          <h1 style="margin:0;color:#ffffff;font-size:26px;line-height:1.25;font-weight:700;">See you ${esc(EVENT.shortDate)}, ${name}!</h1>
          <p style="margin:10px 0 0;color:#D6E0F0;font-size:15px;">${esc(EVENT.title)}</p>
        </td></tr>

        <tr><td style="padding:28px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#EFF5FF;border:1px solid #C9D7EE;">
            <tr><td style="padding:22px;text-align:center;">
              <p style="margin:0 0 6px;color:#1B3A6B;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Save the date</p>
              <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#12100E;">${esc(EVENT.dateLabel)}</p>
              <p style="margin:0 0 16px;font-size:15px;color:#3A352E;">${esc(EVENT.timeLabel || '')}${EVENT.timeLabel ? ' &middot; ' : ''}Live online</p>
              <a href="${cal}" style="display:inline-block;background-color:#1B3A6B;color:#ffffff;padding:12px 24px;text-decoration:none;font-weight:700;font-size:14px;">+ Add to Google Calendar</a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3A352E;">Your seat is saved. On ${esc(when)}, Eric Coffie goes live to show the easiest way to win federal contracts, with Mindy doing the heavy lifting.</p>
          <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3A352E;"><strong style="color:#12100E;">Show up live and you get $50 in free Mindy credits.</strong> Live attendees only.</p>
          ${joinUrl
            ? `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#3A352E;">This is your personal link to join. Please don&rsquo;t share it: it&rsquo;s how we know you were there for the $50.</p>
          <p style="margin:0;text-align:center;"><a href="${esc(joinUrl)}" style="display:inline-block;background-color:#1B3A6B;color:#ffffff;padding:14px 28px;text-decoration:none;font-weight:700;font-size:15px;">Join the live event</a></p>
          <p style="margin:14px 0 0;padding:12px 14px;background-color:#FFFAEB;border:1px solid #FEDF89;font-size:14px;line-height:1.6;color:#3A352E;"><strong>The room seats ${EVENT.zoomCapacity}. Join 10 minutes early.</strong> ${EVENT.youtubeOverflowUrl ? `If it&rsquo;s full, watch live here: <a href="${esc(EVENT.youtubeOverflowUrl)}" style="color:#1B3A6B;">YouTube livestream</a>. You can still claim your $50 from there.` : 'If it&rsquo;s full, we&rsquo;ll send a YouTube livestream link so you can still watch and claim your $50.'}</p>`
            : `<p style="margin:0;font-size:16px;line-height:1.6;color:#3A352E;">We&rsquo;ll email your join link before we go live. Keep an eye on your inbox.</p>`}
        </td></tr>

        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#12100E;">You&rsquo;ll walk away with</p>
          <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.7;color:#3A352E;">
            <li>How small businesses find contracts that fit, without searching SAM.gov for hours</li>
            <li>A live look at Mindy finding real contracts for real businesses</li>
            <li>$50 in free Mindy credits (live attendees only)</li>
          </ul>
        </td></tr>

        <tr><td style="padding:28px 32px 32px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6B6459;">Questions? Just reply to this email.</p>
        </td></tr>

        <tr><td style="padding:18px 32px;border-top:1px solid #EDEAE3;text-align:center;">
          <p style="margin:0;font-size:12px;color:#7A7266;">GovCon Giants AI &middot; <a href="https://getmindy.ai" style="color:#1B3A6B;text-decoration:none;">getmindy.ai</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `You're in, ${(firstName || '').trim() || 'there'}!`,
    '',
    `${EVENT.title}`,
    `${when} · Live online`,
    '',
    'Show up live and you get $50 in free Mindy credits. Live attendees only.',
    joinUrl ? `Your personal join link (please don't share it): ${joinUrl}` : "We'll email your join link before we go live.",
    `The room seats ${EVENT.zoomCapacity}, so join 10 minutes early.${EVENT.youtubeOverflowUrl ? ` If it's full, watch on YouTube: ${EVENT.youtubeOverflowUrl}` : ''}`,
    '',
    `Add to Google Calendar: ${cal}`,
    '',
    'GovCon Giants AI · getmindy.ai',
  ].join('\n');

  return { subject, html, text };
}

export type LazyBlueprintConfirmationOutcome =
  | { status: 'accepted'; providerMessageId: string | null }
  | { status: 'blocked'; reason: string }
  | { status: 'unconfirmed' };

export async function sendLazyBlueprintConfirmation(params: {
  to: string;
  firstName: string;
  joinUrl?: string | null;
}): Promise<LazyBlueprintConfirmationOutcome> {
  const { subject, html, text } = renderLazyBlueprintConfirmation(params.firstName, params.joinUrl);
  const report: { sent?: { providerMessageId: string | null }; blockedReason?: string } = {};
  const ok = await sendEmail({
    to: params.to,
    subject,
    html,
    text,
    from: `"Mindy" <${process.env.EMAIL_FROM || 'mindy@mail.getmindy.ai'}>`,
    emailType: 'lazy_blueprint_confirmation',
    eventSource: 'lazy_contractors_blueprint',
    transactional: true,
    tags: { stream: 'lazy_contractors_blueprint' },
    strictOutcome: true,
    onSent: (info) => { report.sent = { providerMessageId: info.providerMessageId }; },
    onBlocked: (reason) => { report.blockedReason = reason; },
  });
  if (ok) return report.sent ? { status: 'accepted', ...report.sent } : { status: 'unconfirmed' };
  return { status: 'blocked', reason: report.blockedReason ?? 'blocked (no reason reported)' };
}

/** The welcome text sent right after registration (only with SMS consent). Kept short: one or two segments. */
export function lazyBlueprintWelcomeSms(firstName: string): string {
  const name = (firstName || '').trim() || 'there';
  return `You're in, ${name}! ${EVENT.title} is Sat Nov 28 at ${EVENT.timeLabel || '11:00 AM ET'}. Your join link is in your email. Show up live for $50 in Mindy credits. Reply STOP to opt out.`;
}
