import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

/**
 * Stripe Product IDs for bundle detection
 * These are the source of truth for bundle purchases
 */
const STRIPE_PRODUCT_IDS = {
  proGiant: 'prod_TrI1U8j99mcAJm',  // Pro Giant Bundle ($997)
  ultimateGiant: 'prod_TrU0CviMWdDTnj',  // Ultimate Giant Bundle (DISCOUNT) ($1,497)
};

/**
 * Bundle/Product price points in cents
 * Stripe purchase history is the SOURCE OF TRUTH
 *
 * IMPORTANT: Inner Circle is $1,500/year RECURRING subscription
 * Ultimate Bundle is $1,497 ONE-TIME purchase
 * Must distinguish by isRecurring flag, not just amount!
 */
const PRICE_TIERS = {
  // Bundles (one-time purchases)
  // NOTE: Ultimate is detected by price OR by KV access pattern (MA + Content + DB + Recompete)
  // CRITICAL: Only match non-recurring $1,497 charges as Ultimate Bundle
  ultimateGiant: { min: 149700, max: 150300, name: 'Ultimate Bundle', briefings: 'lifetime' as const },
  // NOTE: Pro Giant is detected by KV access pattern (MA + Content Reaper), NOT by price
  // The $997 Pro Giant bundle was sold as a package deal, not a single charge
  starter: { min: 69700, max: 70000, name: 'Starter Bundle', briefings: 'none' as const },

  // Subscriptions
  // Inner Circle: $1,500/year RECURRING - gives lifetime briefings while ACTIVE
  innerCircle: { min: 149700, max: 150300, name: 'Inner Circle', briefings: 'subscription' as const, isRecurring: true },
  // Pro Member: $99/mo or $799/year - includes briefings while active
  proMemberMonthly: { min: 9900, max: 10000, name: 'Pro Member', briefings: 'subscription' as const, isRecurring: true },
  proMemberAnnual: { min: 79900, max: 80000, name: 'Pro Member Annual', briefings: 'subscription' as const, isRecurring: true },
  // Market Intelligence: $49/mo - includes briefings while active
  miSubscription: { min: 4900, max: 5000, name: 'Market Intelligence', briefings: 'subscription' as const, isRecurring: true },
  fhcPro: { min: 9900, max: 10000, name: 'Federal Help Center Pro', briefings: 'none' as const },

  // Standalone products - none give briefings access
  maPremium: { min: 49700, max: 49900, name: 'Market Assassin Premium', briefings: 'none' as const },
  maStandard: { min: 29700, max: 29900, name: 'Market Assassin Standard', briefings: 'none' as const },
  contentFullFix: { min: 39700, max: 39900, name: 'Content Reaper Full Fix', briefings: 'none' as const },
  recompete: { min: 39700, max: 39900, name: 'Recompete Tracker', briefings: 'none' as const },
  contractorDb: { min: 49700, max: 49900, name: 'Contractor Database', briefings: 'none' as const },
  contentStandard: { min: 19700, max: 19900, name: 'Content Reaper', briefings: 'none' as const },
  hunterPro: { min: 1900, max: 2000, name: 'Opportunity Hunter Pro', briefings: 'none' as const },
};

interface StripeCharge {
  amount: number;
  date: Date;
  metadata: Record<string, string>;
  description?: string;
  isRecurring: boolean;
  productIds?: string[];  // Product IDs from invoice line items
}

interface UserProfile {
  email: string;
  name: string;
  charges: StripeCharge[];
  totalSpend: number;
  bundleTier: string | null;
  productsPurchased: string[];
  briefingsAccess: 'lifetime' | '1_year' | 'subscription' | '6_month' | '45_day_trial' | 'none';
  briefingsExpiry?: Date;
  accessSource?: 'bundle_ultimate' | 'inner_circle_active' | 'bundle_pro_giant' | 'past_event_attendee' | 'pro_member_active' | 'mi_subscription' | 'beta_preview' | null;
  discrepancy?: string;
  kvAccessGrants?: string[];
  isUltimateGiant?: boolean;
  isProGiant?: boolean;
  hasMISubscription?: boolean;
  hasInnerCircle?: boolean;
  innerCircleStatus?: 'active' | 'churned';
  hasProMember?: boolean;
  proMemberStatus?: 'active' | 'churned';
  firstPurchaseDate?: Date;
}

