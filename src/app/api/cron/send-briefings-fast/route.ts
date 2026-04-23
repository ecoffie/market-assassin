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
import { fetchSamOpportunitiesFromCache, fetchSamOpportunityNoticeSummaryFromCache } from '@/lib/briefings/pipelines/sam-gov';
import { buildSamGreenBriefing, generateSamGreenEmailHtml } from '@/lib/briefings/delivery/sam-green-email-template';
import {
  recordBriefingProgramDelivery,
  resolveBriefingAudience,
} from '@/lib/briefings/delivery/rollout';
import { sendEmail } from '@/lib/send-email';
import { DEFAULT_NAICS_CODES } from '@/lib/config/defaults';
import { logToolError, recordToolSuccess, ToolNames, ErrorTypes } from '@/lib/tool-errors';

// Process up to 200 users per cron run (~150ms each = 30 seconds total)
// Increased from 100 to ensure all 958+ users are covered in 10 cron runs
const BATCH_SIZE = 200;
const BRIEFING_MARKET_FETCH_LIMIT = 250;

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
    const activeCohortId = audienceResolution.activeCohort?.id || null;

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

    // Check for already processed today (sent OR skipped) - FILTER BY briefing_type='daily'
    // Must exclude skipped users too, otherwise they get re-processed every run
    // CRITICAL: Filter by briefing_type to avoid collision with weekly/pursuit briefings
    const { data: processedToday } = await getSupabase()
      .from('briefing_log')
      .select('user_email, delivery_status')
      .eq('briefing_date', today)
      .eq('briefing_type', 'daily')
      .in('delivery_status', ['sent', 'skipped']);

    const processedEmails = new Set((processedToday || []).map((s: { user_email: string }) => s.user_email));
    const sentCount = (processedToday || []).filter((s: { delivery_status: string }) => s.delivery_status === 'sent').length;
    const skippedCount = (processedToday || []).filter((s: { delivery_status: string }) => s.delivery_status === 'skipped').length;

    // Filter out already processed and limit batch
    usersToProcess = usersToProcess
      .filter(u => !processedEmails.has(u.email))
      .slice(0, BATCH_SIZE);

    console.log(`[SendBriefingsFast] Processing ${usersToProcess.length} users (${sentCount} sent, ${skippedCount} skipped today)`);

    // Step 2: Process each user
    for (const user of usersToProcess) {
      const userStartTime = Date.now();

      try {
        // Get user's NAICS codes (with defaults if none set)
        const userNaics = user.naics_codes?.length > 0 ? user.naics_codes : DEFAULT_NAICS_CODES;
        const userPsc = user.psc_codes || [];
        const userKeywords = user.keywords || [];
        const userStates = user.location_states || [];

        // Fetch SAM opportunities from cache using user's full profile
        // Includes: NAICS codes, PSC codes (industry classification), keywords, and location_states
        const samResult = await fetchSamOpportunitiesFromCache({
          naicsCodes: userNaics.slice(0, 10), // Limit to 10 NAICS codes
          pscCodes: userPsc.slice(0, 10), // Limit to 10 PSC codes
          keywords: userKeywords.slice(0, 10), // Limit to 10 keywords
          states: userStates.slice(0, 10), // Filter by user's location_states (Place of Performance)
          limit: BRIEFING_MARKET_FETCH_LIMIT, // Pull a broader matched market set for strategic ranking + notice summaries
        });

        const noticeSummary = await fetchSamOpportunityNoticeSummaryFromCache({
          naicsCodes: userNaics.slice(0, 10),
          pscCodes: userPsc.slice(0, 10),
          keywords: userKeywords.slice(0, 10),
          states: userStates.slice(0, 10), // Filter by user's location_states
        });

        if (samResult.opportunities.length === 0) {
          noOpportunitiesCount++;
          const profileSummary = [
            userNaics.length > 0 ? `NAICS: ${userNaics.slice(0, 3).join(',')}` : null,
            userPsc.length > 0 ? `PSC: ${userPsc.slice(0, 2).join(',')}` : null,
            userKeywords.length > 0 ? `KW: ${userKeywords.slice(0, 2).join(',')}` : null,
          ].filter(Boolean).join(' | ');
          console.log(`[SendBriefingsFast] No opportunities for ${user.email} (${profileSummary || 'no profile'})`);

          // Log as skipped (no opportunities found)
          await getSupabase().from('briefing_log').upsert({
            user_email: user.email,
            briefing_date: today,
            briefing_type: 'daily',
            briefing_content: { message: 'No opportunities found for profile', naics: userNaics, psc: userPsc, keywords: userKeywords },
            items_count: 0,
            tools_included: ['sam_cache_green', 'no_opportunities'],
            delivery_status: 'skipped',
            created_at: new Date().toISOString(),
          }, { onConflict: 'user_email,briefing_date,briefing_type' });

          briefingsSkipped++;
          continue;
        }

        // Build GREEN briefing from SAM opportunities (NO AI - fast path)
        // Uses buildSamGreenBriefing (instant) instead of generateDailyBriefFromSam (4s/user)
        const greenBriefing = buildSamGreenBriefing(samResult.opportunities, {
          naicsCodes: userNaics,
          agencies: user.agencies || [],
          keywords: userKeywords,
          businessType: user.business_type,
        }, noticeSummary);

        // Log briefing attempt
        await getSupabase().from('briefing_log').upsert({
          user_email: user.email,
          briefing_date: today,
          briefing_type: 'daily',
          briefing_content: greenBriefing,
          items_count: greenBriefing.opportunities.length,
          tools_included: ['sam_cache_green'],
          delivery_status: 'pending',
          retry_count: 0,
          created_at: new Date().toISOString(),
        }, { onConflict: 'user_email,briefing_date,briefing_type' });

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
        await recordToolSuccess(ToolNames.BRIEFINGS);

        // Update log with success (filter by briefing_type to avoid collision)
        await getSupabase().from('briefing_log').update({
          delivery_status: 'sent',
          email_sent_at: new Date().toISOString(),
          tools_included: ['sam_cache_green', 'daily_market_intel'],
        }).eq('user_email', user.email).eq('briefing_date', today).eq('briefing_type', 'daily');

        // Record delivery for rollout tracking (use actual cohortId for proper rotation)
        if (!isTest) {
          await recordBriefingProgramDelivery(activeCohortId, user.email, 'daily_brief');
        }

        const userElapsed = Date.now() - userStartTime;
        console.log(`[SendBriefingsFast] ✅ Sent to ${user.email} (${greenBriefing.opportunities.length} opps, ${userElapsed}ms)`);

      } catch (err) {
        briefingsFailed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;
        errors.push(`${user.email}: ${errorMsg}`);
        console.error(`[SendBriefingsFast] ❌ Failed for ${user.email}:`, err);

        // Log to tool_errors for dashboard visibility (critical tracking)
        await logToolError({
          tool: ToolNames.BRIEFINGS,
          errorType: ErrorTypes.EMAIL_FAILURE,
          errorMessage: errorMsg,
          userEmail: user.email,
          errorStack,
          requestPath: '/api/cron/send-briefings-fast',
        }).catch(() => {}); // Don't let logging failure break the flow

        // Update log with failure (filter by briefing_type to avoid collision)
        await getSupabase().from('briefing_log').update({
          delivery_status: 'failed',
          error_message: errorMsg,
        }).eq('user_email', user.email).eq('briefing_date', today).eq('briefing_type', 'daily');

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
