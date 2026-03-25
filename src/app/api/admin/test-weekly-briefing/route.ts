/**
 * Admin: Test Weekly Deep Dive Briefing
 *
 * GET /api/admin/test-weekly-briefing?password=...&email=user@example.com
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyBriefing } from '@/lib/briefings/delivery/weekly-briefing-generator';

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
    console.log(`[TestWeeklyBriefing] Generating for ${email}...`);

    const briefing = await generateWeeklyBriefing(email, {
      maxOpportunities: 10,
      maxTeamingPlays: 3,
    });

    if (!briefing) {
      return NextResponse.json({
        success: false,
        error: 'Failed to generate briefing - check profile or OpenAI config',
      });
    }

    return NextResponse.json({
      success: true,
      email,
      weekOf: briefing.weekOf,
      opportunities: briefing.opportunities.length,
      teamingPlays: briefing.teamingPlays.length,
      marketSignals: briefing.marketSignals.length,
      calendar: briefing.calendar.length,
      processingTimeMs: briefing.processingTimeMs,
      rawDataAnalyzed: briefing.rawDataSummary,
      briefing,
    });

  } catch (err) {
    console.error('[TestWeeklyBriefing] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
    }, { status: 500 });
  }
}
