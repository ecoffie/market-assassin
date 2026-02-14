import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getProfileByEmail, getProfileByLicenseKey, activateLicense, getOrCreateProfile, UserProfile } from '@/lib/supabase/user-profiles';
import { getPurchasesByEmail } from '@/lib/supabase/purchases';
import {
  getMarketAssassinAccess,
  getContentGeneratorAccess,
  hasEmailDatabaseAccess,
  hasOpportunityHunterProAccess,
  hasRecompeteAccess,
} from '@/lib/access-codes';

interface ProductAccess {
  name: string;
  tier?: string;
  accessUrl: string;
  cookieName: string;
  cookieValue: string;
}

// Cookie configuration
const COOKIE_OPTIONS = {
  httpOnly: false, // Allow JS access for client-side checks
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 365 * 24 * 60 * 60, // 1 year
  path: '/',
};

export async function POST(request: NextRequest) {
  try {
    const { email, licenseKey } = await request.json();

    if (!email && !licenseKey) {
      return NextResponse.json({ error: 'Email or license key is required' }, { status: 400 });
    }

    let profile: UserProfile | null = null;
    let normalizedEmail = email?.toLowerCase().trim();

    // Try to find profile by license key first (if provided)
    if (licenseKey) {
      profile = await getProfileByLicenseKey(licenseKey);
      if (profile) {
        normalizedEmail = profile.email;
        console.log(`Found profile by license key for: ${normalizedEmail}`);
      }
    }

    // If no profile found by license key, try by email
    if (!profile && normalizedEmail) {
      profile = await getProfileByEmail(normalizedEmail);
    }

    // Collect all products the user has access to
    const products: ProductAccess[] = [];

    // FIRST: Check user_profiles table for access flags (new system)
    if (profile) {
      // Opportunity Hunter Pro
      if (profile.access_hunter_pro) {
        products.push({
          name: 'Opportunity Hunter Pro',
          tier: 'pro',
          accessUrl: '/opportunity-hunter',
          cookieName: 'access_hunter_pro',
          cookieValue: 'true',
        });
      }

      // Content Generator Standard
      if (profile.access_content_standard && !profile.access_content_full_fix) {
        products.push({
          name: 'Content Reaper',
          tier: 'standard',
          accessUrl: '/content-generator-product',
          cookieName: 'access_content_standard',
          cookieValue: 'true',
        });
      }

      // Content Generator Full Fix
      if (profile.access_content_full_fix) {
        products.push({
          name: 'Content Reaper - Full Fix',
          tier: 'full_fix',
          accessUrl: '/content-generator-product',
          cookieName: 'access_content_full_fix',
          cookieValue: 'true',
        });
      }

      // Market Assassin Standard
      if (profile.access_assassin_standard && !profile.access_assassin_premium) {
        products.push({
          name: 'Federal Market Assassin',
          tier: 'standard',
          accessUrl: '/federal-market-assassin',
          cookieName: 'access_assassin_standard',
          cookieValue: 'true',
        });
      }

      // Market Assassin Premium
      if (profile.access_assassin_premium) {
        products.push({
          name: 'Federal Market Assassin - Premium',
          tier: 'premium',
          accessUrl: '/federal-market-assassin',
          cookieName: 'access_assassin_premium',
          cookieValue: 'true',
        });
      }

      // Recompete
      if (profile.access_recompete) {
        products.push({
          name: 'Recompete Contracts Tracker',
          accessUrl: '/recompete',
          cookieName: 'access_recompete',
          cookieValue: 'true',
        });
      }

      // Contractor Database
      if (profile.access_contractor_db) {
        products.push({
          name: 'Federal Contractor Database',
          accessUrl: '/contractor-database',
          cookieName: 'access_contractor_db',
          cookieValue: 'true',
        });
      }
    }

    // SECOND: Check Supabase purchases table (fallback for records not yet in user_profiles)
    if (normalizedEmail && products.length === 0) {
      const purchases = await getPurchasesByEmail(normalizedEmail);

      for (const purchase of purchases) {
        const tierToCookie: Record<string, { name: string; cookie: string; url: string }> = {
          'hunter_pro': { name: 'Opportunity Hunter Pro', cookie: 'access_hunter_pro', url: '/opportunity-hunter' },
          'content_standard': { name: 'Content Reaper', cookie: 'access_content_standard', url: '/content-generator-product' },
          'content_full_fix': { name: 'Content Reaper - Full Fix', cookie: 'access_content_full_fix', url: '/content-generator-product' },
          'assassin_standard': { name: 'Federal Market Assassin', cookie: 'access_assassin_standard', url: '/federal-market-assassin' },
          'assassin_premium': { name: 'Federal Market Assassin - Premium', cookie: 'access_assassin_premium', url: '/federal-market-assassin' },
          'recompete': { name: 'Recompete Contracts Tracker', cookie: 'access_recompete', url: '/recompete' },
          'contractor_db': { name: 'Federal Contractor Database', cookie: 'access_contractor_db', url: '/contractor-database' },
        };

        const productInfo = tierToCookie[purchase.tier];
        if (productInfo && !products.some(p => p.cookieName === productInfo.cookie)) {
          products.push({
            name: productInfo.name,
            tier: purchase.tier,
            accessUrl: productInfo.url,
            cookieName: productInfo.cookie,
            cookieValue: 'true',
          });
        }
      }
    }

    // THIRD: Check Vercel KV (legacy fallback for old purchases)
    if (normalizedEmail && products.length === 0) {
      // Market Assassin
      const maAccess = await getMarketAssassinAccess(normalizedEmail);
      if (maAccess) {
        const isPremium = maAccess.tier === 'premium';
        products.push({
          name: isPremium ? 'Federal Market Assassin - Premium' : 'Federal Market Assassin',
          tier: maAccess.tier,
          accessUrl: '/federal-market-assassin',
          cookieName: isPremium ? 'access_assassin_premium' : 'access_assassin_standard',
          cookieValue: 'true',
        });
      }

      // Content Generator
      const cgAccess = await getContentGeneratorAccess(normalizedEmail);
      if (cgAccess) {
        const isFullFix = cgAccess.tier === 'full-fix';
        products.push({
          name: isFullFix ? 'Content Reaper - Full Fix' : 'Content Reaper',
          tier: cgAccess.tier,
          accessUrl: '/content-generator-product',
          cookieName: isFullFix ? 'access_content_full_fix' : 'access_content_standard',
          cookieValue: 'true',
        });
      }

      // Federal Contractor Database
      const hasDbAccess = await hasEmailDatabaseAccess(normalizedEmail);
      if (hasDbAccess) {
        products.push({
          name: 'Federal Contractor Database',
          accessUrl: '/contractor-database',
          cookieName: 'access_contractor_db',
          cookieValue: 'true',
        });
      }

      // Opportunity Hunter Pro
      const hasOhPro = await hasOpportunityHunterProAccess(normalizedEmail);
      if (hasOhPro) {
        products.push({
          name: 'Opportunity Hunter Pro',
          accessUrl: '/opportunity-hunter',
          cookieName: 'access_hunter_pro',
          cookieValue: 'true',
        });
      }

      // Recompete
      const hasRecompete = await hasRecompeteAccess(normalizedEmail);
      if (hasRecompete) {
        products.push({
          name: 'Recompete Contracts Tracker',
          accessUrl: '/recompete',
          cookieName: 'access_recompete',
          cookieValue: 'true',
        });
      }
    }

    // No products found
    if (products.length === 0) {
      return NextResponse.json({
        success: false,
        products: [],
        message: 'No products found for this email or license key',
      });
    }

    // SET COOKIES for all products
    const cookieStore = await cookies();

    // Set access email cookie
    if (normalizedEmail) {
      cookieStore.set('access_email', normalizedEmail, COOKIE_OPTIONS);
    }

    // Set individual access cookies
    for (const product of products) {
      cookieStore.set(product.cookieName, product.cookieValue, COOKIE_OPTIONS);

      // Also set the standard tier if full version is granted
      if (product.cookieName === 'access_content_full_fix') {
        cookieStore.set('access_content_standard', 'true', COOKIE_OPTIONS);
      }
      if (product.cookieName === 'access_assassin_premium') {
        cookieStore.set('access_assassin_standard', 'true', COOKIE_OPTIONS);
      }
    }

    // Mark license as activated if we have a profile
    if (profile) {
      await activateLicense(normalizedEmail);
    } else if (normalizedEmail) {
      // Create a profile for this user (for future reference)
      await getOrCreateProfile(normalizedEmail);
    }

    console.log(`License activated for ${normalizedEmail}: ${products.map(p => p.name).join(', ')}`);

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
      licenseKey: profile?.license_key,
      products: products.map(p => ({
        name: p.name,
        tier: p.tier,
        accessUrl: p.accessUrl,
      })),
      message: `Access granted to ${products.length} product(s)`,
    });
  } catch (error) {
    console.error('License activation error:', error);
    return NextResponse.json(
      { error: 'Failed to activate license' },
      { status: 500 }
    );
  }
}
