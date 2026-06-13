/**
 * Customer Qualification Agent API
 *
 * Identifies users and customers worth personal outreach based on:
 * - Purchase history (Stripe/Supabase)
 * - MI engagement (briefings, alerts, app usage)
 * - Profile completion
 * - Activity signals
 *
 * GET /api/admin/qualify-customers?password=xxx           → Full qualification report
 * GET /api/admin/qualify-customers?password=xxx&segment=10-10  → Specific segment
 * GET /api/admin/qualify-customers?password=xxx&format=csv     → CSV export
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';
import {
  SEGMENT_DEFINITIONS,
  buildSegmentContext,
  describeWhyQualified,
  determineSegment,
  getRecommendedAction,
} from '@/lib/mindy/customer-segments';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// Scoring weights from the spec
const SCORE_WEIGHTS = {
  // Purchase signals
  ULTIMATE_BUNDLE: 30,
  ACTIVE_MI_PRO: 25,
  MULTIPLE_PURCHASES: 20,
  HIGH_TICKET: 15,
  ACTIVE_SUBSCRIPTION: 20,

  // Engagement signals
  PROFILE_COMPLETED: 15,
  CUSTOM_NAICS: 10,
  BRIEFING_OPENED: 10,
  BRIEFING_CLICKED: 5,
  MI_APP_ACTIVE_7D: 15,
  SAVED_OPPORTUNITY: 20,
  USED_PIPELINE: 15,
  USED_FORECASTS: 10,

  // Intent signals
  ATTENDED_BOOTCAMP: 15,
  POSITIVE_FEEDBACK: 10,

  // Negative signals
  REFUND_DISPUTE: -30,
  NO_PROFILE_NO_ENGAGEMENT: -20,
  INACTIVE_30D: -10,
};

// Product tiers for scoring
const HIGH_TICKET_PRODUCTS = [
  'ultimate-giant',
  'pro-giant',
  'contractor-database',
  'market-assassin-premium',
];

const BUNDLE_PRODUCTS = [
  'ultimate-giant',
  'pro-giant',
  'starter-bundle',
];

interface QualifiedCustomer {
  email: string;
  name: string | null;
  segment: string;
  score: number;
  signals: string[];
  recommendedAction: string;
  whyQualified: string;
  // Raw data for debugging
  totalSpent: number;
  purchaseCount: number;
  productsOwned: string[];
  hasActiveSubscription: boolean;
  profileComplete: boolean;
  hasCustomNaics: boolean;
  briefingsReceived: number;
  lastActivity: string | null;
}

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

// Default NAICS codes that indicate incomplete profile
const DEFAULT_NAICS = new Set(['541512', '541611', '541330', '541990', '561210']);

function hasCustomNaics(naicsCodes: string[] | null): boolean {
  if (!naicsCodes || naicsCodes.length === 0) return false;
  // Has custom if ANY code is not in the default set
  return naicsCodes.some(code => !DEFAULT_NAICS.has(code));
}

function isProfileComplete(user: {
  naics_codes: string[] | null;
  business_type: string | null;
  location_state: string | null;
}): boolean {
  return Boolean(
    user.naics_codes &&
    user.naics_codes.length > 0 &&
    hasCustomNaics(user.naics_codes)
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const segment = searchParams.get('segment'); // Filter by specific segment
  const format = searchParams.get('format'); // 'csv' for export
  const limit = parseInt(searchParams.get('limit') || '100', 10);

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabase();

    // Fetch all data sources in parallel
    // Note: Supabase default limit is 1000 rows, we need to fetch in batches for large tables

    // First, fetch purchases and smaller tables
    const [
      purchasesRes,
      briefingLogsRes,
      subscriptionsRes,
      pipelineRes,
      feedbackRes,
    ] = await Promise.all([
      // All purchases (usually <500)
      supabase
        .from('purchases')
        .select('user_email, product_name, amount_paid, created_at')
        .order('created_at', { ascending: false })
        .limit(2000),

      // Briefing delivery log (last 30 days)
      supabase
        .from('briefing_log')
        .select('user_email, briefing_date, briefing_type')
        .gte('briefing_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .limit(10000),

      // Active subscriptions
      supabase
        .from('stripe_subscriptions')
        .select('customer_id, product_name, status, plan_amount')
        .eq('status', 'active')
        .limit(1000),

      // Pipeline activity (saved opportunities)
      supabase
        .from('user_pipeline')
        .select('user_email, created_at')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(5000),

      // Positive feedback
      supabase
        .from('briefing_feedback')
        .select('user_email, rating')
        .eq('rating', 'helpful')
        .limit(5000),
    ]);

    // Fetch users in multiple batches to handle large user base (10K+ users)
    // Supabase default limit is 1000, we'll use that to avoid config issues
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 15; // Safety limit: 15 pages × 1000 = 15K users max
    const allUsers: Array<{
      user_email: string;
      naics_codes: string[] | null;
      business_type: string | null;
      location_state: string | null;
      briefings_enabled: boolean;
      alerts_enabled: boolean;
      created_at: string;
      updated_at: string;
      treatment_type: string | null;
      products_owned: string[] | null;
      paid_status: boolean | null;
    }> = [];

    let page = 0;
    let hasMore = true;
    while (hasMore && page < MAX_PAGES) {
      const { data, error } = await supabase
        .from('user_notification_settings')
        .select('user_email, naics_codes, business_type, location_state, briefings_enabled, alerts_enabled, created_at, updated_at, treatment_type, products_owned, paid_status')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        .order('user_email');

      if (error) {
        console.error('[qualify-customers] Error fetching users page', page, error);
        break;
      }

      if (data && data.length > 0) {
        allUsers.push(...data);
        hasMore = data.length === PAGE_SIZE;
        page++;
      } else {
        hasMore = false;
      }

      // Log progress
      console.log(`[qualify-customers] Fetched page ${page}, got ${data?.length || 0} users, total: ${allUsers.length}`);
    }

    const usersRes = { data: allUsers };

    console.log(`[qualify-customers] Fetched ${purchasesRes.data?.length || 0} purchases, ${allUsers.length} users`);

    // Build lookup maps
    const purchasesByEmail = new Map<string, { products: string[]; totalSpent: number; count: number }>();
    for (const p of purchasesRes.data || []) {
      const email = p.user_email?.toLowerCase();
      if (!email) continue;
      const existing = purchasesByEmail.get(email) || { products: [], totalSpent: 0, count: 0 };
      existing.products.push(p.product_name);
      existing.totalSpent += (p.amount_paid || 0) / 100; // Convert cents to dollars
      existing.count++;
      purchasesByEmail.set(email, existing);
    }

    const briefingsByEmail = new Map<string, number>();
    for (const b of briefingLogsRes.data || []) {
      const email = b.user_email?.toLowerCase();
      if (!email) continue;
      briefingsByEmail.set(email, (briefingsByEmail.get(email) || 0) + 1);
    }

    const pipelineByEmail = new Set<string>();
    for (const p of pipelineRes.data || []) {
      if (p.user_email) pipelineByEmail.add(p.user_email.toLowerCase());
    }

    const positiveFeedbackEmails = new Set<string>();
    for (const f of feedbackRes.data || []) {
      if (f.user_email) positiveFeedbackEmails.add(f.user_email.toLowerCase());
    }

    // Map customer IDs to emails from subscriptions (we need stripe_customers join)
    const activeSubscriptionCustomers = new Set<string>();
    for (const s of subscriptionsRes.data || []) {
      if (s.customer_id) activeSubscriptionCustomers.add(s.customer_id);
    }

    // Score each user
    const qualifiedCustomers: QualifiedCustomer[] = [];

    for (const user of usersRes.data || []) {
      const email = user.user_email?.toLowerCase();
      if (!email) continue;

      // Skip internal/test emails
      if (email.includes('@govcongiants.com') ||
          email.includes('@govconedu.com') ||
          email.includes('test@')) {
        continue;
      }
      // Skip comp/advocate/partner accounts — they're not customers, so they must
      // not pollute scoring, segments, or purchaser counts.
      if (isExcludedFromMetrics(email)) continue;

      const purchase = purchasesByEmail.get(email);
      const briefingsCount = briefingsByEmail.get(email) || 0;
      const hasPipeline = pipelineByEmail.has(email);
      const hasPositiveFeedback = positiveFeedbackEmails.has(email);
      const profileComplete = isProfileComplete(user);
      const customNaics = hasCustomNaics(user.naics_codes);

      let score = 0;
      const signals: string[] = [];
      let hasUltimateBundle = false;
      let hasHighTicketProduct = false;

      // Purchase signals
      if (purchase) {
        const products = purchase.products.map(p => p?.toLowerCase() || '');

        if (products.some(p => p.includes('ultimate'))) {
          hasUltimateBundle = true;
          score += SCORE_WEIGHTS.ULTIMATE_BUNDLE;
          signals.push('Ultimate Bundle buyer (+30)');
        }

        if (products.some(p => HIGH_TICKET_PRODUCTS.some(ht => p.includes(ht)))) {
          hasHighTicketProduct = true;
          score += SCORE_WEIGHTS.HIGH_TICKET;
          signals.push('High-ticket purchase (+15)');
        }

        if (purchase.count >= 2) {
          score += SCORE_WEIGHTS.MULTIPLE_PURCHASES;
          signals.push(`Multiple purchases: ${purchase.count} (+20)`);
        }

        if (user.paid_status || user.treatment_type === 'briefings') {
          score += SCORE_WEIGHTS.ACTIVE_MI_PRO;
          signals.push('Active Mindy Pro / Briefings (+25)');
        }
      }

      // Engagement signals
      if (profileComplete) {
        score += SCORE_WEIGHTS.PROFILE_COMPLETED;
        signals.push('Profile complete (+15)');
      }

      if (customNaics) {
        score += SCORE_WEIGHTS.CUSTOM_NAICS;
        signals.push('Custom NAICS selected (+10)');
      }

      if (briefingsCount > 0) {
        score += SCORE_WEIGHTS.BRIEFING_OPENED;
        signals.push(`Briefings received: ${briefingsCount} (+10)`);
      }

      if (hasPipeline) {
        score += SCORE_WEIGHTS.SAVED_OPPORTUNITY;
        signals.push('Saved/tracked opportunity (+20)');
      }

      if (hasPositiveFeedback) {
        score += SCORE_WEIGHTS.POSITIVE_FEEDBACK;
        signals.push('Positive feedback (+10)');
      }

      // Negative signals
      if (!profileComplete && briefingsCount === 0 && !purchase) {
        score += SCORE_WEIGHTS.NO_PROFILE_NO_ENGAGEMENT;
        signals.push('No profile, no engagement (-20)');
      }

      // Determine segment from real flags (not signal-string parsing)
      const segmentCtx = buildSegmentContext({
        score,
        profileComplete,
        purchase,
        briefingsCount,
        hasPipeline,
        hasPositiveFeedback,
        hasUltimateBundle,
        hasHighTicketProduct,
      });
      const customerSegment = determineSegment(segmentCtx);
      const recommendedAction = getRecommendedAction(customerSegment, segmentCtx);
      const whyQualified = describeWhyQualified(customerSegment, segmentCtx);

      qualifiedCustomers.push({
        email,
        name: null, // Would need to join with stripe_customers
        segment: customerSegment,
        score,
        signals,
        recommendedAction,
        whyQualified,
        totalSpent: purchase?.totalSpent || 0,
        purchaseCount: purchase?.count || 0,
        productsOwned: purchase?.products || [],
        hasActiveSubscription: user.paid_status || false,
        profileComplete,
        hasCustomNaics: customNaics,
        briefingsReceived: briefingsCount,
        lastActivity: user.updated_at,
      });
    }

    // Sort by score descending
    qualifiedCustomers.sort((a, b) => b.score - a.score);

    // Filter by segment if requested
    let filtered = qualifiedCustomers;
    if (segment) {
      const segmentLower = segment.toLowerCase();
      filtered = qualifiedCustomers.filter(c =>
        c.segment.toLowerCase().includes(segmentLower)
      );
    }

    // Limit results
    filtered = filtered.slice(0, limit);

    // Generate segment summaries
    const segmentCounts: Record<string, number> = {};
    for (const c of qualifiedCustomers) {
      segmentCounts[c.segment] = (segmentCounts[c.segment] || 0) + 1;
    }

    // CSV export
    if (format === 'csv') {
      const headers = ['Rank', 'Email', 'Segment', 'Score', 'Why Qualified', 'Signals', 'Recommended Action', 'Total Spent', 'Products'];
      const rows = filtered.map((c, i) => [
        i + 1,
        c.email,
        c.segment,
        c.score,
        c.whyQualified,
        c.signals.join('; '),
        c.recommendedAction,
        `$${c.totalSpent.toFixed(2)}`,
        c.productsOwned.join(', '),
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n');

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="qualified-customers-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    // Decorate each list entry with live outreach state so Sikander
    // and Shanoor see who's already invited / called / booked / etc
    // instead of working from stale CSVs. One query, build a lookup
    // by lowercased email. Best-effort: if the join fails (table not
    // yet migrated, RLS hiccup), we still return the lists without
    // the decoration.
    type OutreachRow = {
      email: string;
      owner: string | null;
      status: string | null;
      last_contacted_at: string | null;
      next_action: string | null;
      call_booked_at: string | null;
    };
    const outreachByEmail = new Map<string, OutreachRow>();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: outreachRows } = await (supabase as any)
        .from('internal_outreach_contacts')
        .select('email, owner, status, last_contacted_at, next_action, call_booked_at');
      for (const row of (outreachRows || []) as OutreachRow[]) {
        if (row.email) outreachByEmail.set(row.email.toLowerCase(), row);
      }
    } catch (err) {
      console.warn('[qualify-customers] outreach decoration skipped:', err);
    }

    const decorateOutreach = <T extends { email: string }>(entry: T) => {
      const o = outreachByEmail.get(entry.email.toLowerCase());
      return {
        ...entry,
        outreach: o
          ? {
              owner: o.owner,
              status: o.status,
              lastContactedAt: o.last_contacted_at,
              nextAction: o.next_action,
              callBookedAt: o.call_booked_at,
            }
          : null,
      };
    };

    // JSON response
    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      segmentDefinitions: SEGMENT_DEFINITIONS,
      summary: {
        totalScored: qualifiedCustomers.length,
        totalUsers: allUsers.length,
        totalPurchases: purchasesRes.data?.length || 0,
        uniquePurchasers: purchasesByEmail.size,
        purchasersWithProfile: qualifiedCustomers.filter(c => c.totalSpent > 0).length,
        bySegment: segmentCounts,
        top10Score: qualifiedCustomers.slice(0, 10).map(c => ({ email: c.email, score: c.score, segment: c.segment })),
      },
      lists: {
        // Top 10 for founder calls
        founderCalls: qualifiedCustomers
          .filter(c => c.segment === '10-10 Candidate')
          .slice(0, 10)
          .map(c => decorateOutreach({
            email: c.email,
            score: c.score,
            why: c.signals.slice(0, 3).join(', '),
            action: c.recommendedAction,
          })),

        // Activation — incomplete profile, setup nudges (Annelle/Sikander)
        activationCandidates: qualifiedCustomers
          .filter(c => c.segment === 'Activation Candidate')
          .slice(0, 50)
          .map(c => decorateOutreach({
            email: c.email,
            score: c.score,
            why: c.whyQualified,
            action: c.recommendedAction,
          })),

        // Top 25 for Shanoor/Sikander outreach
        salesOutreach: qualifiedCustomers
          .filter(c => ['10-10 Candidate', 'White-glove Candidate'].includes(c.segment))
          .slice(0, 25)
          .map(c => decorateOutreach({
            email: c.email,
            segment: c.segment,
            score: c.score,
            why: c.signals.slice(0, 3).join(', '),
            action: c.recommendedAction,
          })),

        // MI Pro upgrade candidates
        upgradeTargets: qualifiedCustomers
          .filter(c => c.segment === 'MI Pro Upgrade')
          .slice(0, 25)
          .map(c => decorateOutreach({
            email: c.email,
            score: c.score,
            why: c.signals.slice(0, 3).join(', '),
          })),

        // Rescue candidates (paid but inactive)
        rescueCandidates: qualifiedCustomers
          .filter(c => c.segment === 'Rescue Candidate')
          .slice(0, 25)
          .map(c => decorateOutreach({
            email: c.email,
            totalSpent: c.totalSpent,
            products: c.productsOwned,
            issue: c.profileComplete ? 'Inactive despite profile' : 'Never completed profile',
          })),
      },
      customers: filtered,
    });
  } catch (error) {
    console.error('[qualify-customers] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to qualify customers',
    }, { status: 500 });
  }
}
