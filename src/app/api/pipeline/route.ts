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

import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { ensureWorkspaceMember, recordAppActivity } from '@/lib/app/workspace';
import { fetchPursuitDocs } from '@/lib/sam/fetch-pursuit-docs';
import { isValidSamNoticeId } from '@/lib/sam/utils';
import { isCleanValueEstimate } from '@/lib/pipeline/value-estimate';

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
  workspace_id?: string;
  owner_email?: string;
  created_by?: string;
  updated_by?: string;
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

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;
  const normalizedEmail = email.toLowerCase().trim();
  const { workspaceId } = await ensureWorkspaceMember(normalizedEmail);

  try {
    const buildQuery = (useWorkspace: boolean) => {
      let query = getSupabase()
        .from('user_pipeline')
        .select('*');

      query = useWorkspace
        ? query.or(`workspace_id.eq.${workspaceId},user_email.eq.${normalizedEmail}`)
        : query.eq('user_email', normalizedEmail);

      query = query.order('response_deadline', { ascending: true, nullsFirst: false });

      if (stage) {
        query = query.eq('stage', stage);
      }

      if (priority) {
        query = query.eq('priority', priority);
      }

      return query;
    };

    let { data: opportunities, error } = await buildQuery(true);

    if (error && (error.code === '42703' || error.message?.includes('workspace_id'))) {
      const fallback = await buildQuery(false);
      opportunities = fallback.data;
      error = fallback.error;
    }

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

    const authSession = requireMIAuthSession(request, body.user_email);
    if (!authSession.ok) return authSession.response;

    // Normalize email
    body.user_email = body.user_email.toLowerCase();
    const { workspaceId } = await ensureWorkspaceMember(body.user_email);

    // Set defaults
    body.stage = body.stage || 'tracking';
    body.priority = body.priority || 'medium';
    body.source = body.source || 'manual';
    body.is_prime = body.is_prime ?? true;

    body.workspace_id = workspaceId;
    body.owner_email = body.owner_email || body.user_email;
    body.created_by = body.user_email;
    body.updated_by = body.user_email;

    // Reject malformed notice_id values. React render keys like
    // 'deadline-140R6026Q0068' have been leaking into this field via
    // email action URLs, which then breaks SAM API lookups (fetchPursuitDocs,
    // attachment resolution). Null-out garbage instead of storing it so
    // downstream code can fall back to title-based search gracefully.
    if (body.notice_id && !isValidSamNoticeId(body.notice_id)) {
      console.warn(`[Pipeline POST] rejecting malformed notice_id "${body.notice_id}" for "${body.title}"`);
      body.notice_id = undefined;
    }

    // Reject value_estimate strings that are display labels ("Due in
    // 6 days", "Open market research window...") instead of dollar
    // amounts. Audit 2026-05-26 found DashboardPanel writing item.amount
    // (a display label) into value_estimate. Null-out garbage so the
    // Pipeline Value column stays scannable.
    if (body.value_estimate && !isCleanValueEstimate(body.value_estimate)) {
      console.warn(`[Pipeline POST] rejecting non-dollar value_estimate "${body.value_estimate}" for "${body.title}"`);
      body.value_estimate = undefined;
    }

    // Backfill response_deadline from the SAM cache when the caller
    // didn't supply one but we have a valid notice_id. Several save
    // paths (Today's Intel, Source Feed, Alerts) can hand us an
    // opportunity object whose response_deadline was empty/expired in
    // their feed, so the pursuit lands with "No deadline" even though
    // SAM has the date. One lookup here fixes every save path at once.
    if ((!body.response_deadline) && body.notice_id && isValidSamNoticeId(body.notice_id)) {
      try {
        const { data: samRow } = await getSupabase()
          .from('sam_opportunities')
          .select('response_deadline')
          .eq('notice_id', body.notice_id)
          .maybeSingle();
        if (samRow?.response_deadline) {
          const d = new Date(samRow.response_deadline);
          if (!Number.isNaN(d.getTime())) {
            body.response_deadline = d.toISOString();
          }
        }
      } catch (e) {
        // Non-fatal — a missing deadline just means the drawer shows
        // "No deadline", same as before this backfill existed.
        console.warn('[Pipeline POST] deadline backfill lookup failed:', e);
      }
    }

    const { data, error } = await getSupabase()
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
      // Surface the actual Postgres error so the client toast / log
      // tells us what column mismatched, what RLS rejected, etc.
      // Previously this threw into the generic catch-all 500 below.
      console.error('Pipeline POST Postgres error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return NextResponse.json(
        {
          error: error.message || 'Failed to add to pipeline',
          details: error.details || null,
          hint: error.hint || null,
          code: error.code || null,
        },
        { status: 500 }
      );
    }

    await recordAppActivity({
      workspaceId,
      userEmail: body.user_email,
      actorEmail: body.user_email,
      entityType: 'pipeline',
      entityId: data.id,
      action: 'created',
      summary: `Added ${data.title} to pipeline`,
      metadata: { stage: data.stage, priority: data.priority },
    });

    // Background-task SAM doc fetch. Uses Next.js after() so the
    // lambda stays alive past the response (the OLD fire-and-forget
    // approach was getting killed mid-pdf-parse by Vercel teardown,
    // which surfaced as 'DOMMatrix is not defined' — see commit
    // history 2026-05-26). The fetcher updates user_pipeline.docs_status
    // as it runs so the UI can poll.
    if (data.notice_id && data.id) {
      after(async () => {
        try {
          await fetchPursuitDocs({
            pipelineId: data.id,
            userEmail: body.user_email,
            noticeId: data.notice_id,
          });
        } catch (err) {
          console.warn('[Pipeline POST] background doc fetch threw:', err);
        }
      });
    }

    return NextResponse.json({
      success: true,
      opportunity: data,
      message: 'Added to pipeline'
    });
  } catch (error) {
    // Non-Postgres exception (e.g. ensureWorkspaceMember threw, JSON
    // parse failed, recordAppActivity blew up). Echo the message
    // verbatim so the client toast shows it instead of a generic
    // "Failed to add" that hides the cause.
    const message = error instanceof Error ? error.message : String(error);
    console.error('Pipeline POST error:', error);
    return NextResponse.json(
      { error: message || 'Failed to add to pipeline' },
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

    const authSession = requireMIAuthSession(request, user_email);
    if (!authSession.ok) return authSession.response;
    const { workspaceId } = await ensureWorkspaceMember(user_email);
    updates.updated_by = user_email.toLowerCase();
    updates.workspace_id = updates.workspace_id || workspaceId;

    // Verify ownership — caller must own the row by user_email OR the
    // workspace it belongs to (team members can edit each other's rows).
    const { data: existing } = await getSupabase()
      .from('user_pipeline')
      .select('id, stage')
      .eq('id', id)
      .or(`workspace_id.eq.${workspaceId},user_email.eq.${user_email.toLowerCase()}`)
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

    const { data, error } = await getSupabase()
      .from('user_pipeline')
      .update(updates)
      .eq('id', id)
      .or(`workspace_id.eq.${workspaceId},user_email.eq.${user_email.toLowerCase()}`)
      .select()
      .single();

    if (error) {
      console.error('Pipeline PATCH Postgres error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return NextResponse.json(
        {
          error: error.message || 'Failed to update pipeline item',
          details: error.details || null,
          hint: error.hint || null,
          code: error.code || null,
        },
        { status: 500 }
      );
    }

    // Record stage change in history (trigger handles this, but log for debugging)
    if (newStage && oldStage !== newStage) {
      console.log(`Pipeline stage change: ${oldStage} → ${newStage} for ${id}`);
    }

    await recordAppActivity({
      workspaceId,
      userEmail: user_email,
      actorEmail: user_email,
      entityType: 'pipeline',
      entityId: id,
      action: newStage && oldStage !== newStage ? 'stage_changed' : 'updated',
      summary: newStage && oldStage !== newStage
        ? `Moved ${data.title} from ${oldStage} to ${newStage}`
        : `Updated ${data.title}`,
      metadata: { oldStage, newStage },
    });

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

    const authSession = requireMIAuthSession(request, user_email);
    if (!authSession.ok) return authSession.response;
    const { workspaceId } = await ensureWorkspaceMember(user_email);

    const { data: existing } = await getSupabase()
      .from('user_pipeline')
      .select('id,title,stage')
      .eq('id', id)
      .or(`workspace_id.eq.${workspaceId},user_email.eq.${user_email.toLowerCase()}`)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: 'Opportunity not found or access denied' },
        { status: 404 }
      );
    }

    const { error } = await getSupabase()
      .from('user_pipeline')
      .delete()
      .eq('id', id)
      .or(`workspace_id.eq.${workspaceId},user_email.eq.${user_email.toLowerCase()}`);

    if (error) throw error;

    await recordAppActivity({
      workspaceId,
      userEmail: user_email,
      actorEmail: user_email,
      entityType: 'pipeline',
      entityId: id,
      action: 'deleted',
      summary: `Removed ${existing.title} from pipeline`,
      metadata: { stage: existing.stage },
    });

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
