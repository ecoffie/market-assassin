/**
 * Admin: Check all access for a user email
 *
 * GET /api/admin/check-access?password=...&email=user@example.com
 *
 * Returns complete access audit: KV keys, Supabase flags, Stripe purchases.
 * One-stop support tool — no more checking 3 systems manually.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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

const KV_KEYS = [
  { key: 'ma', label: 'Market Assassin' },
  { key: 'contentgen', label: 'Content Reaper' },
  { key: 'ospro', label: 'Opportunity Hunter Pro' },
  { key: 'recompete', label: 'Recompete Tracker' },
  { key: 'dbaccess', label: 'Contractor Database' },
  { key: 'briefings', label: 'Daily Briefings' },
];

const SUPABASE_FLAGS = [
  'access_assassin_standard',
  'access_assassin_premium',
  'access_content_standard',
  'access_content_full_fix',
  'access_hunter_pro',
  'access_recompete',
  'access_contractor_db',
  'access_briefings',
];

async function safeKvGet<T>(key: string): Promise<{ value: T | null; available: boolean; error: string | null }> {
  try {
    return { value: await kv.get<T>(key), available: true, error: null };
  } catch (error) {
    console.warn(`[Admin Check Access] KV unavailable for ${key}`, error);
    return {
      value: null,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function safeKvSet(key: string, value: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await kv.set(key, value);
    return { ok: true };
  } catch (error) {
    console.warn(`[Admin Check Access] KV write failed for ${key}`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();
  const fix = searchParams.get('fix'); // ?fix=briefings or ?fix=all to grant missing KV

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=user@example.com)' }, { status: 400 });
  }

  // 1. Check all KV keys
  const kvResults: Record<string, { hasAccess: boolean; value: string | null }> = {};
  const kvErrors: string[] = [];
  for (const { key, label } of KV_KEYS) {
    const result = await safeKvGet<string>(`${key}:${email}`);
    const val = result.value;
    if (!result.available && result.error) {
      kvErrors.push(`${label}: ${result.error}`);
    }
    kvResults[label] = {
      hasAccess: !!val,
      value: val as string | null,
    };
  }

  // Also check dbtoken (Contractor DB uses token-based access)
  let dbTokenFound: string | null = null;
  // Check if any dbtoken maps to this email
  const dbAccessResult = await safeKvGet(`dbaccess:${email}`);
  const dbAccessVal = dbAccessResult.value;
  if (!dbAccessResult.available && dbAccessResult.error) {
    kvErrors.push(`Contractor DB token: ${dbAccessResult.error}`);
  }
  if (dbAccessVal) {
    dbTokenFound = String(dbAccessVal);
  }

  // 2. Check Supabase user_profiles
  const { data: profile, error: profileError } = await getSupabase()
    .from('user_profiles')
    .select('*')
    .eq('email', email)
    .single();

  const supabaseFlags: Record<string, boolean> = {};
  if (profile) {
    for (const flag of SUPABASE_FLAGS) {
      supabaseFlags[flag] = !!(profile as Record<string, unknown>)[flag];
    }
  }

  // 3. Check Supabase purchases
  const { data: purchases } = await getSupabase()
    .from('purchases')
    .select('product_id, amount_paid, status, created_at, stripe_session_id')
    .eq('user_email', email)
    .order('created_at', { ascending: false });

  // 4. Check briefing profile
  const { data: briefingProfile } = await getSupabase()
    .from('user_briefing_profile')
    .select('user_email, created_at, updated_at')
    .eq('user_email', email)
    .single();

  // 5. Check briefing log
  const { data: recentBriefings } = await getSupabase()
    .from('briefing_log')
    .select('briefing_date, items_count, delivery_status')
    .eq('user_email', email)
    .order('briefing_date', { ascending: false })
    .limit(5);

  // 6. Identify gaps (KV says no but Supabase says yes, or vice versa)
  const gaps: string[] = [];
  if (profile) {
    if (profile.access_assassin_standard && !kvResults['Market Assassin'].hasAccess) {
      gaps.push('Market Assassin: Supabase YES, KV NO');
    }
    if (profile.access_assassin_premium && !kvResults['Market Assassin'].hasAccess) {
      gaps.push('Market Assassin Premium: Supabase YES, KV NO');
    }
    if ((profile.access_content_standard || profile.access_content_full_fix) && !kvResults['Content Reaper'].hasAccess) {
      gaps.push('Content Reaper: Supabase YES, KV NO');
    }
    if (profile.access_hunter_pro && !kvResults['Opportunity Hunter Pro'].hasAccess) {
      gaps.push('Opp Hunter Pro: Supabase YES, KV NO');
    }
    if (profile.access_recompete && !kvResults['Recompete Tracker'].hasAccess) {
      gaps.push('Recompete: Supabase YES, KV NO');
    }
    if (profile.access_contractor_db && !kvResults['Contractor Database'].hasAccess) {
      gaps.push('Contractor DB: Supabase YES, KV NO');
    }
    if (profile.access_briefings && !kvResults['Daily Briefings'].hasAccess) {
      gaps.push('Briefings: Supabase YES, KV NO');
    }
  }

  // 7. Optional: fix gaps by granting KV access
  const fixed: string[] = [];
  if (fix) {
    const kvMap: Record<string, string> = {
      ma: 'Market Assassin',
      contentgen: 'Content Reaper',
      ospro: 'Opportunity Hunter Pro',
      recompete: 'Recompete Tracker',
      briefings: 'Daily Briefings',
    };

    if (fix === 'all') {
      // Grant all tools that have Supabase access but missing KV
      for (const gap of gaps) {
        const tool = gap.split(':')[0].trim();
        for (const [kvKey, label] of Object.entries(kvMap)) {
          if (label === tool || tool.startsWith(label)) {
            const result = await safeKvSet(`${kvKey}:${email}`, 'true');
            fixed.push(
              result.ok
                ? `Granted KV ${kvKey}:${email}`
                : `Failed KV ${kvKey}:${email}: ${result.error}`
            );
          }
        }
      }
    } else {
      // Grant specific tool
      const result = await safeKvSet(`${fix}:${email}`, 'true');
      fixed.push(
        result.ok
          ? `Granted KV ${fix}:${email}`
          : `Failed KV ${fix}:${email}: ${result.error}`
      );
    }
  }

  return NextResponse.json({
    email,
    kv: kvResults,
    dbToken: dbTokenFound,
    supabase: {
      hasProfile: !!profile,
      error: profileError?.message || null,
      flags: supabaseFlags,
    },
    purchases: purchases || [],
    briefings: {
      hasProfile: !!briefingProfile,
      recentDeliveries: recentBriefings || [],
    },
    gaps,
    fixed: fixed.length > 0 ? fixed : undefined,
    warnings: kvErrors.length > 0 ? kvErrors : undefined,
    summary: {
      kvToolCount: Object.values(kvResults).filter(v => v.hasAccess).length,
      supabaseFlagCount: Object.values(supabaseFlags).filter(v => v).length,
      purchaseCount: purchases?.length || 0,
      gapCount: gaps.length,
    },
  });
}
