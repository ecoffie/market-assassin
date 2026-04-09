/**
 * Send Briefings Cron Job
 *
 * Generates and sends daily briefings to ALL users (FREE FOR EVERYONE).
 * Pulls from unified user_notification_settings table.
 * Schedule: 7 AM UTC daily (before most users wake up)
 *
 * Process:
 * 1. Get all users with briefings_enabled=true
 * 2. For each user: generate briefing → send email
 * 3. Track delivery status with retry support
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateAIBriefing, AIGeneratedBriefing } from '@/lib/briefings/delivery/ai-briefing-generator';
import { generateAIEmailTemplate } from '@/lib/briefings/delivery/ai-email-template';
import {
  recordBriefingProgramDelivery,
  resolveBriefingAudience,
} from '@/lib/briefings/delivery/rollout';
import { sendEmail } from '@/lib/send-email';
import {
  IntelligenceMetrics,
  logIntelligenceDelivery,
  GuardrailMonitor,
  CircuitBreaker,
  postSendValidation,
} from '@/lib/intelligence';

/**
 * Batch Processing Configuration
 *
 * With Groq (10-50x faster than Claude), we can process users much faster.
 * Each user takes ~3-8 seconds total (data fetch + LLM call).
 * With 60s timeout and no delays, we can process ~8-20 users per run.
 *
 * Strategy: Run cron multiple times (5:00, 5:30, 6:00, 6:30 AM UTC)
 * Each run processes users who haven't received today's briefing yet.
 */
const BATCH_SIZE = 15; // Process up to 15 users per cron run
const DELAY_BETWEEN_USERS_MS = 500; // Minimal delay - Groq handles rate limits well

interface BriefingUser {
  email: string;
  naics_codes: string[];
  agencies: string[];
  timezone?: string;
  sms_enabled?: boolean;
  phone_number?: string;
  source: 'briefing_profile' | 'alert_settings';
}

