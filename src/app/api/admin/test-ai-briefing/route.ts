/**
 * Admin: Test AI Briefing Generation
 *
 * GET /api/admin/test-ai-briefing?password=...&email=user@example.com
 *
 * Generates an AI-powered briefing with displacement intel + teaming plays.
 * Returns the briefing data and optionally sends as email.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateAIBriefing } from '@/lib/briefings/delivery/ai-briefing-generator';
import { generateAIEmailTemplate } from '@/lib/briefings/delivery/ai-email-template';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();
  const sendIt = searchParams.get('send') === 'true';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  try {
    console.log(`[TestAIBriefing] Generating AI briefing for ${email}...`);

    const briefing = await generateAIBriefing(email, {
      maxOpportunities: 10,
      maxTeamingPlays: 3,
    });

    if (!briefing) {
      return NextResponse.json({
        success: false,
        error: 'Failed to generate briefing - check profile or OpenAI config',
      });
    }

    // Generate email template
    const emailTemplate = generateAIEmailTemplate(briefing);

    // Optionally send the email
    let emailSent = false;
    if (sendIt) {
      try {
        await sendEmail({
          to: email,
          subject: emailTemplate.subject,
          html: emailTemplate.htmlBody,
          text: emailTemplate.textBody,
        });
        emailSent = true;
        console.log(`[TestAIBriefing] Email sent to ${email}`);
      } catch (emailErr) {
        console.error(`[TestAIBriefing] Email failed:`, emailErr);
      }
    }

    return NextResponse.json({
      success: true,
      email,
      briefingDate: briefing.briefingDate,
      opportunities: briefing.opportunities.length,
      teamingPlays: briefing.teamingPlays.length,
      processingTimeMs: briefing.processingTimeMs,
      rawDataAnalyzed: briefing.rawDataSummary,
      emailSent,
      subject: emailTemplate.subject,
      preheader: emailTemplate.preheader,
      briefing,
      // Include HTML for preview (truncated)
      htmlPreview: emailTemplate.htmlBody.substring(0, 2000) + '...',
    });

  } catch (err) {
    console.error('[TestAIBriefing] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
    }, { status: 500 });
  }
}
