/**
 * Send Briefings (Fast) - GREEN SAM.gov Format
 *
 * UPDATED April 17, 2026: Now fetches from SAM.gov cache and sends GREEN format
 * instead of using pre-computed templates.
 *
 * Processing time per user: ~100-200ms (database query + email generation)
 * Capacity: 500+ users per cron run
 *
 * Schedule: 7 AM UTC daily
 *
 * Process:
 * 1. Get all users with briefings_enabled=true
 * 2. For each user, fetch SAM opportunities from cache by NAICS
 * 3. Generate GREEN email with active solicitations
 * 4. Send email
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunitiesFromCache } from '@/lib/briefings/pipelines/sam-gov';
import { generateDailyBriefFromSam, generateSamGreenEmailHtml } from '@/lib/briefings/delivery/sam-green-email-template';
import {
  recordBriefingProgramDelivery,
  resolveBriefingAudience,
} from '@/lib/briefings/delivery/rollout';
import { sendEmail } from '@/lib/send-email';
import { DEFAULT_NAICS_CODES } from '@/lib/config/defaults';

// Process up to 100 users per cron run (~150ms each = 15 seconds total)
const BATCH_SIZE = 100;

/**
 * Queue a failed briefing for automatic retry (dead letter queue)
 */
async function queueForRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userEmail: string,
  naicsCodes: string[],
  failureReason: string,
  briefingDate: string
): Promise<void> {
  try {
    await supabase.rpc('queue_briefing_retry', {
      p_user_email: userEmail,
      p_briefing_type: 'daily',
      p_briefing_date: briefingDate,
      p_naics_codes: JSON.stringify(naicsCodes),
      p_failure_reason: failureReason,
    });
  } catch (err) {
    // Don't fail the main process if retry queue fails
    console.error(`[SendBriefingsFast] Failed to queue retry for ${userEmail}:`, err);
  }
}

