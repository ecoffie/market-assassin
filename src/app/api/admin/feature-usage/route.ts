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
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString();

  try {
    // Get page view events from user_engagement
    const { data: pageViews, error: pageViewsError } = await supabase
      .from('user_engagement')
      .select('user_email, page_url, created_at')
      .eq('event_type', 'page_view')
      .gte('created_at', startDateStr);

    // Get report generation events
    const { data: reportEvents, error: reportEventsError } = await supabase
      .from('user_engagement')
      .select('user_email, event_source, metadata, created_at')
      .in('event_type', ['report_generated', 'content_generated', 'search_performed'])
      .gte('created_at', startDateStr);

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
      const url = view.page_url || '';
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
