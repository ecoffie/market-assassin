/**
 * Briefing Interaction Tracking API
 *
 * POST /api/profile/track
 * - Record briefing open, click, or action
 *
 * Body: BriefingInteraction
 */

import { NextRequest, NextResponse } from 'next/server';
import { recordInteraction, BriefingInteraction } from '@/lib/smart-profile';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const interaction: BriefingInteraction = {
      userEmail: body.userEmail || body.email,
      briefingId: body.briefingId,
      briefingDate: body.briefingDate || new Date().toISOString().split('T')[0],
      interactionType: body.interactionType || body.type,
      itemType: body.itemType,
      itemId: body.itemId,
      itemNaics: body.itemNaics || body.naics,
      itemAgency: body.itemAgency || body.agency,
      itemValue: body.itemValue || body.value,
      section: body.section,
      position: body.position,
      deviceType: body.deviceType || body.device,
    };

    if (!interaction.userEmail) {
      return NextResponse.json({ error: 'userEmail required' }, { status: 400 });
    }

    if (!interaction.interactionType) {
      return NextResponse.json({ error: 'interactionType required' }, { status: 400 });
    }

    await recordInteraction(interaction);

    return NextResponse.json({
      success: true,
      message: 'Interaction recorded',
    });
  } catch (error) {
    console.error('[TrackAPI] Error recording interaction:', error);
    return NextResponse.json({ error: 'Failed to record interaction' }, { status: 500 });
  }
}

// Also handle GET for tracking pixels (email opens)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email') || searchParams.get('e');
  const briefingId = searchParams.get('bid') || searchParams.get('b');
  const type = searchParams.get('type') || 'open';

  if (email) {
    await recordInteraction({
      userEmail: email,
      briefingId: briefingId || 'unknown',
      briefingDate: new Date().toISOString().split('T')[0],
      interactionType: type as 'open' | 'click',
    });
  }

  // Return 1x1 transparent GIF
  const gif = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );

  return new NextResponse(gif, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}
