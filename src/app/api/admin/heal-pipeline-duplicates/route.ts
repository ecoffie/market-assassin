/**
 * Heal duplicate rows in user_pipeline.
 *
 * Found by audit 2026-05-27 (Eric's report): two rows for the same
 * project ("Z--DK - SHADEHILL GATEHOUSE ROOFING") in the same stage,
 * created days apart, with DIFFERENT notice_ids (one a junk
 * "opp-140R6026" prefix that snuck in before isValidSamNoticeId
 * validation landed in task #69; the other clean).
 *
 * Strategy: for each user_email, group active rows by normalized
 * title. If a group has >1 rows, keep the one with the cleanest
 * notice_id (32-char UUID > short code > null), break ties by oldest
 * created_at (preserve user's original add). Archive the rest.
 *
 * GET  ?password=... = preview (counts + sample, no writes)
 * POST ?password=... = execute (archives redundant rows)
 *
 * Same pattern as heal-pursuit-notice-ids + heal-pipeline-values.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

function normalizeTitle(s: string | null | undefined): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Score a row's notice_id quality. Higher = better. We keep the highest.
function noticeIdScore(noticeId: string | null | undefined): number {
  const s = String(noticeId || '').trim();
  if (!s) return 0;
  // Pre-existing junk prefixes we identified during the pursuit-docs work
  if (/^(deadline|alert|brief|opp|item)-/i.test(s)) return 1;
  // Clean 32-char SAM internal UUID (highest signal)
  if (/^[0-9a-f]{32}$/i.test(s)) return 100;
  // Solicitation-number-like (alphanumeric, contains digits)
  if (/^[A-Z0-9-]{4,50}$/i.test(s) && /\d/.test(s)) return 50;
  return 10;
}

interface PipelineRow {
  id: string;
  user_email: string;
  title: string | null;
  notice_id: string | null;
  stage: string;
  source: string | null;
  created_at: string;
}

async function handle(request: NextRequest, execute: boolean) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) {
    return unauthorized();
  }

  const emailFilter = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();

  const supabase = getSupabase();
  let q = supabase
    .from('user_pipeline')
    .select('id, user_email, title, notice_id, stage, source, created_at')
    .eq('is_archived', false)
    .order('created_at', { ascending: true })
    .limit(10000);
  if (emailFilter) q = q.eq('user_email', emailFilter);

  const { data, error } = await q;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // Group by user_email + normalized title
  const groups = new Map<string, PipelineRow[]>();
  for (const row of (data || []) as PipelineRow[]) {
    const key = `${row.user_email}::${normalizeTitle(row.title)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // For each duplicate group, pick a keeper + mark the rest for archival
  const toArchive: PipelineRow[] = [];
  const groupSummaries: Array<{
    user_email: string;
    title: string;
    kept: { id: string; notice_id: string | null; stage: string; created_at: string };
    archived: Array<{ id: string; notice_id: string | null; stage: string }>;
  }> = [];

  for (const [, rows] of groups) {
    if (rows.length <= 1) continue;
    // Keep the one with the highest notice_id score; ties → oldest created_at
    const sorted = [...rows].sort((a, b) => {
      const sa = noticeIdScore(a.notice_id);
      const sb = noticeIdScore(b.notice_id);
      if (sb !== sa) return sb - sa;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    const keeper = sorted[0];
    const losers = sorted.slice(1);
    toArchive.push(...losers);
    groupSummaries.push({
      user_email: keeper.user_email,
      title: (keeper.title || '').slice(0, 80),
      kept: {
        id: keeper.id,
        notice_id: keeper.notice_id,
        stage: keeper.stage,
        created_at: keeper.created_at,
      },
      archived: losers.map(l => ({ id: l.id, notice_id: l.notice_id, stage: l.stage })),
    });
  }

  if (!execute) {
    return NextResponse.json({
      success: true,
      mode: 'preview',
      total_groups: groupSummaries.length,
      total_to_archive: toArchive.length,
      sample: groupSummaries.slice(0, 50),
    });
  }

  // Execute: archive losers in batches
  let archived = 0;
  const ids = toArchive.map(r => r.id);
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const { error: updErr } = await supabase
      .from('user_pipeline')
      .update({
        is_archived: true,
        updated_at: new Date().toISOString(),
      })
      .in('id', slice);
    if (updErr) {
      return NextResponse.json({
        success: false,
        error: updErr.message,
        archived_so_far: archived,
      }, { status: 500 });
    }
    archived += slice.length;
  }

  return NextResponse.json({
    success: true,
    mode: 'execute',
    total_groups: groupSummaries.length,
    archived,
  });
}

export async function GET(request: NextRequest) {
  return handle(request, false);
}

export async function POST(request: NextRequest) {
  return handle(request, true);
}
