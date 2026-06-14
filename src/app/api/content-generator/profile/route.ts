/**
 * Content Reaper profile API for KV-only logins (no Supabase browser session).
 *
 * GET  /api/content-generator/profile?email=user@example.com
 * POST /api/content-generator/profile  { email, company_name, ... }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hasContentGeneratorAccess } from '@/lib/access-codes';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any;

async function findAuthUserId(supabaseAdmin: SupabaseAdmin, email: string): Promise<string | null> {
  try {
    const { data: byEmail } = await supabaseAdmin.auth.admin.getUserByEmail(email);
    if (byEmail?.user?.id) return byEmail.user.id;
  } catch {
    // fall through to pagination
  }

  let page = 1;
  for (;;) {
    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const users = list?.users || [];
    const match = users.find((u: { email?: string | null }) => (u.email || '').toLowerCase() === email);
    if (match?.id) return match.id;
    if (users.length < 1000) break;
    page += 1;
    if (page > 30) break;
  }
  return null;
}

async function resolveUserId(
  supabaseAdmin: SupabaseAdmin,
  email: string,
): Promise<string | null> {
  const authId = await findAuthUserId(supabaseAdmin, email);
  if (authId) return authId;

  const { data: profileRow } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();

  return profileRow?.user_id || null;
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const email = new URL(request.url).searchParams.get('email')?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400, headers: corsHeaders });
  }

  if (!(await hasContentGeneratorAccess(email))) {
    return NextResponse.json({ error: 'No access' }, { status: 403, headers: corsHeaders });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const userId = await resolveUserId(supabase, email);

  let profile = null;
  if (userId) {
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    profile = data;
  }

  if (!profile) {
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    profile = data;
  }

  return NextResponse.json({
    success: true,
    email,
    userId: profile?.user_id || userId,
    profile: profile || null,
  }, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = (body.email as string | undefined)?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400, headers: corsHeaders });
    }

    if (!(await hasContentGeneratorAccess(email))) {
      return NextResponse.json({ error: 'No access' }, { status: 403, headers: corsHeaders });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Server config error' }, { status: 500, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    let userId = await resolveUserId(supabase, email);

    if (!userId) {
      const randomPassword = crypto.randomUUID() + crypto.randomUUID();
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: randomPassword,
        email_confirm: true,
        user_metadata: { source: 'content-generator-kv' },
      });
      if (createError) {
        userId = await findAuthUserId(supabase, email);
        if (!userId) {
          console.error('[CG Profile] createUser failed:', createError.message);
          return NextResponse.json({ error: 'Failed to resolve user' }, { status: 500, headers: corsHeaders });
        }
      } else {
        userId = newUser.user.id;
      }
    }

    const { email: _email, ...profileFields } = body;
    const dataToSave = {
      ...profileFields,
      user_id: userId,
      email,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    let profile;
    if (existing?.id) {
      const { data, error } = await supabase
        .from('user_profiles')
        .update(dataToSave)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (error) {
        console.error('[CG Profile] update failed:', error.message);
        return NextResponse.json({ error: 'Failed to save profile' }, { status: 500, headers: corsHeaders });
      }
      profile = data;
    } else {
      const { data, error } = await supabase
        .from('user_profiles')
        .insert({ ...dataToSave, created_at: new Date().toISOString() })
        .select('*')
        .single();
      if (error) {
        console.error('[CG Profile] insert failed:', error.message);
        return NextResponse.json({ error: 'Failed to save profile' }, { status: 500, headers: corsHeaders });
      }
      profile = data;
    }

    return NextResponse.json({
      success: true,
      email,
      userId,
      profile,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[CG Profile] POST error:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: corsHeaders });
  }
}
