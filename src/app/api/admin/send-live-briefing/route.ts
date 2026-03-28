/**
 * Admin: Send briefing using the EXISTING briefing system
 *
 * GET /api/admin/send-live-briefing?password=...&email=user@example.com
 *
 * Uses the proper briefing generator pipeline with all 3 formats:
 * 1) Recompete Alerts (Displacement Intel)
 * 2) Teaming Intel
 * 3) Market Intel (awards, competitor wins)
 *
 * This triggers the same system used by the daily cron job.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateBriefing, deliverBriefing } from '@/lib/briefings/delivery';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  try {
    console.log(`[LiveBriefing] Generating briefing for ${email} using main pipeline...`);

    // Generate briefing using the FULL system (snapshots, diff engine, etc.)
    const briefing = await generateBriefing(email, {
      includeWebIntel: true,
      maxItems: 15,
    });

    if (!briefing) {
      return NextResponse.json({
        success: false,
        error: 'No briefing generated. User may not have profile data or no items matched.',
        help: 'Ensure user has briefing profile with NAICS codes/agencies set up.',
      }, { status: 400 });
    }

    if (briefing.totalItems === 0) {
      return NextResponse.json({
        success: false,
        error: 'Briefing generated but has 0 items. No matching data found.',
        briefingDate: briefing.briefingDate,
        sourcesIncluded: briefing.sourcesIncluded,
      }, { status: 400 });
    }

    // Deliver briefing via email
    const results = await deliverBriefing(briefing, {
      email,
      method: 'email',
    });

    const anySuccess = results.some(r => r.success);

    return NextResponse.json({
      success: anySuccess,
      email,
      briefingDate: briefing.briefingDate,
      totalItems: briefing.totalItems,
      sourcesIncluded: briefing.sourcesIncluded,
      summary: briefing.summary,
      categorizedItems: Object.keys(briefing.categorizedItems).map(cat => ({
        category: cat,
        count: briefing.categorizedItems[cat].items.length,
      })),
      deliveryResults: results,
      processingTimeMs: briefing.processingTimeMs,
    });

  } catch (err) {
    console.error('[LiveBriefing] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

