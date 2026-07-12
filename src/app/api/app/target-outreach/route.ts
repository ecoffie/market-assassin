/**
 * /api/app/target-outreach — outreach activity log per target.
 *
 * Slice 3D of the Target Market Research roadmap. Drives the inline
 * activity timeline + "Log activity" form inside MyTargetListPanel.
 *
 * Activity types follow the BD vocabulary: email / call / event /
 * rfi / meeting / note. Each row joins to user_target_list via
 * target_id with ON DELETE CASCADE so removing a target also clears
 * its outreach history (intentional — if you stop pursuing the
 * office, the activity log goes with it).
 *
 * Pro-gated. Free users get 402 on POST (they shouldn't get this
 * far anyway — target-list itself is Pro-gated — but the gate is a
 * belt-and-suspenders safety check).
 *
 * Verbs:
 *   GET    ?target_id=X&email=Y       → list activities for target
 *   POST   { target_id, ...fields }   → log a new activity
 *   DELETE { id, user_email }         → delete one activity
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
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

const VALID_TYPES = ['email', 'call', 'event', 'rfi', 'meeting', 'note'] as const;
const VALID_OUTCOMES = ['replied', 'meeting_set', 'no_response', 'pass', 'success', ''] as const;

// ---------------------------------------------------------------------
// GET — list activities for a target
// ---------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const targetId = url.searchParams.get('target_id');
  const email = url.searchParams.get('email');

  if (!targetId || !email) {
    return NextResponse.json({ error: 'target_id and email required' }, { status: 400 });
  }
  const gate = requireMIAuthSession(request, email);
  if (!gate.ok) return gate.response;
  // Coach Mode: read the ACTIVE CLIENT's outreach log, not the coach's.
  const { workspaceId: gWs, asClient: gAsClient } = await resolveActiveWorkspace(email, request);
  const scopedEmail = gAsClient ? clientNotificationEmail(gWs) : email.toLowerCase();

  try {
    const { data, error } = await getSupabase()
      .from('user_target_outreach')
      .select('*')
      .eq('target_id', targetId)
      .eq('user_email', scopedEmail)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[target-outreach] GET error:', error);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }
    return NextResponse.json({ success: true, activities: data || [], count: (data || []).length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------
// POST — log a new activity
// ---------------------------------------------------------------------
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const targetId = typeof body.target_id === 'string' ? body.target_id : null;
  const email = typeof body.user_email === 'string' ? body.user_email : null;
  const activityType = typeof body.activity_type === 'string' ? body.activity_type : null;

  if (!targetId || !email || !activityType) {
    return NextResponse.json(
      { error: 'target_id, user_email, and activity_type are required' },
      { status: 400 }
    );
  }
  if (!(VALID_TYPES as readonly string[]).includes(activityType)) {
    return NextResponse.json(
      { error: `Invalid activity_type. Must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  // Identity gate — caller must own this email (verifyMIAccess below only
  // checks tier, not who is asking).
  const gate = requireMIAuthSession(request, email);
  if (!gate.ok) return gate.response;
  // Coach Mode: log outreach against the ACTIVE CLIENT's target, not the coach's.
  const { workspaceId: pWs, asClient: pAsClient } = await resolveActiveWorkspace(email, request);
  const scopedEmail = pAsClient ? clientNotificationEmail(pWs) : email.toLowerCase();

  // Tier gate. Same as the target-list endpoint.
  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      {
        upgrade_required: true,
        message: 'Outreach logging is included with Mindy Pro',
      },
      { status: 402 }
    );
  }

  // Verify the target belongs to this user before allowing an
  // outreach insert. Prevents another user from inserting activity
  // rows on a target that isn't theirs (the FK alone doesn't enforce
  // ownership since target_id is a UUID, not bound to the requester).
  const { data: target, error: targetErr } = await getSupabase()
    .from('user_target_list')
    .select('id, workspace_id, user_email')
    .eq('id', targetId)
    .eq('user_email', scopedEmail)
    .maybeSingle();
  if (targetErr) console.error('[target-outreach] target query error:', targetErr.message);

  if (!target) {
    return NextResponse.json(
      { error: 'Target not found or access denied' },
      { status: 404 }
    );
  }

  const outcome = typeof body.outcome === 'string' && (VALID_OUTCOMES as readonly string[]).includes(body.outcome)
    ? (body.outcome || null)
    : null;

  const insertPayload: Record<string, unknown> = {
    target_id: targetId,
    user_email: scopedEmail,
    workspace_id: target.workspace_id || null,
    activity_type: activityType,
    contact_name: body.contact_name || null,
    contact_role: body.contact_role || null,
    subject: body.subject || null,
    body: body.body || null,
    outcome,
    follow_up_date: body.follow_up_date || null,
  };

  try {
    const { data, error } = await getSupabase()
      .from('user_target_outreach')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error('[target-outreach] POST error:', error);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }
    return NextResponse.json({ success: true, activity: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------
// DELETE — remove an activity entry
// ---------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const id = typeof body.id === 'string' ? body.id : null;
  const email = typeof body.user_email === 'string' ? body.user_email : null;
  if (!id || !email) {
    return NextResponse.json({ error: 'id and user_email required' }, { status: 400 });
  }
  const gate = requireMIAuthSession(request, email);
  if (!gate.ok) return gate.response;
  // Coach Mode: delete from the ACTIVE CLIENT's outreach log, not the coach's.
  const { workspaceId: dWs, asClient: dAsClient } = await resolveActiveWorkspace(email, request);
  const scopedEmail = dAsClient ? clientNotificationEmail(dWs) : email.toLowerCase();

  try {
    const { error } = await getSupabase()
      .from('user_target_outreach')
      .delete()
      .eq('id', id)
      .eq('user_email', scopedEmail);

    if (error) {
      console.error('[target-outreach] DELETE error:', error);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