export async function GET(request: NextRequest) {
  const testEmail = request.nextUrl.searchParams.get('email');
  const isTest = request.nextUrl.searchParams.get('test') === 'true';

  // Verify cron secret
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !hasCronSecret && !(testEmail && isTest)) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        message: 'Send Briefings (Fast) - GREEN SAM.gov Format',
        description: 'Fetches SAM.gov cache, sends GREEN active solicitations email',
        schedule: '7 AM UTC daily',
        capacity: '500+ users per run',
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _supabase: any = null;
  function getSupabase() {
    if (!_supabase) {
      _supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
    }
    return _supabase;
  }

  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];
  let briefingsSent = 0;
  let briefingsSkipped = 0;
  let briefingsFailed = 0;
  let noOpportunitiesCount = 0;
  const errors: string[] = [];

  console.log('[SendBriefingsFast] Starting GREEN SAM.gov briefing delivery...');

  try {
    // Step 1: Get users to process
    const audienceResolution = await resolveBriefingAudience(getSupabase());
    let usersToProcess = audienceResolution.users;

    // Filter to test email if specified
    if (testEmail) {
      usersToProcess = usersToProcess.filter(u => u.email === testEmail.toLowerCase());
      if (usersToProcess.length === 0) {
        return NextResponse.json({
          success: false,
          error: `No user found with email: ${testEmail}`,
        });
      }
    }

    // Check for already sent today
    const { data: sentToday } = await getSupabase()
      .from('briefing_log')
      .select('user_email')
      .eq('briefing_date', today)
      .eq('delivery_status', 'sent');

    const sentEmails = new Set((sentToday || []).map((s: { user_email: string }) => s.user_email));

    // Filter out already sent and limit batch
    usersToProcess = usersToProcess
      .filter(u => !sentEmails.has(u.email))
      .slice(0, BATCH_SIZE);

    console.log(`[SendBriefingsFast] Processing ${usersToProcess.length} users (${sentEmails.size} already sent today)`);

    // Step 2: Process each user
    for (const user of usersToProcess) {
      const userStartTime = Date.now();

      try {
        // Get user's NAICS codes (with defaults if none set)
        const userNaics = user.naics_codes?.length > 0 ? user.naics_codes : DEFAULT_NAICS_CODES;

        // Fetch SAM opportunities from cache for this user's NAICS
        const samResult = await fetchSamOpportunitiesFromCache({
          naicsCodes: userNaics.slice(0, 10), // Limit to 10 NAICS codes
          limit: 20, // Get top 20 opportunities
        });

        if (samResult.opportunities.length === 0) {
          noOpportunitiesCount++;
          console.log(`[SendBriefingsFast] No opportunities for ${user.email} (NAICS: ${userNaics.slice(0, 3).join(',')})`);

          // Log as skipped (no opportunities found)
          await getSupabase().from('briefing_log').upsert({
            user_email: user.email,
            briefing_date: today,
            briefing_content: { message: 'No opportunities found for NAICS codes', naics: userNaics },
            items_count: 0,
            tools_included: ['sam_cache_green', 'no_opportunities'],
            delivery_status: 'skipped',
            created_at: new Date().toISOString(),
          }, { onConflict: 'user_email,briefing_date' });

          briefingsSkipped++;
          continue;
        }

        // Build GREEN briefing from SAM opportunities (with AI analysis)
        const greenBriefing = await generateDailyBriefFromSam(samResult.opportunities);

        // Log briefing attempt
        await getSupabase().from('briefing_log').upsert({
          user_email: user.email,
          briefing_date: today,
          briefing_content: greenBriefing,
          items_count: greenBriefing.opportunities.length,
          tools_included: ['sam_cache_green'],
          delivery_status: 'pending',
          retry_count: 0,
          created_at: new Date().toISOString(),
        }, { onConflict: 'user_email,briefing_date' });

        // Generate GREEN email
        const emailTemplate = generateSamGreenEmailHtml(greenBriefing, user.email);

        // Send email
        await sendEmail({
          to: user.email,
          subject: emailTemplate.subject,
          html: emailTemplate.htmlBody,
          text: emailTemplate.textBody,
        });

        briefingsSent++;

        // Update log with success
        await getSupabase().from('briefing_log').update({
          delivery_status: 'sent',
          email_sent_at: new Date().toISOString(),
          tools_included: ['sam_cache_green', 'daily_market_intel'],
        }).eq('user_email', user.email).eq('briefing_date', today);

        // Record delivery for rollout tracking
        if (!isTest) {
          await recordBriefingProgramDelivery(null, user.email, 'daily_brief');
        }

        const userElapsed = Date.now() - userStartTime;
        console.log(`[SendBriefingsFast] ✅ Sent to ${user.email} (${greenBriefing.opportunities.length} opps, ${userElapsed}ms)`);

      } catch (err) {
        briefingsFailed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`${user.email}: ${errorMsg}`);
        console.error(`[SendBriefingsFast] ❌ Failed for ${user.email}:`, err);

        // Update log with failure
        await getSupabase().from('briefing_log').update({
          delivery_status: 'failed',
          error_message: errorMsg,
        }).eq('user_email', user.email).eq('briefing_date', today);

        // Queue for automatic retry
        const userNaics = user.naics_codes || DEFAULT_NAICS_CODES;
        await queueForRetry(getSupabase(), user.email, userNaics, errorMsg, today);
      }
    }

    const elapsed = Date.now() - startTime;
    const avgTimePerUser = usersToProcess.length > 0 ? Math.round(elapsed / usersToProcess.length) : 0;

    console.log(`[SendBriefingsFast] Complete: ${briefingsSent} sent, ${briefingsSkipped} skipped, ${briefingsFailed} failed, ${noOpportunitiesCount} no opps`);

    return NextResponse.json({
      success: true,
      briefingsSent,
      briefingsSkipped,
      briefingsFailed,
      noOpportunitiesCount,
      totalUsersProcessed: usersToProcess.length,
      avgTimePerUserMs: avgTimePerUser,
      format: 'GREEN_SAM_CACHE',
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      elapsed,
    });

  } catch (error) {
    console.error('[SendBriefingsFast] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      briefingsSent,
      briefingsFailed,
      elapsed: Date.now() - startTime,
    }, { status: 500 });
  }
}
