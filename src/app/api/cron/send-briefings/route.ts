/**
 * Send Briefings Cron Job
 *
 * Generates and sends daily briefings to all subscribed users.
 * Schedule: 9 AM UTC daily (after all data gathering completes)
 *
 * Process:
 * 1. Get all active subscribers
 * 2. For each user: generate briefing → send email
 * 3. Track delivery status
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  generateBriefing,
  deliverBriefing,
} from '@/lib/briefings/delivery';

const BATCH_SIZE = 10;
const MAX_USERS_PER_RUN = 100;

export async function GET(request: Request) {
  // Verify cron secret for Vercel
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startTime = Date.now();
  let briefingsSent = 0;
  let briefingsFailed = 0;
  const errors: string[] = [];

  console.log('[SendBriefings] Starting daily briefing delivery...');

  try {
    // Step 1: Get active subscribers
    // For Phase 1, we'll use users who have briefing profiles
    const { data: subscribers, error: subError } = await supabase
      .from('user_briefing_profiles')
      .select('user_email, aggregated_profile, preferences, sms_enabled, phone_number')
      .not('aggregated_profile', 'is', null)
      .limit(MAX_USERS_PER_RUN);

    if (subError) {
      throw new Error(`Failed to fetch subscribers: ${subError.message}`);
    }

    if (!subscribers || subscribers.length === 0) {
      console.log('[SendBriefings] No active subscribers');
      return NextResponse.json({
        success: true,
        message: 'No active subscribers',
        briefingsSent: 0,
        elapsed: Date.now() - startTime,
      });
    }

    console.log(`[SendBriefings] Processing ${subscribers.length} subscribers`);

    // Step 2: Process in batches
    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const batch = subscribers.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (subscriber) => {
        try {
          // Generate briefing
          const briefing = await generateBriefing(subscriber.user_email, {
            includeWebIntel: true,
            maxItems: 15,
          });

          if (!briefing || briefing.totalItems === 0) {
            console.log(`[SendBriefings] No items for ${subscriber.user_email}`);
            return;
          }

          // Get delivery preferences
          // Check both schema columns and JSONB preferences for backwards compatibility
          const preferences = subscriber.preferences as {
            delivery_method?: string;
            phone?: string;
          } | null;

          // SMS enabled if column is true OR preference is set
          const smsEnabled = subscriber.sms_enabled === true;
          const phoneNumber = subscriber.phone_number || preferences?.phone;

          // Determine delivery method
          let deliveryMethod: 'email' | 'sms' | 'both' = 'email';
          if (smsEnabled && phoneNumber) {
            deliveryMethod = 'both'; // Always send email + SMS if SMS is enabled
          }

          // Deliver briefing
          const results = await deliverBriefing(briefing, {
            email: subscriber.user_email,
            phone: phoneNumber,
            method: deliveryMethod,
          });

          const anySuccess = results.some((r) => r.success);
          if (anySuccess) {
            briefingsSent++;
            console.log(`[SendBriefings] Sent to ${subscriber.user_email}`);
          } else {
            briefingsFailed++;
            errors.push(`Failed to deliver to ${subscriber.user_email}`);
          }
        } catch (err) {
          briefingsFailed++;
          const errorMsg = `Error processing ${subscriber.user_email}: ${err}`;
          console.error(`[SendBriefings] ${errorMsg}`);
          errors.push(errorMsg);
        }
      });

      await Promise.all(batchPromises);
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[SendBriefings] Complete: ${briefingsSent} sent, ${briefingsFailed} failed, ${elapsed}ms`
    );

    return NextResponse.json({
      success: true,
      briefingsSent,
      briefingsFailed,
      totalSubscribers: subscribers.length,
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
