/**
 * /api/app/triage — Start Tracking Targets flow
 *
 * Powers the StartTrackingModal in MarketResearchPanel. Users triage
 * agency offices one at a time with three actions:
 *   - track  → write to user_target_list (existing flow)
 *   - defer  → write to user_dismissed_targets with reason='defer' + 30d cooldown
 *   - skip   → write to user_dismissed_targets with reason='skip' (permanent for this NAICS profile)
 *
 * GET ?email=&naics=&offices=<json>  → returns next batch of agencies to triage
 *   - email: user email (auth lookup)
 *   - naics: comma-separated NAICS codes (drives the profile hash)
 *   - offices: optional JSON array of {office_name, agency_name, sub_agency_name, payload...}
 *     If passed, server filters this list against already-tracked + dismissed.
 *     If omitted, server returns 'eligible' filter criteria only and the
 *     client filters its own tmrRows in-memory (preferred path — avoids
 *     re-fetching the whole agency list).
 *
 * POST body { action, office_name, agency_name?, sub_agency_name?, naics, full_row? }
 *   - action='track': delegates to user_target_list insert (mirrors existing /api/app/target-list POST)
 *   - action='defer': upserts user_dismissed_targets with defer_until=NOW+30d
 *   - action='skip':  upserts user_dismissed_targets with reason='skip', defer_until=null
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

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

// Same hash function used by precompute-briefings so the profile keys
// are consistent across the app. Sort + md5 of NAICS codes.
function hashNaicsProfile(naicsCodes: string[]): string {
  const sorted = [...naicsCodes].map(c => c.trim()).filter(Boolean).sort();
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
}

function parseNaicsParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map(c => c.trim()).filter(Boolean);
}

/**
 * GET /api/app/triage?email=&naics=
 *
 * Returns the user's dismissal context: which office names are tracked
 * (so client can hide them), which are dismissed (skip or unexpired defer).
 * Client uses this to filter its own tmrRows in-memory — avoids a second
 * full agency-list fetch.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email')?.toLowerCase().trim();
  const naicsRaw = url.searchParams.get('naics');

  if (!email) {
    return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
  }
  // Reads the caller's private target list — require they own this email.
  const gate = requireMIAuthSession(request, email);
  if (!gate.ok) return gate.response;
  // Coach Mode: read the ACTIVE CLIENT's target list / dismissals, not the coach's.
  const { workspaceId: gWs, asClient: gAsClient } = await resolveActiveWorkspace(email, request);
  const readEmail = gAsClient ? clientNotificationEmail(gWs) : email;
  const naicsCodes = parseNaicsParam(naicsRaw);
  if (naicsCodes.length === 0) {
    return NextResponse.json({ success: false, error: 'naics is required' }, { status: 400 });
  }

  const naicsProfile = hashNaicsProfile(naicsCodes);
  const supabase = getSupabase();

  // Tracked office_names — sourced from user_target_list directly so
  // the client doesn't have to make a second call.
  const { data: tracked, error: trackedErr } = await supabase
    .from('user_target_list')
    .select('office_name')
    .eq('user_email', readEmail);
  if (trackedErr) {
    console.warn('[triage GET] tracked query failed:', trackedErr);
  }

  // Dismissed office_names for this NAICS profile. Skip = forever;
  // Defer = only if defer_until is in the future. SQL handles both
  // in one query.
  const { data: dismissed, error: dismissedErr } = await supabase
    .from('user_dismissed_targets')
    .select('office_name, reason, defer_until')
    .eq('user_email', readEmail)
    .eq('naics_profile', naicsProfile);
  if (dismissedErr) {
    console.warn('[triage GET] dismissed query failed:', dismissedErr);
  }

  const now = Date.now();
  const activeDismissals = (dismissed || []).filter((row: { reason: string; defer_until: string | null }) => {
    if (row.reason === 'skip') return true;
    if (row.reason === 'defer' && row.defer_until) {
      return new Date(row.defer_until).getTime() > now;
    }
    return false;
  });

  return NextResponse.json({
    success: true,
    naics_profile: naicsProfile,
    tracked_office_names: (tracked || []).map((r: { office_name: string }) => r.office_name),
    dismissed_office_names: activeDismissals.map((r: { office_name: string }) => r.office_name),
    tracked_count: (tracked || []).length,
    dismissed_count: activeDismissals.length,
  });
}

/**
 * POST /api/app/triage
 *
 * Records one triage action. Body:
 *   {
 *     action: 'track' | 'defer' | 'skip',
 *     email: string,
 *     naics: string,                     // comma-separated codes (drives profile hash)
 *     office_name: string,
 *     agency_name?: string,
 *     sub_agency_name?: string,
 *     // For action='track', the full row payload that user_target_list expects:
 *     track_payload?: {
 *       agency_code, sub_agency_code, office_code, location,
 *       set_aside_spending, contract_count, sat_ratio,
 *       pain_point_count, open_opp_count, upcoming_event_count
 *     }
 *   }
 */
