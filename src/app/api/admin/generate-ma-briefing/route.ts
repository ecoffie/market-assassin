/**
 * Admin endpoint for generating MA briefings
 *
 * Usage:
 * GET /api/admin/generate-ma-briefing?email=test@example.com&password=galata-assassin-2026
 *
 * Query params:
 * - email (required): User email to generate briefing for
 * - password (required): Admin password
 * - format: "full" (default) or "condensed"
 * - send: "true" to send email (default: just generate)
 * - preview: "html" to return rendered HTML, "json" for raw data (default)
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateMABriefing } from '@/lib/briefings/market-assassin';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const password = searchParams.get('password');
  const format = (searchParams.get('format') || 'full') as 'full' | 'condensed';
  const send = searchParams.get('send') === 'true';
  const preview = searchParams.get('preview') || 'json';

  // Validate password
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate email
  if (!email) {
    return NextResponse.json({ error: 'Email parameter required' }, { status: 400 });
  }

  try {
    console.log(`[AdminMABriefing] Generating ${format} briefing for ${email}...`);

    // Generate briefing
    const result = await generateMABriefing(email, {
      format,
      testMode: !send, // If not sending, run in test mode (no DB save)
    });

    if (!result) {
      return NextResponse.json({
        error: 'Failed to generate briefing',
        details: 'User may not have MA access or no data available',
      }, { status: 404 });
    }

    const { briefing, email: emailTemplate } = result;

    // Send email if requested
    if (send) {
      try {
        await sendEmail({
          to: email,
          subject: emailTemplate.subject,
          html: emailTemplate.htmlBody,
          text: emailTemplate.textBody,
        });
        console.log(`[AdminMABriefing] Email sent to ${email}`);
      } catch (emailError) {
        console.error('[AdminMABriefing] Email send failed:', emailError);
        return NextResponse.json({
          success: false,
          error: 'Briefing generated but email failed to send',
          briefing,
          emailError: String(emailError),
        }, { status: 500 });
      }
    }

    // Return preview or JSON
    if (preview === 'html') {
      return new NextResponse(emailTemplate.htmlBody, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return NextResponse.json({
      success: true,
      message: send ? 'Briefing generated and sent' : 'Briefing generated (not sent)',
      format,
      briefing,
      emailSubject: emailTemplate.subject,
      emailPreheader: emailTemplate.preheader,
    });
  } catch (error) {
    console.error('[AdminMABriefing] Error:', error);
    return NextResponse.json({
      error: 'Failed to generate briefing',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
