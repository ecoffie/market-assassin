/**
 * Admin: Get full user breakdown across all tables
 *
 * GET /api/admin/user-breakdown?password=...
 *
 * Returns:
 * - leads (free resource downloads)
 * - user_profiles (purchases)
 * - user_briefing_profile (alert configs)
 * - user_alert_settings (MA Premium alerts)
 * - user_search_history (OH searches)
 * - purchases from SHOP database (shop.govcongiants.org)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const SHOP_ADMIN_PASSWORD = 'admin123'; // shop uses different password

interface ShopPurchase {
  id: string;
  email: string;
  productId: string;
  productName: string;
  amountPaid: number;
  createdAt: string;
}

async function fetchShopPurchases(): Promise<ShopPurchase[]> {
  try {
    const res = await fetch('https://shop.govcongiants.org/api/admin/purchases-report?days=365', {
      headers: { 'x-admin-password': SHOP_ADMIN_PASSWORD },
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.purchases || [];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch shop purchases in parallel with local queries
  const shopPurchasesPromise = fetchShopPurchases();

  // Get leads (free users)
  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('email, name, company, source, resources_accessed, created_at')
    .order('created_at', { ascending: false });

  // Get user_profiles (paying customers)
  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('email, access_hunter_pro, access_assassin_standard, access_assassin_premium, access_recompete, access_contractor_db, access_content_standard, access_content_full_fix, access_briefings, created_at')
    .order('created_at', { ascending: false });

  // Get shop purchases (actual Stripe transactions from SHOP database)
  const shopPurchases = await shopPurchasesPromise;

  // Convert shop purchases to standard format
  const purchases = shopPurchases.map(p => ({
    email: p.email,
    product_name: p.productName,
    product_id: p.productId,
    amount: p.amountPaid,
    created_at: p.createdAt,
  }));
  const purchasesError = shopPurchases.length === 0 ? { message: 'No purchases from shop or fetch failed' } : null;

  // Get user_briefing_profile (alert configurations)
  const { data: briefingProfiles, error: bpError } = await supabase
    .from('user_briefing_profile')
    .select('user_email, naics_codes, agencies, created_at')
    .order('created_at', { ascending: false });

  // Get user_alert_settings (MA Premium weekly alerts)
  const { data: alertSettings, error: asError } = await supabase
    .from('user_alert_settings')
    .select('user_email, naics_codes, business_type, is_active, total_alerts_sent, created_at')
    .order('created_at', { ascending: false });

  // Get unique users from search history (OH users who searched)
  const { data: searchUsers, error: suError } = await supabase
    .from('user_search_history')
    .select('user_email, tool, search_type')
    .order('created_at', { ascending: false });

  // Dedupe search users
  const uniqueSearchUsers = new Map<string, { tools: Set<string>, searches: number }>();
  searchUsers?.forEach(s => {
    if (!s.user_email) return;
    if (!uniqueSearchUsers.has(s.user_email)) {
      uniqueSearchUsers.set(s.user_email, { tools: new Set(), searches: 0 });
    }
    const u = uniqueSearchUsers.get(s.user_email)!;
    u.tools.add(s.tool);
    u.searches++;
  });

  // Build summary
  const leadEmails = new Set(leads?.map(l => l.email?.toLowerCase()).filter(Boolean) || []);
  const profileEmails = new Set(profiles?.map(p => p.email?.toLowerCase()).filter(Boolean) || []);
  const purchaseEmails = new Set(purchases?.map(p => p.email?.toLowerCase()).filter(Boolean) || []);
  const searchEmails = new Set([...uniqueSearchUsers.keys()].map(e => e.toLowerCase()));

  // Group purchases by email
  const purchasesByEmail = new Map<string, Array<{ product: string; productId: string; amount: number; date: string }>>();
  purchases?.forEach(p => {
    if (!p.email) return;
    const email = p.email.toLowerCase();
    if (!purchasesByEmail.has(email)) {
      purchasesByEmail.set(email, []);
    }
    purchasesByEmail.get(email)!.push({
      product: p.product_name || p.product_id,
      productId: p.product_id,
      amount: p.amount || 0,
      date: p.created_at,
    });
  });

  // Free users = leads who are NOT in purchases (haven't purchased)
  const freeUsers = [...leadEmails].filter(e => !purchaseEmails.has(e));

  // OH users = searched but not purchased
  const ohFreeUsers = [...searchEmails].filter(e => !purchaseEmails.has(e));

  // Alert tier logic based on ACTUAL purchases
  // Tier mapping:
  // - OH Free: 5 SAM opps/week (no purchases, just used free search)
  // - OH Pro / Any Paid: 15 SAM opps/week (bought any tool)
  // - MA Premium: 15 SAM opps + Free Briefings + AI Recs upsell ($49/mo)

  // Products that grant 15 opps tier (any paid product)
  const PRO_TIER_PRODUCTS = [
    'opportunity-hunter-pro',
    'market-assassin-standard',
    'market-assassin-premium',
    'ultimate-govcon-bundle',
    'contractor-database',
    'recompete-contracts',
    'ai-content-generator',
    'starter-govcon-bundle',
    'pro-giant-bundle',
  ];

  // Products that include MA Standard or Premium (briefings eligible)
  const MA_PRODUCTS = [
    'market-assassin-standard',
    'market-assassin-premium',
    'ultimate-govcon-bundle',
    'pro-giant-bundle',
  ];

  // Products that include MA Premium (briefings + AI recs)
  const MA_PREMIUM_PRODUCTS = [
    'market-assassin-premium',
    'ultimate-govcon-bundle',
  ];

  // Categorize buyers by tier based on purchases
  const proTierBuyers: string[] = [];
  const maBuyers: string[] = [];
  const maPremiumBuyers: string[] = [];
  const ohProBuyers: string[] = [];

  purchasesByEmail.forEach((userPurchases, email) => {
    const productIds = userPurchases.map(p => p.productId.toLowerCase());

    // Check highest tier first
    if (productIds.some(id => MA_PREMIUM_PRODUCTS.some(p => id.includes(p)))) {
      maPremiumBuyers.push(email);
    } else if (productIds.some(id => MA_PRODUCTS.some(p => id.includes(p)))) {
      maBuyers.push(email);
    } else if (productIds.some(id => id.includes('opportunity-hunter-pro'))) {
      ohProBuyers.push(email);
    } else if (productIds.some(id => PRO_TIER_PRODUCTS.some(p => id.includes(p)))) {
      proTierBuyers.push(email);
    }
  });

  // Legacy: Paying customers breakdown from profiles (may be outdated)
  const withHunterPro = profiles?.filter(p => p.access_hunter_pro) || [];
  const withMAStandard = profiles?.filter(p => p.access_assassin_standard) || [];
  const withMAPremium = profiles?.filter(p => p.access_assassin_premium) || [];
  const withRecompete = profiles?.filter(p => p.access_recompete) || [];
  const withContractorDB = profiles?.filter(p => p.access_contractor_db) || [];
  const withContentStandard = profiles?.filter(p => p.access_content_standard) || [];
  const withContentFullFix = profiles?.filter(p => p.access_content_full_fix) || [];
  const withAnyPaidTool = profiles?.filter(p =>
    p.access_hunter_pro || p.access_assassin_standard || p.access_assassin_premium ||
    p.access_recompete || p.access_contractor_db || p.access_content_standard || p.access_content_full_fix
  ) || [];

  return NextResponse.json({
    summary: {
      total_leads: leads?.length || 0,
      total_profiles: profiles?.length || 0,
      total_purchases: purchases?.length || 0,
      unique_buyers: purchaseEmails.size,
      free_users: freeUsers.length,
      oh_free_users: ohFreeUsers.length,
      users_with_searches: uniqueSearchUsers.size,
      users_with_alert_config: briefingProfiles?.length || 0,
      users_with_ma_alerts: alertSettings?.length || 0,
    },
    paying_customers: {
      any_paid_tool: withAnyPaidTool.length,
      hunter_pro: withHunterPro.length,
      ma_standard: withMAStandard.length,
      ma_premium: withMAPremium.length,
      recompete: withRecompete.length,
      contractor_db: withContractorDB.length,
      content_standard: withContentStandard.length,
      content_full_fix: withContentFullFix.length,
    },
    tier_assignment: {
      oh_free: {
        tier: 'free',
        description: 'Free users - 5 SAM opps/week',
        alert_limit: 5,
        count: ohFreeUsers.length,
        emails: ohFreeUsers.slice(0, 20),
      },
      oh_pro: {
        tier: 'pro',
        description: 'OH Pro buyers - 15 SAM opps/week',
        alert_limit: 15,
        count: ohProBuyers.length,
        emails: ohProBuyers,
      },
      any_paid_tool: {
        tier: 'pro',
        description: 'Other paid tools (Recompete, ContractorDB, etc) - 15 SAM opps/week',
        alert_limit: 15,
        count: proTierBuyers.length,
        emails: proTierBuyers,
      },
      ma_standard: {
        tier: 'ma_standard',
        description: 'MA Standard buyers - 15 SAM opps/week, briefings $29/mo',
        alert_limit: 15,
        briefings_included: false,
        count: maBuyers.length,
        emails: maBuyers,
      },
      ma_premium: {
        tier: 'ma_premium',
        description: 'MA Premium / Ultimate Bundle - 15 SAM opps + FREE briefings, AI recs $49/mo',
        alert_limit: 15,
        briefings_included: true,
        count: maPremiumBuyers.length,
        emails: maPremiumBuyers,
      },
    },
    // Total paying customers (from actual purchases)
    total_paying_customers: purchaseEmails.size,
    // All customers who get 15 opps (any purchase)
    pro_tier_total: ohProBuyers.length + proTierBuyers.length + maBuyers.length + maPremiumBuyers.length,
    purchases_by_product: (() => {
      const byProduct: Record<string, string[]> = {};
      purchases?.forEach(p => {
        const product = p.product_name || p.product_id || 'unknown';
        if (!byProduct[product]) byProduct[product] = [];
        if (p.email && !byProduct[product].includes(p.email.toLowerCase())) {
          byProduct[product].push(p.email.toLowerCase());
        }
      });
      return Object.entries(byProduct).map(([product, emails]) => ({
        product,
        count: emails.length,
        emails,
      }));
    })(),
    all_buyers: [...purchasesByEmail.entries()].map(([email, purchases]) => ({
      email,
      total_spent: purchases.reduce((sum, p) => sum + p.amount, 0),
      purchases: purchases.map(p => p.product),
    })),
    raw: {
      leads: leads?.slice(0, 50),
      profiles: profiles?.slice(0, 50),
      purchases: purchases?.slice(0, 50),
      briefing_profiles: briefingProfiles?.slice(0, 20),
      alert_settings: alertSettings,
      search_users: [...uniqueSearchUsers.entries()].slice(0, 30).map(([email, data]) => ({
        email,
        tools: [...data.tools],
        total_searches: data.searches,
      })),
    },
    errors: {
      leads: leadsError?.message,
      profiles: profilesError?.message,
      purchases: purchasesError?.message,
      briefing_profiles: bpError?.message,
      alert_settings: asError?.message,
      search_history: suError?.message,
    },
  });
}
