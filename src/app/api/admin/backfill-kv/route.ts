import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createDatabaseToken,
  grantOpportunityHunterProAccess,
  grantMarketAssassinAccess,
  grantContentGeneratorAccess,
  grantRecompeteAccess,
} from '@/lib/access-codes';

// Read user_profiles from Supabase, grant KV access based on flags
// Run this from market-assassin (tools.govcongiants.org) where KV is connected

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';
    if (password !== expectedPassword) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Get all user_profiles that have at least one access flag set
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('*')
      .or('access_hunter_pro.eq.true,access_content_standard.eq.true,access_content_full_fix.eq.true,access_assassin_standard.eq.true,access_assassin_premium.eq.true,access_recompete.eq.true,access_contractor_db.eq.true');

    if (error) {
      return NextResponse.json({ error: `Supabase query failed: ${error.message}` }, { status: 500 });
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ success: true, message: 'No profiles with access flags found', total: 0 });
    }

    const results: Array<{
      email: string;
      grants: string[];
      status: string;
    }> = [];

    for (const profile of profiles) {
      const email = profile.email;
      const name = profile.name || undefined;
      const grants: string[] = [];

      try {
        if (profile.access_hunter_pro) {
          await grantOpportunityHunterProAccess(email, name);
          grants.push('ospro');
        }

        if (profile.access_assassin_premium) {
          await grantMarketAssassinAccess(email, 'premium', name);
          grants.push('ma:premium');
        } else if (profile.access_assassin_standard) {
          await grantMarketAssassinAccess(email, 'standard', name);
          grants.push('ma:standard');
        }

        if (profile.access_content_full_fix) {
          await grantContentGeneratorAccess(email, 'full-fix', name);
          grants.push('contentgen:full-fix');
        } else if (profile.access_content_standard) {
          await grantContentGeneratorAccess(email, 'content-engine', name);
          grants.push('contentgen:content-engine');
        }

        if (profile.access_recompete) {
          await grantRecompeteAccess(email, name);
          grants.push('recompete');
        }

        if (profile.access_contractor_db) {
          await createDatabaseToken(email, name);
          grants.push('database');
        }

        results.push({ email, grants, status: 'granted' });
      } catch (err) {
        results.push({
          email,
          grants,
          status: `error: ${err instanceof Error ? err.message : 'unknown'}`,
        });
      }
    }

    return NextResponse.json({
      success: true,
      total: results.length,
      granted: results.filter(r => r.status === 'granted').length,
      errors: results.filter(r => r.status.startsWith('error')).length,
      results,
    });

  } catch (error) {
    console.error('KV backfill error:', error);
    return NextResponse.json(
      { error: `Backfill failed: ${error instanceof Error ? error.message : 'unknown'}` },
      { status: 500 }
    );
  }
}
