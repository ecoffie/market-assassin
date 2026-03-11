// Admin endpoint to grant briefings access to FHC members
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Quick grant for a single email: ?grant=user@example.com
  const grantEmail = searchParams.get('grant')?.toLowerCase().trim();
  if (grantEmail) {
    try {
      await kv.set(`briefings:${grantEmail}`, 'true');
      return NextResponse.json({
        success: true,
        message: `Briefing access granted to ${grantEmail}`,
        email: grantEmail,
      });
    } catch (err) {
      return NextResponse.json({ error: `KV error: ${err}` }, { status: 500 });
    }
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Get all users with MA Standard access (FHC members)
  const { data: members, error } = await supabase
    .from('user_profiles')
    .select('email, access_assassin_standard, access_briefings')
    .eq('access_assassin_standard', true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    total: members?.length || 0,
    withBriefings: members?.filter(m => m.access_briefings).length || 0,
    withoutBriefings: members?.filter(m => !m.access_briefings).length || 0,
    members: members?.map(m => ({
      email: m.email,
      hasBriefings: m.access_briefings,
    })),
  });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview'; // 'preview' or 'execute'

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Get all users with MA Standard access who don't have briefings yet
  const { data: members, error: fetchError } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('access_assassin_standard', true)
    .eq('access_briefings', false);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!members || members.length === 0) {
    return NextResponse.json({
      message: 'No members need briefings access',
      updated: 0,
    });
  }

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      message: `Would grant briefings to ${members.length} members`,
      members: members.map(m => m.email),
      instructions: 'Add ?mode=execute to actually grant access',
    });
  }

  // Execute mode - actually grant access
  const results = {
    success: [] as string[],
    failed: [] as { email: string; error: string }[],
  };

  for (const member of members) {
    try {
      // Update Supabase
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ access_briefings: true })
        .eq('email', member.email);

      if (updateError) {
        results.failed.push({ email: member.email, error: updateError.message });
        continue;
      }

      // Set KV access
      try {
        await kv.set(`briefings:${member.email.toLowerCase()}`, 'true');
      } catch (kvError) {
        console.warn(`KV error for ${member.email}:`, kvError);
        // Non-fatal, continue
      }

      results.success.push(member.email);
    } catch (err) {
      results.failed.push({
        email: member.email,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    mode: 'execute',
    message: `Granted briefings to ${results.success.length} members`,
    success: results.success,
    failed: results.failed,
    total: members.length,
  });
}
