/**
 * Admin: Generate AND SEND a test briefing for a single user
 *
 * GET /api/admin/send-test-briefing?password=...&email=user@example.com
 *
 * Generates a briefing, saves to briefing_log, and SENDS via email.
 * Use this for testing the full email delivery flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateBriefing } from '@/lib/briefings/delivery';
import { sendBriefingEmail } from '@/lib/briefings/delivery/sender';
import { generateEmailTemplate } from '@/lib/briefings/delivery/email-template';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();
  const preview = searchParams.get('preview') === 'true'; // Just show HTML, don't send

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Ensure user has a briefing profile (auto-create default if missing)
    const { data: existingProfile } = await supabase
      .from('user_briefing_profile')
      .select('user_email')
      .eq('user_email', email)
      .single();

    if (!existingProfile) {
      console.log(`[SendTestBriefing] Creating default briefing profile for ${email}`);
      const defaultProfile = {
        naics_codes: ['541512', '541511', '541519', '541513', '541330'],
        agencies: [
          'Department of Defense',
          'Department of Homeland Security',
          'Department of Veterans Affairs',
          'General Services Administration',
          'Department of Health and Human Services',
        ],
        keywords: ['cybersecurity', 'IT modernization', 'cloud', 'data analytics', 'small business'],
        zip_codes: [],
        watched_companies: [],
        watched_contracts: [],
      };

      await supabase.from('user_briefing_profile').upsert({
        user_email: email,
        aggregated_profile: defaultProfile,
        naics_codes: defaultProfile.naics_codes,
        agencies: defaultProfile.agencies,
        keywords: defaultProfile.keywords,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_email' });
    }

    console.log(`[SendTestBriefing] Generating briefing for ${email}...`);

    const briefing = await generateBriefing(email, {
      includeWebIntel: true,
      maxItems: 15,
    });

    if (!briefing || briefing.totalItems === 0) {
      return NextResponse.json({
        success: false,
        message: 'Briefing generated but has 0 items. Snapshot data may be missing.',
        email,
        hint: 'Run /api/admin/seed-test-briefing first to seed mock data, or wait for daily crons to populate snapshots.',
      });
    }

    // Save to briefing_log
    const { error: upsertError } = await supabase.from('briefing_log').upsert({
      user_email: email,
      briefing_date: briefing.briefingDate,
      briefing_content: briefing,
      items_count: briefing.totalItems,
      tools_included: briefing.sourcesIncluded,
      delivery_status: 'pending',
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_email,briefing_date' });

    if (upsertError) {
      console.error('[SendTestBriefing] Upsert error:', upsertError);
    }

    // Preview mode: return HTML without sending
    if (preview) {
      const template = generateEmailTemplate(briefing);
      return new NextResponse(template.htmlBody, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // SEND THE EMAIL
    console.log(`[SendTestBriefing] Sending email to ${email}...`);
    const deliveryResult = await sendBriefingEmail(briefing, email);

    // Update delivery status
    if (deliveryResult.success) {
      await supabase
        .from('briefing_log')
        .update({ delivery_status: 'sent' })
        .eq('user_email', email)
        .eq('briefing_date', briefing.briefingDate);
    }

    return NextResponse.json({
      success: deliveryResult.success,
      email,
      briefing_date: briefing.briefingDate,
      total_items: briefing.totalItems,
      sources: briefing.sourcesIncluded,
      headline: briefing.summary.headline,
      delivery: {
        method: 'email',
        success: deliveryResult.success,
        messageId: deliveryResult.messageId,
        error: deliveryResult.error,
      },
      preview_url: `${request.url}&preview=true`,
    });
  } catch (err) {
    console.error('[SendTestBriefing] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
      email,
    }, { status: 500 });
  }
}
