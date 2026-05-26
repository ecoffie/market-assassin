/**
 * /api/admin/heal-pursuit-notice-ids
 *
 * Find every user_pipeline row with a malformed notice_id (React render
 * keys like 'deadline-xxx', or anything isValidSamNoticeId() rejects)
 * and try to repair it by searching SAM.gov for the real UUID using
 * title + agency + naics. Then fire fetchPursuitDocs to populate the
 * cached attachments so 'Draft Proposal' auto-load works on the
 * healed pursuit.
 *
 * GET / POST ?password=galata-assassin-2026
 *   [&user_email=]       — heal only this user's pursuits (optional)
 *   [&dry_run=true]      — report what would change without writing
 *   [&limit=50]          — cap pursuits processed per call (default 50)
 *
 * Returns:
 *   {
 *     success: true,
 *     scanned: 87,
 *     malformed: 12,
 *     healed: 9,
 *     unhealable: 3,
 *     details: [
 *       { pipeline_id, old_notice_id, new_notice_id, docs_fetch },
 *       { pipeline_id, old_notice_id, reason: 'no SAM match for title' },
 *     ]
 *   }
 *
 * Built 2026-05-25 to clean up the 'deadline-' prefix pollution +
 * rehydrate existing pursuits to make Draft Proposal work for them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchPursuitDocs } from '@/lib/sam/fetch-pursuit-docs';
import { getRotatedSAMKey, isValidSamNoticeId } from '@/lib/sam/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;  // up to 10 min — many docs, sequential

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const SAM_OPPS_URL = 'https://api.sam.gov/opportunities/v2/search';

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

/**
 * Search SAM by title (+ optional agency hint) and return the most
 * recent matching noticeId. Returns null if no candidate found.
 *
 * SAM's search is forgiving on title — partial matches work.
 * We narrow with department/agency when available to reduce false
 * positives (multiple agencies post 'Roof Repair' type titles).
 */
async function findRealNoticeId(opts: {
  title: string;
  agency?: string | null;
  naicsCode?: string | null;
  apiKey: string;
}): Promise<{ noticeId: string; matchedTitle: string } | null> {
  const { title, agency, naicsCode, apiKey } = opts;

  // Use a 2-year window — most active opps were posted in that range.
  const today = new Date();
  const fmt = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  const past = new Date(today);
  past.setFullYear(past.getFullYear() - 2);

  // Clean the title — strip the leading 'Z--', 'Y--', 'X--' notice-type
  // prefixes that aren't part of the actual title. SAM search struggles
  // with them.
  const cleanTitle = title.replace(/^[A-Z]{1,2}--\s*/, '').trim();

  const url = new URL(SAM_OPPS_URL);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('title', cleanTitle.slice(0, 100));
  url.searchParams.set('postedFrom', fmt(past));
  url.searchParams.set('postedTo', fmt(today));
  url.searchParams.set('limit', '10');
  if (naicsCode) {
    // Only send the first NAICS code (SAM doesn't like comma-separated)
    const firstNaics = naicsCode.split(',')[0]?.trim();
    if (firstNaics && /^\d{2,6}$/.test(firstNaics)) {
      url.searchParams.set('ncode', firstNaics);
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = await res.json().catch(() => null) as any;
  const opps: { noticeId: string; title: string; department?: string; fullParentPathName?: string }[] =
    payload?.opportunitiesData || [];

  if (opps.length === 0) return null;

  // Score candidates — prefer agency match if we have one.
  const agencyLower = (agency || '').toLowerCase();
  const scored = opps.map((opp) => {
    let score = 0;
    if (opp.title?.toLowerCase().includes(cleanTitle.toLowerCase())) score += 5;
    if (agencyLower) {
      const dept = (opp.department || opp.fullParentPathName || '').toLowerCase();
      if (dept.includes(agencyLower) || agencyLower.includes(dept)) score += 3;
    }
    return { opp, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const winner = scored[0]?.opp;
  if (!winner?.noticeId) return null;
  return { noticeId: winner.noticeId, matchedTitle: winner.title || '' };
}

async function handle(request: NextRequest) {
  const url = new URL(request.url);
  const password = url.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = url.searchParams.get('dry_run') === 'true';
  const userEmailFilter = url.searchParams.get('user_email')?.toLowerCase().trim() || null;
  const limit = Number(url.searchParams.get('limit') || '50');

  const supabase = getSupabase();
  const apiKey = getRotatedSAMKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'SAM API key not configured' }, { status: 500 });
  }

  // Pull a batch of candidates — non-null notice_id (no point healing
  // rows that already lack one). We filter to malformed in code since
  // Postgres doesn't have isValidSamNoticeId.
  let query = supabase
    .from('user_pipeline')
    .select('id, user_email, title, agency, naics_code, notice_id, docs_status')
    .not('notice_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit * 3);  // Over-fetch since most will be clean

  if (userEmailFilter) {
    query = query.eq('user_email', userEmailFilter);
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const allRows = (rows || []) as Array<{
    id: string;
    user_email: string;
    title: string;
    agency: string | null;
    naics_code: string | null;
    notice_id: string;
    docs_status: string | null;
  }>;
  const malformed = allRows.filter((r) => !isValidSamNoticeId(r.notice_id)).slice(0, limit);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const details: any[] = [];
  let healed = 0;
  let unhealable = 0;

  for (const row of malformed) {
    const match = await findRealNoticeId({
      title: row.title,
      agency: row.agency,
      naicsCode: row.naics_code,
      apiKey,
    });

    if (!match) {
      unhealable++;
      details.push({
        pipeline_id: row.id,
        user_email: row.user_email,
        title: row.title,
        old_notice_id: row.notice_id,
        reason: 'No SAM match found for title + agency',
      });
      continue;
    }

    if (dryRun) {
      details.push({
        pipeline_id: row.id,
        user_email: row.user_email,
        title: row.title,
        old_notice_id: row.notice_id,
        would_set: match.noticeId,
        matched_title: match.matchedTitle,
        dry_run: true,
      });
      healed++;
      continue;
    }

    const { error: updateErr } = await supabase
      .from('user_pipeline')
      .update({ notice_id: match.noticeId, docs_status: 'pending' })
      .eq('id', row.id);

    if (updateErr) {
      details.push({
        pipeline_id: row.id,
        user_email: row.user_email,
        title: row.title,
        old_notice_id: row.notice_id,
        attempted_set: match.noticeId,
        update_error: updateErr.message,
      });
      unhealable++;
      continue;
    }

    // Fire doc fetch now that the notice_id is valid. Synchronous so we
    // can include the result in the response (caller has 10 min budget).
    const fetchResult = await fetchPursuitDocs({
      pipelineId: row.id,
      userEmail: row.user_email,
      noticeId: match.noticeId,
    });

    healed++;
    details.push({
      pipeline_id: row.id,
      user_email: row.user_email,
      title: row.title,
      old_notice_id: row.notice_id,
      new_notice_id: match.noticeId,
      matched_title: match.matchedTitle,
      doc_fetch: fetchResult,
    });
  }

  return NextResponse.json({
    success: true,
    dry_run: dryRun,
    scanned: allRows.length,
    malformed: malformed.length,
    healed,
    unhealable,
    details,
  });
}

export const GET = handle;
export const POST = handle;
