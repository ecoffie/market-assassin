/**
 * Admin: Feature Usage Tracking API
 *
 * Tracks and analyzes which tools users access most:
 * - Market Assassin
 * - Content Reaper
 * - Opportunity Hunter
 * - Forecasts
 * - BD Assist
 * - Briefings Dashboard
 *
 * GET ?password=... - Get usage summary
 * GET ?password=...&days=7 - Get usage for specific period
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Feature definitions for aggregation
const FEATURES = {
  market_assassin: {
    name: 'Market Assassin',
    category: 'premium',
    price: '$297-$497',
    patterns: ['market-assassin', 'reports/generate'],
  },
  content_reaper: {
    name: 'Content Reaper',
    category: 'premium',
    price: '$197-$397',
    patterns: ['content-generator', 'content/generate'],
  },
  opportunity_hunter: {
    name: 'Opportunity Hunter',
    category: 'freemium',
    price: 'Free / $19/mo',
    patterns: ['opportunity-hunter', 'opportunities', 'opp-search'],
  },
  forecasts: {
    name: 'Forecast Intelligence',
    category: 'free',
    price: 'Free',
    patterns: ['forecasts'],
  },
  bd_assist: {
    name: 'BD Assist',
    category: 'premium',
    price: '$199/mo',
    patterns: ['bd-assist', 'pipeline', 'teaming', 'market-scanner'],
  },
  briefings: {
    name: 'Briefings Dashboard',
    category: 'freemium',
    price: '$19-$49/mo',
    patterns: ['briefings', 'alerts'],
  },
  contractor_db: {
    name: 'Contractor Database',
    category: 'premium',
    price: '$497',
    patterns: ['contractor-database', 'sblo-directory'],
  },
  recompete: {
    name: 'Recompete Tracker',
    category: 'premium',
    price: '$397',
    patterns: ['recompete'],
  },
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const days = parseInt(searchParams.get('days') || '30');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Pure read-only analytics (GET, no writes) → read replica to keep off the primary.
  const supabase = getReadClient();

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString();

  try {
    // PAGINATED. MEASURED 2026-08-22: the 30-day page_view window is 16,998 rows, and an
    // unpaginated PostgREST read returns 1,000 — so every feature-adoption number on this
    // dashboard was computed from ~6% of the data and presented as the whole picture.
    //
    // Triaged P1 under Eric's rule: "fix claims before convenience. If an unpaginated read
    // can change a displayed count, percentage, benchmark, audience size, eligibility
    // determination, or research conclusion, it moves to the front."
    const PAGE = 1000;
    async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
      const out: T[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1);
        if (error) return { data: null, error };
        if (!data?.length) break;
        out.push(...data);
        if (data.length < PAGE) break;
      }
      return { data: out, error: null };
    }

    // Get page view events from user_engagement
    // ⚠️ THE PATH LIVES IN metadata->>path, NOT a page_url column — that column DOES NOT
    // EXIST. Measured 2026-08-22 with `npm run db:check`: "user_engagement.page_url: column
    // does not exist". PostgREST fails the WHOLE query when a .select() names a missing
    // column, so this route returned NULL for 16,998 page views and reported 0 across every
    // feature — behind a soft "some data may be incomplete" note that read as a data gap
    // rather than a broken query. (The documented missing-column trap; see CLAUDE.md.)
    const { data: pageViews, error: pageViewsError } = await readAll<{ user_email: string; metadata: Record<string, unknown> | null; created_at: string }>(
      (from, to) => supabase
        .from('user_engagement')
        .select('user_email, metadata, created_at')
        .eq('event_type', 'page_view')
        .gte('created_at', startDateStr)
        .range(from, to),
    );

    // Get report generation events
    const { data: reportEvents, error: reportEventsError } = await readAll<{ user_email: string; event_source: string | null; metadata: Record<string, unknown> | null; created_at: string }>(
      (from, to) => supabase
        .from('user_engagement')
        .select('user_email, event_source, metadata, created_at')
        .in('event_type', ['report_generated', 'content_generated', 'search_performed'])
        .gte('created_at', startDateStr)
        .range(from, to),
    );

    // Calculate feature usage from page views
    const featureUsage: Record<string, {
      views: number;
      uniqueUsers: Set<string>;
      byDay: Record<string, number>;
    }> = {};

    // Initialize feature usage
    for (const featureId of Object.keys(FEATURES)) {
      featureUsage[featureId] = {
        views: 0,
        uniqueUsers: new Set(),
        byDay: {},
      };
    }

    // Process page views
    for (const view of pageViews || []) {
      // MATCH THE PANEL, NOT JUST THE PATH. The app consolidated into a single /app route
      // with a `panel` parameter, so EVERY path in the last 30 days is literally "/app"
      // (7,374 of them) — the patterns below look for legacy URLs like 'market-assassin'
      // and 'opportunity-hunter' that no longer exist as separate pages. Result: the
      // dashboard reported 0 views for every feature while 7,887 panel views sat in the
      // table (alerts 1,689 · dashboard 1,665 · settings 1,011 · pipeline 758 · vault 418…).
      //
      // The existing patterns already carry the right words ('pipeline', 'alerts',
      // 'forecasts'), so the taxonomy did not need rewriting — only the field it reads.
      const md = view.metadata as { path?: unknown; panel?: unknown } | null;
      const url = [String(md?.path ?? ''), String(md?.panel ?? '')].filter(Boolean).join(' ');
      const email = view.user_email?.toLowerCase() || 'anonymous';
      const date = new Date(view.created_at).toISOString().split('T')[0];

      for (const [featureId, feature] of Object.entries(FEATURES)) {
        const matched = feature.patterns.some(pattern => url.includes(pattern));
        if (matched) {
          featureUsage[featureId].views++;
          featureUsage[featureId].uniqueUsers.add(email);
          featureUsage[featureId].byDay[date] = (featureUsage[featureId].byDay[date] || 0) + 1;
          break; // Only count once per URL
        }
      }
    }

    // Process report/action events
    for (const event of reportEvents || []) {
      const source = event.event_source || '';
      const email = event.user_email?.toLowerCase() || 'anonymous';
      const date = new Date(event.created_at).toISOString().split('T')[0];

      for (const [featureId, feature] of Object.entries(FEATURES)) {
        const matched = feature.patterns.some(pattern => source.includes(pattern));
        if (matched) {
          featureUsage[featureId].views++;
          featureUsage[featureId].uniqueUsers.add(email);
          featureUsage[featureId].byDay[date] = (featureUsage[featureId].byDay[date] || 0) + 1;
          break;
        }
      }
    }

    // Build summary
    const featureSummary = Object.entries(featureUsage)
      .map(([featureId, usage]) => {
        const feature = FEATURES[featureId as keyof typeof FEATURES];
        return {
          id: featureId,
          name: feature.name,
          category: feature.category,
          price: feature.price,
          totalViews: usage.views,
          uniqueUsers: usage.uniqueUsers.size,
          avgViewsPerUser: usage.uniqueUsers.size > 0
            ? Math.round((usage.views / usage.uniqueUsers.size) * 10) / 10
            : 0,
          trend: Object.entries(usage.byDay)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, count]) => ({ date, count })),
        };
      })
      .sort((a, b) => b.totalViews - a.totalViews);

    // Calculate totals
    const totalViews = featureSummary.reduce((sum, f) => sum + f.totalViews, 0);
    const allUniqueUsers = new Set<string>();
    for (const usage of Object.values(featureUsage)) {
      for (const user of usage.uniqueUsers) {
        allUniqueUsers.add(user);
      }
    }

    // Top users by feature usage
    const userFeatureMap: Record<string, number> = {};
    for (const view of pageViews || []) {
      const email = view.user_email?.toLowerCase();
      if (email) {
        userFeatureMap[email] = (userFeatureMap[email] || 0) + 1;
      }
    }
    for (const event of reportEvents || []) {
      const email = event.user_email?.toLowerCase();
      if (email) {
        userFeatureMap[email] = (userFeatureMap[email] || 0) + 1;
      }
    }

    const topUsers = Object.entries(userFeatureMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([email, count]) => ({ email, totalActions: count }));

    // Category breakdown
    const categoryBreakdown = {
      free: featureSummary.filter(f => f.category === 'free').reduce((sum, f) => sum + f.totalViews, 0),
      freemium: featureSummary.filter(f => f.category === 'freemium').reduce((sum, f) => sum + f.totalViews, 0),
      premium: featureSummary.filter(f => f.category === 'premium').reduce((sum, f) => sum + f.totalViews, 0),
    };

    return NextResponse.json({
      period: {
        days,
        startDate: startDateStr,
        endDate: new Date().toISOString(),
      },
      summary: {
        totalViews,
        totalUniqueUsers: allUniqueUsers.size,
        categoryBreakdown,
        avgViewsPerUser: allUniqueUsers.size > 0
          ? Math.round((totalViews / allUniqueUsers.size) * 10) / 10
          : 0,
      },
      features: featureSummary,
      topUsers,
      insights: generateInsights(featureSummary, categoryBreakdown),
      dataNote: pageViewsError || reportEventsError
        ? 'Some data may be incomplete - tracking tables being populated'
        : 'Full tracking data available',
    });

  } catch (error) {
    console.error('[FeatureUsage] Error:', error);
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * Generate insights from usage data
 */
