/**
 * Teaming Partners API
 *
 * Manage saved teaming partners and get AI suggestions
 *
 * GET /api/teaming?email=user@example.com - List saved partners
 * POST /api/teaming - Save a teaming partner
 * PATCH /api/teaming - Update partner info
 * DELETE /api/teaming - Remove partner
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolveActiveWorkspace, recordAppActivity, clientNotificationEmail } from '@/lib/app/workspace';

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

export interface TeamingPartner {
  id?: string;
  user_email: string;
  partner_name: string;
  partner_type?: 'prime' | 'sub' | 'jv' | 'mentor';
  uei?: string;
  cage_code?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_title?: string;
  naics_codes?: string[];
  certifications?: string[];
  past_performance?: string;
  outreach_status?: 'none' | 'contacted' | 'responded' | 'meeting' | 'partnered';
  last_contact?: string;
  notes?: string;
  source?: string;
  workspace_id?: string;
  owner_email?: string;
  created_by?: string;
  updated_by?: string;
}

// GET - List saved partners
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const status = request.nextUrl.searchParams.get('status');
  const type = request.nextUrl.searchParams.get('type');

  if (!email) {
    return NextResponse.json(
      { error: 'Email parameter required' },
      { status: 400 }
    );
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;
  // Coach Mode: list the ACTIVE CLIENT's teaming partners, not the coach's.
  // resolveActiveWorkspace falls back to the caller's own workspace when not
  // acting as a client, so this is a safe drop-in for ensureWorkspaceMember.
  const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
  const scopedEmail = asClient ? clientNotificationEmail(workspaceId) : email.toLowerCase();

  try {
    let query = getSupabase()
      .from('user_teaming_partners')
      .select('*')
      .or(`workspace_id.eq.${workspaceId},user_email.eq.${scopedEmail}`)
      .order('partner_name', { ascending: true });

    if (status) {
      query = query.eq('outreach_status', status);
    }

    if (type) {
      query = query.eq('partner_type', type);
    }

    const { data: partners, error } = await query;

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({
          partners: [],
          message: 'Teaming table not yet created. Run migration first.'
        });
      }
      throw error;
    }

    // Calculate stats
    const stats = {
      total: partners?.length || 0,
      byStatus: {
        none: 0,
        contacted: 0,
        responded: 0,
        meeting: 0,
        partnered: 0
      },
      byType: {
        prime: 0,
        sub: 0,
        jv: 0,
        mentor: 0
      }
    };

    for (const p of partners || []) {
      if (p.outreach_status) {
        stats.byStatus[p.outreach_status as keyof typeof stats.byStatus]++;
      }
      if (p.partner_type) {
        stats.byType[p.partner_type as keyof typeof stats.byType]++;
      }
    }

    return NextResponse.json({
      partners: partners || [],
      stats
    });
  } catch (error) {
    console.error('Teaming GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch partners' },
      { status: 500 }
    );
  }
}

// POST - Save a teaming partner
export async function POST(request: NextRequest) {
  try {
    const body: TeamingPartner = await request.json();

    if (!body.user_email || !body.partner_name) {
      return NextResponse.json(
        { error: 'user_email and partner_name are required' },
        { status: 400 }
      );
    }

    const authSession = requireMIAuthSession(request, body.user_email);
    if (!authSession.ok) return authSession.response;

    body.user_email = body.user_email.toLowerCase();
    // Coach Mode: file the partner under the ACTIVE CLIENT's workspace, not the
    // coach's. owner_email/user_email follow the client so the partner shows in
    // the client's list; created_by/updated_by record the acting coach.
    const { workspaceId, asClient } = await resolveActiveWorkspace(body.user_email, request);
    const ownerEmail = asClient ? clientNotificationEmail(workspaceId) : body.user_email;
    body.outreach_status = body.outreach_status || 'none';
    body.source = body.source || 'manual';
    body.workspace_id = workspaceId;
    body.owner_email = body.owner_email || ownerEmail;
    body.user_email = ownerEmail;
    body.created_by = body.user_email;
    body.updated_by = body.user_email;

    const { data, error } = await getSupabase()
      .from('user_teaming_partners')
      .insert(body)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Partner already saved' },
          { status: 409 }
        );
      }
      throw error;
    }

    await recordAppActivity({
      workspaceId,
      userEmail: body.user_email,
      actorEmail: body.user_email,
      entityType: 'partner',
      entityId: data.id,
      action: 'created',
      summary: `Added teaming partner ${data.partner_name}`,
      metadata: { partnerType: data.partner_type, status: data.outreach_status },
    });

    return NextResponse.json({
      success: true,
      partner: data,
      message: 'Partner saved'
    });
  } catch (error) {
    console.error('Teaming POST error:', error);
    return NextResponse.json(
      { error: 'Failed to save partner' },
      { status: 500 }
    );
  }
}

// PATCH - Update partner
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, user_email, ...updates } = body;

    if (!id || !user_email) {
      return NextResponse.json(
        { error: 'id and user_email are required' },
        { status: 400 }
      );
    }

    const authSession = requireMIAuthSession(request, user_email);
    if (!authSession.ok) return authSession.response;
    // Coach Mode: mutate the ACTIVE CLIENT's partner, not the coach's.
    const { workspaceId, asClient } = await resolveActiveWorkspace(user_email, request);
    const scopedEmail = asClient ? clientNotificationEmail(workspaceId) : user_email.toLowerCase();
    updates.updated_by = user_email.toLowerCase();
    updates.workspace_id = updates.workspace_id || workspaceId;

    // Update last_contact if outreach_status changes
    if (updates.outreach_status && updates.outreach_status !== 'none') {
      updates.last_contact = new Date().toISOString().split('T')[0];
    }

    const { data, error } = await getSupabase()
      .from('user_teaming_partners')
      .update(updates)
      .eq('id', id)
      .or(`workspace_id.eq.${workspaceId},user_email.eq.${scopedEmail}`)
      .select()
      .single();

    if (error) throw error;

    await recordAppActivity({
      workspaceId,
      userEmail: user_email,
      actorEmail: user_email,
      entityType: 'partner',
      entityId: id,
      action: 'updated',
      summary: `Updated teaming partner ${data.partner_name}`,
      metadata: { status: data.outreach_status },
    });

    return NextResponse.json({
      success: true,
      partner: data
    });
  } catch (error) {
    console.error('Teaming PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update partner' },
      { status: 500 }
    );
  }
}

// DELETE - Remove partner
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, user_email } = body;

    if (!id || !user_email) {
      return NextResponse.json(
        { error: 'id and user_email are required' },
        { status: 400 }
      );
    }

    const authSession = requireMIAuthSession(request, user_email);
    if (!authSession.ok) return authSession.response;
    // Coach Mode: delete from the ACTIVE CLIENT's partner list, not the coach's.
    const { workspaceId, asClient } = await resolveActiveWorkspace(user_email, request);
    const scopedEmail = asClient ? clientNotificationEmail(workspaceId) : user_email.toLowerCase();

    const { error } = await getSupabase()
      .from('user_teaming_partners')
      .delete()
      .eq('id', id)
      .or(`workspace_id.eq.${workspaceId},user_email.eq.${scopedEmail}`);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Partner removed'
    });
  } catch (error) {
    console.error('Teaming DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to remove partner' },
      { status: 500 }
    );
  }
}
