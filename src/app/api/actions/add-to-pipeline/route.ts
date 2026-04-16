/**
 * Email Action: Add to Pipeline
 *
 * One-click action from email to add opportunity to BD Assist pipeline.
 * Uses GET for email link compatibility.
 *
 * Usage in email:
 * <a href="https://tools.govcongiants.org/api/actions/add-to-pipeline?email=user@example.com&notice_id=FA8773-24-R-0001&title=Navy%20IT%20Support&stage=tracking">
 *   Track This
 * </a>
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Lazy initialization to avoid build-time errors
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

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Required params
  const email = params.get('email');
  const title = params.get('title');

  // Optional params
  const notice_id = params.get('notice_id') || params.get('noticeId');
  const stage = params.get('stage') || 'tracking';
  const agency = params.get('agency');
  const value = params.get('value');
  const deadline = params.get('deadline');
  const naics = params.get('naics');
  const setAside = params.get('setAside') || params.get('set_aside');
  const source = params.get('source') || 'email_action';
  const externalUrl = params.get('url') || params.get('samLink');

  // Validate required fields
  if (!email || !title) {
    return NextResponse.redirect(
      new URL('/pipeline/error?reason=missing_params', request.url)
    );
  }

  try {
    // Check if already in pipeline (by notice_id or title+email)
    let existingQuery = getSupabase()
      .from('user_pipeline')
      .select('id, stage')
      .eq('user_email', email.toLowerCase());

    if (notice_id) {
      existingQuery = existingQuery.eq('notice_id', notice_id);
    } else {
      existingQuery = existingQuery.eq('title', title);
    }

    const { data: existing } = await existingQuery.single() as { data: { id: string; stage: string } | null };

    if (existing) {
      // Already tracking - redirect to pipeline with message
      const redirectUrl = new URL('/pipeline/already-tracking', request.url);
      redirectUrl.searchParams.set('title', title);
      redirectUrl.searchParams.set('stage', existing.stage);
      return NextResponse.redirect(redirectUrl);
    }

    // Add to pipeline
    const pipelineEntry = {
      user_email: email.toLowerCase(),
      notice_id: notice_id || null,
      title: decodeURIComponent(title),
      agency: agency ? decodeURIComponent(agency) : null,
      value_estimate: value ? decodeURIComponent(value) : null,
      response_deadline: deadline || null,
      naics_code: naics || null,
      set_aside: setAside ? decodeURIComponent(setAside) : null,
      stage: stage as 'tracking' | 'pursuing' | 'bidding' | 'submitted',
      source: source,
      external_url: externalUrl ? decodeURIComponent(externalUrl) : null,
      priority: 'medium',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await getSupabase()
      .from('user_pipeline')
      .insert(pipelineEntry);

    if (error) {
      console.error('Failed to add to pipeline:', error);
      return NextResponse.redirect(
        new URL('/pipeline/error?reason=db_error', request.url)
      );
    }

    // Success - redirect to confirmation
    const redirectUrl = new URL('/pipeline/added', request.url);
    redirectUrl.searchParams.set('title', title);
    redirectUrl.searchParams.set('stage', stage);
    return NextResponse.redirect(redirectUrl);

  } catch (err) {
    console.error('Add to pipeline error:', err);
    return NextResponse.redirect(
      new URL('/pipeline/error?reason=unknown', request.url)
    );
  }
}

// POST endpoint for programmatic use
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      notice_id,
      title,
      agency,
      value,
      deadline,
      naics,
      setAside,
      stage = 'tracking',
      source = 'api',
      externalUrl
    } = body;

    if (!email || !title) {
      return NextResponse.json(
        { success: false, error: 'Email and title are required' },
        { status: 400 }
      );
    }

    // Check for existing
    let existingQuery = getSupabase()
      .from('user_pipeline')
      .select('id, stage')
      .eq('user_email', email.toLowerCase());

    if (notice_id) {
      existingQuery = existingQuery.eq('notice_id', notice_id);
    } else {
      existingQuery = existingQuery.eq('title', title);
    }

    const { data: existing } = await existingQuery.single() as { data: { id: string; stage: string } | null };

    if (existing) {
      return NextResponse.json({
        success: false,
        error: 'Already in pipeline',
        existingStage: existing.stage,
        pipelineId: existing.id,
      });
    }

    // Insert
    const { data, error } = await getSupabase()
      .from('user_pipeline')
      .insert({
        user_email: email.toLowerCase(),
        notice_id: notice_id || null,
        title,
        agency: agency || null,
        value_estimate: value || null,
        response_deadline: deadline || null,
        naics_code: naics || null,
        set_aside: setAside || null,
        stage,
        source,
        external_url: externalUrl || null,
        priority: 'medium',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Pipeline insert error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      pipelineId: data.id,
      stage,
      message: `Added "${title}" to pipeline`,
    });

  } catch (err) {
    console.error('Add to pipeline error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
