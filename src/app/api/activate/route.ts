import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import {
  getMarketAssassinAccess,
  getContentGeneratorAccess,
  hasEmailDatabaseAccess,
  hasOpportunityHunterProAccess,
  hasRecompeteAccess,
  hasBriefingAccess,
} from '@/lib/access-codes';

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

interface ToolAccess {
  name: string;
  key: string;
  active: boolean;
  url: string;
}

export async function POST(request: NextRequest) {
  try {
    const { user_email, license_key } = await request.json();

    if (!user_email) {
      return NextResponse.json({ error: 'Email is required', success: false, tools: [] }, { status: 400 });
    }

    const normalizedEmail = user_email.toLowerCase().trim();
    const tools: ToolAccess[] = [];
    const accessFlags: Record<string, boolean> = {};

    // ============================================
    // SOURCE 1: Check user_profiles table (primary)
    // ============================================
    const supabase = getAdminClient();
    if (supabase) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('email', normalizedEmail)
        .single();

      if (profile) {
        if (profile.access_hunter_pro) {
          accessFlags.access_hunter_pro = true;
          tools.push({ name: 'Opportunity Hunter Pro', key: 'access_hunter_pro', active: true, url: '/opportunity-hunter' });
        }
        if (profile.access_content_standard && !profile.access_content_full_fix) {
          accessFlags.access_content_standard = true;
          tools.push({ name: 'Content Reaper', key: 'access_content_standard', active: true, url: '/content-generator' });
        }
        if (profile.access_content_full_fix) {
          accessFlags.access_content_standard = true;
          accessFlags.access_content_full_fix = true;
          tools.push({ name: 'Content Reaper - Full Fix', key: 'access_content_full_fix', active: true, url: '/content-generator' });
        }
        if (profile.access_assassin_standard && !profile.access_assassin_premium) {
          accessFlags.access_assassin_standard = true;
          tools.push({ name: 'Federal Market Assassin', key: 'access_assassin_standard', active: true, url: '/market-assassin' });
        }
        if (profile.access_assassin_premium) {
          accessFlags.access_assassin_standard = true;
          accessFlags.access_assassin_premium = true;
          tools.push({ name: 'Market Assassin Premium', key: 'access_assassin_premium', active: true, url: '/market-assassin' });
        }
        if (profile.access_recompete) {
          accessFlags.access_recompete = true;
          tools.push({ name: 'Recompete Tracker', key: 'access_recompete', active: true, url: '/recompete' });
        }
        if (profile.access_contractor_db) {
          accessFlags.access_contractor_db = true;
          tools.push({ name: 'Federal Contractor Database', key: 'access_contractor_db', active: true, url: '/contractor-database' });
        }
        if (profile.access_briefings) {
          accessFlags.access_briefings = true;
          tools.push({ name: 'Daily Briefings', key: 'access_briefings', active: true, url: '/briefings' });
        }
      }
    }

    // ============================================
    // SOURCE 2: Check purchases table (fallback)
    // ============================================
    if (supabase && tools.length === 0) {
      let query = supabase.from('purchases').select('*').eq('user_email', normalizedEmail).eq('status', 'completed');
      if (license_key) {
        query = query.eq('license_key', license_key);
      }

      const { data: purchases } = await query;

      if (purchases && purchases.length > 0) {
        for (const p of purchases) {
          const tier = p.tier;
          if (tier === 'hunter_pro' && !accessFlags.access_hunter_pro) {
            accessFlags.access_hunter_pro = true;
            tools.push({ name: 'Opportunity Hunter Pro', key: 'access_hunter_pro', active: true, url: '/opportunity-hunter' });
          }
          if (tier === 'content_standard' && !accessFlags.access_content_standard) {
            accessFlags.access_content_standard = true;
            tools.push({ name: 'Content Reaper', key: 'access_content_standard', active: true, url: '/content-generator' });
          }
          if (tier === 'content_full_fix' && !accessFlags.access_content_full_fix) {
            accessFlags.access_content_standard = true;
            accessFlags.access_content_full_fix = true;
            tools.push({ name: 'Content Reaper - Full Fix', key: 'access_content_full_fix', active: true, url: '/content-generator' });
          }
          if (tier === 'assassin_standard' && !accessFlags.access_assassin_standard) {
            accessFlags.access_assassin_standard = true;
            tools.push({ name: 'Federal Market Assassin', key: 'access_assassin_standard', active: true, url: '/market-assassin' });
          }
          if (tier === 'assassin_premium' && !accessFlags.access_assassin_premium) {
            accessFlags.access_assassin_standard = true;
            accessFlags.access_assassin_premium = true;
            tools.push({ name: 'Market Assassin Premium', key: 'access_assassin_premium', active: true, url: '/market-assassin' });
          }
          if (tier === 'recompete' && !accessFlags.access_recompete) {
            accessFlags.access_recompete = true;
            tools.push({ name: 'Recompete Tracker', key: 'access_recompete', active: true, url: '/recompete' });
          }
          if (tier === 'contractor_db' && !accessFlags.access_contractor_db) {
            accessFlags.access_contractor_db = true;
            tools.push({ name: 'Federal Contractor Database', key: 'access_contractor_db', active: true, url: '/contractor-database' });
          }
        }
      }
    }

    // ============================================
    // SOURCE 3: Check Vercel KV (legacy fallback)
    // ============================================
    if (tools.length === 0) {
      // Market Assassin
      const maAccess = await getMarketAssassinAccess(normalizedEmail);
      if (maAccess) {
        const isPremium = maAccess.tier === 'premium';
        if (isPremium) {
          accessFlags.access_assassin_standard = true;
          accessFlags.access_assassin_premium = true;
          tools.push({ name: 'Market Assassin Premium', key: 'access_assassin_premium', active: true, url: '/market-assassin' });
        } else {
          accessFlags.access_assassin_standard = true;
          tools.push({ name: 'Federal Market Assassin', key: 'access_assassin_standard', active: true, url: '/market-assassin' });
        }
      }

      // Content Reaper
      const cgAccess = await getContentGeneratorAccess(normalizedEmail);
      if (cgAccess) {
        const isFullFix = cgAccess.tier === 'full-fix';
        if (isFullFix) {
          accessFlags.access_content_standard = true;
          accessFlags.access_content_full_fix = true;
          tools.push({ name: 'Content Reaper - Full Fix', key: 'access_content_full_fix', active: true, url: '/content-generator' });
        } else {
          accessFlags.access_content_standard = true;
          tools.push({ name: 'Content Reaper', key: 'access_content_standard', active: true, url: '/content-generator' });
        }
      }

      // Federal Contractor Database
      const hasDbAccess = await hasEmailDatabaseAccess(normalizedEmail);
      if (hasDbAccess) {
        accessFlags.access_contractor_db = true;
        tools.push({ name: 'Federal Contractor Database', key: 'access_contractor_db', active: true, url: '/contractor-database' });
      }

      // Opportunity Hunter Pro
      const hasOhPro = await hasOpportunityHunterProAccess(normalizedEmail);
      if (hasOhPro) {
        accessFlags.access_hunter_pro = true;
        tools.push({ name: 'Opportunity Hunter Pro', key: 'access_hunter_pro', active: true, url: '/opportunity-hunter' });
      }

      // Recompete
      const hasRecompete = await hasRecompeteAccess(normalizedEmail);
      if (hasRecompete) {
        accessFlags.access_recompete = true;
        tools.push({ name: 'Recompete Tracker', key: 'access_recompete', active: true, url: '/recompete' });
      }

      // Briefings
      const hasBriefings = await hasBriefingAccess(normalizedEmail);
      if (hasBriefings) {
        accessFlags.access_briefings = true;
        tools.push({ name: 'Daily Briefings', key: 'access_briefings', active: true, url: '/briefings' });
      }
    }

    // ============================================
    // No access found anywhere
    // ============================================
    if (tools.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No purchases found for this email. Please check the email you used during checkout, or contact support@govcongiants.com',
        tools: [],
      });
    }

    // ============================================
    // Set cookies for instant access
    // ============================================
    const cookieStore = await cookies();
    cookieStore.set('access_email', normalizedEmail, COOKIE_OPTIONS);

    for (const [flag, value] of Object.entries(accessFlags)) {
      if (value) {
        cookieStore.set(flag, 'true', COOKIE_OPTIONS);
      }
    }

    // ============================================
    // Sync to user_profiles if we found access in KV/purchases but not in profile
    // ============================================
    if (supabase && Object.keys(accessFlags).length > 0) {
      const { error: upsertError } = await supabase
        .from('user_profiles')
        .upsert({
          email: normalizedEmail,
          ...accessFlags,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });

      if (upsertError) {
        console.error('Error syncing to user_profiles:', upsertError);
      }
    }

    console.log(`✅ Activated access for ${normalizedEmail}: ${tools.map(t => t.name).join(', ')}`);

    return NextResponse.json({
      success: true,
      tools,
      message: `Access granted to ${tools.length} product(s)`,
    });
  } catch (error) {
    console.error('Activation error:', error);
    return NextResponse.json(
      { error: 'Failed to activate. Please try again or contact support@govcongiants.com', success: false, tools: [] },
      { status: 500 }
    );
  }
}
