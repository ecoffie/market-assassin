/**
 * Send Briefings Cron Job
 *
 * Generates and sends daily briefings to ALL users (FREE FOR EVERYONE).
 * Pulls from unified user_notification_settings table.
 * Schedule: 9 AM UTC daily (after all data gathering completes)
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
import { sendEmail } from '@/lib/send-email';
import {
  IntelligenceMetrics,
  logIntelligenceDelivery,
  GuardrailMonitor,
  CircuitBreaker,
  postSendValidation,
} from '@/lib/intelligence';

const MAX_USERS_PER_RUN = 1000;
const DELAY_BETWEEN_USERS_MS = 3000; // 3 second delay between users to avoid Claude API rate limits (50k tokens/min)

// Timezone offsets for delivery timing
const TIMEZONE_OFFSETS: Record<string, number> = {
  'America/New_York': -5,
  'America/Chicago': -6,
  'America/Denver': -7,
  'America/Los_Angeles': -8,
  'America/Phoenix': -7,
  'Pacific/Honolulu': -10,
  'America/Anchorage': -9,
};

function isDeliveryTimeForTimezone(timezone: string | undefined): boolean {
  const currentHourUTC = new Date().getUTCHours();
  const tz = timezone || 'America/New_York';
  const offset = TIMEZONE_OFFSETS[tz] || -5;
  const localHour = (currentHourUTC + offset + 24) % 24;
  // Allow delivery if local time is between 6 AM and 10 AM
  return localHour >= 6 && localHour <= 10;
}

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
        schedule: 'Every day at 9 AM UTC',
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

    // Step 1: Get users from BOTH tables (user_notification_settings AND user_alert_settings)
    const allUsers: BriefingUser[] = [];
    const seenEmails = new Set<string>();

    // Source 1: user_notification_settings (original source)
    // BETA MODE: Send to ALL active users regardless of briefings_enabled flag
    // TODO: After April 27, 2026 beta ends, restore .eq('briefings_enabled', true) filter
    const { data: notificationSettings } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, agencies, timezone, sms_enabled, phone_number, briefings_enabled, is_active, aggregated_profile')
      .eq('is_active', true)
      // .eq('briefings_enabled', true) // BETA: Commented out - all active users get briefings
      .limit(MAX_USERS_PER_RUN);

    if (notificationSettings) {
      for (const p of notificationSettings) {
        const email = p.user_email?.toLowerCase();
        if (!email || seenEmails.has(email)) continue;
        seenEmails.add(email);

        // Extract NAICS from either JSONB or columns
        const jsonb = p.aggregated_profile as Record<string, unknown> | null;
        let naics: string[] = [];
        let agencies: string[] = [];

        if (jsonb && Array.isArray(jsonb.naics_codes)) {
          naics = jsonb.naics_codes as string[];
        }
        if (Array.isArray(p.naics_codes) && p.naics_codes.length > 0) {
          naics = [...new Set([...naics, ...p.naics_codes])];
        }
        if (jsonb && Array.isArray(jsonb.agencies)) {
          agencies = jsonb.agencies as string[];
        }
        if (Array.isArray(p.agencies) && p.agencies.length > 0) {
          agencies = [...new Set([...agencies, ...p.agencies])];
        }

        // FALLBACK: If user has no NAICS and no agencies, use popular default NAICS codes
        if (naics.length === 0 && agencies.length === 0) {
          naics = [
            '541512', // Computer Systems Design
            '541611', // Management Consulting
            '541330', // Engineering Services
            '541990', // Other Professional Services
            '561210', // Facilities Support Services
          ];
          console.log(`[SendBriefings] Using fallback NAICS for ${email} (from notification_settings)`);
        }

        allUsers.push({
          email,
          naics_codes: naics,
          agencies,
          timezone: p.timezone,
          sms_enabled: p.sms_enabled,
          phone_number: p.phone_number,
          source: 'briefing_profile',
        });
      }
    }

    // Source 2: smart_user_profiles (users from search history aggregation)
    // This catches users who have used tools but not explicitly set preferences
    const { data: smartProfiles } = await supabase
      .from('smart_user_profiles')
      .select('email, naics_codes, keywords, agencies, timezone')
      .limit(MAX_USERS_PER_RUN);

    if (smartProfiles) {
      for (const p of smartProfiles) {
        const email = p.email?.toLowerCase();
        if (!email || seenEmails.has(email)) continue; // Skip if already added from notification_settings
        seenEmails.add(email);

        let naics: string[] = Array.isArray(p.naics_codes) ? p.naics_codes : [];
        const agencies: string[] = Array.isArray(p.agencies) ? p.agencies : [];

        // FALLBACK: If user has no NAICS and no agencies, use popular default NAICS codes
        if (naics.length === 0 && agencies.length === 0) {
          naics = [
            '541512', // Computer Systems Design
            '541611', // Management Consulting
            '541330', // Engineering Services
            '541990', // Other Professional Services
            '561210', // Facilities Support Services
          ];
          console.log(`[SendBriefings] Using fallback NAICS for ${email} (from smart_profiles)`);
        }

        allUsers.push({
          email,
          naics_codes: naics,
          agencies,
          timezone: p.timezone || 'America/New_York',
          sms_enabled: false,
          phone_number: undefined,
          source: 'alert_settings' as const, // Keep for type compat
        });
      }
    }

    console.log(`[SendBriefings] Found ${allUsers.length} total users (${notificationSettings?.length || 0} from notification_settings, ${smartProfiles?.length || 0} from smart_profiles, ${seenEmails.size - allUsers.length} duplicates removed)`);

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

    console.log(`[SendBriefings] Processing ${usersToProcess.length} users SEQUENTIALLY (${allUsers.length - usersToProcess.length} filtered/deduped)`);

    // Step 2: Process users SEQUENTIALLY to avoid Claude API rate limits (50k tokens/min)
    // With 892 users @ 3s delay = ~45 minutes, fits within Vercel Pro function limits
    for (let i = 0; i < usersToProcess.length; i++) {
      const user = usersToProcess[i];

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
          continue;
        }

          // Generate AI-powered briefing (Top 10 + 3 Teaming Plays)
          const briefing = await generateAIBriefing(user.email, {
            maxOpportunities: 10,
            maxTeamingPlays: 3,
          });

        if (!briefing || briefing.opportunities.length === 0) {
          console.log(`[SendBriefings] No opportunities for ${user.email}`);
          briefingsSkipped++;
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