/**
 * POST /api/admin/align-treatment-types
 *
 * Reconciles user treatment with Stripe purchase history:
 * - Stripe is SOURCE OF TRUTH for bundle/tier ownership
 * - KV access is operational metadata only
 * - Flags discrepancies between Stripe and KV for review
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';
  const notifyLimit = parseInt(searchParams.get('notifyLimit') || '10');
  const detail = searchParams.get('detail'); // 'ultimate', 'proGiant', or null

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  if (!stripeKey) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // Check if treatment_type column exists
  const { data: sampleUser } = await supabase
    .from('user_notification_settings')
    .select('*')
    .limit(1)
    .single();

  const hasTreatmentType = sampleUser && 'treatment_type' in sampleUser;

  if (!hasTreatmentType && mode !== 'preview') {
    return NextResponse.json({
      error: 'Migration required',
      message: 'Run POST /api/admin/apply-treatment-type-migration?password=xxx first',
    }, { status: 400 });
  }

  // Build user profiles from Supabase cache (populated by backfill-stripe endpoint)
  // This is MUCH faster than calling Stripe API directly (~200ms vs 50+ seconds)
  const useCache = searchParams.get('useCache') !== 'false';
  const skipKVCheck = searchParams.get('skipKV') === 'true'; // Skip KV lookups for faster response

  const startTime = Date.now();
  const userProfiles = useCache
    ? await buildUserProfilesFromSupabaseCache(supabase, skipKVCheck)
    : await buildUserProfilesFromStripe(stripeKey);
  const profileBuildTime = Date.now() - startTime;

  // Fetch Pro Giant purchases from Supabase purchases table
  // This is more reliable than Stripe product IDs for historical purchases
  const { data: proGiantPurchases } = await supabase
    .from('purchases')
    .select('user_email, product_name, amount_paid, created_at')
    .or('product_name.ilike.%Pro Giant%,product_name.ilike.%Product Supplier%');

  // Also fetch Ultimate Giant purchases to exclude users who upgraded
  const { data: ultimatePurchases } = await supabase
    .from('purchases')
    .select('user_email, product_name, created_at')
    .ilike('product_name', '%Ultimate%');

  // Create a set of Ultimate Giant users (to exclude from Pro Giant)
  const ultimateUsers = new Set<string>();
  for (const purchase of ultimatePurchases || []) {
    ultimateUsers.add(purchase.user_email.toLowerCase());
  }

  // Create a map of Pro Giant users with their purchase dates
  // Exclude users who also have Ultimate purchases (they upgraded)
  const proGiantUsers = new Map<string, Date>();
  for (const purchase of proGiantPurchases || []) {
    const email = purchase.user_email.toLowerCase();
    // Skip if user upgraded to Ultimate
    if (ultimateUsers.has(email)) continue;

    const purchaseDate = new Date(purchase.created_at);
    // Only add if not already in map or this is an earlier purchase
    if (!proGiantUsers.has(email) || purchaseDate < proGiantUsers.get(email)!) {
      proGiantUsers.set(email, purchaseDate);
    }
  }

  // Override user profiles with Pro Giant status from purchases table
  const profileEmails = new Set(userProfiles.map(p => p.email.toLowerCase()));

  for (const profile of userProfiles) {
    const purchaseDate = proGiantUsers.get(profile.email.toLowerCase());
    if (purchaseDate && !profile.isUltimateGiant) {
      // Don't downgrade Ultimate to Pro Giant
      profile.bundleTier = 'Pro Giant Bundle';
      profile.isProGiant = true;
      profile.briefingsAccess = '1_year';
      // Set expiry to 1 year from purchase
      const expiry = new Date(purchaseDate);
      expiry.setFullYear(expiry.getFullYear() + 1);
      profile.briefingsExpiry = expiry;
      if (!profile.productsPurchased.includes('Pro Giant Bundle')) {
        profile.productsPurchased.push('Pro Giant Bundle');
      }
    }
  }

  // Add Pro Giant users who don't have Stripe profiles (guest checkout)
  for (const [email, purchaseDate] of proGiantUsers.entries()) {
    if (!profileEmails.has(email)) {
      // Create a new profile for this Pro Giant user
      const expiry = new Date(purchaseDate);
      expiry.setFullYear(expiry.getFullYear() + 1);

      userProfiles.push({
        email,
        name: '',
        charges: [],
        totalSpend: 99700, // $997 Pro Giant price
        bundleTier: 'Pro Giant Bundle',
        productsPurchased: ['Pro Giant Bundle'],
        briefingsAccess: '1_year',
        briefingsExpiry: expiry,
        isProGiant: true,
        firstPurchaseDate: purchaseDate,
      });
    }
  }

  // Fetch all users from notification settings
  const { data: allUsers, error: fetchError } = await supabase
    .from('user_notification_settings')
    .select('user_email, is_active, alerts_enabled, briefings_enabled, experiment_cohort, paid_status, treatment_type')
    .limit(10000);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const profileMap = new Map(userProfiles.map(p => [p.email.toLowerCase(), p]));
  const now = new Date();

  // Categorize migrations needed
  const migrations: {
    email: string;
    oldTreatment: string | null;
    newTreatment: string;
    oldPaidStatus: boolean;
    newPaidStatus: boolean;
    reason: string;
    needsNotification: boolean;
    profile?: UserProfile;
  }[] = [];

  const discrepancies: {
    email: string;
    issue: string;
    stripeSpend: number;
    bundleTier: string | null;
    kvAccess: string[];
  }[] = [];

  // Track KV-detected bundles (users without Stripe profiles)
  const kvDetectedBundles = {
    ultimateGiant: 0,
    proGiant: 0,
  };
  const kvDetectedUltimateEmails: string[] = [];

  for (const user of allUsers || []) {
    const email = user.user_email.toLowerCase();
    const profile = profileMap.get(email);
    let isPaid = profile && profile.totalSpend > 0;
    const currentTreatment = user.treatment_type || 'alerts';
    const currentPaidStatus = user.paid_status || false;

    // Determine treatment based on Stripe purchase history
    // Tiered access rules:
    //   1. Ultimate Giant Bundle → Lifetime briefings
    //   2. Pro Giant Bundle → 1-year briefings (check expiry)
    //   3. MI Subscription → Active briefings while subscribed
    //   4. Any other paying customer → 45-day trial from first purchase
    //   5. Flash sale users (no Stripe, but have KV briefings access) → Lifetime
    //   6. Non-paying → Alerts only
    let newTreatment = 'alerts';
    let briefingsTier = 'none';

    if (profile) {
      if (profile.isUltimateGiant || profile.briefingsAccess === 'lifetime') {
        // Ultimate Giant = lifetime briefings
        newTreatment = 'briefings';
        briefingsTier = 'lifetime';
      } else if (profile.isProGiant || profile.briefingsAccess === '1_year') {
        // Pro Giant = 1 year from purchase
        if (profile.briefingsExpiry && profile.briefingsExpiry > now) {
          newTreatment = 'briefings';
          briefingsTier = '1_year';
        } else {
          newTreatment = 'alerts'; // Expired
          briefingsTier = 'expired';
        }
      } else if (profile.hasMISubscription || profile.briefingsAccess === 'subscription') {
        // Active MI subscription
        newTreatment = 'briefings';
        briefingsTier = 'subscription';
      } else if (isPaid && profile.firstPurchaseDate) {
        // Any other paying customer gets 45-day trial from first purchase
        const trialEndDate = new Date(profile.firstPurchaseDate);
        trialEndDate.setDate(trialEndDate.getDate() + 45);

        if (trialEndDate > now) {
          newTreatment = 'briefings';
          briefingsTier = '45_day_trial';
        } else {
          newTreatment = 'alerts'; // Trial expired
          briefingsTier = 'trial_expired';
        }
      }
      // Else: non-paying = alerts (default)

      if (profile.discrepancy) {
        discrepancies.push({
          email: profile.email,
          issue: profile.discrepancy,
          stripeSpend: profile.totalSpend / 100,
          bundleTier: profile.bundleTier,
          kvAccess: profile.kvAccessGrants || [],
        });
      }
    } else {
      // User has no Stripe profile - check KV access for bundle detection
      // This handles flash sale users AND bundle users who paid via non-Stripe channels
      try {
        // Check all relevant KV keys
        const [maRaw, contentRaw, dbRaw, recompeteRaw, briefingsRaw] = await Promise.all([
          kv.get(`ma:${email}`),
          kv.get(`contentgen:${email}`),
          kv.get(`dbaccess:${email}`),
          kv.get(`recompete:${email}`),
          kv.get(`briefings:${email}`),
        ]);

        const hasMA = !!maRaw;
        const hasContent = !!contentRaw;
        const hasDB = !!dbRaw;
        const hasRecompete = !!recompeteRaw;
        const hasAllFour = hasMA && hasContent && hasDB && hasRecompete;

        // Extract tier info from MA and Content KV data
        let maTier: string | undefined;
        let contentTier: string | undefined;
        if (maRaw && typeof maRaw === 'object') {
          const maData = maRaw as Record<string, unknown>;
          if (maData.tier) maTier = String(maData.tier).toLowerCase();
        }
        if (contentRaw && typeof contentRaw === 'object') {
          const contentData = contentRaw as Record<string, unknown>;
          if (contentData.tier) contentTier = String(contentData.tier).toLowerCase();
        }

        // Check for premium tiers (Ultimate Giant)
        const isPremiumMA = maTier === 'premium' || maTier === 'assassin_premium';
        const isFullFixContent = contentTier === 'full-fix' || contentTier === 'full_fix' || contentTier === 'content_full_fix';

        // Flash sale check - they should have briefings KV with flash_sale marker
        if (briefingsRaw) {
          const parsed = typeof briefingsRaw === 'string' ? JSON.parse(briefingsRaw) : briefingsRaw;
          if (parsed.tier === 'lifetime' || parsed.source === 'flash_sale_backfill') {
            // Flash sale user - keep them on briefings and mark as paid
            newTreatment = 'briefings';
            briefingsTier = 'lifetime_flash_sale';
            isPaid = true;
          }
        }

        // Bundle detection based on ALL 4 products + tier levels
        // Ultimate Giant = all 4 + (Premium MA OR Full Fix Content)
        // Pro Giant is ONLY detected via Stripe (product ID or $997 price)
        // Do NOT detect Pro Giant from KV alone - too many false positives
        if (hasAllFour && briefingsTier !== 'lifetime_flash_sale') {
          if (isPremiumMA || isFullFixContent) {
            // Ultimate Giant via KV - premium tiers are reliable indicators
            newTreatment = 'briefings';
            briefingsTier = 'lifetime_kv';
            isPaid = true;
            kvDetectedBundles.ultimateGiant++;
            kvDetectedUltimateEmails.push(email);
          }
          // Note: We do NOT detect Pro Giant from KV - standard tiers are not reliable
          // Pro Giant users are detected via Stripe product ID or $997 price only
        }

        // Also count flash sale users as Ultimate Giant
        if (briefingsTier === 'lifetime_flash_sale') {
          kvDetectedBundles.ultimateGiant++;
          kvDetectedUltimateEmails.push(email);
        }
      } catch {
        // KV error, default to alerts
      }
    }

    const newPaidStatus = isPaid ?? false;
    const needsMigration = currentTreatment !== newTreatment || currentPaidStatus !== newPaidStatus;

    if (needsMigration) {
      const needsNotification = (isPaid ?? false) && currentTreatment !== 'briefings' && newTreatment === 'briefings';

      migrations.push({
        email: user.user_email,
        oldTreatment: currentTreatment,
        newTreatment,
        oldPaidStatus: currentPaidStatus,
        newPaidStatus,
        reason: 'stripe_reconciliation',
        needsNotification,
        profile,
      });
    }
  }

  // Summary stats
  const upgradesToBriefings = migrations.filter(m => m.newTreatment === 'briefings');
  const downgradeToAlerts = migrations.filter(m => m.newTreatment === 'alerts' && m.oldTreatment === 'briefings');
  const noChange = (allUsers || []).length - migrations.length;

  // Collect Ultimate Giant and Pro Giant emails for detail view
  const ultimateGiantEmails: string[] = [];
  const proGiantEmails: string[] = [];

  // From Stripe profiles
  for (const profile of userProfiles) {
    if (profile.bundleTier === 'Ultimate Bundle' || profile.bundleTier === 'Ultimate Bundle (Flash Sale)' || profile.isUltimateGiant) {
      if (!ultimateGiantEmails.includes(profile.email)) {
        ultimateGiantEmails.push(profile.email);
      }
    }
    if (profile.bundleTier === 'Pro Giant Bundle' || profile.isProGiant) {
      if (!proGiantEmails.includes(profile.email)) {
        proGiantEmails.push(profile.email);
      }
    }
  }

  // Count bundles from both Stripe profiles AND KV-detected (non-Stripe) users
  // IMPORTANT: We now distinguish Inner Circle ($1,500/year recurring) from Ultimate Bundle ($1,497 one-time)
  const stripeUltimate = userProfiles.filter(p =>
    (p.bundleTier === 'Ultimate Bundle' || p.bundleTier === 'Ultimate Bundle (Flash Sale)') &&
    !p.hasInnerCircle // Exclude Inner Circle subscribers
  ).length;
  const stripeProGiant = userProfiles.filter(p => p.bundleTier === 'Pro Giant Bundle').length;

  // Inner Circle counts (active vs churned)
  const innerCircleActive = userProfiles.filter(p => p.hasInnerCircle && p.innerCircleStatus === 'active').length;
  const innerCircleChurned = userProfiles.filter(p => p.hasInnerCircle && p.innerCircleStatus === 'churned').length;

  // Pro Member counts (active vs churned)
  const proMemberActive = userProfiles.filter(p => p.hasProMember && p.proMemberStatus === 'active').length;
  const proMemberChurned = userProfiles.filter(p => p.hasProMember && p.proMemberStatus === 'churned').length;

  // Event attendees ($1,498/$1,997/$799/$499 one-time charges that aren't bundles)
  const eventAttendees = userProfiles.filter(p =>
    p.briefingsAccess === '6_month' &&
    !p.bundleTier &&
    !p.hasInnerCircle
  ).length;

  const bundleCounts = {
    // Lifetime access
    ultimateGiant: stripeUltimate + kvDetectedBundles.ultimateGiant,
    innerCircleActive,
    // 1-year access
    proGiant: stripeProGiant + kvDetectedBundles.proGiant,
    // 6-month access
    eventAttendees,
    // Subscription-based
    innerCircleChurned, // Win-back targets
    proMemberActive,
    proMemberChurned,
    miSubscription: userProfiles.filter(p => p.hasMISubscription).length,
    // Other
    starter: userProfiles.filter(p => p.bundleTier === 'Starter Bundle').length,
    standalone: userProfiles.filter(p =>
      !p.bundleTier &&
      !p.hasInnerCircle &&
      !p.hasProMember &&
      !p.hasMISubscription &&
      p.briefingsAccess !== '6_month' &&
      p.totalSpend > 0
    ).length,
  };

  if (mode === 'preview') {
    const totalTime = Date.now() - startTime;
    return NextResponse.json({
      success: true,
      mode: 'preview',
      hasTreatmentTypeColumn: hasTreatmentType,
      timing: {
        profileBuildMs: profileBuildTime,
        totalMs: totalTime,
        source: useCache ? 'supabase_cache' : 'stripe_api',
        kvChecksEnabled: !skipKVCheck,
      },
      reconciliationRules: {
        sourceOfTruth: 'Stripe purchase history',
        bundleDetection: 'Charge amounts (not KV access)',
        discrepancyHandling: 'Flag for manual review',
      },
      summary: {
        totalUsers: (allUsers || []).length,
        totalPaidCustomers: userProfiles.filter(p => p.totalSpend > 0).length,
        migrationsNeeded: migrations.length,
        upgradesToBriefings: upgradesToBriefings.length,
        downgradeToAlerts: downgradeToAlerts.length,
        noChangeNeeded: noChange,
        needsNotification: upgradesToBriefings.filter(m => m.needsNotification).length,
        discrepancies: discrepancies.length,
      },
      bundleClassification: bundleCounts,
      sampleMigrations: {
        upgrades: upgradesToBriefings.slice(0, 10).map(m => ({
          email: m.email,
          bundleTier: m.profile?.bundleTier || null,
          productsPurchased: m.profile?.productsPurchased || [],
          stripeSpend: (m.profile?.totalSpend || 0) / 100,
          briefingsAccess: m.profile?.briefingsAccess || 'none',
          briefingsExpiry: m.profile?.briefingsExpiry?.toISOString() || null,
          accessSource: m.profile?.accessSource || null,
          innerCircleStatus: m.profile?.innerCircleStatus || null,
          proMemberStatus: m.profile?.proMemberStatus || null,
        })),
        downgrades: downgradeToAlerts.slice(0, 5).map(m => ({
          email: m.email,
          reason: m.profile?.briefingsAccess === '1_year' && m.profile?.briefingsExpiry
            ? `Pro Giant expired: ${m.profile.briefingsExpiry.toISOString()}`
            : m.profile?.hasInnerCircle && m.profile?.innerCircleStatus === 'churned'
              ? 'Inner Circle churned - win-back target'
              : 'No valid Stripe purchase',
        })),
      },
      discrepancies: discrepancies.slice(0, 20),
      // Include full email lists when detail parameter is specified
      ...(detail === 'ultimate' && {
        ultimateGiantEmails: {
          fromStripe: ultimateGiantEmails,
          fromKV: kvDetectedUltimateEmails,
          combined: [...new Set([...ultimateGiantEmails, ...kvDetectedUltimateEmails])].sort(),
          total: [...new Set([...ultimateGiantEmails, ...kvDetectedUltimateEmails])].length,
        },
      }),
      ...(detail === 'proGiant' && {
        proGiantEmails: {
          emails: proGiantEmails.sort(),
          total: proGiantEmails.length,
        },
      }),
      instructions: {
        migrate: 'Use mode=migrate to apply treatment_type changes',
        notify: 'Use mode=notify&notifyLimit=N to send upgrade notifications',
        detail: 'Use detail=ultimate or detail=proGiant to get full email lists',
      },
    });
  }

  if (mode === 'migrate') {
    const results: { email: string; status: 'updated' | 'failed'; error?: string }[] = [];

    for (const migration of migrations) {
      try {
        const { error: updateError } = await supabase
          .from('user_notification_settings')
          .update({
            treatment_type: migration.newTreatment,
            paid_status: migration.newPaidStatus,
            briefings_enabled: migration.newTreatment === 'briefings',
          })
          .eq('user_email', migration.email);

        if (updateError) throw updateError;

        await supabase.from('experiment_log').insert({
          user_email: migration.email,
          action: 'treatment_alignment',
          old_value: {
            treatment_type: migration.oldTreatment,
            paid_status: migration.oldPaidStatus,
          },
          new_value: {
            treatment_type: migration.newTreatment,
            paid_status: migration.newPaidStatus,
            bundle_tier: migration.profile?.bundleTier,
            briefings_access: migration.profile?.briefingsAccess,
          },
          reason: 'stripe_reconciliation',
        });

        results.push({ email: migration.email, status: 'updated' });
      } catch (err) {
        results.push({
          email: migration.email,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const updated = results.filter(r => r.status === 'updated').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return NextResponse.json({
      success: true,
      mode: 'migrate',
      summary: {
        processed: migrations.length,
        updated,
        failed,
      },
      results: results.slice(0, 50),
      nextStep: 'Use mode=notify to send upgrade notifications',
    });
  }

  if (mode === 'notify') {
    const toNotify = upgradesToBriefings
      .filter(m => m.needsNotification && m.profile)
      .slice(0, notifyLimit);

    const results: { email: string; status: 'sent' | 'failed'; error?: string }[] = [];

    for (const migration of toNotify) {
      try {
        const html = generateUpgradeNotificationEmail(
          migration.email,
          migration.profile?.name || '',
          migration.profile?.bundleTier || 'GovCon products',
          migration.profile?.briefingsAccess || 'none'
        );

        await sendEmail({
          to: migration.email,
          subject: '🎯 Your Market Intelligence Access is Now Active',
          html,
          emailType: 'treatment_upgrade',
          tags: { campaign: 'stripe_reconciliation_apr2026' },
        });

        results.push({ email: migration.email, status: 'sent' });

        await supabase.from('experiment_log').insert({
          user_email: migration.email,
          action: 'upgrade_notification_sent',
          new_value: {
            bundle_tier: migration.profile?.bundleTier,
            briefings_access: migration.profile?.briefingsAccess,
          },
          reason: 'stripe_reconciliation',
        });
      } catch (err) {
        results.push({
          email: migration.email,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const remaining = upgradesToBriefings.filter(m => m.needsNotification).length - notifyLimit;

    return NextResponse.json({
      success: true,
      mode: 'notify',
      summary: {
        processed: toNotify.length,
        sent,
        failed,
        remaining: Math.max(0, remaining),
      },
      results,
    });
  }

  return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
}

export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * Fetch checkout session to get product IDs from line items
 */
