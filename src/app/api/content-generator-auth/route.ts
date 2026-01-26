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

// Handle OPTIONS preflight request
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * Content Generator Auth Endpoint
 *
 * This endpoint:
 * 1. Verifies the email has Content Generator access
 * 2. Creates a Supabase user if they don't exist
 * 3. Generates a magic link for passwordless login
 */
export async function POST(request: NextRequest) {
  try {
    const { email, action } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Step 1: Verify email has Content Generator access
    const hasAccess = await hasContentGeneratorAccess(normalizedEmail);

    if (!hasAccess) {
      return NextResponse.json({
        success: false,
        error: 'No access found for this email',
      }, { status: 403, headers: corsHeaders });
    }

    // Get access details for tier info
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

    // Step 2: Check if user exists in Supabase
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === normalizedEmail);

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
      console.log('[CG Auth] Found existing user:', userId);
    } else {
      // Step 3: Create new user with a random password (they'll use magic link)
      const randomPassword = crypto.randomUUID() + crypto.randomUUID();

      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password: randomPassword,
        email_confirm: true, // Auto-confirm since we verified access
        user_metadata: {
          tier: tier,
          source: 'content-generator',
          customerName: accessDetails?.customerName || '',
        }
      });

      if (createError) {
        console.error('[CG Auth] Error creating user:', createError);
        return NextResponse.json({
          success: false,
          error: 'Failed to create user account',
        }, { status: 500, headers: corsHeaders });
      }

      userId = newUser.user.id;
      console.log('[CG Auth] Created new user:', userId);

      // Create user_profiles entry
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .upsert({
          user_id: userId,
          email: normalizedEmail,
          tier: tier,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (profileError) {
        console.error('[CG Auth] Error creating profile:', profileError);
        // Continue anyway - profile can be created later
      }
    }

    // Step 4: Generate magic link for passwordless login
    const redirectUrl = `${request.headers.get('origin') || 'https://tools.govcongiants.org'}/content-generator/`;

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: normalizedEmail,
      options: {
        redirectTo: redirectUrl,
      }
    });

    if (linkError) {
      console.error('[CG Auth] Error generating magic link:', linkError);
      return NextResponse.json({
        success: false,
        error: 'Failed to generate login link',
      }, { status: 500, headers: corsHeaders });
    }

    // The magic link contains the token - we need to extract it
    // Format: https://xxx.supabase.co/auth/v1/verify?token=...&type=magiclink&redirect_to=...
    const magicLink = linkData.properties?.action_link;

    if (!magicLink) {
      console.error('[CG Auth] No magic link in response');
      return NextResponse.json({
        success: false,
        error: 'Failed to generate login link',
      }, { status: 500, headers: corsHeaders });
    }

    console.log('[CG Auth] Generated magic link for:', normalizedEmail);

    return NextResponse.json({
      success: true,
      userId: userId,
      email: normalizedEmail,
      tier: tier,
      tierName: tierInfo?.name || 'Content Engine',
      customerName: accessDetails?.customerName || '',
      magicLink: magicLink,
      redirectUrl: redirectUrl,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('[CG Auth] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Authentication failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}
