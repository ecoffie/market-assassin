import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

/**
 * Sync Access Tool - Compare and fix Stripe, KV, and Supabase access records
 *
 * GET: Compare all three systems and report gaps
 * POST: Fix gaps by syncing access grants
 *
 * Usage:
 *   GET  /api/admin/sync-access?password=xxx                  - Full comparison report
 *   GET  /api/admin/sync-access?password=xxx&email=user@x.com - Check single user
 *   POST /api/admin/sync-access?password=xxx&mode=preview     - Preview fixes
 *   POST /api/admin/sync-access?password=xxx&mode=execute     - Execute fixes
 */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

interface AccessRecord {
  email: string;
  name?: string;
  stripe: {
    hasPurchase: boolean;
    tier?: string;
    bundle?: string;
    sessionId?: string;
    purchaseDate?: string;
  };
  kv: {
    hasAccess: boolean;
    keys: string[];
  };
  supabase: {
    hasProfile: boolean;
    flags: Record<string, boolean>;
  };
  gaps: string[];
  recommendations: string[];
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// KV key patterns we check
const KV_PATTERNS = [
  'ospro:', // Opportunity Scout Pro
  'ma:', // Market Assassin
  'contentgen:', // Content Generator
  'recompete:', // Recompete Radar
  'database:', // Contractor Database
  'briefings:', // Daily Briefings
];

// Map tier/bundle to expected KV and Supabase flags
function getExpectedAccess(tier?: string, bundle?: string): { kvKeys: string[]; supabaseFlags: Record<string, boolean> } {
  const kvKeys: string[] = [];
  const supabaseFlags: Record<string, boolean> = {};

  if (bundle === 'ultimate' || bundle === 'ultimate-govcon-bundle' || bundle === 'complete') {
    kvKeys.push('ma:premium', 'contentgen:full-fix', 'recompete', 'database', 'briefings');
    supabaseFlags.access_assassin_premium = true;
    supabaseFlags.access_content_full_fix = true;
    supabaseFlags.access_recompete = true;
    supabaseFlags.access_contractor_db = true;
    supabaseFlags.access_briefings = true;
  } else if (bundle === 'pro' || bundle === 'pro-giant-bundle') {
    kvKeys.push('ma:standard', 'contentgen', 'recompete', 'database', 'briefings');
    supabaseFlags.access_assassin_standard = true;
    supabaseFlags.access_content_standard = true;
    supabaseFlags.access_recompete = true;
    supabaseFlags.access_contractor_db = true;
    supabaseFlags.access_briefings = true;
  } else if (bundle === 'starter' || bundle === 'govcon-starter-bundle') {
    kvKeys.push('ospro', 'recompete', 'database');
    supabaseFlags.access_hunter_pro = true;
    supabaseFlags.access_recompete = true;
    supabaseFlags.access_contractor_db = true;
  }

  // Individual tiers
  if (tier === 'hunter_pro') {
    kvKeys.push('ospro');
    supabaseFlags.access_hunter_pro = true;
  }
  if (tier === 'assassin_standard') {
    kvKeys.push('ma:standard');
    supabaseFlags.access_assassin_standard = true;
  }
  if (tier === 'assassin_premium' || tier === 'assassin_premium_upgrade') {
    kvKeys.push('ma:premium');
    supabaseFlags.access_assassin_premium = true;
  }
  if (tier === 'content_standard') {
    kvKeys.push('contentgen');
    supabaseFlags.access_content_standard = true;
  }
  if (tier === 'content_full_fix' || tier === 'content_full_fix_upgrade') {
    kvKeys.push('contentgen:full-fix');
    supabaseFlags.access_content_full_fix = true;
  }
  if (tier === 'recompete') {
    kvKeys.push('recompete');
    supabaseFlags.access_recompete = true;
  }
  if (tier === 'contractor_db') {
    kvKeys.push('database');
    supabaseFlags.access_contractor_db = true;
  }
  if (tier === 'briefings' || tier === 'briefings_monthly' || tier === 'briefings_annual' || tier === 'briefings_lifetime') {
    kvKeys.push('briefings');
    supabaseFlags.access_briefings = true;
  }
  if (tier === 'fhc_membership') {
    kvKeys.push('briefings');
    supabaseFlags.access_assassin_standard = true;
    supabaseFlags.access_briefings = true;
  }

  return { kvKeys, supabaseFlags };
}

// Check KV for user access
async function checkKVAccess(email: string): Promise<string[]> {
  const foundKeys: string[] = [];
  const normalizedEmail = email.toLowerCase().trim();

  for (const pattern of KV_PATTERNS) {
    try {
      const key = `${pattern}${normalizedEmail}`;
      const value = await kv.get(key);
      if (value !== null) {
        foundKeys.push(pattern.replace(':', ''));
      }
    } catch {
      // Key doesn't exist
    }
  }

  // Also check ma:standard and ma:premium specifically
  try {
    const maStandard = await kv.get(`ma:standard:${normalizedEmail}`);
    if (maStandard) foundKeys.push('ma:standard');
  } catch {}
  try {
    const maPremium = await kv.get(`ma:premium:${normalizedEmail}`);
    if (maPremium) foundKeys.push('ma:premium');
  } catch {}

  return [...new Set(foundKeys)]; // Dedupe
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const emailFilter = searchParams.get('email');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
  const supabase = getSupabase();

  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const records: AccessRecord[] = [];
  const emailsChecked = new Set<string>();

  // 1. Pull all Stripe completed sessions
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.Checkout.SessionListParams = {
      limit: 100,
      status: 'complete',
    };
    if (startingAfter) params.starting_after = startingAfter;

    const sessions = await stripe.checkout.sessions.list(params);

    for (const session of sessions.data) {
      const email = (session.customer_email || session.customer_details?.email)?.toLowerCase().trim();
      if (!email) continue;
      if (emailFilter && email !== emailFilter.toLowerCase().trim()) continue;
      if (emailsChecked.has(email)) continue;
      emailsChecked.add(email);

      const tier = session.metadata?.tier;
      const bundle = session.metadata?.bundle;

      if (!tier && !bundle) continue; // No metadata

      const expected = getExpectedAccess(tier, bundle);
      const kvKeys = await checkKVAccess(email);

      // Check Supabase
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('email', email)
        .single();

      const gaps: string[] = [];
      const recommendations: string[] = [];

      // Check KV gaps
      for (const expectedKey of expected.kvKeys) {
        const hasKey = kvKeys.some(k => k.includes(expectedKey.replace(':', '')));
        if (!hasKey) {
          gaps.push(`Missing KV: ${expectedKey}`);
          recommendations.push(`Grant KV access: ${expectedKey}`);
        }
      }

      // Check Supabase gaps
      for (const [flag, shouldHave] of Object.entries(expected.supabaseFlags)) {
        if (shouldHave && (!profile || !profile[flag])) {
          gaps.push(`Missing Supabase: ${flag}`);
          recommendations.push(`Set Supabase flag: ${flag} = true`);
        }
      }

      // Check for Supabase profile existence
      if (!profile && Object.keys(expected.supabaseFlags).length > 0) {
        gaps.push('Missing Supabase profile entirely');
        recommendations.push('Create Supabase user_profiles record');
      }

      records.push({
        email,
        name: session.customer_details?.name || undefined,
        stripe: {
          hasPurchase: true,
          tier: tier || undefined,
          bundle: bundle || undefined,
          sessionId: session.id,
          purchaseDate: new Date(session.created * 1000).toISOString(),
        },
        kv: {
          hasAccess: kvKeys.length > 0,
          keys: kvKeys,
        },
        supabase: {
          hasProfile: !!profile,
          flags: profile ? {
            access_hunter_pro: profile.access_hunter_pro || false,
            access_assassin_standard: profile.access_assassin_standard || false,
            access_assassin_premium: profile.access_assassin_premium || false,
            access_content_standard: profile.access_content_standard || false,
            access_content_full_fix: profile.access_content_full_fix || false,
            access_recompete: profile.access_recompete || false,
            access_contractor_db: profile.access_contractor_db || false,
            access_briefings: profile.access_briefings || false,
          } : {},
        },
        gaps,
        recommendations,
      });
    }

    hasMore = sessions.has_more;
    if (sessions.data.length > 0) {
      startingAfter = sessions.data[sessions.data.length - 1].id;
    }
  }

