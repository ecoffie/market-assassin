import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hasContentGeneratorAccess, getContentGeneratorAccess, CONTENT_GENERATOR_TIER_FEATURES } from '@/lib/access-codes';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Initialize Supabase Admin client (with service role key)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any;

async function findAuthUserId(supabaseAdmin: SupabaseAdmin, email: string): Promise<string | null> {
  try {
    const { data: byEmail } = await supabaseAdmin.auth.admin.getUserByEmail(email);
    if (byEmail?.user?.id) return byEmail.user.id;
  } catch {
    // getUserByEmail unavailable on some runtimes — fall through to pagination
  }

  let page = 1;
  for (;;) {
    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error('[CG Auth] listUsers error:', error.message);
      break;
    }
    const users = list?.users || [];
    const match = users.find((u: { email?: string | null }) => (u.email || '').toLowerCase() === email);
    if (match?.id) return match.id;
    if (users.length < 1000) break;
    page += 1;
    if (page > 30) break;
  }
  return null;
}

/** Find or create auth user — page-1 listUsers missed most Mindy accounts. */
async function resolveContentGeneratorUserId(
  supabaseAdmin: SupabaseAdmin,
  email: string,
  tier: string,
  customerName: string,
): Promise<string | null> {
  const existingId = await findAuthUserId(supabaseAdmin, email);
  if (existingId) {
    console.log('[CG Auth] Found existing user:', existingId);
    return existingId;
  }

  const randomPassword = crypto.randomUUID() + crypto.randomUUID();
  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: randomPassword,
    email_confirm: true,
    user_metadata: {
      tier,
      source: 'content-generator',
      customerName,
    },
  });

  if (createError) {
    const retryId = await findAuthUserId(supabaseAdmin, email);
    if (retryId) {
      console.log('[CG Auth] User existed after create conflict:', retryId);
      return retryId;
    }
    console.error('[CG Auth] Error creating user:', createError.message, createError);
    return null;
  }

  const userId = newUser.user.id;
  console.log('[CG Auth] Created new user:', userId);

  const { error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .upsert({
      user_id: userId,
      email,
      tier,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (profileError) {
    console.error('[CG Auth] Error creating profile:', profileError);
  }

  return userId;
}

async function generateMagicLink(
  supabaseAdmin: SupabaseAdmin,
  email: string,
  redirectUrl: string,
): Promise<{ magicLink: string; userId?: string } | null> {
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: redirectUrl },
  });

  if (linkError) {
    console.warn('[CG Auth] generateLink:', linkError.message);
    return null;
  }

  const magicLink = linkData.properties?.action_link;
  if (!magicLink) return null;

  return {
    magicLink,
    userId: linkData.user?.id,
  };
}

// Handle OPTIONS preflight request
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * Content Reaper Auth Endpoint
 *
 * 1. Verifies KV purchase access
 * 2. Generates Supabase magic link (creates auth user if needed)
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    const hasAccess = await hasContentGeneratorAccess(normalizedEmail);
    if (!hasAccess) {
      return NextResponse.json({
        success: false,
        error: 'No access found for this email',
      }, { status: 403, headers: corsHeaders });
    }

    const accessDetails = await getContentGeneratorAccess(normalizedEmail);
    const tier = accessDetails?.tier || 'content-engine';
    const tierInfo = CONTENT_GENERATOR_TIER_FEATURES[tier];

    if (!supabaseAdmin) {
      console.error('[CG Auth] Supabase admin client not configured');
      return NextResponse.json({
        success: false,
        error: 'Authentication service not configured',
      }, { status: 500, headers: corsHeaders });
    }

    const requestOrigin = request.headers.get('origin')
      || request.headers.get('referer')?.replace(/\/content-generator.*$/i, '')
      || 'https://getmindy.ai';
    const redirectUrl = `${requestOrigin.replace(/\/$/, '')}/content-generator/`;

    // Fast path — works when auth user already exists
    let link = await generateMagicLink(supabaseAdmin, normalizedEmail, redirectUrl);
    let userId = link?.userId || (await findAuthUserId(supabaseAdmin, normalizedEmail));

    if (!link) {
      userId = await resolveContentGeneratorUserId(
        supabaseAdmin,
        normalizedEmail,
        tier,
        accessDetails?.customerName || '',
      );
      if (!userId) {
        return NextResponse.json({
          success: false,
          error: 'Failed to create user account',
        }, { status: 500, headers: corsHeaders });
      }
      link = await generateMagicLink(supabaseAdmin, normalizedEmail, redirectUrl);
    }

    if (!link?.magicLink) {
      return NextResponse.json({
        success: false,
        error: 'Failed to generate login link',
      }, { status: 500, headers: corsHeaders });
    }

    console.log('[CG Auth] Generated magic link for:', normalizedEmail);

    return NextResponse.json({
      success: true,
      userId: userId || link.userId,
      email: normalizedEmail,
      tier,
      tierName: tierInfo?.name || 'Content Engine',
      customerName: accessDetails?.customerName || '',
      magicLink: link.magicLink,
      redirectUrl,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('[CG Auth] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Authentication failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}
