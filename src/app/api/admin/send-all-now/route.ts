/**
 * Admin: Send briefings to ALL users NOW
 *
 * Clears today's briefing_log entries and sends fresh briefings to everyone.
 * Uses the working generateAIBriefing function (same as cron).
 *
 * GET ?password=...&mode=preview - Show what will happen
 * GET ?password=...&mode=execute - Actually send to everyone
 * GET ?password=...&mode=execute&limit=100 - Send to first N users
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateAIBriefing } from '@/lib/briefings/delivery/ai-briefing-generator';
import { generateAIEmailTemplate } from '@/lib/briefings/delivery/ai-email-template';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const BATCH_SIZE = 10;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';
  const limit = parseInt(searchParams.get('limit') || '1000');
  const offset = parseInt(searchParams.get('offset') || '0');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const today = new Date().toISOString().split('T')[0];

  // Get all users with briefings enabled
  const { data: users, error, count } = await supabase
    .from('user_notification_settings')
    .select('user_email, naics_codes, agencies', { count: 'exact' })
    .eq('is_active', true)
    .eq('briefings_enabled', true)
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Check how many have already been sent today
  const { count: alreadySent } = await supabase
    .from('briefing_log')
    .select('*', { count: 'exact', head: true })
    .eq('briefing_date', today)
    .eq('delivery_status', 'sent');

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      today,
      total_users: count,
      users_in_batch: users?.length || 0,
      already_sent_today: alreadySent,
      offset,
      limit,
      instructions: 'Add ?mode=execute to clear today\'s log and send fresh briefings to everyone',
      warning: 'This will DELETE all briefing_log entries for today and resend',
    });
  }

  // Execute mode
  console.log(`[SendAllNow] Starting bulk send to ${users?.length} users...`);

  // Step 1: Clear today's briefing_log entries to allow resend
  const { error: deleteError, count: deletedCount } = await supabase
    .from('briefing_log')
    .delete({ count: 'exact' })
    .eq('briefing_date', today);

  if (deleteError) {
    console.error('[SendAllNow] Failed to clear log:', deleteError);
  } else {
    console.log(`[SendAllNow] Cleared ${deletedCount} existing log entries for today`);
  }

  const results = {
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
    sent_emails: [] as string[],
  };

  // Step 2: Process users in batches
  for (let i = 0; i < (users?.length || 0); i += BATCH_SIZE) {
    const batch = users!.slice(i, i + BATCH_SIZE);
    console.log(`[SendAllNow] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(users!.length/BATCH_SIZE)}`);

    await Promise.all(batch.map(async (user) => {
      const email = user.user_email;

      try {
        // Generate AI briefing (same function as cron)
        const briefing = await generateAIBriefing(email, {
          maxOpportunities: 10,
          maxTeamingPlays: 3,
        });

        if (!briefing || briefing.opportunities.length === 0) {
          console.log(`[SendAllNow] No opportunities for ${email}, skipping`);
          results.skipped++;
          return;
        }

        // Log the briefing
        await supabase.from('briefing_log').upsert({
          user_email: email,
          briefing_date: today,
          briefing_content: briefing,
          items_count: briefing.opportunities.length + briefing.teamingPlays.length,
          tools_included: ['ai_briefing'],
          delivery_status: 'pending',
          created_at: new Date().toISOString(),
        }, { onConflict: 'user_email,briefing_date' });

        // Generate email
        const emailTemplate = generateAIEmailTemplate(briefing);

        // Send email
        await sendEmail({
          to: email,
          subject: emailTemplate.subject,
          html: emailTemplate.htmlBody,
          text: emailTemplate.textBody,
        });

        // Mark as sent
        await supabase.from('briefing_log').update({
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
    }));

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < (users?.length || 0)) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`[SendAllNow] Complete: ${results.sent} sent, ${results.failed} failed, ${results.skipped} skipped`);

  return NextResponse.json({
    mode: 'execute',
    today,
    cleared_log_entries: deletedCount,
    total_users: users?.length || 0,
    sent: results.sent,
    failed: results.failed,
    skipped: results.skipped,
    sent_emails: results.sent_emails.slice(0, 20), // First 20 for display
    errors: results.errors.slice(0, 10), // First 10 errors
    next_offset: offset + limit,
  });
}
