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
const hasAnthropicBriefingKey = () => !!(process.env.BRIEFING_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();
  const sendIt = searchParams.get('send') === 'true';
  const fastMode = searchParams.get('fast') === 'true'; // Skip ALL data fetches (fastest, but no real data)
  const cronMode = searchParams.get('cron') === 'true'; // Mimics actual cron: skipEnrichment only (keeps data fetches)

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  try {
    console.log(`[TestAIBriefing] Generating AI briefing for ${email}...`);

    // Check environment variables
    const hasAnthropicKey = hasAnthropicBriefingKey();
    const hasSamKey = !!process.env.SAM_API_KEY;
    const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!hasAnthropicKey) {
      return NextResponse.json({
        success: false,
        error: 'BRIEFING_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY not configured',
        envCheck: { hasAnthropicKey, hasSamKey, hasSupabase },
      });
    }

    let briefing;
    let generationError: string | null = null;
    try {
      briefing = await generateAIBriefing(email, {
        maxOpportunities: 10,
        maxTeamingPlays: 3,
        skipEnrichment: fastMode || cronMode, // Skip Perplexity when fast=true OR cron=true
        skipDataFetch: fastMode, // Skip data fetches ONLY when fast=true (cron keeps data fetches)
      });
    } catch (genErr) {
      generationError = genErr instanceof Error ? genErr.message : String(genErr);
      console.error('[TestAIBriefing] Generation error:', genErr);
    }

    if (!briefing) {
      return NextResponse.json({
        success: false,
        error: generationError || 'Briefing returned null - check profile or Anthropic config',
        envCheck: { hasAnthropicKey, hasSamKey, hasSupabase },
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
      mode: fastMode ? 'fast' : cronMode ? 'cron' : 'normal',
      fastMode, // true = skipped ALL data fetches (fastest but no data)
      cronMode, // true = skipped Perplexity only (mimics actual cron behavior)
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
