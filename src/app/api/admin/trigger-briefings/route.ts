/**
 * Admin: Manually trigger daily briefing send to all users
 *
 * GET /api/admin/trigger-briefings?password=...&mode=preview
 * GET /api/admin/trigger-briefings?password=...&mode=execute
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateBriefing, deliverBriefing } from '@/lib/briefings/delivery';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const BATCH_SIZE = 5;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';
  const limit = parseInt(searchParams.get('limit') || '50');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get users with briefing profiles
  const { data: profiles, error } = await supabase
    .from('user_briefing_profile')
    .select('user_email, naics_codes, agencies')
    .not('naics_codes', 'eq', '{}')
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const validProfiles = profiles?.filter(p =>
    p.user_email &&
    p.naics_codes?.length > 0
  ) || [];

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      total_profiles: profiles?.length || 0,
      valid_for_send: validProfiles.length,
      will_send_to: validProfiles.map(p => ({
        email: p.user_email,
        naics_count: p.naics_codes?.length || 0,
        agency_count: p.agencies?.length || 0,
      })),
      instructions: 'Add ?mode=execute to send briefings',
    });
  }

  // Execute mode - send briefings
  const results = {
    sent: [] as string[],
    failed: [] as { email: string; error: string }[],
    skipped: [] as string[],
  };

  const today = new Date().toISOString().split('T')[0];

  for (let i = 0; i < validProfiles.length; i += BATCH_SIZE) {
    const batch = validProfiles.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (profile) => {
      const email = profile.user_email;

      try {
        // Generate briefing
        const briefing = await generateBriefing(email, {
          includeWebIntel: true,
          maxItems: 15,
        });

        if (!briefing || briefing.totalItems === 0) {
          results.skipped.push(email);
          return;
        }

        // Save to briefing_log
        await supabase.from('briefing_log').upsert({
          user_email: email,
          briefing_date: today,
          briefing_content: briefing,
          items_count: briefing.totalItems,
          tools_included: briefing.sourcesIncluded,
          delivery_status: 'pending',
          created_at: new Date().toISOString(),
        }, { onConflict: 'user_email,briefing_date' });

        // Send email
        const deliveryResults = await deliverBriefing(briefing, {
          email,
          method: 'email',
        });

        const emailResult = deliveryResults.find(r => r.method === 'email');
        if (emailResult?.success) {
          results.sent.push(email);

          // Update delivery status
          await supabase
            .from('briefing_log')
            .update({ delivery_status: 'sent' })
            .eq('user_email', email)
            .eq('briefing_date', today);
        } else {
          results.failed.push({
            email,
            error: emailResult?.error || 'Email delivery failed'
          });
        }
      } catch (err) {
        results.failed.push({
          email,
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    }));

    // Small delay between batches
    if (i + BATCH_SIZE < validProfiles.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return NextResponse.json({
    mode: 'execute',
    date: today,
    sent: results.sent.length,
    failed: results.failed.length,
    skipped: results.skipped.length,
    sent_to: results.sent,
    failures: results.failed,
    skipped_emails: results.skipped,
  });
}
