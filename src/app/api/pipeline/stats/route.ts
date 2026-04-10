/**
 * Pipeline Stats API
 *
 * Get pipeline statistics for a user
 *
 * GET /api/pipeline/stats?email=user@example.com
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface PipelineOpportunity {
  stage?: string;
  priority?: string;
  value_estimate?: string;
  response_deadline?: string;
}

// GET - Get pipeline statistics
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');

  if (!email) {
    return NextResponse.json(
      { error: 'Email parameter required' },
      { status: 400 }
    );
  }

  try {
    const { data: opportunities, error } = await supabase
      .from('user_pipeline')
      .select('stage, priority, value_estimate, response_deadline')
      .eq('user_email', email.toLowerCase());

    if (error) {
      // Table might not exist yet
      if (error.code === '42P01') {
        return NextResponse.json(getEmptyStats());
      }
      throw error;
    }

    const stats = calculateStats(opportunities || []);
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Pipeline stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline statistics' },
      { status: 500 }
    );
  }
}

// Helper: Calculate pipeline stats
function calculateStats(opportunities: PipelineOpportunity[]) {
  const byStage: Record<string, number> = {
    tracking: 0,
    pursuing: 0,
    bidding: 0,
    submitted: 0,
    won: 0,
    lost: 0,
    archived: 0
  };

  const byPriority: Record<string, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0
  };

  let totalValue = 0;
  let upcomingDeadlines = 0;
  const now = new Date();
  const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  for (const opp of opportunities) {
    // Count by stage
    if (opp.stage) {
      byStage[opp.stage] = (byStage[opp.stage] || 0) + 1;
    }

    // Count by priority
    if (opp.priority) {
      byPriority[opp.priority] = (byPriority[opp.priority] || 0) + 1;
    }

    // Parse value estimate (e.g., "$5M-$10M" → average)
    if (opp.value_estimate) {
      const match = opp.value_estimate.match(/\$?([\d.]+)\s*(K|M|B)?/gi);
      if (match) {
        const multiplier = (str: string) => {
          if (str?.toUpperCase().includes('B')) return 1_000_000_000;
          if (str?.toUpperCase().includes('M')) return 1_000_000;
          if (str?.toUpperCase().includes('K')) return 1_000;
          return 1;
        };
        const value = parseFloat(match[0].replace(/[^0-9.]/g, '')) * multiplier(match[0]);
        totalValue += value;
      }
    }

    // Check upcoming deadlines (next 14 days)
    if (opp.response_deadline) {
      const deadline = new Date(opp.response_deadline);
      if (deadline > now && deadline < twoWeeks) {
        upcomingDeadlines++;
      }
    }
  }

  const total = opportunities.length;
  const activeCount = opportunities.filter(o =>
    !['won', 'lost', 'archived'].includes(o.stage || '')
  ).length;

  const wonCount = byStage.won || 0;
  const lostCount = byStage.lost || 0;
  const winRate = wonCount + lostCount > 0
    ? Math.round((wonCount / (wonCount + lostCount)) * 100)
    : 0;

  return {
    totalCount: total,
    activeCount,
    byStage,
    byPriority,
    totalValue: formatValue(totalValue),
    upcomingDeadlines,
    winRate
  };
}

function getEmptyStats() {
  return {
    totalCount: 0,
    activeCount: 0,
    byStage: {
      tracking: 0,
      pursuing: 0,
      bidding: 0,
      submitted: 0,
      won: 0,
      lost: 0,
      archived: 0
    },
    byPriority: {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    },
    totalValue: '$0',
    upcomingDeadlines: 0,
    winRate: 0
  };
}

function formatValue(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}
