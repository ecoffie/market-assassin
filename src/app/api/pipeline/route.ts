/**
 * Pipeline Tracker API
 *
 * CRUD operations for opportunity pipeline tracking
 *
 * GET /api/pipeline?email=user@example.com - List user's pipeline
 * POST /api/pipeline - Add opportunity to pipeline
 * PATCH /api/pipeline - Update pipeline opportunity
 * DELETE /api/pipeline - Remove from pipeline
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface PipelineOpportunity {
  id?: string;
  user_email: string;
  notice_id?: string;
  source?: string;
  external_url?: string;
  title: string;
  agency?: string;
  value_estimate?: string;
  naics_code?: string;
  set_aside?: string;
  response_deadline?: string;
  stage?: 'tracking' | 'pursuing' | 'bidding' | 'submitted' | 'won' | 'lost' | 'archived';
  win_probability?: number;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  next_action?: string;
  next_action_date?: string;
  teaming_partners?: string[];
  is_prime?: boolean;
  outcome_date?: string;
  outcome_notes?: string;
  award_amount?: string;
  winner?: string;
}

// GET - List pipeline opportunities
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const stage = request.nextUrl.searchParams.get('stage');
  const priority = request.nextUrl.searchParams.get('priority');
  const includeStats = request.nextUrl.searchParams.get('stats') === 'true';

  if (!email) {
    return NextResponse.json(
      { error: 'Email parameter required' },
      { status: 400 }
    );
  }

  try {
    let query = supabase
      .from('user_pipeline')
      .select('*')
      .eq('user_email', email.toLowerCase())
      .order('response_deadline', { ascending: true, nullsFirst: false });

    if (stage) {
      query = query.eq('stage', stage);
    }

    if (priority) {
      query = query.eq('priority', priority);
    }

    const { data: opportunities, error } = await query;

    if (error) {
      // Table might not exist yet
      if (error.code === '42P01') {
        return NextResponse.json({
          opportunities: [],
          stats: includeStats ? getEmptyStats() : undefined,
          message: 'Pipeline table not yet created. Run migration first.'
        });
      }
      throw error;
    }

    const result: {
      opportunities: typeof opportunities;
      stats?: ReturnType<typeof calculateStats>;
    } = {
      opportunities: opportunities || []
    };

    if (includeStats) {
      result.stats = calculateStats(opportunities || []);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Pipeline GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline' },
      { status: 500 }
    );
  }
}

// POST - Add to pipeline
export async function POST(request: NextRequest) {
  try {
    const body: PipelineOpportunity = await request.json();

    if (!body.user_email || !body.title) {
      return NextResponse.json(
        { error: 'user_email and title are required' },
        { status: 400 }
      );
    }

    // Normalize email
    body.user_email = body.user_email.toLowerCase();

    // Set defaults
    body.stage = body.stage || 'tracking';
    body.priority = body.priority || 'medium';
    body.source = body.source || 'manual';
    body.is_prime = body.is_prime ?? true;

    const { data, error } = await supabase
      .from('user_pipeline')
      .insert(body)
      .select()
      .single();

    if (error) {
      // Check for duplicate
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Opportunity already in pipeline' },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      opportunity: data,
      message: 'Added to pipeline'
    });
  } catch (error) {
    console.error('Pipeline POST error:', error);
    return NextResponse.json(
      { error: 'Failed to add to pipeline' },
      { status: 500 }
    );
  }
}

// PATCH - Update pipeline opportunity
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, user_email, ...updates } = body;

    if (!id || !user_email) {
      return NextResponse.json(
        { error: 'id and user_email are required' },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from('user_pipeline')
      .select('id, stage')
      .eq('id', id)
      .eq('user_email', user_email.toLowerCase())
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: 'Opportunity not found or access denied' },
        { status: 404 }
      );
    }

    // Track stage change for history
    const oldStage = existing.stage;
    const newStage = updates.stage;

    const { data, error } = await supabase
      .from('user_pipeline')
      .update(updates)
      .eq('id', id)
      .eq('user_email', user_email.toLowerCase())
      .select()
      .single();

    if (error) throw error;

    // Record stage change in history (trigger handles this, but log for debugging)
    if (newStage && oldStage !== newStage) {
      console.log(`Pipeline stage change: ${oldStage} → ${newStage} for ${id}`);
    }

    return NextResponse.json({
      success: true,
      opportunity: data,
      stageChanged: newStage && oldStage !== newStage
    });
  } catch (error) {
    console.error('Pipeline PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update pipeline' },
      { status: 500 }
    );
  }
}

// DELETE - Remove from pipeline
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, user_email } = body;

    if (!id || !user_email) {
      return NextResponse.json(
        { error: 'id and user_email are required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('user_pipeline')
      .delete()
      .eq('id', id)
      .eq('user_email', user_email.toLowerCase());

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Removed from pipeline'
    });
  } catch (error) {
    console.error('Pipeline DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to remove from pipeline' },
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
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  for (const opp of opportunities) {
    if (opp.stage) byStage[opp.stage] = (byStage[opp.stage] || 0) + 1;
    if (opp.priority) byPriority[opp.priority] = (byPriority[opp.priority] || 0) + 1;

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

    // Check upcoming deadlines
    if (opp.response_deadline) {
      const deadline = new Date(opp.response_deadline);
      if (deadline > now && deadline < nextWeek) {
        upcomingDeadlines++;
      }
    }
  }

  const activeOpps = opportunities.filter(o =>
    !['won', 'lost', 'archived'].includes(o.stage || '')
  ).length;

  const winRate = byStage.won + byStage.lost > 0
    ? Math.round((byStage.won / (byStage.won + byStage.lost)) * 100)
    : 0;

  return {
    total: opportunities.length,
    active: activeOpps,
    byStage,
    byPriority,
    estimatedPipelineValue: formatValue(totalValue),
    upcomingDeadlines,
    winRate
  };
}

function getEmptyStats() {
  return {
    total: 0,
    active: 0,
    byStage: { tracking: 0, pursuing: 0, bidding: 0, submitted: 0, won: 0, lost: 0, archived: 0 },
    byPriority: { low: 0, medium: 0, high: 0, critical: 0 },
    estimatedPipelineValue: '$0',
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