function generateInsights(
  features: Array<{ name: string; totalViews: number; uniqueUsers: number; category: string }>,
  categoryBreakdown: { free: number; freemium: number; premium: number }
): string[] {
  const insights: string[] = [];

  // Top feature
  if (features.length > 0 && features[0].totalViews > 0) {
    insights.push(`Most used feature: ${features[0].name} with ${features[0].totalViews} views`);
  }

  // Premium vs free ratio
  const totalPremium = categoryBreakdown.premium;
  const totalFree = categoryBreakdown.free + categoryBreakdown.freemium;
  if (totalFree > 0) {
    const ratio = Math.round((totalPremium / (totalFree + totalPremium)) * 100);
    insights.push(`Premium feature usage: ${ratio}% of total`);
  }

  // Underutilized features
  const underutilized = features.filter(f => f.totalViews === 0 && f.category === 'premium');
  if (underutilized.length > 0) {
    insights.push(`Underutilized premium features: ${underutilized.map(f => f.name).join(', ')}`);
  }

  // Engagement depth
  const avgEngagement = features.reduce((sum, f) => sum + (f.uniqueUsers > 0 ? f.totalViews / f.uniqueUsers : 0), 0) / features.length;
  if (avgEngagement > 5) {
    insights.push(`High engagement: Users average ${Math.round(avgEngagement)} views per feature`);
  } else if (avgEngagement < 2) {
    insights.push(`Low engagement: Users average only ${Math.round(avgEngagement * 10) / 10} views per feature - consider onboarding improvements`);
  }

  // No data case
  if (features.every(f => f.totalViews === 0)) {
    insights.push('No feature usage data yet - tracking recently deployed');
  }

  return insights;
}
