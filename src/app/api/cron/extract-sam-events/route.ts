/**
 * Cron: Extract Events from SAM.gov Special Notices
 *
 * GET /api/cron/extract-sam-events
 *
 * Scans Special Notices and Presolicitations for industry days,
 * webinars, RFI responses, and other events.
 *
 * Runs daily at 7 AM UTC.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

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

// Keywords that indicate events
const EVENT_KEYWORDS = {
  industry_day: [
    'industry day',
    'vendor day',
    'industry conference',
    'vendor outreach',
    'market research event',
    'industry engagement',
  ],
  webinar: ['webinar', 'virtual event', 'online session', 'video conference', 'zoom meeting'],
  rfi: ['request for information', 'rfi', 'sources sought', 'market survey'],
  forecast: ['forecast', 'projection', 'upcoming procurement', 'planned acquisition'],
};

interface SamOpportunity {
  notice_id: string;
  title: string;
  description: string | null;
  department: string | null;
  notice_type: string;
  posted_date: string | null;
  response_deadline: string | null;
  ui_link: string | null;
}

function classifyEvent(title: string, description: string | null): string | null {
  const text = `${title} ${description || ''}`.toLowerCase();

  for (const [eventType, keywords] of Object.entries(EVENT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return eventType;
      }
    }
  }

  return null;
}

function extractEventDate(text: string): Date | null {
  // Common date patterns in event notices
  const patterns = [
    // "April 15, 2026"
    /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/gi,
    // "15 April 2026"
    /\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/gi,
    // "04/15/2026" or "4/15/26"
    /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        const date = new Date(match[0]);
        if (!isNaN(date.getTime()) && date > new Date()) {
          return date;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

function extractLocation(text: string): string | null {
  // Look for common location patterns
  const patterns = [
    /(?:at|location:|venue:)\s*([^,.\n]+(?:,\s*[A-Z]{2})?)/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2}\s*\d{5})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const dryRun = searchParams.get('dry_run') === 'true';

  const isAuthorized =
    password === ADMIN_PASSWORD || cronSecret === process.env.CRON_SECRET;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  // Fetch Special Notices and Presolicitations from sam_opportunities
  const { data: notices, error: fetchError } = await getSupabase()
    .from('sam_opportunities')
    .select('notice_id, title, description, department, notice_type, posted_date, response_deadline, ui_link')
    .in('notice_type', ['Special Notice', 'Presolicitation', 'Sources Sought'])
    .eq('active', true)
    .order('posted_date', { ascending: false })
    .limit(500);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const events: {
    notice_id: string;
    title: string;
    event_type: string;
    agency: string | null;
    event_date: string | null;
    event_location: string | null;
    description: string | null;
    source_notice_type: string;
  }[] = [];

  for (const notice of notices as SamOpportunity[]) {
    const eventType = classifyEvent(notice.title, notice.description);

    if (eventType) {
      const fullText = `${notice.title} ${notice.description || ''}`;
      const eventDate = extractEventDate(fullText);
      const location = extractLocation(fullText);

      events.push({
        notice_id: notice.notice_id,
        title: notice.title,
        event_type: eventType,
        agency: notice.department,
        event_date: eventDate?.toISOString().split('T')[0] || notice.response_deadline?.split('T')[0] || null,
        event_location: location,
        description: notice.description?.substring(0, 2000) || null,
        source_notice_type: notice.notice_type,
      });
    }
  }

  // Upsert events
  let upsertedCount = 0;
  if (!dryRun && events.length > 0) {
    const { data: upsertData, error: upsertError } = await getSupabase()
      .from('sam_events')
      .upsert(events, { onConflict: 'notice_id', ignoreDuplicates: false })
      .select('id');

    if (upsertError) {
      console.error('[extract-sam-events] Upsert error:', upsertError);
      return NextResponse.json({
        success: false,
        error: upsertError.message,
      }, { status: 500 });
    }

    upsertedCount = upsertData?.length || 0;
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  // Get event type breakdown
  const eventsByType = events.reduce((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`[extract-sam-events] Found ${events.length} events, upserted ${upsertedCount}`);

  return NextResponse.json({
    success: true,
    dryRun,
    stats: {
      noticesScanned: notices?.length || 0,
      eventsFound: events.length,
      eventsUpserted: upsertedCount,
      durationSeconds: duration,
    },
    eventsByType,
    sampleEvents: events.slice(0, 5).map((e) => ({
      title: e.title.substring(0, 80),
      type: e.event_type,
      agency: e.agency,
      date: e.event_date,
    })),
  });
}
