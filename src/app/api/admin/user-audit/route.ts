// Admin endpoint to audit user profiles for duplicates and access issues
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  const action = searchParams.get('action') || 'full';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Get all user profiles
  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('email');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!profiles) {
    return NextResponse.json({ error: 'No profiles found' }, { status: 404 });
  }

  // 1. Find duplicates (case-insensitive email comparison)
  const emailMap = new Map<string, typeof profiles>();
  const duplicates: { email: string; count: number; ids: string[] }[] = [];

  for (const profile of profiles) {
    const normalizedEmail = profile.email?.toLowerCase().trim();
    if (!normalizedEmail) continue;

    if (!emailMap.has(normalizedEmail)) {
      emailMap.set(normalizedEmail, []);
    }
    emailMap.get(normalizedEmail)!.push(profile);
  }

  for (const [email, dupes] of emailMap) {
    if (dupes.length > 1) {
      duplicates.push({
        email,
        count: dupes.length,
        ids: dupes.map(d => d.id),
      });
    }
  }

  // 2. Find bundle buyers who should have premium but only have standard
  const bundleMismatches: {
    email: string;
    bundle: string;
    hasStandard: boolean;
    hasPremium: boolean;
    issue: string;
  }[] = [];

  for (const profile of profiles) {
    const bundle = profile.bundle?.toLowerCase();
    if (!bundle) continue;

    // Ultimate/Pro bundles should have premium
    if (bundle.includes('ultimate') || bundle === 'complete') {
      if (profile.access_assassin_standard && !profile.access_assassin_premium) {
        bundleMismatches.push({
          email: profile.email,
          bundle: profile.bundle,
          hasStandard: profile.access_assassin_standard,
          hasPremium: profile.access_assassin_premium,
          issue: 'Ultimate bundle should have MA Premium',
        });
      }
    }
  }

  // 3. Find FHC members without briefings
  const fhcWithoutBriefings: { email: string; hasStandard: boolean; hasBriefings: boolean }[] = [];
  for (const profile of profiles) {
    if (profile.access_assassin_standard && !profile.access_briefings) {
      fhcWithoutBriefings.push({
        email: profile.email,
        hasStandard: profile.access_assassin_standard,
        hasBriefings: profile.access_briefings,
      });
    }
  }

  // 4. Summary statistics
  const stats = {
    totalProfiles: profiles.length,
    withMAStandard: profiles.filter(p => p.access_assassin_standard).length,
    withMAPremium: profiles.filter(p => p.access_assassin_premium).length,
    withBriefings: profiles.filter(p => p.access_briefings).length,
    withBundle: profiles.filter(p => p.bundle).length,
    bundleBreakdown: {} as Record<string, number>,
  };

  // Count bundles
  for (const profile of profiles) {
    if (profile.bundle) {
      const b = profile.bundle.toLowerCase();
      stats.bundleBreakdown[b] = (stats.bundleBreakdown[b] || 0) + 1;
    }
  }

  if (action === 'duplicates') {
    return NextResponse.json({ duplicates, count: duplicates.length });
  }

  if (action === 'bundles') {
    return NextResponse.json({ bundleMismatches, count: bundleMismatches.length });
  }

  if (action === 'briefings') {
    return NextResponse.json({ fhcWithoutBriefings, count: fhcWithoutBriefings.length });
  }

  // Full audit
  return NextResponse.json({
    stats,
    issues: {
      duplicates: {
        count: duplicates.length,
        items: duplicates,
      },
      bundleMismatches: {
        count: bundleMismatches.length,
        items: bundleMismatches,
      },
      fhcWithoutBriefings: {
        count: fhcWithoutBriefings.length,
        items: fhcWithoutBriefings,
      },
    },
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const action = searchParams.get('action');
  const mode = searchParams.get('mode') || 'preview';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Fix bundle buyers - upgrade standard to premium where needed
  if (action === 'fix-bundles') {
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('*')
      .not('bundle', 'is', null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const toFix: { email: string; bundle: string }[] = [];

    for (const profile of profiles || []) {
      const bundle = profile.bundle?.toLowerCase();
      if (!bundle) continue;

      // Ultimate/complete bundles should have premium
      if ((bundle.includes('ultimate') || bundle === 'complete') &&
          profile.access_assassin_standard &&
          !profile.access_assassin_premium) {
        toFix.push({ email: profile.email, bundle: profile.bundle });
      }
    }

    if (mode === 'preview') {
      return NextResponse.json({
        mode: 'preview',
        message: `Would upgrade ${toFix.length} bundle buyers to MA Premium`,
        users: toFix,
        instructions: 'Add ?mode=execute to actually fix',
      });
    }

    // Execute fixes
    const results = { success: [] as string[], failed: [] as { email: string; error: string }[] };

    for (const user of toFix) {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          access_assassin_premium: true,
          access_content_full_fix: true, // Ultimate also gets full fix
          access_briefings: true, // Ultimate gets lifetime briefings
        })
        .eq('email', user.email);

      if (updateError) {
        results.failed.push({ email: user.email, error: updateError.message });
      } else {
        results.success.push(user.email);
      }
    }

    return NextResponse.json({
      mode: 'execute',
      message: `Upgraded ${results.success.length} bundle buyers`,
      success: results.success,
      failed: results.failed,
    });
  }

  // Merge duplicates - keep the one with most access, delete others
  // IMPORTANT: Premium includes Standard, so if user has Premium, remove Standard flag
  if (action === 'fix-duplicates') {
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('email');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Group by email
    const emailMap = new Map<string, typeof profiles>();
    for (const profile of profiles || []) {
      const normalizedEmail = profile.email?.toLowerCase().trim();
      if (!normalizedEmail) continue;
      if (!emailMap.has(normalizedEmail)) {
        emailMap.set(normalizedEmail, []);
      }
      emailMap.get(normalizedEmail)!.push(profile);
    }

    const duplicatesToMerge: {
      email: string;
      keepId: string;
      deleteIds: string[];
      mergedAccess: Record<string, boolean>;
    }[] = [];

    for (const [email, dupes] of emailMap) {
      if (dupes.length <= 1) continue;

      // Calculate merged access (OR all flags together)
      const mergedAccess: Record<string, boolean> = {
        access_hunter_pro: false,
        access_content_standard: false,
        access_content_full_fix: false,
        access_assassin_standard: false,
        access_assassin_premium: false,
        access_recompete: false,
        access_contractor_db: false,
        access_briefings: false,
      };

      let keepProfile = dupes[0];
      let maxAccess = 0;

      for (const profile of dupes) {
        let accessCount = 0;
        for (const flag of Object.keys(mergedAccess)) {
          if (profile[flag]) {
            mergedAccess[flag] = true;
            accessCount++;
          }
        }
        // Keep the profile with most access
        if (accessCount > maxAccess) {
          maxAccess = accessCount;
          keepProfile = profile;
        }
      }

      // IMPORTANT: If user has Premium, they don't need Standard flag
      // Premium includes Standard - remove redundant Standard flag
      if (mergedAccess.access_assassin_premium) {
        mergedAccess.access_assassin_standard = false;
      }
      if (mergedAccess.access_content_full_fix) {
        mergedAccess.access_content_standard = false;
      }

      const deleteIds = dupes.filter(d => d.id !== keepProfile.id).map(d => d.id);

      duplicatesToMerge.push({
        email,
        keepId: keepProfile.id,
        deleteIds,
        mergedAccess,
      });
    }

    if (mode === 'preview') {
      return NextResponse.json({
        mode: 'preview',
        message: `Would merge ${duplicatesToMerge.length} duplicate email sets`,
        duplicates: duplicatesToMerge,
        instructions: 'Add ?mode=execute to actually merge',
      });
    }

    // Execute merges
    const results = { success: [] as string[], failed: [] as { email: string; error: string }[] };

    for (const dupe of duplicatesToMerge) {
      try {
        // Update the keeper with merged access
        const { error: updateError } = await supabase
          .from('user_profiles')
          .update(dupe.mergedAccess)
          .eq('id', dupe.keepId);

        if (updateError) {
          results.failed.push({ email: dupe.email, error: updateError.message });
          continue;
        }

        // Delete the duplicates
        for (const deleteId of dupe.deleteIds) {
          const { error: deleteError } = await supabase
            .from('user_profiles')
            .delete()
            .eq('id', deleteId);

          if (deleteError) {
            console.warn(`Failed to delete duplicate ${deleteId}:`, deleteError);
          }
        }

        results.success.push(dupe.email);
      } catch (err) {
        results.failed.push({
          email: dupe.email,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      mode: 'execute',
      message: `Merged ${results.success.length} duplicate email sets`,
      success: results.success,
      failed: results.failed,
    });
  }

  // Clean up redundant Standard flags for users who have Premium
  if (action === 'cleanup-redundant') {
    // Find users with Premium who also have Standard flagged (redundant)
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('id, email, access_assassin_standard, access_assassin_premium, access_content_standard, access_content_full_fix');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const redundant: { email: string; issue: string }[] = [];

    for (const profile of profiles || []) {
      if (profile.access_assassin_premium && profile.access_assassin_standard) {
        redundant.push({ email: profile.email, issue: 'Has MA Premium + redundant MA Standard' });
      }
      if (profile.access_content_full_fix && profile.access_content_standard) {
        redundant.push({ email: profile.email, issue: 'Has Content Full Fix + redundant Content Standard' });
      }
    }

    if (mode === 'preview') {
      return NextResponse.json({
        mode: 'preview',
        message: `Would clean up ${redundant.length} redundant access flags`,
        users: redundant,
        instructions: 'Add ?mode=execute to actually clean up',
      });
    }

    // Execute cleanup
    const results = { success: [] as string[], failed: [] as { email: string; error: string }[] };

    for (const profile of profiles || []) {
      const updates: Record<string, boolean> = {};

      if (profile.access_assassin_premium && profile.access_assassin_standard) {
        updates.access_assassin_standard = false;
      }
      if (profile.access_content_full_fix && profile.access_content_standard) {
        updates.access_content_standard = false;
      }

      if (Object.keys(updates).length === 0) continue;

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', profile.id);

      if (updateError) {
        results.failed.push({ email: profile.email, error: updateError.message });
      } else {
        results.success.push(profile.email);
      }
    }

    return NextResponse.json({
      mode: 'execute',
      message: `Cleaned up ${results.success.length} redundant access flags`,
      success: results.success,
      failed: results.failed,
    });
  }

  return NextResponse.json({
    error: 'Invalid action',
    availableActions: ['fix-bundles', 'fix-duplicates', 'cleanup-redundant'],
  }, { status: 400 });
}
