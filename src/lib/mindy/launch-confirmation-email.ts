import { sendEmail } from '@/lib/send-email';

/**
 * Mindy Free Live Launch confirmation — Saturday, June 27, 2026, 10 AM–4 PM ET.
 *
 * Sent through the GUARDED sendEmail() (Resend → Office365 fallback, as
 * alerts@govcongiants.com — the Resend-verified domain) so it gets suppression-list
 * + deliverability tracking like every other Mindy stream. Marked transactional:
 * it's a confirmation the registrant expects in direct response to signing up, so it
 * bypasses the daily cap and always delivers.
 *
 * Keeps the REAL access framing — first 150 registrants get the live Zoom (100
 * seats), the rest watch on YouTube — but the actual join LINK isn't confirmed yet,
 * so this is a save-the-date: it tells them their tier and drives the calendar add.
 * The join link goes out in a reminder email closer to the event.
 *
 * Facts verified from govcongiants.com/mindy-launch.
 */
export async function sendMindyLaunchConfirmationEmail(params: {
  to: string;
  name: string;
  getsZoom?: boolean;
}): Promise<boolean> {
  const firstName = (params.name || '').split(' ')[0] || 'there';
  const getsZoom = params.getsZoom !== false; // default to the better experience if unknown
  const eventUrl = 'https://govcongiants.com/mindy-launch';

  // Google Calendar add-event link (June 27, 2026, 10:00 AM–4:00 PM EDT = 14:00–20:00 UTC)
  const calendarUrl =
    'https://www.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent('Mindy Free Live Launch — GovCon Giants') +
    '&dates=20260627T140000Z/20260627T200000Z' +
    '&details=' + encodeURIComponent(`Free full-day live working session: build your own federal market map with Mindy on real government data. Demo + hands-on workshops + lifetime recording + free Mindy account.\n\nWe'll email your join link before the event.\n\nDetails: ${eventUrl}`) +
    '&location=' + encodeURIComponent(eventUrl);

  // Real access framing (first 150 → live Zoom / 100 seats; rest → YouTube), but the
  // link itself isn't confirmed yet — so each tier says the link is coming, not here.
  const accessBlock = getsZoom
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ecfdf5; border: 2px solid #a7f3d0; border-radius: 12px;">
        <tr>
          <td style="padding: 24px; text-align: center;">
            <p style="color: #047857; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px;">&#10003; You got a live Zoom seat</p>
            <p style="color: #1e293b; font-size: 16px; margin: 0; line-height: 1.6;">You&rsquo;re in the live room &mdash; one of the first 150 to register. You&rsquo;ll be able to ask questions and build alongside us. <strong>We&rsquo;ll email your Zoom link before we go live &mdash; add the date to your calendar now so you don&rsquo;t miss it.</strong></p>
          </td>
        </tr>
      </table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #eff6ff; border: 2px solid #bfdbfe; border-radius: 12px;">
        <tr>
          <td style="padding: 24px; text-align: center;">
            <p style="color: #1d4ed8; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px;">You&rsquo;re on the YouTube stream</p>
            <p style="color: #1e293b; font-size: 16px; margin: 0; line-height: 1.6;">The live Zoom room (first 150) is full, so you&rsquo;ll watch the full day on our YouTube live stream &mdash; still 100% free, and you keep the recording. <strong>We&rsquo;ll email your stream link before we go live &mdash; add the date to your calendar now so you don&rsquo;t miss it.</strong></p>
          </td>
        </tr>
      </table>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Registered — Mindy Free Live Launch</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a8a 0%, #4338ca 50%, #7c3aed 100%); padding: 40px 32px; text-align: center;">
              <div style="display: inline-block; background-color: rgba(255,255,255,0.2); color: #ffffff; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; padding: 6px 14px; border-radius: 999px; margin-bottom: 16px;">
                You&rsquo;re Registered
              </div>
              <h1 style="color: #ffffff; font-size: 30px; line-height: 1.2; font-weight: 800; margin: 0 0 12px;">
                See You June 27, ${firstName}!
              </h1>
              <p style="color: #ddd6fe; font-size: 16px; margin: 0;">
                The <strong style="color: #ffffff;">Mindy</strong> Free Live Launch
              </p>
            </td>
          </tr>

          <!-- Date/Time Block -->
          <tr>
            <td style="padding: 32px 32px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #eef2ff; border: 2px solid #c7d2fe; border-radius: 12px;">
                <tr>
                  <td style="padding: 24px; text-align: center;">
                    <p style="color: #4338ca; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px;">
                      Save the Date
                    </p>
                    <p style="color: #1e293b; font-size: 22px; font-weight: 800; margin: 0 0 4px;">
                      Saturday, June 27, 2026
                    </p>
                    <p style="color: #475569; font-size: 16px; margin: 0 0 16px;">
                      10:00 AM &ndash; 4:00 PM ET <span style="color: #94a3b8; font-size: 14px;">(full-day working session)</span>
                    </p>
                    <a href="${calendarUrl}" style="display: inline-block; background-color: #4338ca; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px;">
                      + Add to Google Calendar
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Access Tier (Zoom vs YouTube — link coming) -->
          <tr>
            <td style="padding: 24px 32px 0;">
              ${accessBlock}
            </td>
          </tr>

          <!-- Welcome Body -->
          <tr>
            <td style="padding: 32px 32px 0;">
              <h2 style="color: #0f172a; font-size: 22px; font-weight: 800; margin: 0 0 12px;">
                Welcome, ${firstName}.
              </h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.65; margin: 0 0 16px;">
                Your spot is locked in. This isn&rsquo;t a webinar where you watch slides &mdash; it&rsquo;s a
                working session where you build your own federal market map alongside us, on real
                government data, and walk out with a free Mindy account set up.
              </p>
              <p style="color: #475569; font-size: 16px; line-height: 1.65; margin: 0;">
                100% free. No credit card. You keep the full recording either way.
              </p>
            </td>
          </tr>

          <!-- What We'll Do -->
          <tr>
            <td style="padding: 32px 32px 0;">
              <h3 style="color: #0f172a; font-size: 18px; font-weight: 800; margin: 0 0 16px;">
                What we&rsquo;ll do, live
              </h3>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                    <table cellpadding="0" cellspacing="0"><tr>
                      <td valign="top" style="width: 36px;"><div style="width: 28px; height: 28px; background-color: #4338ca; border-radius: 50%; color: #ffffff; font-weight: 800; text-align: center; line-height: 28px; font-size: 14px;">1</div></td>
                      <td valign="top">
                        <p style="color: #0f172a; font-size: 15px; font-weight: 700; margin: 0;">Find the opportunities you&rsquo;d otherwise miss</p>
                        <p style="color: #64748b; font-size: 14px; margin: 4px 0 0; line-height: 1.5;">The overnight SAM feed &mdash; hundreds of notices drop while you sleep.</p>
                      </td>
                    </tr></table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                    <table cellpadding="0" cellspacing="0"><tr>
                      <td valign="top" style="width: 36px;"><div style="width: 28px; height: 28px; background-color: #4338ca; border-radius: 50%; color: #ffffff; font-weight: 800; text-align: center; line-height: 28px; font-size: 14px;">2</div></td>
                      <td valign="top">
                        <p style="color: #0f172a; font-size: 15px; font-weight: 700; margin: 0;">Pull the incumbent&rsquo;s real deal</p>
                        <p style="color: #64748b; font-size: 14px; margin: 4px 0 0; line-height: 1.5;">Ceiling value, true expiration, how concentrated the agency&rsquo;s spend is.</p>
                      </td>
                    </tr></table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                    <table cellpadding="0" cellspacing="0"><tr>
                      <td valign="top" style="width: 36px;"><div style="width: 28px; height: 28px; background-color: #4338ca; border-radius: 50%; color: #ffffff; font-weight: 800; text-align: center; line-height: 28px; font-size: 14px;">3</div></td>
                      <td valign="top">
                        <p style="color: #0f172a; font-size: 15px; font-weight: 700; margin: 0;">Map who&rsquo;s buying in your space</p>
                        <p style="color: #64748b; font-size: 14px; margin: 4px 0 0; line-height: 1.5;">By agency, by dollars, by set-aside &mdash; grounded in actual award records.</p>
                      </td>
                    </tr></table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0;">
                    <table cellpadding="0" cellspacing="0"><tr>
                      <td valign="top" style="width: 36px;"><div style="width: 28px; height: 28px; background-color: #4338ca; border-radius: 50%; color: #ffffff; font-weight: 800; text-align: center; line-height: 28px; font-size: 14px;">4</div></td>
                      <td valign="top">
                        <p style="color: #0f172a; font-size: 15px; font-weight: 700; margin: 0;">Watch Mindy draft a real response</p>
                        <p style="color: #64748b; font-size: 14px; margin: 4px 0 0; line-height: 1.5;">To a sources-sought or RFI &mdash; grounded in the actual notice, not made up.</p>
                      </td>
                    </tr></table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- How to Prepare -->
          <tr>
            <td style="padding: 32px 32px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-radius: 12px;">
                <tr>
                  <td style="padding: 24px;">
                    <h3 style="color: #0f172a; font-size: 16px; font-weight: 800; margin: 0 0 12px;">How to prepare</h3>
                    <ul style="color: #475569; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                      <li>Bring a NAICS code (or a contract you&rsquo;re curious about) &mdash; we&rsquo;ll run it together.</li>
                      <li>Block 10 AM&ndash;4 PM ET &mdash; this is hands-on, not a passive watch.</li>
                      <li>Have your laptop ready so you can build your own market map alongside us.</li>
                    </ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${eventUrl}" style="display: inline-block; background-color: #4338ca; color: #ffffff; padding: 16px 32px; border-radius: 10px; text-decoration: none; font-weight: 800; font-size: 16px;">
                      View Event Details
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="color: #64748b; font-size: 12px; margin: 0 0 6px;">
                Hosted by <strong style="color: #1e293b;">GovCon Giants</strong>. Built on real government data &mdash; not generic AI guesses.
              </p>
              <p style="color: #94a3b8; font-size: 11px; margin: 0;">
                <a href="${eventUrl}" style="color: #4338ca; text-decoration: none;">govcongiants.com/mindy-launch</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const subject = getsZoom
    ? `${firstName}, your live Zoom seat is confirmed — Mindy Launch, Sat June 27`
    : `${firstName}, you're registered — Mindy Launch, Sat June 27 (10 AM ET)`;

  return sendEmail({
    to: params.to,
    subject,
    html,
    from: '"Mindy" <alerts@govcongiants.com>',
    emailType: 'mindy_launch_confirmation',
    eventSource: 'mindy_launch',
    transactional: true, // confirmation in direct response to signup — always deliver
    tags: { stream: 'mindy_launch', tier: getsZoom ? 'zoom' : 'youtube' },
  });
}
