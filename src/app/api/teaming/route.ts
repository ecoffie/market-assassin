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

  try {
    let query = getSupabase()
      .from('user_teaming_partners')
      .select('*')
      .eq('user_email', email.toLowerCase())
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

    body.user_email = body.user_email.toLowerCase();
    body.outreach_status = body.outreach_status || 'none';
    body.source = body.source || 'manual';

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

    // Update last_contact if outreach_status changes
    if (updates.outreach_status && updates.outreach_status !== 'none') {
      updates.last_contact = new Date().toISOString().split('T')[0];
    }

    const { data, error } = await getSupabase()
      .from('user_teaming_partners')
      .update(updates)
      .eq('id', id)
      .eq('user_email', user_email.toLowerCase())
      .select()
      .single();

    if (error) throw error;

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

    const { error } = await getSupabase()
      .from('user_teaming_partners')
      .delete()
      .eq('id', id)
      .eq('user_email', user_email.toLowerCase());

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
