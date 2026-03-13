/**
 * Content Library API
 *
 * GET /api/content-generator/library?email=user@example.com
 *   Returns saved posts for a user (most recent first)
 *   Optional: &limit=50&offset=0&agency=X&template=Y
 *
 * DELETE /api/content-generator/library
 *   Body: { email, postId }
 *   Deletes a specific post from the library
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
  const offset = parseInt(searchParams.get('offset') || '0');
  const agency = searchParams.get('agency');
  const template = searchParams.get('template');

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400, headers: corsHeaders });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Try full query first (with new columns), fall back to basic columns if table hasn't been migrated
  let data: Record<string, unknown>[] | null = null;
  let error: { message: string } | null = null;
  let count: number | null = null;

  // First try with all columns
  let query = supabase
    .from('content_library')
    .select('id, title, content, tags, template_key, angle, pain_point, target_agencies, created_at', { count: 'exact' })
    .eq('user_email', email.toLowerCase().trim())
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (agency) {
    query = query.contains('target_agencies', [agency]);
  }
  if (template) {
    query = query.eq('template_key', template);
  }

  const fullResult = await query;

  if (fullResult.error) {
    // Fall back to basic columns (table may not have new columns yet)
    console.warn('[Library] Full query failed, trying basic columns:', fullResult.error.message);
    const basicQuery = supabase
      .from('content_library')
      .select('id, title, content, tags, created_at', { count: 'exact' })
      .eq('user_email', email.toLowerCase().trim())
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const basicResult = await basicQuery;
    data = basicResult.data;
    error = basicResult.error;
    count = basicResult.count;
  } else {
    data = fullResult.data;
    error = fullResult.error;
    count = fullResult.count;
  }

  if (error) {
    console.error('[Library] Query error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch library' }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json({
    success: true,
    posts: data || [],
    total: count || 0,
    limit,
    offset,
  }, { headers: corsHeaders });
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, postId } = body;

    if (!email || !postId) {
      return NextResponse.json({ error: 'Email and postId required' }, { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Server config error' }, { status: 500, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase
      .from('content_library')
      .delete()
      .eq('id', postId)
      .eq('user_email', email.toLowerCase().trim());

    if (error) {
      return NextResponse.json({ error: 'Failed to delete post' }, { status: 500, headers: corsHeaders });
    }

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: corsHeaders });
  }
}