export async function POST(request: NextRequest) {
  let body: {
    action?: 'track' | 'defer' | 'skip';
    email?: string;
    naics?: string;
    office_name?: string;
    agency_name?: string;
    sub_agency_name?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    track_payload?: Record<string, any>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON' }, { status: 400 });
  }

  const { action, email: rawEmail, naics, office_name, agency_name, sub_agency_name } = body;
  const email = rawEmail?.toLowerCase().trim();

  if (!action || !['track', 'defer', 'skip'].includes(action)) {
    return NextResponse.json({ success: false, error: 'action must be track | defer | skip' }, { status: 400 });
  }
  if (!email || !office_name) {
    return NextResponse.json({ success: false, error: 'email and office_name are required' }, { status: 400 });
  }
  // Writes to the caller's private target list — require they own this email.
  const gate = requireMIAuthSession(request, email);
  if (!gate.ok) return gate.response;
  // Coach Mode: track/dismiss on behalf of the ACTIVE CLIENT, not the coach.
  const { workspaceId: pWs, asClient: pAsClient } = await resolveActiveWorkspace(email, request);
  const writeEmail = pAsClient ? clientNotificationEmail(pWs) : email;
  const naicsCodes = parseNaicsParam(naics || null);
  if (naicsCodes.length === 0) {
    return NextResponse.json({ success: false, error: 'naics is required' }, { status: 400 });
  }
  const naicsProfile = hashNaicsProfile(naicsCodes);
  const supabase = getSupabase();

  if (action === 'track') {
    // Mirror the existing /api/app/target-list POST shape. We could
    // also POST to that route internally, but inline insert avoids
    // an extra round trip and keeps auth simple.
    const payload = body.track_payload || {};
    const insertPayload = {
      user_email: writeEmail,
      agency_name: agency_name || office_name,
      sub_agency_name: sub_agency_name || null,
      office_name,
      added_from: 'triage_modal',
      agency_code: payload.agency_code || null,
      sub_agency_code: payload.sub_agency_code || null,
      office_code: payload.office_code || null,
      location: payload.location || null,
      set_aside_spending: Number(payload.set_aside_spending || 0),
      contract_count: Number(payload.contract_count || 0),
      sat_ratio: Number(payload.sat_ratio || 0),
      pain_point_count: Number(payload.pain_point_count || 0),
      open_opp_count: Number(payload.open_opp_count || 0),
      upcoming_event_count: Number(payload.upcoming_event_count || 0),
    };

    const { data, error } = await supabase
      .from('user_target_list')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      // 23505 = unique violation. Treat as success (already tracked).
      if (error.code === '23505') {
        return NextResponse.json({ success: true, action: 'track', already_tracked: true });
      }
      console.error('[triage POST track] insert failed:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, action: 'track', target: data });
  }

  // defer / skip → write to user_dismissed_targets
  const deferUntil = action === 'defer'
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const dismissalPayload = {
    user_email: writeEmail,
    office_name,
    agency_name: agency_name || null,
    sub_agency_name: sub_agency_name || null,
    naics_profile: naicsProfile,
    reason: action,
    defer_until: deferUntil,
    dismissed_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_dismissed_targets')
    .upsert(dismissalPayload, { onConflict: 'user_email,office_name,naics_profile' });

  if (error) {
    console.error(`[triage POST ${action}] upsert failed:`, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    action,
    defer_until: deferUntil,
  });
}
