import { NextRequest, NextResponse } from 'next/server';
import { generateRecompeteBriefing } from '@/lib/briefings/recompete';
import nodemailer from 'nodemailer';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

/**
 * GET /api/admin/generate-recompete-briefing?password=xxx&email=xxx&format=full|condensed&send=true
 *
 * Generate and optionally send a recompete briefing in Eric's format.
 *
 * Query params:
 * - password: Admin password (required)
 * - email: User email to generate briefing for (required)
 * - format: 'full' (default) or 'condensed'
 * - send: 'true' to actually send the email
 * - preview: 'html' to return just the HTML body for preview
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email');
  const format = (searchParams.get('format') || 'full') as 'full' | 'condensed';
  const shouldSend = searchParams.get('send') === 'true';
  const preview = searchParams.get('preview');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email parameter required' }, { status: 400 });
  }

  try {
    console.log(`[Admin] Generating ${format} recompete briefing for ${email}...`);

    const result = await generateRecompeteBriefing(email, {
      format,
      testMode: !shouldSend, // Don't save to DB if not sending
    });

    if (!result) {
      return NextResponse.json({
        success: false,
        error: 'Failed to generate briefing - no data or no profile',
      }, { status: 500 });
    }

    const { briefing, emailTemplate } = { briefing: result.briefing, emailTemplate: result.email };

    // If preview=html, just return the HTML body
    if (preview === 'html') {
      return new NextResponse(emailTemplate.htmlBody, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // If preview=text, return the text body
    if (preview === 'text') {
      return new NextResponse(emailTemplate.textBody, {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // If send=true, actually send the email
    if (shouldSend) {
      const sendResult = await sendBriefingEmail(email, emailTemplate);

      if (!sendResult.success) {
        return NextResponse.json({
          success: false,
          error: `Failed to send email: ${sendResult.error}`,
          briefing,
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Briefing sent to ${email}`,
        subject: emailTemplate.subject,
        opportunityCount: 'opportunities' in briefing ? briefing.opportunities.length : 0,
        format,
      });
    }

    // Default: return briefing data without sending
    return NextResponse.json({
      success: true,
      message: 'Briefing generated (not sent)',
      subject: emailTemplate.subject,
      preheader: emailTemplate.preheader,
      briefing,
      instructions: {
        preview_html: `Add &preview=html to see the email HTML`,
        preview_text: `Add &preview=text to see the plain text version`,
        send: `Add &send=true to actually send the email`,
      },
    });
  } catch (error) {
    console.error('[Admin] Error generating briefing:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * Send briefing email via SMTP
 */
async function sendBriefingEmail(
  to: string,
  template: { subject: string; htmlBody: string; textBody: string }
): Promise<{ success: boolean; error?: string }> {
  const smtpUser = process.env.SMTP_ALERTS_USER || process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_ALERTS_PASSWORD || process.env.SMTP_PASSWORD;

  if (!smtpUser || !smtpPass) {
    return { success: false, error: 'SMTP not configured' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: `"GovCon Giants AI" <${smtpUser}>`,
      to,
      subject: template.subject,
      text: template.textBody,
      html: template.htmlBody,
    });

    console.log(`[Admin] Briefing email sent to ${to}`);
    return { success: true };
  } catch (error) {
    console.error('[Admin] SMTP error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SMTP error',
    };
  }
}