async function fetchCheckoutSession(stripeKey: string, sessionId: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items`,
      { headers: { 'Authorization': `Bearer ${stripeKey}` } }
    );
    const session = await response.json();
    if (session.error || !session.line_items?.data) return [];

    return session.line_items.data
      .map((item: { price?: { product?: string } }) => item.price?.product)
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}

/**
 * Build user profiles from Supabase cache (customer_classifications table)
 * This is MUCH faster than calling Stripe API directly (~200ms vs 50+ seconds)
 *
 * The cache is populated by /api/admin/backfill-stripe endpoint
 *
 * @param supabase - Supabase client
 * @param skipKVCheck - If true, skip KV lookups for faster response (discrepancy detection disabled)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildUserProfilesFromSupabaseCache(
  supabase: any,
  skipKVCheck: boolean = false
): Promise<UserProfile[]> {
  // Fetch all customer classifications from cache
  const { data: classifications, error } = await supabase
    .from('customer_classifications')
    .select('*');

  if (error) {
    console.error('Failed to fetch customer_classifications:', error);
    throw new Error(`Cache query failed: ${error.message}`);
  }

  if (!classifications || classifications.length === 0) {
    console.warn('No customer classifications found in cache - run backfill-stripe first');
    return [];
  }

  const profiles: UserProfile[] = [];

  for (const cc of classifications) {
    // Map briefings_access string to the correct type
    let briefingsAccess: UserProfile['briefingsAccess'] = 'none';
    if (cc.briefings_access === 'lifetime') briefingsAccess = 'lifetime';
    else if (cc.briefings_access === '1_year') briefingsAccess = '1_year';
    else if (cc.briefings_access === 'subscription') briefingsAccess = 'subscription';
    else if (cc.briefings_access === '6_month') briefingsAccess = '6_month';
    else if (cc.briefings_access === '45_day_trial') briefingsAccess = '45_day_trial';

    // Determine bundle flags from bundle_tier
    const isUltimateGiant = cc.bundle_tier?.includes('Ultimate') || false;
    const isProGiant = cc.bundle_tier === 'Pro Giant Bundle';

    // Determine access source
    let accessSource: UserProfile['accessSource'] = null;
    if (isUltimateGiant) {
      accessSource = 'bundle_ultimate';
    } else if (isProGiant) {
      accessSource = 'bundle_pro_giant';
    } else if (cc.has_active_subscription && cc.subscription_type === 'inner_circle') {
      accessSource = 'inner_circle_active';
    } else if (cc.has_active_subscription && cc.subscription_type === 'pro_member') {
      accessSource = 'pro_member_active';
    } else if (cc.has_active_subscription && cc.subscription_type === 'mi_subscription') {
      accessSource = 'mi_subscription';
    } else if (briefingsAccess === '6_month') {
      accessSource = 'past_event_attendee';
    } else if (cc.total_spend > 0 && briefingsAccess === 'none') {
      accessSource = 'beta_preview';
    }

    // Check KV for discrepancy detection (optional - skip for faster response)
    let kvAccessGrants: string[] = [];
    let discrepancy: string | undefined;

    if (!skipKVCheck) {
      const kvAccessInfo = await checkKVAccessWithTier(cc.email);
      kvAccessGrants = kvAccessInfo.grants;

      // Flag discrepancies
      if (isUltimateGiant) {
        const expectedKV = ['ma', 'contentgen', 'dbaccess', 'recompete'];
        const missingKV = expectedKV.filter(k => !kvAccessGrants.includes(k));
        if (missingKV.length > 0) {
          discrepancy = `Ultimate buyer missing KV access: ${missingKV.join(', ')}`;
        }
      } else if (isProGiant) {
        const expectedKV = ['ma', 'contentgen', 'dbaccess', 'recompete'];
        const missingKV = expectedKV.filter(k => !kvAccessGrants.includes(k));
        if (missingKV.length > 0) {
          discrepancy = `Pro Giant buyer missing KV access: ${missingKV.join(', ')}`;
        }
      }

      // Check for over-provisioned access
      if (!cc.bundle_tier && kvAccessGrants.length >= 4) {
        const bundleAccess = ['ma', 'contentgen', 'dbaccess', 'recompete'].every(k => kvAccessGrants.includes(k));
        if (bundleAccess && cc.total_spend < 69700) {
          discrepancy = `Has bundle-level KV access but only $${cc.total_spend / 100} in Stripe`;
        }
      }
    }

    // Create empty charges array (we don't store individual charges in the cache)
    // The cache stores aggregated data which is sufficient for classification
    const charges: StripeCharge[] = [];

    profiles.push({
      email: cc.email,
      name: '', // Name not stored in cache, could add later if needed
      charges,
      totalSpend: cc.total_spend || 0,
      bundleTier: cc.bundle_tier,
      productsPurchased: cc.products_purchased || [],
      briefingsAccess,
      briefingsExpiry: cc.briefings_expiry ? new Date(cc.briefings_expiry) : undefined,
      accessSource,
      discrepancy,
      kvAccessGrants,
      isUltimateGiant,
      isProGiant,
      hasMISubscription: cc.subscription_type === 'mi_subscription' && cc.has_active_subscription,
      hasInnerCircle: cc.subscription_type === 'inner_circle',
      innerCircleStatus: cc.subscription_type === 'inner_circle'
        ? (cc.has_active_subscription ? 'active' : 'churned')
        : undefined,
      hasProMember: cc.subscription_type === 'pro_member',
      proMemberStatus: cc.subscription_type === 'pro_member'
        ? (cc.has_active_subscription ? 'active' : 'churned')
        : undefined,
      firstPurchaseDate: cc.first_charge_at ? new Date(cc.first_charge_at) : undefined,
    });
  }

  console.log(`Built ${profiles.length} user profiles from Supabase cache`);
  return profiles;
}

/**
 * Build user profiles directly from Stripe charges
 * Stripe is the SOURCE OF TRUTH
 */
async function buildUserProfilesFromStripe(stripeKey: string): Promise<UserProfile[]> {
  const chargesByEmail: Map<string, StripeCharge[]> = new Map();
  const nameByEmail: Map<string, string> = new Map();

  // Fetch all charges with payment_intent expansion to get checkout session reference
  let hasMore = true;
  let startingAfter: string | null = null;

  while (hasMore) {
    const params = new URLSearchParams({
      limit: '100',
      'expand[]': 'data.customer',
    });
    // Add second expand for payment_intent to get order_reference
    params.append('expand[]', 'data.payment_intent');
    if (startingAfter) params.append('starting_after', startingAfter);

    const response = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
      headers: { 'Authorization': `Bearer ${stripeKey}` },
    });

    const data = await response.json();
    if (data.error) break;

    for (const charge of data.data) {
      if (charge.status !== 'succeeded' || charge.refunded) continue;

      const email = (charge.receipt_email || charge.customer?.email || charge.billing_details?.email || '').toLowerCase().trim();
      if (!email) continue;

      if (!chargesByEmail.has(email)) {
        chargesByEmail.set(email, []);
      }

      // Try to get product IDs from checkout session if available
      let productIds: string[] = [];
      const orderRef = charge.payment_intent?.payment_details?.order_reference;
      if (orderRef && orderRef.startsWith('cs_')) {
        // This is a checkout session ID - fetch it to get product IDs
        productIds = await fetchCheckoutSession(stripeKey, orderRef);
      }

      chargesByEmail.get(email)!.push({
        amount: charge.amount,
        date: new Date(charge.created * 1000),
        metadata: charge.metadata || {},
        description: charge.description || '',
        isRecurring: !!(charge.invoice && (charge.description?.toLowerCase().includes('subscription') || charge.metadata?.recurring === 'true')),
        productIds,  // Product IDs from checkout session
      });

      if (!nameByEmail.has(email)) {
        nameByEmail.set(email, charge.customer?.name || charge.billing_details?.name || '');
      }
    }

    hasMore = data.has_more;
    if (data.data.length > 0) {
      startingAfter = data.data[data.data.length - 1].id;
    }
  }

  // Also fetch active subscriptions
  const subscriptionsByEmail = await fetchActiveSubscriptions(stripeKey);

  // Build profiles
  const profiles: UserProfile[] = [];

  for (const [email, charges] of chargesByEmail.entries()) {
    const totalSpend = charges.reduce((sum, c) => sum + c.amount, 0);
    const activeSubscription = subscriptionsByEmail.get(email);

    // Classify based on Stripe data
    const classification = classifyFromStripe(charges, activeSubscription);

    // Check KV for discrepancy detection - get tier info too
    const kvAccessInfo = await checkKVAccessWithTier(email);
    const kvAccessGrants = kvAccessInfo.grants;

    // Flag discrepancies
    let discrepancy: string | undefined;
    if (classification.bundleTier === 'Ultimate Bundle' || classification.bundleTier === 'Ultimate Bundle (Flash Sale)') {
      const expectedKV = ['ma', 'contentgen', 'dbaccess', 'recompete'];
      const missingKV = expectedKV.filter(k => !kvAccessGrants.includes(k));
      if (missingKV.length > 0) {
        discrepancy = `Ultimate buyer missing KV access: ${missingKV.join(', ')}`;
      }
    } else if (classification.bundleTier === 'Pro Giant Bundle') {
      const expectedKV = ['ma', 'contentgen', 'dbaccess', 'recompete'];
      const missingKV = expectedKV.filter(k => !kvAccessGrants.includes(k));
      if (missingKV.length > 0) {
        discrepancy = `Pro Giant buyer missing KV access: ${missingKV.join(', ')}`;
      }
    }

    // Check for over-provisioned access
    if (!classification.bundleTier && kvAccessGrants.length >= 4) {
      const bundleAccess = ['ma', 'contentgen', 'dbaccess', 'recompete'].every(k => kvAccessGrants.includes(k));
      if (bundleAccess && totalSpend < 69700) {
        discrepancy = `Has bundle-level KV access but only $${totalSpend / 100} in Stripe`;
      }
    }

    // Check if this is a flash sale user (already has briefings KV access from backfill)
    // Flash sale users were backfilled with lifetime briefings via backfill-flash-sale endpoint
    let isFlashSaleUltimate = false;
    if (kvAccessGrants.includes('briefings')) {
      // Check KV briefings data for flash sale marker
      try {
        const briefingsData = await kv.get(`briefings:${email}`);
        if (briefingsData) {
          const parsed = typeof briefingsData === 'string' ? JSON.parse(briefingsData) : briefingsData;
          if (parsed.tier === 'lifetime' && (parsed.source === 'flash_sale_backfill' || parsed.product?.includes('Flash Sale'))) {
            isFlashSaleUltimate = true;
          }
        }
      } catch {
        // KV parse error, skip
      }
    }

    // Determine final briefings access, accounting for flash sale users
    let finalBriefingsAccess = classification.briefingsAccess;
    let finalIsUltimateGiant = classification.isUltimateGiant;
    let finalIsProGiant = classification.isProGiant;
    let finalBundleTier = classification.bundleTier;
    let finalBriefingsExpiry = classification.briefingsExpiry;

    if (isFlashSaleUltimate && finalBriefingsAccess !== 'lifetime') {
      finalBriefingsAccess = 'lifetime';
      finalIsUltimateGiant = true;
      finalBundleTier = finalBundleTier || 'Ultimate Bundle (Flash Sale)';
    }

    // Bundle detection from KV access patterns
    // Both Pro Giant and Ultimate Giant have ALL 4 products (MA + Content + DB + Recompete)
    // The difference is the TIER level:
    //   - Ultimate Giant = MA Premium + Content Full Fix (premium tiers)
    //   - Pro Giant = MA Standard + Content Standard (standard tiers)
    const hasMAAccess = kvAccessGrants.includes('ma');
    const hasContentAccess = kvAccessGrants.includes('contentgen');
    const hasDBAccess = kvAccessGrants.includes('dbaccess');
    const hasRecompeteAccess = kvAccessGrants.includes('recompete');
    const hasAllFour = hasMAAccess && hasContentAccess && hasDBAccess && hasRecompeteAccess;

    // Check tier levels from KV
    const isPremiumMA = kvAccessInfo.maTier === 'premium' || kvAccessInfo.maTier === 'assassin_premium';
    const isFullFixContent = kvAccessInfo.contentTier === 'full-fix' || kvAccessInfo.contentTier === 'full_fix' || kvAccessInfo.contentTier === 'content_full_fix';

    // Ultimate Giant = all 4 products + (Premium MA OR Full Fix Content)
    const isUltimatePattern = hasAllFour && (isPremiumMA || isFullFixContent);

    // NOTE: Pro Giant is ONLY detected via Stripe (product ID or $997 price)
    // hasAllFour with standard tiers is NOT reliable for Pro Giant detection
    // KV-based detection is unreliable for Pro Giant since "standard tiers" could be
    // manually provisioned users, not actual Pro Giant bundle buyers.

    // Apply Ultimate Giant detection from KV if not already detected via Stripe
    // (Premium/Full-Fix tiers are reliable indicators of Ultimate Giant)
    if (isUltimatePattern && !finalIsUltimateGiant && !finalBundleTier) {
      finalIsUltimateGiant = true;
      finalBundleTier = 'Ultimate Bundle';
      if (finalBriefingsAccess !== 'lifetime') {
        finalBriefingsAccess = 'lifetime';
      }
    }
    // Pro Giant detection removed from KV - too many false positives
    // Pro Giant users are detected via Stripe classifyFromStripe() only

    // Determine access source based on classification
    let accessSource: UserProfile['accessSource'] = null;
    if (finalIsUltimateGiant) {
      accessSource = 'bundle_ultimate';
    } else if (classification.hasInnerCircle && classification.innerCircleStatus === 'active') {
      accessSource = 'inner_circle_active';
    } else if (finalIsProGiant) {
      accessSource = 'bundle_pro_giant';
    } else if (finalBriefingsAccess === '6_month') {
      accessSource = 'past_event_attendee';
    } else if (classification.hasProMember && classification.proMemberStatus === 'active') {
      accessSource = 'pro_member_active';
    } else if (classification.hasMISubscription) {
      accessSource = 'mi_subscription';
    } else if (totalSpend > 0 && finalBriefingsAccess === 'none') {
      accessSource = 'beta_preview';
    }

    profiles.push({
      email,
      name: nameByEmail.get(email) || '',
      charges,
      totalSpend,
      bundleTier: finalBundleTier,
      productsPurchased: classification.products,
      briefingsAccess: finalBriefingsAccess,
      briefingsExpiry: finalBriefingsExpiry,
      accessSource,
      discrepancy,
      kvAccessGrants,
      isUltimateGiant: finalIsUltimateGiant,
      isProGiant: finalIsProGiant,
      hasMISubscription: classification.hasMISubscription,
      hasInnerCircle: classification.hasInnerCircle,
      innerCircleStatus: classification.innerCircleStatus ?? undefined,
      hasProMember: classification.hasProMember,
      proMemberStatus: classification.proMemberStatus ?? undefined,
      firstPurchaseDate: classification.firstPurchaseDate,
    });
  }

  return profiles;
}

/**
 * Classify user based on Stripe charge amounts and product IDs
 *
 * Key distinction:
 * - Inner Circle = $1,500/year RECURRING subscription
 * - Ultimate Bundle = $1,497 ONE-TIME purchase
 *
 * Both have similar amounts, so we MUST check isRecurring flag!
 */
function classifyFromStripe(
  charges: StripeCharge[],
  activeSubscription?: { product: string; active: boolean }
): {
  bundleTier: string | null;
  products: string[];
  briefingsAccess: 'lifetime' | '1_year' | 'subscription' | '6_month' | '45_day_trial' | 'none';
  briefingsExpiry?: Date;
  isUltimateGiant: boolean;
  isProGiant: boolean;
  hasMISubscription: boolean;
  hasInnerCircle: boolean;
  innerCircleStatus: 'active' | 'churned' | null;
  hasProMember: boolean;
  proMemberStatus: 'active' | 'churned' | null;
  firstPurchaseDate?: Date;
} {
  const products: string[] = [];
  let bundleTier: string | null = null;
  let briefingsAccess: 'lifetime' | '1_year' | 'subscription' | '6_month' | '45_day_trial' | 'none' = 'none';
  let briefingsExpiry: Date | undefined;
  let isUltimateGiant = false;
  let isProGiant = false;
  let hasMISubscription = false;
  let hasInnerCircle = false;
  let innerCircleStatus: 'active' | 'churned' | null = null;
  let hasProMember = false;
  let proMemberStatus: 'active' | 'churned' | null = null;
  let firstPurchaseDate: Date | undefined;

  // Find earliest purchase date
  if (charges.length > 0) {
    const sortedCharges = [...charges].sort((a, b) => a.date.getTime() - b.date.getTime());
    firstPurchaseDate = sortedCharges[0].date;
  }

  // Sort charges by date (newest first) for detecting current status
  const sortedCharges = [...charges].sort((a, b) => b.date.getTime() - a.date.getTime());
  const now = new Date();

  // EVENT ATTENDEE PRICE POINTS (bootcamp, conference, challenge)
  const EVENT_PRICES = [
    { min: 149700, max: 150300 }, // $1,497-$1,503 (bootcamp/conference)
    { min: 199700, max: 200300 }, // $1,997-$2,003 (premium bootcamp)
    { min: 79800, max: 80200 },   // $798-$802 (challenge/workshop)
    { min: 49800, max: 50200 },   // $498-$502 (smaller event)
  ];

  // STEP 1: Detect Inner Circle ($1,500/year RECURRING)
  // This must be checked BEFORE Ultimate Bundle detection since amounts overlap
  const innerCircleCharges = sortedCharges.filter(c =>
    c.isRecurring &&
    c.amount >= 149700 && c.amount <= 150300 &&
    (c.description?.toLowerCase().includes('subscription') || c.description?.toLowerCase().includes('inner circle'))
  );

  if (innerCircleCharges.length > 0) {
    hasInnerCircle = true;
    if (!products.includes('Inner Circle')) {
      products.push('Inner Circle');
    }

    // Check if most recent charge succeeded (within last 13 months)
    const latestCharge = innerCircleCharges[0];
    const thirteenMonthsAgo = new Date(now);
    thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13);

    if (latestCharge.date > thirteenMonthsAgo) {
      innerCircleStatus = 'active';
      briefingsAccess = 'lifetime'; // Active Inner Circle = lifetime while active
    } else {
      innerCircleStatus = 'churned';
      // Churned = no automatic briefings (win-back campaign target)
    }
  }

  // STEP 2: Check for Pro Member subscription ($99/mo or $799/year)
  const proMemberCharges = sortedCharges.filter(c =>
    c.isRecurring &&
    ((c.amount >= 9800 && c.amount <= 10200) || (c.amount >= 79800 && c.amount <= 80200)) &&
    (c.description?.toLowerCase().includes('subscription') ||
     c.description?.toLowerCase().includes('pro member') ||
     c.description?.toLowerCase().includes('federal help center'))
  );

  if (proMemberCharges.length > 0) {
    hasProMember = true;
    if (!products.includes('Pro Member')) {
      products.push('Pro Member');
    }

    // Check if most recent charge is recent (within subscription period)
    const latestCharge = proMemberCharges[0];
    const cutoffDate = new Date(now);
    // Annual = 13 months, Monthly = 45 days
    if (latestCharge.amount >= 79800) {
      cutoffDate.setMonth(cutoffDate.getMonth() - 13);
    } else {
      cutoffDate.setDate(cutoffDate.getDate() - 45);
    }

    if (latestCharge.date > cutoffDate) {
      proMemberStatus = 'active';
      if (briefingsAccess === 'none') {
        briefingsAccess = 'subscription';
      }
    } else {
      proMemberStatus = 'churned';
    }
  }

  // STEP 3: Check for explicit metadata (highest priority for bundles)
  for (const charge of sortedCharges) {
    const meta = charge.metadata;
    if (meta.product_type === 'bundle') {
      if (meta.bundle_tier === 'ultimate_giant') {
        bundleTier = 'Ultimate Bundle';
        briefingsAccess = 'lifetime';
        isUltimateGiant = true;
        break;
      }
      if (meta.bundle_tier === 'pro_giant') {
        bundleTier = 'Pro Giant Bundle';
        if (briefingsAccess !== 'lifetime') {
          briefingsAccess = '1_year';
          briefingsExpiry = new Date(charge.date);
          briefingsExpiry.setFullYear(briefingsExpiry.getFullYear() + 1);
        }
        isProGiant = true;
        break;
      }
    }
  }

  // STEP 4: Check for bundles by Stripe product ID
  if (!bundleTier) {
    for (const charge of sortedCharges) {
      const productIds = charge.productIds || [];

      // Pro Giant Bundle detection by product ID
      if (productIds.includes(STRIPE_PRODUCT_IDS.proGiant)) {
        bundleTier = 'Pro Giant Bundle';
        if (briefingsAccess !== 'lifetime') {
          briefingsAccess = '1_year';
          briefingsExpiry = new Date(charge.date);
          briefingsExpiry.setFullYear(briefingsExpiry.getFullYear() + 1);
        }
        isProGiant = true;
        if (!products.includes('Pro Giant Bundle')) {
          products.push('Pro Giant Bundle');
        }
        break;
      }

      // Ultimate Giant Bundle detection by product ID
      if (productIds.includes(STRIPE_PRODUCT_IDS.ultimateGiant)) {
        bundleTier = 'Ultimate Bundle';
        briefingsAccess = 'lifetime';
        isUltimateGiant = true;
        if (!products.includes('Ultimate Bundle')) {
          products.push('Ultimate Bundle');
        }
        break;
      }
    }
  }

  // STEP 5: Detect Ultimate Bundle by price (ONE-TIME $1,497-$1,503)
  // CRITICAL: Must be NON-RECURRING to distinguish from Inner Circle
  if (!bundleTier && !hasInnerCircle) {
    for (const charge of sortedCharges) {
      if (!charge.isRecurring && charge.amount >= 149700 && charge.amount <= 150300) {
        // Check description to see if it's truly a bundle purchase
        const desc = charge.description?.toLowerCase() || '';
        const isBundleDescription = desc.includes('bundle') || desc.includes('ultimate') ||
                                     desc.includes('payment for invoice');

        if (isBundleDescription) {
          bundleTier = 'Ultimate Bundle';
          briefingsAccess = 'lifetime';
          isUltimateGiant = true;
          if (!products.includes('Ultimate Bundle')) {
            products.push('Ultimate Bundle');
          }
          break;
        }
      }
    }
  }

  // STEP 6: Detect past event attendees (6-month access)
  // $1,498/$1,997/$799/$499 one-time charges that aren't bundles
  if (!bundleTier && !hasInnerCircle && briefingsAccess === 'none') {
    for (const charge of sortedCharges) {
      if (charge.isRecurring) continue;

      const isEventPrice = EVENT_PRICES.some(p => charge.amount >= p.min && charge.amount <= p.max);
      if (isEventPrice) {
        // This is an event attendee
        if (!products.includes('Past Event Attendee')) {
          products.push('Past Event Attendee');
        }
        // 6-month access from today (April 28, 2026)
        briefingsAccess = '6_month';
        briefingsExpiry = new Date('2026-10-28'); // October 28, 2026
        break;
      }
    }
  }

  // STEP 7: Check active subscription from Stripe
  if (activeSubscription?.active) {
    if (!products.includes(activeSubscription.product)) {
      products.push(activeSubscription.product);
    }

    // Market Intelligence subscription
    const isMISubscription = activeSubscription.product.includes('Market Intelligence') ||
                             activeSubscription.product.includes('Intelligence');

    if (isMISubscription) {
      hasMISubscription = true;
      if (briefingsAccess !== 'lifetime' && briefingsAccess !== '1_year') {
        briefingsAccess = 'subscription';
      }
    }

    // Pro Member subscription
    const isProMemberSub = activeSubscription.product.includes('Pro Member') ||
                           activeSubscription.product.includes('Federal Help Center');
    if (isProMemberSub) {
      hasProMember = true;
      proMemberStatus = 'active';
      if (briefingsAccess !== 'lifetime' && briefingsAccess !== '1_year') {
        briefingsAccess = 'subscription';
      }
    }

    // Inner Circle subscription
    const isInnerCircleSub = activeSubscription.product.includes('Inner Circle');
    if (isInnerCircleSub) {
      hasInnerCircle = true;
      innerCircleStatus = 'active';
      briefingsAccess = 'lifetime';
    }
  }

  // Set flags based on what we detected
  if (bundleTier === 'Ultimate Bundle' || bundleTier === 'Ultimate Bundle (Flash Sale)') {
    isUltimateGiant = true;
  }
  if (bundleTier === 'Pro Giant Bundle') {
    isProGiant = true;
  }

  return {
    bundleTier,
    products,
    briefingsAccess,
    briefingsExpiry,
    isUltimateGiant,
    isProGiant,
    hasMISubscription,
    hasInnerCircle,
    innerCircleStatus,
    hasProMember,
    proMemberStatus,
    firstPurchaseDate,
  };
}

/**
 * Fetch active subscriptions from Stripe
 */
async function fetchActiveSubscriptions(stripeKey: string): Promise<Map<string, { product: string; active: boolean }>> {
  const subscriptions = new Map<string, { product: string; active: boolean }>();

  try {
    const response = await fetch('https://api.stripe.com/v1/subscriptions?status=active&limit=100&expand[]=data.customer', {
      headers: { 'Authorization': `Bearer ${stripeKey}` },
    });

    const data = await response.json();
    if (data.data) {
      for (const sub of data.data) {
        const email = sub.customer?.email?.toLowerCase().trim();
        if (email) {
          const price = sub.items?.data?.[0]?.price;
          let product = 'Subscription';

          if (price?.unit_amount) {
            if (price.unit_amount >= 4900 && price.unit_amount <= 5000) {
              product = 'Market Intelligence';
            } else if (price.unit_amount >= 9900 && price.unit_amount <= 10000) {
              product = 'Federal Help Center Pro';
            }
          }

          subscriptions.set(email, { product, active: true });
        }
      }
    }
  } catch {
    // Ignore subscription fetch errors
  }

  return subscriptions;
}

/**
 * KV access data with tier information
 */
interface KVAccessWithTier {
  grants: string[];
  maTier?: string;  // 'premium' or 'standard'
  contentTier?: string;  // 'full-fix' or 'standard'
}

/**
 * Check KV access grants for discrepancy detection
 * Also returns tier information for MA and Content to distinguish Pro Giant vs Ultimate Giant
 */
async function checkKVAccess(email: string): Promise<string[]> {
  const result = await checkKVAccessWithTier(email);
  return result.grants;
}

/**
 * Check KV access grants WITH tier information
 * Used to distinguish Pro Giant (standard tiers) from Ultimate Giant (premium/full-fix tiers)
 */
async function checkKVAccessWithTier(email: string): Promise<KVAccessWithTier> {
  const kvKeys = {
    ma: `ma:${email}`,
    contentgen: `contentgen:${email}`,
    dbaccess: `dbaccess:${email}`,
    recompete: `recompete:${email}`,
    ospro: `ospro:${email}`,
    alertpro: `alertpro:${email}`,
    briefings: `briefings:${email}`,
  };

  const grants: string[] = [];
  let maTier: string | undefined;
  let contentTier: string | undefined;

  for (const [product, key] of Object.entries(kvKeys)) {
    try {
      const value = await kv.get(key);
      if (value) {
        grants.push(product);

        // Extract tier information for MA and Content
        if (product === 'ma' && typeof value === 'object' && value !== null) {
          const data = value as Record<string, unknown>;
          if (data.tier) maTier = String(data.tier).toLowerCase();
        }
        if (product === 'contentgen' && typeof value === 'object' && value !== null) {
          const data = value as Record<string, unknown>;
          if (data.tier) contentTier = String(data.tier).toLowerCase();
        }
      }
    } catch {
      // KV error, skip
    }
  }

  return { grants, maTier, contentTier };
}

function generateUpgradeNotificationEmail(
  email: string,
  name: string,
  bundle: string,
  briefingsAccess: 'lifetime' | '1_year' | 'subscription' | '6_month' | '45_day_trial' | 'none'
): string {
  const greeting = name ? `Hi ${name.split(' ')[0]},` : 'Hi there,';

  const accessDuration = briefingsAccess === 'lifetime'
    ? '<strong>lifetime access</strong>'
    : briefingsAccess === '1_year'
      ? '<strong>1 year of access</strong>'
      : briefingsAccess === '6_month'
        ? '<strong>6 months of access</strong> (through October 2026)'
        : briefingsAccess === 'subscription'
          ? 'access with your subscription'
          : briefingsAccess === '45_day_trial'
            ? '<strong>45-day complimentary access</strong> (included with your purchase)'
            : 'access';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">
                🎯 Your Access Has Been Upgraded
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                ${greeting}
              </p>
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                Great news! As a ${bundle} customer, your account now includes ${accessDuration} to <strong>Market Intelligence</strong> — our premium daily briefing service.
              </p>
              <div style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border: 1px solid #86efac; border-radius: 8px; padding: 24px; margin: 24px 0;">
                <h3 style="margin: 0 0 16px; color: #166534; font-size: 16px; font-weight: 600;">
                  What's Now Included:
                </h3>
                <ul style="margin: 0; padding: 0 0 0 20px; color: #166534; font-size: 14px; line-height: 1.8;">
                  <li><strong>Daily Market Brief</strong> — Opportunities matched to your NAICS codes</li>
                  <li><strong>Weekly Deep Dive</strong> — Analysis of expiring contracts & recompete intel</li>
                  <li><strong>Pursuit Brief</strong> — Top 3 high-value targets with win probability scoring</li>
                  <li><strong>Forecasts Access</strong> — 7,700+ agency forecasts 6-18 months ahead</li>
                </ul>
              </div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="https://tools.govcongiants.org/briefings"
                       style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: #ffffff; padding: 16px 40px; font-size: 18px; font-weight: 600; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
                      View Your Dashboard →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                If you haven't set up your industry profile yet, we'll guide you through a quick 2-minute setup to personalize your briefings.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 12px; text-align: center;">
                GovCon Giants • Federal Contracting Intelligence<br>
                <a href="mailto:service@govcongiants.com" style="color: #059669;">service@govcongiants.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}
