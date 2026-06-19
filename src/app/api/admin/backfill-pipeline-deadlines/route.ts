/**
 * /api/admin/backfill-pipeline-deadlines
 *
 * Repairs existing user_pipeline rows that have a valid notice_id but a
 * NULL response_deadline, by looking the deadline up from the
 * sam_opportunities cache. Companion to the inline backfill added to the
 * pipeline POST handler (which only covers new saves) — this fixes rows
 * that were saved before the inline backfill existed.
 *
 * Auth: ?password=ADMIN_PASSWORD
 * GET  ?mode=preview  (default) — count + sample of what WOULD change
 * POST ?mode=execute            — apply the updates
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidSamNoticeId } from '@/lib/sam/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function authed(request: NextRequest): boolean {
  const pw = request.nextUrl.searchParams.get('password');
  return !!pw && pw === (process.env.ADMIN_PASSWORD);
}

async function run(execute: boolean) {
  const supabase = getSupabase();

  // Candidate rows: have a notice_id, missing a deadline.
  const { data: rows, error } = await supabase
    .from('user_pipeline')
    .select('id, notice_id, title')
    .is('response_deadline', null)
    .not('notice_id', 'is', null)
    .limit(1000);

  if (error) {
    return { success: false, error: error.message };
  }

  const candidates = (rows || []).filter(r => r.notice_id && isValidSamNoticeId(r.notice_id));
  if (candidates.length === 0) {
    return { success: true, mode: execute ? 'execute' : 'preview', candidates: 0, updated: 0, samples: [] };
  }

  // Batch-fetch deadlines from the SAM cache.
  const noticeIds = [...new Set(candidates.map(c => c.notice_id as string))];
  const { data: samRows } = await supabase
    .from('sam_opportunities')
    .select('notice_id, response_deadline')
    .in('notice_id', noticeIds);

  const deadlineByNotice = new Map<string, string>();
  for (const s of samRows || []) {
    if (s.response_deadline) {
      const d = new Date(s.response_deadline);
      if (!Number.isNaN(d.getTime())) deadlineByNotice.set(s.notice_id, d.toISOString());
    }
  }

  const toUpdate = candidates
    .map(c => ({ id: c.id, title: c.title, notice_id: c.notice_id, deadline: deadlineByNotice.get(c.notice_id as string) }))
    .filter(c => c.deadline);

  let updated = 0;
  if (execute) {
    for (const u of toUpdate) {
      const { error: upErr } = await supabase
        .from('user_pipeline')
        .update({ response_deadline: u.deadline })
        .eq('id', u.id);
      if (!upErr) updated++;
    }
  }

  return {
    success: true,
    mode: execute ? 'execute' : 'preview',
    candidates: candidates.length,
    matched_in_sam_cache: toUpdate.length,
    updated: execute ? updated : 0,
    would_update: execute ? undefined : toUpdate.length,
    samples: toUpdate.slice(0, 10).map(u => ({ title: u.title, notice_id: u.notice_id, deadline: u.deadline })),
  };
}

export async function GET(request: NextRequest) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await run(false));
}

export async function POST(request: NextRequest) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const execute = request.nextUrl.searchParams.get('mode') === 'execute';
  return NextResponse.json(await run(execute));
}
