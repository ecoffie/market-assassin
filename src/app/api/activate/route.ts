import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

// Supabase admin client
function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

// Cookie configuration
const COOKIE_OPTIONS = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 365 * 24 * 60 * 60, // 1 year
  path: '/',
};

export async function POST(request: NextRequest) {
  try {
    const { user_email, license_key } = await request.json();

    if (!user_email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const normalizedEmail = user_email.toLowerCase().trim();

    // Query purchases
    let query = supabase.from('purchases').select('*').eq('user_email', normalizedEmail);
    if (license_key) {
      query = query.eq('license_key', license_key);
    }

    const { data: purchases, error: queryError } = await query;

    if (queryError) {
      console.error('Error querying purchases:', queryError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (!purchases || purchases.length === 0) {
      return NextResponse.json({
        error: 'No purchases found for this email/key',
        success: false,
        tools: []
      }, { status: 400 });
    }

    // Build access updates from purchases
    const updates: Record<string, boolean> = {};

    purchases.forEach((p: { tier: string }) => {
      if (p.tier === 'hunter_pro') updates.access_hunter_pro = true;
      if (p.tier === 'content_standard') updates.access_content_standard = true;
      if (p.tier === 'content_full_fix') updates.access_content_full_fix = true;
      if (p.tier === 'assassin_standard') updates.access_assassin_standard = true;
      if (p.tier === 'assassin_premium') updates.access_assassin_premium = true;
      if (p.tier === 'recompete') updates.access_recompete = true;
      if (p.tier === 'contractor_db') updates.access_contractor_db = true;
    });

    // Update user_profiles
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('email', normalizedEmail);

      if (updateError) {
        console.error('Error updating user_profiles:', updateError);
      }
    }

    // Set cookies for instant access
    const cookieStore = await cookies();
    cookieStore.set('access_email', normalizedEmail, COOKIE_OPTIONS);

    for (const [flag, value] of Object.entries(updates)) {
      if (value) {
        cookieStore.set(flag, 'true', COOKIE_OPTIONS);
      }
    }

    // Build tools response with names
    const toolNames: Record<string, string> = {
      access_hunter_pro: 'Opportunity Hunter Pro',
      access_content_standard: 'Content Reaper',
      access_content_full_fix: 'Content Generator Full Fix',
      access_assassin_standard: 'Federal Market Assassin',
      access_assassin_premium: 'Market Assassin Premium',
      access_recompete: 'Recompete Contracts Tracker',
      access_contractor_db: 'Federal Contractor Database',
    };

    const tools = Object.keys(updates)
      .filter(key => updates[key])
      .map(key => ({
        name: toolNames[key] || key,
        key,
        active: true,
      }));

    console.log(`Activated access for ${normalizedEmail}: ${Object.keys(updates).join(', ')}`);

    return NextResponse.json({
      success: true,
      tools,
    });
  } catch (error) {
    console.error('Activation error:', error);
    return NextResponse.json(
      { error: 'Failed to activate', success: false, tools: [] },
      { status: 500 }
    );
  }
}
