/**
 * Admin: Trigger catch-up briefings for today
 *
 * Calls the send-briefings-fast logic directly to process remaining users.
 * Use when the daily cron window has passed.
 *
 * GET ?password=xxx - Preview mode (show counts)
 * GET ?password=xxx&mode=execute - Execute and send briefings
 * GET ?password=xxx&mode=execute&batch=1 - Run multiple batches (1-5)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunitiesFromCache } from '@/lib/briefings/pipelines/sam-gov';
import { generateDailyBriefFromSam, generateSamGreenEmailHtml } from '@/lib/briefings/delivery/sam-green-email-template';
import { resolveBriefingAudience } from '@/lib/briefings/delivery/rollout';
import { sendEmail } from '@/lib/send-email';
import { DEFAULT_NAICS_CODES } from '@/lib/config/defaults';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const BATCH_SIZE = 10; // Reduced to fit within 60s Vercel timeout (~6s/user)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';
  const batches = parseInt(searchParams.get('batch') || '1');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({
      endpoint: '/api/admin/trigger-catchup-briefings',
      description: 'Trigger catch-up briefings when daily cron window has passed',
      usage: '?password=xxx&mode=execute&batch=1',
    });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const today = new Date().toISOString().split('T')[0];

  // Get counts
  const { data: processedToday } = await supabase
    .from('briefing_log')
    .select('user_email, delivery_status')
    .eq('briefing_date', today)
    .in('delivery_status', ['sent', 'skipped']);

  const processedEmails = new Set((processedToday || []).map((s: { user_email: string }) => s.user_email));
  const sentCount = (processedToday || []).filter((s: { delivery_status: string }) => s.delivery_status === 'sent').length;
  const skippedCount = (processedToday || []).filter((s: { delivery_status: string }) => s.delivery_status === 'skipped').length;

  // Get total eligible users
  const audienceResolution = await resolveBriefingAudience(supabase);
  const totalEligible = audienceResolution.users.length;
  const remaining = audienceResolution.users.filter(u => !processedEmails.has(u.email)).length;

  if (mode === 'preview') {
    return NextResponse.json({
      today,
      totalEligible,
      sentToday: sentCount,
      skippedToday: skippedCount,
      remaining,
      batchSize: BATCH_SIZE,
      estimatedBatches: Math.ceil(remaining / BATCH_SIZE),
      instructions: {
        execute: '?password=xxx&mode=execute - Run 1 batch',
        multiple: '?password=xxx&mode=execute&batch=3 - Run 3 batches',
      },
    });
  }

  // Execute mode
  const startTime = Date.now();
  let totalSent = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const errors: string[] = [];

  for (let batch = 0; batch < batches; batch++) {
    // Refresh audience to exclude newly processed users
    const freshAudience = await resolveBriefingAudience(supabase);
    const { data: freshProcessed } = await supabase
      .from('briefing_log')
      .select('user_email')
      .eq('briefing_date', today)
      .in('delivery_status', ['sent', 'skipped']);

    const freshProcessedEmails = new Set((freshProcessed || []).map((s: { user_email: string }) => s.user_email));
    const usersToProcess = freshAudience.users
      .filter(u => !freshProcessedEmails.has(u.email))
      .slice(0, BATCH_SIZE);

    if (usersToProcess.length === 0) {
      console.log(`[CatchupBriefings] Batch ${batch + 1}: No more users to process`);
      break;
    }

    console.log(`[CatchupBriefings] Batch ${batch + 1}: Processing ${usersToProcess.length} users`);

    for (const user of usersToProcess) {
      try {
        const userNaics = user.naics_codes?.length > 0 ? user.naics_codes : DEFAULT_NAICS_CODES;
        const userPsc = user.psc_codes || [];
        const userKeywords = user.keywords || [];

        const samResult = await fetchSamOpportunitiesFromCache({
          naicsCodes: userNaics.slice(0, 10),
          pscCodes: userPsc.slice(0, 10),
          keywords: userKeywords.slice(0, 10),
          limit: 25,
        });

        if (samResult.opportunities.length === 0) {
          await supabase.from('briefing_log').upsert({
            user_email: user.email,
            briefing_date: today,
            briefing_type: 'daily',
            briefing_content: { message: 'No opportunities found', naics: userNaics },
            items_count: 0,
            tools_included: ['catchup', 'no_opportunities'],
            delivery_status: 'skipped',
            created_at: new Date().toISOString(),
          }, { onConflict: 'user_email,briefing_date,briefing_type' });
          totalSkipped++;
          continue;
        }

        const greenBriefing = await generateDailyBriefFromSam(samResult.opportunities);

        await supabase.from('briefing_log').upsert({
          user_email: user.email,
          briefing_date: today,
          briefing_type: 'daily',
          briefing_content: greenBriefing,
          items_count: greenBriefing.opportunities.length,
          tools_included: ['catchup', 'sam_cache_green'],
          delivery_status: 'pending',
          created_at: new Date().toISOString(),
        }, { onConflict: 'user_email,briefing_date,briefing_type' });

        const emailTemplate = generateSamGreenEmailHtml(greenBriefing, user.email);
        await sendEmail({
          to: user.email,
          subject: emailTemplate.subject,
          html: emailTemplate.htmlBody,
          text: emailTemplate.textBody,
        });

        await supabase.from('briefing_log').update({
          delivery_status: 'sent',
          email_sent_at: new Date().toISOString(),
        }).eq('user_email', user.email).eq('briefing_date', today);

        totalSent++;
        console.log(`[CatchupBriefings] ✅ Sent to ${user.email}`);

      } catch (err) {
        totalFailed++;
        const errorMsg = `${user.email}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(errorMsg);
        console.error(`[CatchupBriefings] ❌ Failed for ${user.email}:`, err);

        await supabase.from('briefing_log').upsert({
          user_email: user.email,
          briefing_date: today,
          briefing_type: 'daily',
          delivery_status: 'failed',
          error_message: err instanceof Error ? err.message : String(err),
          created_at: new Date().toISOString(),
        }, { onConflict: 'user_email,briefing_date,briefing_type' });
      }
    }
  }

  const elapsed = Date.now() - startTime;

  return NextResponse.json({
    success: true,
    today,
    batchesRun: batches,
    results: {
      sent: totalSent,
      skipped: totalSkipped,
      failed: totalFailed,
    },
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    elapsed,
  });
}
