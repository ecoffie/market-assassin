/**
 * /api/app/target-list — CRUD for the user's saved BD target offices.
 *
 * Slice 3A of the Target Market Research roadmap. Drives the
 * "+ Add to my list" button in the AgencyDrawer (Slice 3B) and the
 * upcoming My Target List panel (Slice 3C).
 *
 * Vocabulary note: "target list" is plain BD language per the
 * mindy-vocabulary-rule. The table is `user_target_list`, NOT
 * `user_target_accounts` / "TAL" / sales jargon.
 *
 * Verbs:
 *   GET    ?email=...               → list mine (most-recent first)
 *   POST   { ...office fields }     → add (idempotent via UNIQUE)
 *   PATCH  { id, ...fields }        → update status / priority / notes
 *   DELETE { id, user_email }       → remove
 *
 * Pro-gated. Free users get 402 when they try to POST. Reading the
 * list is allowed for any signed-in user (so the "saved" star can
 * render correctly even after a tier downgrade — they still see what
 * they had).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';

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

const VALID_STATUSES = ['targeting', 'contacted', 'qualified', 'passed', 'won'] as const;
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

// ---------------------------------------------------------------------
// GET — list my saved targets
// ---------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabase()
      .from('user_target_list')
      .select('*')
      .eq('user_email', email.toLowerCase())
      .order('added_at', { ascending: false });

    if (error) {
      console.error('[target-list] GET error:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to load target list', code: error.code },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, targets: data || [], count: (data || []).length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[target-list] GET threw:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------
// POST — add an office to my target list
// ---------------------------------------------------------------------
//
// Pro-gated. Required: user_email, agency_name, office_name. Other
// fields are snapshot-from-research so the saved row survives even if
// the underlying USAspending data refreshes later.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body.user_email === 'string' ? body.user_email : null;
  if (!email) {
    return NextResponse.json({ error: 'user_email required' }, { status: 400 });
  }
  if (!body.agency_name || !body.office_name) {
    return NextResponse.json(
      { error: 'agency_name and office_name are required' },
      { status: 400 }
    );
  }

  // Tier gate. Saved-target lists are a Mindy Pro feature.
  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      {
        upgrade_required: true,
        message: 'Saved target lists are included with Mindy Pro',
        teaser: {
          note: 'Pro lets you save offices from Market Research to a persistent list you can work over months — with status tracking, notes, and (soon) an outreach activity log.',
        },
      },
      { status: 402 }
    );
  }

  // Normalize numbers — UI sometimes passes strings.
  const num = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  const insertPayload: Record<string, unknown> = {
    user_email: email.toLowerCase(),
    workspace_id: body.workspace_id || null,

    agency_code: body.agency_code || null,
    agency_name: body.agency_name,
    sub_agency_code: body.sub_agency_code || null,
    sub_agency_name: body.sub_agency_name || null,
    office_code: body.office_code || null,
    office_name: body.office_name,
    location: body.location || null,

    set_aside_spending: num(body.set_aside_spending),
    contract_count: num(body.contract_count),
    sat_ratio: num(body.sat_ratio),
    pain_point_count: num(body.pain_point_count),
    open_opp_count: num(body.open_opp_count),
    upcoming_event_count: num(body.upcoming_event_count),

    status: typeof body.status === 'string' && (VALID_STATUSES as readonly string[]).includes(body.status) ? body.status : 'targeting',
    priority: typeof body.priority === 'string' && (VALID_PRIORITIES as readonly string[]).includes(body.priority) ? body.priority : 'medium',
    notes: body.notes || null,
    added_from: body.added_from || 'research_drawer',
  };

  try {
    const { data, error } = await getSupabase()
      .from('user_target_list')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      // 23505 = unique violation — office already saved. Return 409
      // so the UI can surface "Already in your list" instead of red.
      if (error.code === '23505') {
        return NextResponse.json(
          { success: false, already_saved: true, error: 'Office already in your target list' },
          { status: 409 }
        );
      }
      console.error('[target-list] POST Postgres error:', {
        message: error.message, details: error.details, hint: error.hint, code: error.code,
      });
      return NextResponse.json(
        { error: error.message, details: error.details, hint: error.hint, code: error.code },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, target: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[target-list] POST threw:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------
// PATCH — update status / priority / notes on an existing target
// ---------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : null;
  const email = typeof body.user_email === 'string' ? body.user_email : null;
  if (!id || !email) {
    return NextResponse.json({ error: 'id and user_email required' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.status === 'string' && (VALID_STATUSES as readonly string[]).includes(body.status)) {
    updates.status = body.status;
  }
  if (typeof body.priority === 'string' && (VALID_PRIORITIES as readonly string[]).includes(body.priority)) {
    updates.priority = body.priority;
  }
  if ('notes' in body) {
    updates.notes = body.notes || null;
  }

  try {
    const { data, error } = await getSupabase()
      .from('user_target_list')
      .update(updates)
      .eq('id', id)
      .eq('user_email', email.toLowerCase()) // ownership check
      .select()
      .single();

    if (error) {
      console.error('[target-list] PATCH error:', error);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Target not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({ success: true, target: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[target-list] PATCH threw:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------
// DELETE — remove from my target list
// ---------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : null;
  const email = typeof body.user_email === 'string' ? body.user_email : null;
  if (!id || !email) {
    return NextResponse.json({ error: 'id and user_email required' }, { status: 400 });
  }

  try {
    // ON DELETE CASCADE on user_target_outreach.target_id handles the
    // child rows automatically — see the migration.
    const { error } = await getSupabase()
      .from('user_target_list')
      .delete()
      .eq('id', id)
      .eq('user_email', email.toLowerCase());

    if (error) {
      console.error('[target-list] DELETE error:', error);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[target-list] DELETE threw:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
