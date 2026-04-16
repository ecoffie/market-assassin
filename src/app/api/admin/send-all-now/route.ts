/**
 * Admin: Send briefings to users in small batches
 *
 * Process users sequentially to avoid Claude API rate limits.
 * Call multiple times with different offsets to process all users.
 *
 * GET ?password=...&mode=preview - Show counts
 * GET ?password=...&mode=execute&limit=5 - Send to N users (default 5)
 * GET ?password=...&mode=execute&offset=5&limit=5 - Send to next N users
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateAIBriefing } from '@/lib/briefings/delivery/ai-briefing-generator';
import { generateAIEmailTemplate } from '@/lib/briefings/delivery/ai-email-template';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const DEFAULT_LIMIT = 10; // Process 10 users at a time (sequential, not parallel)
const DELAY_BETWEEN_USERS_MS = 2000; // 2 second delay between users to avoid rate limits

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';
  const limit = parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT));
  const offset = parseInt(searchParams.get('offset') || '0');
  const clearLog = searchParams.get('clear') === 'true';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  const today = new Date().toISOString().split('T')[0];

  // Get total counts
  // BETA MODE: Send to ALL active users regardless of briefings_enabled flag
  // TODO: After April 27, 2026 beta ends, restore .eq('briefings_enabled', true) filter
  const { count: totalUsers } = await getSupabase()
    .from('user_notification_settings')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);
    // .eq('briefings_enabled', true) // BETA: Commented out

  const { count: alreadySent } = await getSupabase()
    .from('briefing_log')
    .select('*', { count: 'exact', head: true })
    .eq('briefing_date', today)
    .eq('delivery_status', 'sent');

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      today,
      total_users: totalUsers,
      already_sent_today: alreadySent,
      remaining: (totalUsers || 0) - (alreadySent || 0),
      instructions: {
        execute: '?mode=execute&limit=5 - Send to 5 users',
        paginate: '?mode=execute&offset=5&limit=5 - Skip first 5, send next 5',
        clear: '?mode=execute&clear=true - Clear today\'s log first',
      },
    });
  }

  // Execute mode
  console.log(`[SendAllNow] Processing offset=${offset}, limit=${limit}`);

  // Optionally clear today's log
  let deletedCount = 0;
  if (clearLog) {
    const { error: deleteError, count } = await getSupabase()
      .from('briefing_log')
      .delete({ count: 'exact' })
      .eq('briefing_date', today);

    if (deleteError) {
      console.error('[SendAllNow] Failed to clear log:', deleteError);
    } else {
      deletedCount = count || 0;
      console.log(`[SendAllNow] Cleared ${deletedCount} existing log entries`);
    }
  }

  // Get users to process (skip those already sent today)
  // BETA MODE: Send to ALL active users regardless of briefings_enabled flag
  const { data: users, error } = await getSupabase()
    .from('user_notification_settings')
    .select('user_email, naics_codes, agencies')
    .eq('is_active', true)
    // .eq('briefings_enabled', true) // BETA: Commented out
    .order('user_email')
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = {
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
    sent_emails: [] as string[],
  };

  // Process users SEQUENTIALLY (not in parallel) to avoid rate limits
  for (const user of users || []) {
    const email = user.user_email;

    // Check if already sent today
    const { data: existingLog } = await getSupabase()
      .from('briefing_log')
      .select('delivery_status')
      .eq('user_email', email)
      .eq('briefing_date', today)
      .single();

    if (existingLog?.delivery_status === 'sent') {
      console.log(`[SendAllNow] Already sent to ${email}, skipping`);
      results.skipped++;
      continue;
    }

    try {
      console.log(`[SendAllNow] Generating briefing for ${email}...`);

      // Generate AI briefing
      const briefing = await generateAIBriefing(email, {
        maxOpportunities: 10,
        maxTeamingPlays: 3,
      });

      if (!briefing || briefing.opportunities.length === 0) {
        console.log(`[SendAllNow] No opportunities for ${email}, skipping`);
        results.skipped++;
        continue;
      }

      // Log the briefing
      await getSupabase().from('briefing_log').upsert({
        user_email: email,
        briefing_date: today,
        briefing_content: briefing,
        items_count: briefing.opportunities.length + briefing.teamingPlays.length,
        tools_included: ['ai_briefing'],
        delivery_status: 'pending',
        created_at: new Date().toISOString(),
      }, { onConflict: 'user_email,briefing_date' });

      // Generate and send email
      const emailTemplate = generateAIEmailTemplate(briefing);
      await sendEmail({
        to: email,
        subject: emailTemplate.subject,
        html: emailTemplate.htmlBody,
        text: emailTemplate.textBody,
      });

      // Mark as sent
      await getSupabase().from('briefing_log').update({
        delivery_status: 'sent',
        email_sent_at: new Date().toISOString(),
      }).eq('user_email', email).eq('briefing_date', today);

      results.sent++;
      results.sent_emails.push(email);
      console.log(`[SendAllNow] ✅ Sent to ${email}`);

    } catch (err) {
      results.failed++;
      const errorMsg = `${email}: ${err instanceof Error ? err.message : String(err)}`;
      results.errors.push(errorMsg);
      console.error(`[SendAllNow] ❌ Failed for ${email}:`, err);
    }

    // Delay between users to avoid rate limits
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_USERS_MS));
  }

  const nextOffset = offset + limit;
  const hasMore = nextOffset < (totalUsers || 0);

  console.log(`[SendAllNow] Batch complete: ${results.sent} sent, ${results.failed} failed, ${results.skipped} skipped`);

  return NextResponse.json({
    mode: 'execute',
    today,
    cleared_log_entries: deletedCount,
    batch: {
      offset,
      limit,
      processed: users?.length || 0,
    },
    results: {
      sent: results.sent,
      failed: results.failed,
      skipped: results.skipped,
    },
    sent_emails: results.sent_emails,
    errors: results.errors,
    progress: {
      total_users: totalUsers,
      next_offset: hasMore ? nextOffset : null,
      has_more: hasMore,
      next_url: hasMore
        ? `?password=${password}&mode=execute&offset=${nextOffset}&limit=${limit}`
        : null,
    },
  });
}