export async function GET(request: NextRequest) {
  // Check for test mode
  const testEmail = request.nextUrl.searchParams.get('email');
  const isTest = request.nextUrl.searchParams.get('test') === 'true';

  // Verify cron secret for Vercel (skip for test mode with email)
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !hasCronSecret && !(testEmail && isTest)) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        message: 'Daily Briefings Cron Job (FREE FOR EVERYONE)',
        usage: {
          test: 'GET ?email=xxx&test=true to send test briefing',
          manual: 'Triggered by Vercel cron or CRON_SECRET',
        },
        schedule: 'Every day at 7 AM UTC',
        features: [
          'FREE for all users (no paywall)',
          'Pulls from both briefing_profile AND alert_settings',
          'Timezone-aware delivery',
          'Retry failed deliveries',
        ],
      });
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startTime = Date.now();
  let briefingsSent = 0;
  let briefingsFailed = 0;
  let briefingsSkipped = 0;
  const errors: string[] = [];
  let audienceSummary: {
    totalCandidates: number;
    profileReadyCandidates: number;
    fallbackCandidates: number;
    selectedUsers: number;
    selectedProfileReady: number;
    selectedFallback: number;
  } | null = null;
  let rolloutMode = 'beta_all';
  let activeCohortId: string | null = null;
  let cohortProgress = null;

  // Initialize metrics and guardrails
  const metrics = new IntelligenceMetrics('briefings');
  const guardrail = new GuardrailMonitor('send-briefings');
  const circuitBreaker = new CircuitBreaker('send-briefings');

  // Check circuit breaker (skip for test mode)
  if (!testEmail) {
    const isOpen = await circuitBreaker.isOpen();
    if (isOpen) {
      console.log('[SendBriefings] Circuit breaker OPEN - skipping this run');
      return NextResponse.json({
        success: false,
        error: 'Circuit breaker open - too many recent failures',
        message: 'System paused due to high failure rate. Will auto-reset in 30 minutes.',
      }, { status: 503 });
    }
  }

  console.log('[SendBriefings] Starting daily briefing delivery (FREE FOR ALL)...');

  try {
    // Retry failed briefings from previous runs
    const retryResults = await retryFailedBriefings(supabase);
    if (retryResults.retried > 0) {
      console.log(`[SendBriefings] Retried ${retryResults.retried} failed briefings, ${retryResults.succeeded} succeeded`);
    }

    const audienceResolution = await resolveBriefingAudience(supabase);
    const allUsers: BriefingUser[] = audienceResolution.users;
    audienceSummary = audienceResolution.audienceSummary;
    rolloutMode = audienceResolution.config.mode;
    activeCohortId = audienceResolution.activeCohort?.id || null;
    cohortProgress = audienceResolution.cohortProgress;

    console.log(
      `[SendBriefings] Audience mode=${rolloutMode}, selected=${audienceSummary.selectedUsers}/${audienceSummary.totalCandidates}, ` +
      `profile-ready=${audienceSummary.selectedProfileReady}, fallback=${audienceSummary.selectedFallback}, cohort=${activeCohortId || 'none'}`
    );

    // Filter to test email if specified
    let usersToProcess = allUsers;
    if (testEmail) {
      usersToProcess = allUsers.filter(u => u.email === testEmail.toLowerCase());
      if (usersToProcess.length === 0) {
        return NextResponse.json({
          success: false,
          error: `No user found with email: ${testEmail}`,
          totalUsers: allUsers.length,
        });
      }
    }

    if (usersToProcess.length === 0) {
      console.log('[SendBriefings] No users with profile data');
      return NextResponse.json({
        success: true,
        message: 'No users with profile data',
        briefingsSent: 0,
        elapsed: Date.now() - startTime,
      });
    }

    // Limit to BATCH_SIZE users per run to stay within Vercel timeout (60s)
    // Multiple cron runs throughout the morning will process all users
    const totalEligible = usersToProcess.length;
    usersToProcess = usersToProcess.slice(0, BATCH_SIZE);

    console.log(`[SendBriefings] Processing ${usersToProcess.length}/${totalEligible} users (BATCH_SIZE=${BATCH_SIZE}, filtered/deduped=${allUsers.length - totalEligible})`);

    // Step 2: Process users SEQUENTIALLY to avoid Claude API rate limits (50k tokens/min)
    // With 892 users @ 3s delay = ~45 minutes, fits within Vercel Pro function limits
    for (let i = 0; i < usersToProcess.length; i++) {
      const user = usersToProcess[i];
      metrics.recordUserEligible();

      // Log progress every 10 users
      if (i % 10 === 0) {
        console.log(`[SendBriefings] Progress: ${i}/${usersToProcess.length} users processed`);
      }

      try {
        // Check guardrails before processing each user
        const guardrailCheck = guardrail.check();
        if (!guardrailCheck.continue) {
          console.log(`[SendBriefings] Guardrail blocked: ${guardrailCheck.reason}`);
          briefingsSkipped++;
          metrics.recordUserSkipped();
          continue;
        }

          // REMOVED: Timezone filter was blocking most users
          // All briefings now sent at 7 AM UTC (2-3 AM ET) so users see them when they wake up

          // Check for recent briefing (deduplication)
          const today = new Date().toISOString().split('T')[0];
          const { data: existingBriefing } = await supabase
            .from('briefing_log')
            .select('delivery_status')
            .eq('user_email', user.email)
            .eq('briefing_date', today)
            .single();

        if (existingBriefing?.delivery_status === 'sent') {
          console.log(`[SendBriefings] ${user.email} already received briefing today, skipping`);
          briefingsSkipped++;
          metrics.recordUserSkipped();
          continue;
        }

          // Generate AI-powered briefing (Top 10 + 3 Teaming Plays)
          // Skip Perplexity enrichment (~75-90s per user) during batch processing
          // Keep data fetches to ensure real contract data is included
          const briefing = await generateAIBriefing(user.email, {
            maxOpportunities: 10,
            maxTeamingPlays: 3,
            skipEnrichment: true, // Critical for batch processing - saves ~90s per user
            // Note: Data fetches (~30-40s) are kept for real contract data
          });

        if (!briefing || briefing.opportunities.length === 0) {
          console.log(`[SendBriefings] No opportunities for ${user.email}`);
          briefingsSkipped++;
          metrics.recordUserSkipped();
          continue;
        }

          const briefingDate = new Date().toISOString().split('T')[0];
          const totalItems = briefing.opportunities.length + briefing.teamingPlays.length;

          // Persist briefing to briefing_log
          try {
            await supabase.from('briefing_log').upsert({
              user_email: user.email,
              briefing_date: briefingDate,
              briefing_content: briefing,
              items_count: totalItems,
              tools_included: ['ai_briefing', 'recompetes', 'teaming_plays'],
              delivery_status: 'pending',
              retry_count: 0,
              created_at: new Date().toISOString(),
            }, { onConflict: 'user_email,briefing_date' });
          } catch (logErr) {
            console.error(`[SendBriefings] Failed to log briefing for ${user.email}:`, logErr);
          }

          // Generate AI email template
          const emailTemplate = generateAIEmailTemplate(briefing);

          // Send email (sendEmail returns boolean or throws on error)
          try {
            metrics.recordEmailAttempted();
            await sendEmail({
              to: user.email,
              subject: emailTemplate.subject,
              html: emailTemplate.htmlBody,
              text: emailTemplate.textBody,
            });

            // Email sent successfully
            briefingsSent++;
            metrics.recordEmailSent();
            metrics.recordOpportunityMatched(totalItems);
            guardrail.recordSuccess();
            circuitBreaker.record(true);
            if (!isTest) {
              await recordBriefingProgramDelivery(activeCohortId, user.email, 'daily_brief');
            }
            console.log(`[SendBriefings] ✅ AI Briefing sent to ${user.email} (${briefing.opportunities.length} opps, ${briefing.teamingPlays.length} plays)`);

            await supabase.from('briefing_log').update({
              delivery_status: 'sent',
              email_sent_at: new Date().toISOString(),
            }).eq('user_email', user.email)
              .eq('briefing_date', briefingDate);

            // Log to intelligence_log for tracking
            await logIntelligenceDelivery({
              userEmail: user.email,
              intelligenceType: 'briefing',
              itemsCount: totalItems,
              itemIds: ['ai_briefing', 'recompetes', 'teaming_plays'],
              deliveryStatus: 'sent',
            });
          } catch (emailErr) {
            briefingsFailed++;
            metrics.recordEmailFailed();
            guardrail.recordFailure('email_send_failed');
            circuitBreaker.record(false);
            const errorMsg = emailErr instanceof Error ? emailErr.message : 'Unknown email error';
            errors.push(`${user.email}: ${errorMsg}`);

            await supabase.from('briefing_log').update({
              delivery_status: 'failed',
              error_message: errorMsg,
            }).eq('user_email', user.email)
              .eq('briefing_date', briefingDate);

            // Log failed delivery
            await logIntelligenceDelivery({
              userEmail: user.email,
              intelligenceType: 'briefing',
              itemsCount: 0,
              deliveryStatus: 'failed',
              errorMessage: errorMsg,
            });
          }
        } catch (err) {
          briefingsFailed++;
          metrics.recordEmailFailed();
          guardrail.recordFailure('processing_error');
          circuitBreaker.record(false);
          const errorMsg = `Error processing ${user.email}: ${err}`;
          console.error(`[SendBriefings] ${errorMsg}`);
          errors.push(errorMsg);
        }

        // Add delay between users to avoid Claude API rate limits (50k tokens/min)
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_USERS_MS));
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[SendBriefings] Complete: ${briefingsSent} sent, ${briefingsSkipped} skipped, ${briefingsFailed} failed, ${elapsed}ms`
    );

    // Save metrics to database
    try {
      await metrics.save();
      console.log('[SendBriefings] Metrics saved');
    } catch (metricsErr) {
      console.error('[SendBriefings] Failed to save metrics:', metricsErr);
    }

    // Post-send validation (checks failure rates, may trip circuit breaker)
    await postSendValidation('send-briefings', {
      attempted: briefingsSent + briefingsFailed,
      sent: briefingsSent,
      failed: briefingsFailed,
      failedRecipients: errors.slice(0, 10).map(e => e.split(':')[0]),
      duration: elapsed,
    });

    return NextResponse.json({
      success: true,
      briefingsSent,
      briefingsSkipped,
      briefingsFailed,
      totalUsers: usersToProcess.length,
      audienceMode: rolloutMode,
      activeCohortId,
      cohortProgress,
      audienceSummary,
      retryResults,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      elapsed,
      guardrailStatus: guardrail.check(),
    });
  } catch (error) {
    console.error('[SendBriefings] Fatal error:', error);

    // Record fatal error in metrics
    metrics.recordEmailFailed();
    try {
      await metrics.save();
    } catch {
      // Ignore metrics save failure on fatal error
    }

    return NextResponse.json(
      {
        success: false,
        error: String(error),
        briefingsSent,
        briefingsFailed,
        elapsed: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

/**
 * Retry failed briefings from previous days
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function retryFailedBriefings(supabase: any): Promise<{ retried: number; succeeded: number }> {
  const results = { retried: 0, succeeded: 0 };

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const { data: failedBriefings } = await supabase
    .from('briefing_log')
    .select('*')
    .eq('delivery_status', 'failed')
    .lt('retry_count', 3)
    .gte('briefing_date', threeDaysAgo.toISOString().split('T')[0]);

  if (!failedBriefings || failedBriefings.length === 0) return results;

  console.log(`[SendBriefings] Retrying ${failedBriefings.length} failed briefings...`);

  for (const briefing of failedBriefings) {
    results.retried++;

    try {
      if (!briefing.briefing_content) continue;

      // Re-generate email template from stored briefing content
      const emailTemplate = generateAIEmailTemplate(briefing.briefing_content as AIGeneratedBriefing);

      // Re-send email (sendEmail returns boolean or throws)
      await sendEmail({
        to: briefing.user_email,
        subject: emailTemplate.subject,
        html: emailTemplate.htmlBody,
        text: emailTemplate.textBody,
      });

      // Email sent successfully
      await supabase.from('briefing_log').update({
        delivery_status: 'sent',
        email_sent_at: new Date().toISOString(),
        error_message: null,
      }).eq('id', briefing.id);

      results.succeeded++;
      console.log(`[SendBriefings] Retry succeeded for ${briefing.user_email}`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await supabase.from('briefing_log').update({
        retry_count: (briefing.retry_count || 0) + 1,
        error_message: errorMessage,
      }).eq('id', briefing.id);

      console.error(`[SendBriefings] Retry failed for ${briefing.user_email}:`, errorMessage);
    }
  }

  return results;
}
