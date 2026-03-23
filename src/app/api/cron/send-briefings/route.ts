/**
 * Send Briefings Cron Job
 *
 * Generates and sends daily briefings to ALL users (FREE FOR EVERYONE).
 * Pulls from both user_briefing_profile AND user_alert_settings tables.
 * Schedule: 9 AM UTC daily (after all data gathering completes)
 *
 * Process:
 * 1. Get all users from both tables
 * 2. Deduplicate by email
 * 3. For each user: generate briefing → send email
 * 4. Track delivery status with retry support
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  generateBriefing,
  deliverBriefing,
} from '@/lib/briefings/delivery';

const BATCH_SIZE = 10;
const MAX_USERS_PER_RUN = 200;

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

  console.log('[SendBriefings] Starting daily briefing delivery (FREE FOR ALL)...');

  try {
    // Retry failed briefings from previous runs
    const retryResults = await retryFailedBriefings(supabase);
    if (retryResults.retried > 0) {
      console.log(`[SendBriefings] Retried ${retryResults.retried} failed briefings, ${retryResults.succeeded} succeeded`);
    }

    // Step 1: Get users from BOTH tables
    const allUsers: BriefingUser[] = [];
    const seenEmails = new Set<string>();

    // Get from user_briefing_profile (original source)
    const { data: briefingProfiles } = await supabase
      .from('user_briefing_profile')
      .select('user_email, aggregated_profile, naics_codes, agencies, preferences, sms_enabled, phone_number, timezone')
      .limit(MAX_USERS_PER_RUN);

    if (briefingProfiles) {
      for (const p of briefingProfiles) {
        const email = p.user_email?.toLowerCase();
        if (!email || seenEmails.has(email)) continue;

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

        if (naics.length === 0 && agencies.length === 0) continue;

        seenEmails.add(email);
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

    // Get from user_alert_settings (daily alerts users)
    const { data: alertSettings } = await supabase
      .from('user_alert_settings')
      .select('user_email, naics_codes, target_agencies, timezone, alert_frequency, is_active')
      .eq('is_active', true)
      .limit(MAX_USERS_PER_RUN);

    if (alertSettings) {
      for (const a of alertSettings) {
        const email = a.user_email?.toLowerCase();
        if (!email || seenEmails.has(email)) continue;

        const naics = a.naics_codes || [];
        const agencies = a.target_agencies || [];

        if (naics.length === 0) continue;

        seenEmails.add(email);
        allUsers.push({
          email,
          naics_codes: naics,
          agencies,
          timezone: a.timezone,
          source: 'alert_settings',
        });
      }
    }

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

    console.log(`[SendBriefings] Processing ${usersToProcess.length} users (${allUsers.length - usersToProcess.length} filtered/deduped)`);

    // Step 2: Process in batches
    for (let i = 0; i < usersToProcess.length; i += BATCH_SIZE) {
      const batch = usersToProcess.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (user) => {
        try {
          // Check timezone (skip if not delivery time, unless test mode)
          if (!testEmail && !isDeliveryTimeForTimezone(user.timezone)) {
            console.log(`[SendBriefings] ${user.email} timezone ${user.timezone || 'ET'} - not delivery time, skipping`);
            briefingsSkipped++;
            return;
          }

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
            return;
          }

          // Generate briefing
          const briefing = await generateBriefing(user.email, {
            includeWebIntel: true,
            maxItems: 15,
          });

          if (!briefing || briefing.totalItems === 0) {
            console.log(`[SendBriefings] No items for ${user.email}`);
            briefingsSkipped++;
            return;
          }

          // Persist briefing to briefing_log
          try {
            await supabase.from('briefing_log').upsert({
              user_email: user.email,
              briefing_date: briefing.briefingDate,
              briefing_content: briefing,
              items_count: briefing.totalItems,
              tools_included: briefing.sourcesIncluded,
              delivery_status: 'pending',
              retry_count: 0,
              created_at: new Date().toISOString(),
            }, { onConflict: 'user_email,briefing_date' });
          } catch (logErr) {
            console.error(`[SendBriefings] Failed to log briefing for ${user.email}:`, logErr);
          }

          // Determine delivery method
          let deliveryMethod: 'email' | 'sms' | 'both' = 'email';
          if (user.sms_enabled && user.phone_number) {
            deliveryMethod = 'both';
          }

          // Deliver briefing
          const results = await deliverBriefing(briefing, {
            email: user.email,
            phone: user.phone_number,
            method: deliveryMethod,
          });

          const anySuccess = results.some((r) => r.success);
          if (anySuccess) {
            briefingsSent++;
            console.log(`[SendBriefings] ✅ Sent to ${user.email}`);

            await supabase.from('briefing_log').update({
              delivery_status: 'sent',
              email_sent_at: new Date().toISOString(),
            }).eq('user_email', user.email)
              .eq('briefing_date', briefing.briefingDate);
          } else {
            briefingsFailed++;
            const errorMsg = results.map(r => r.error).filter(Boolean).join(', ');
            errors.push(`${user.email}: ${errorMsg}`);

            await supabase.from('briefing_log').update({
              delivery_status: 'failed',
              error_message: errorMsg,
            }).eq('user_email', user.email)
              .eq('briefing_date', briefing.briefingDate);
          }
        } catch (err) {
          briefingsFailed++;
          const errorMsg = `Error processing ${user.email}: ${err}`;
          console.error(`[SendBriefings] ${errorMsg}`);
          errors.push(errorMsg);
        }
      });

      await Promise.all(batchPromises);
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[SendBriefings] Complete: ${briefingsSent} sent, ${briefingsSkipped} skipped, ${briefingsFailed} failed, ${elapsed}ms`
    );

    return NextResponse.json({
      success: true,
      briefingsSent,
      briefingsSkipped,
      briefingsFailed,
      totalUsers: usersToProcess.length,
      retryResults,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      elapsed,
    });
  } catch (error) {
    console.error('[SendBriefings] Fatal error:', error);
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

      // Re-deliver
      const deliveryResults = await deliverBriefing(briefing.briefing_content, {
        email: briefing.user_email,
        method: 'email',
      });

      if (deliveryResults.some(r => r.success)) {
        await supabase.from('briefing_log').update({
          delivery_status: 'sent',
          email_sent_at: new Date().toISOString(),
          error_message: null,
        }).eq('id', briefing.id);

        results.succeeded++;
        console.log(`[SendBriefings] Retry succeeded for ${briefing.user_email}`);
      } else {
        await supabase.from('briefing_log').update({
          retry_count: (briefing.retry_count || 0) + 1,
        }).eq('id', briefing.id);
      }
    } catch (err: any) {
      await supabase.from('briefing_log').update({
        retry_count: (briefing.retry_count || 0) + 1,
        error_message: err.message,
      }).eq('id', briefing.id);

      console.error(`[SendBriefings] Retry failed for ${briefing.user_email}:`, err.message);
    }
  }

  return results;
}