  // Summary stats
  const withGaps = records.filter(r => r.gaps.length > 0);
  const summary = {
    totalCustomers: records.length,
    withGaps: withGaps.length,
    fullyInSync: records.length - withGaps.length,
    gapTypes: {
      missingKV: withGaps.filter(r => r.gaps.some(g => g.includes('KV'))).length,
      missingSupabase: withGaps.filter(r => r.gaps.some(g => g.includes('Supabase'))).length,
    },
  };

  return NextResponse.json({
    summary,
    customersWithGaps: withGaps,
    allCustomers: emailFilter ? records : undefined, // Only include all if filtering single user
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIP(request);
    const rl = await checkAdminRateLimit(ip);
    if (!rl.allowed) return rateLimitResponse(rl);

    const { searchParams } = new URL(request.url);
    const password = searchParams.get('password');
    const mode = searchParams.get('mode') || 'preview';
    const emailFilter = searchParams.get('email');

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Import grant functions
    const {
      grantOpportunityHunterProAccess,
      grantMarketAssassinAccess,
      grantContentGeneratorAccess,
      grantRecompeteAccess,
      createDatabaseToken,
    } = await import('@/lib/access-codes');

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
    const supabase = getSupabase();

    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const fixes: Array<{
      email: string;
      action: string;
      status: 'pending' | 'success' | 'error';
      error?: string;
    }> = [];

    // Pull sessions and find gaps
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const params: Stripe.Checkout.SessionListParams = {
        limit: 100,
        status: 'complete',
      };
      if (startingAfter) params.starting_after = startingAfter;

      const sessions = await stripe.checkout.sessions.list(params);
      const processedEmails = new Set<string>();

      for (const session of sessions.data) {
        const email = (session.customer_email || session.customer_details?.email)?.toLowerCase().trim();
        if (!email) continue;
        if (emailFilter && email !== emailFilter.toLowerCase().trim()) continue;
        if (processedEmails.has(email)) continue;
        processedEmails.add(email);

        const tier = session.metadata?.tier;
        const bundle = session.metadata?.bundle;
        const name = session.customer_details?.name || undefined;

        if (!tier && !bundle) continue;

        const expected = getExpectedAccess(tier, bundle);
        const kvKeys = await checkKVAccess(email);

        // Fix KV gaps
        for (const expectedKey of expected.kvKeys) {
          const hasKey = kvKeys.some(k => k.includes(expectedKey.replace(':', '')));
          if (!hasKey) {
            const action = `Grant KV: ${expectedKey}`;

            if (mode === 'preview') {
              fixes.push({ email, action, status: 'pending' });
            } else {
              try {
                // Grant based on key type
                if (expectedKey === 'ospro') {
                  await grantOpportunityHunterProAccess(email, name);
                } else if (expectedKey === 'ma:standard') {
                  await grantMarketAssassinAccess(email, 'standard', name);
                } else if (expectedKey === 'ma:premium') {
                  await grantMarketAssassinAccess(email, 'premium', name);
                } else if (expectedKey === 'contentgen') {
                  await grantContentGeneratorAccess(email, 'content-engine', name);
                } else if (expectedKey === 'contentgen:full-fix') {
                  await grantContentGeneratorAccess(email, 'full-fix', name);
                } else if (expectedKey === 'recompete') {
                  await grantRecompeteAccess(email, name);
                } else if (expectedKey === 'database') {
                  await createDatabaseToken(email, name);
                } else if (expectedKey === 'briefings') {
                  await kv.set(`briefings:${email}`, 'true');
                }
                fixes.push({ email, action, status: 'success' });
              } catch (err) {
                fixes.push({
                  email,
                  action,
                  status: 'error',
                  error: err instanceof Error ? err.message : 'Unknown error'
                });
              }
            }
          }
        }

        // Fix Supabase gaps
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('email', email)
          .single();

        const supabaseUpdates: Record<string, boolean> = {};

        for (const [flag, shouldHave] of Object.entries(expected.supabaseFlags)) {
          if (shouldHave && (!profile || !profile[flag])) {
            supabaseUpdates[flag] = true;
          }
        }

        if (Object.keys(supabaseUpdates).length > 0) {
          const action = `Set Supabase flags: ${Object.keys(supabaseUpdates).join(', ')}`;

          if (mode === 'preview') {
            fixes.push({ email, action, status: 'pending' });
          } else {
            try {
              if (profile) {
                // Update existing profile
                await supabase
                  .from('user_profiles')
                  .update(supabaseUpdates)
                  .eq('email', email);
              } else {
                // Create new profile
                await supabase
                  .from('user_profiles')
                  .insert({
                    email,
                    name: name || null,
                    ...supabaseUpdates,
                  });
              }
              fixes.push({ email, action, status: 'success' });
            } catch (err) {
              fixes.push({
                email,
                action,
                status: 'error',
                error: err instanceof Error ? err.message : 'Unknown error'
              });
            }
          }
        }
      }

      hasMore = sessions.has_more;
      if (sessions.data.length > 0) {
        startingAfter = sessions.data[sessions.data.length - 1].id;
      }
    }

    const summary = {
      mode,
      totalFixes: fixes.length,
      success: fixes.filter(f => f.status === 'success').length,
      errors: fixes.filter(f => f.status === 'error').length,
      pending: fixes.filter(f => f.status === 'pending').length,
    };

    return NextResponse.json({
      summary,
      fixes,
      timestamp: new Date().toISOString(),
      nextStep: mode === 'preview'
        ? 'Add &mode=execute to apply these fixes'
        : 'Fixes applied successfully',
    });

  } catch (error) {
    console.error('Sync access error:', error);
    return NextResponse.json(
      { error: `Sync failed: ${error instanceof Error ? error.message : 'unknown'}` },
      { status: 500 }
    );
  }
}
