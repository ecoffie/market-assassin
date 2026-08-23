/**
 * POST /api/opportunities/save
 *
 * Save/favorite an opportunity and trigger Pursuit Brief generation.
 *
 * Body:
 * - email: user email
 * - noticeId: SAM.gov notice ID
 * - opportunityData: full opportunity object (optional, will fetch if not provided)
 * - source: 'daily_alert' | 'daily_brief' | 'manual' | 'opportunity_hunter'
 * - requestPursuitBrief: boolean (default true)
 *
 * Returns saved opportunity and optionally triggers pursuit brief generation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      noticeId,
      opportunityData,
      source = 'manual',
      requestPursuitBrief = true,
    } = body;

    if (!email || !noticeId) {
      return NextResponse.json(
        { error: 'Missing required fields: email and noticeId' },
        { status: 400 }
      );
    }

    // SECURITY: Verify user owns this email
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    // Check if user has alert settings (they should be backfilled)
    const { data: userSettings, error: userSettingsErr } = await supabase
      .from('user_notification_settings')
      .select('user_email, briefings_enabled')
      .eq('user_email', email.toLowerCase())
      .maybeSingle(); // may not exist yet — returns null instead of PGRST116
    if (userSettingsErr) console.error('[opportunities/save] settings query error:', userSettingsErr.message);

    if (!userSettings) {
      return NextResponse.json(
        { error: 'User not found. Please set up your alert preferences first.' },
        { status: 404 }
      );
    }

    // If no opportunityData provided, we'd need to fetch from SAM.gov
    // For now, require it to be passed (comes from the email link)
    let oppData = opportunityData;
    if (!oppData) {
      // Minimal placeholder - in production would fetch from SAM.gov
      oppData = {
        noticeId,
        title: 'Unknown Opportunity',
        fetchedAt: new Date().toISOString(),
      };
    }

    // Save the opportunity
    const { data: savedOpp, error: saveError } = await supabase
      .from('user_saved_opportunities')
      .upsert({
        user_email: email.toLowerCase(),
        notice_id: noticeId,
        solicitation_number: oppData.solicitationNumber || oppData.solicitation_number,
        opportunity_data: oppData,
        title: oppData.title,
        agency: oppData.department || oppData.agency,
        naics_code: oppData.naicsCode || oppData.naics_code,
        set_aside: oppData.setAside || oppData.set_aside,
        response_deadline: oppData.responseDeadline || oppData.response_deadline,
        posted_date: oppData.postedDate || oppData.posted_date,
        estimated_value: oppData.estimatedValue || oppData.estimated_value,
        source,
        pursuit_brief_requested: requestPursuitBrief,
        status: 'watching',
      }, {
        onConflict: 'user_email,notice_id',
      })
      .select()
      .single();

    if (saveError) {
      console.error('[Save Opportunity] Error:', saveError);
      return NextResponse.json(
        { error: 'Failed to save opportunity', details: saveError.message },
        { status: 500 }
      );
    }

    // If pursuit brief requested, trigger async generation
    if (requestPursuitBrief) {
      // Fire and forget - call the pursuit brief endpoint
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';
      fetch(`${baseUrl}/api/opportunities/pursuit-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.toLowerCase(),
          savedOpportunityId: savedOpp.id,
          noticeId,
          opportunityData: oppData,
        }),
      }).catch(err => {
        console.error('[Save Opportunity] Failed to trigger pursuit brief:', err);
      });
    }

    return NextResponse.json({
      success: true,
      savedOpportunity: savedOpp,
      pursuitBriefRequested: requestPursuitBrief,
      message: requestPursuitBrief
        ? 'Opportunity saved! Your Pursuit Brief will be emailed shortly.'
        : 'Opportunity saved to your watchlist.',
    });

  } catch (error) {
    console.error('[Save Opportunity] Error:', error);
    return NextResponse.json(
      { error: 'Server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/opportunities/save?email=xxx
 *
 * Get user's saved opportunities
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  // SECURITY: Verify user owns this email
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const { data: savedOpps, error } = await supabase
    .from('user_saved_opportunities')
    // truncation-ok: scoped to ONE user — user_saved_opportunities is 48 rows total.
    .select('*')
    .eq('user_email', email.toLowerCase())
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Saved Opportunities] Fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch saved opportunities', details: error.message },
      { status: 500 }
    );
  }

  const rows = savedOpps || [];

  // HYDRATE ON READ: the heart save only persists {notice_id} (title/agency/etc. are null),
  // so we enrich each saved row from the live sam_opportunities cache in ONE batched query.
  // Live values win; the saved-row snapshot is the fallback for archived/purged notices.
  const noticeIds = Array.from(
    new Set(rows.map((r) => r.notice_id).filter((v): v is string => !!v))
  );
  const liveById = new Map<string, Record<string, unknown>>();
  if (noticeIds.length > 0) {
    const { data: liveOpps, error: liveErr } = await supabase
      .from('sam_opportunities')
      .select(
        // opportunity_dna (full genome array) + opportunity_dna_keys (keys-only, for the forecast/
        // strategy detection) power the Saved-inbox Decision Card's DNA identity line + "Saved
        // because <strand>" — migration 20260804, both populated. sub_tier is the sub-agency the
        // card's identity line reads. (See src/app/opportunity-map/favorites/route.ts.)
        'notice_id, title, department, sub_tier, naics_code, psc_code, set_aside_code, set_aside_description, notice_type, response_deadline, posted_date, pop_state, intel_value_range, opportunity_dna, opportunity_dna_keys'
      )
      .in('notice_id', noticeIds);
    if (liveErr) {
      // Non-fatal: fall back to the saved snapshot rather than failing the whole page.
      console.error('[Saved Opportunities] Hydration lookup error:', liveErr.message);
    } else {
      for (const o of liveOpps || []) liveById.set(o.notice_id, o);
    }
  }

  const opportunities = rows.map((r) => {
    const live = liveById.get(r.notice_id);
    const pick = (liveVal: unknown, snapVal: unknown) =>
      liveVal != null && liveVal !== '' ? liveVal : snapVal ?? null;
    return {
      ...r,
      // Prefer live sam_opportunities values; fall back to the saved snapshot columns.
      title: pick(live?.title, r.title),
      agency: pick(live?.department, r.agency),
      sub_tier: pick(live?.sub_tier, null),
      naics_code: pick(live?.naics_code, r.naics_code),
      psc_code: pick(live?.psc_code, null),
      set_aside_code: pick(live?.set_aside_code, r.set_aside),
      set_aside_description: pick(live?.set_aside_description, r.set_aside),
      notice_type: pick(live?.notice_type, null),
      response_deadline: pick(live?.response_deadline, r.response_deadline),
      posted_date: pick(live?.posted_date, r.posted_date),
      pop_state: pick(live?.pop_state, null),
      intel_value_range: live?.intel_value_range ?? null,
      // Opportunity DNA (Decision-Card identity + "Saved because"): the full genome array + the
      // keys-only array. Live-only — the saved snapshot never stored a genome, so these are null
      // for a notice that no longer hydrates (honest: no fabricated strands).
      opportunity_dna: (live?.opportunity_dna as unknown) ?? null,
      opportunity_dna_keys: (live?.opportunity_dna_keys as unknown) ?? null,
      // READ-TIME DELTA (Saved inbox "Needs Attention"): the LIVE deadline is `response_deadline`
      // (above); `saved_response_deadline` is the row's OWN snapshot column, captured at save time
      // (user_saved_opportunities.response_deadline). The client diffs the two to flag a
      // deadline-MOVED opportunity. NOTE: there is NO snapshot notice_type column on
      // user_saved_opportunities (schema 20260726), so a cancelled/awarded read-time delta is NOT
      // derivable and is deliberately deferred — closing-soon + deadline-moved still work.
      saved_response_deadline: r.response_deadline ?? null,
      hydrated: !!live,
    };
  });

  return NextResponse.json({
    success: true,
    count: opportunities.length,
    opportunities,
  });
}

/**
 * DELETE /api/opportunities/save
 *
 * Remove a saved opportunity
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, noticeId } = body;

    if (!email || !noticeId) {
      return NextResponse.json({ error: 'Missing email or noticeId' }, { status: 400 });
    }

    // SECURITY: Verify user owns this email
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { error } = await supabase
      .from('user_saved_opportunities')
      .delete()
      .eq('user_email', email.toLowerCase())
      .eq('notice_id', noticeId);

    if (error) {
      console.error('[Saved Opportunities] Delete error:', error);
      return NextResponse.json({ error: 'Failed to delete', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Opportunity removed from watchlist' });

  } catch (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
