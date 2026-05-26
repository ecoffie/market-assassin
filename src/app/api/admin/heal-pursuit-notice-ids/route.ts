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
 * Strip the React-key prefix (deadline-, opp-, alert-, etc.) from a
 * polluted notice_id to recover the embedded solicitation number.
 * Returns the bare value if it looks like a solnum, null otherwise.
 */
function extractSolnumFromDirtyId(dirty: string): string | null {
  const stripped = dirty.replace(/^(deadline|opp|alert|brief|item|notice)-/i, '').trim();
  // Solicitation numbers are alphanumeric + hyphens, at least one digit,
  // 4-30 chars. Different from a React key (which had a known prefix).
  if (/^[A-Z0-9-]{4,30}$/i.test(stripped) && /\d/.test(stripped)) {
    return stripped;
  }
  return null;
}

/**
 * Aggressive title cleaner. SAM notice titles often start with:
 *   - 'Z--' / 'R--' / 'Y--' / 'X--' (notice type prefix)
 *   - Sometimes followed by 'DK - ', 'XX - ', or other office codes
 *   - Sometimes with extra leading punctuation
 * Strip all of that to get a search-friendly core title.
 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^[A-Z]{1,2}--\s*/, '')      // 'Z-- '
    .replace(/^[A-Z]{1,4}\s*-\s*/, '')    // 'DK - '
    .replace(/^[-\s]+/, '')               // leading dashes/spaces
    .trim();
}

/**
 * Search SAM by solnum first (high-precision match), then fall back
 * to title search if no solnum is recoverable from the dirty id.
 * Returns null if nothing found.
 *
 * Three-attempt strategy:
 *   1. solnum query (extracted from dirty notice_id) — most reliable
 *   2. cleaned title query — fallback if no solnum or solnum miss
 *   3. raw title query — last resort if cleaning was too aggressive
 */
async function findRealNoticeId(opts: {
  title: string;
  agency?: string | null;
  naicsCode?: string | null;
  dirtyNoticeId: string;
  apiKey: string;
}): Promise<{ noticeId: string; matchedTitle: string; matchedBy: 'solnum' | 'title-clean' | 'title-raw' } | null> {
  const { title, agency, naicsCode, dirtyNoticeId, apiKey } = opts;

  const today = new Date();
  const fmt = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

  // SAM API constraint: postedFrom and postedTo must be in the SAME
  // calendar year (otherwise it returns 'Date range must be null
  // year(s) apart' with 0 results). Two-pass strategy: try current
  // year first (most pursuits are recent), then last calendar year
  // as a fallback for older pursuits.
  const currentYear = today.getFullYear();
  const lastYear = currentYear - 1;
  const dateWindows = [
    { from: `01/01/${currentYear}`, to: fmt(today) },
    { from: `01/01/${lastYear}`, to: `12/31/${lastYear}` },
  ];

  async function searchWindow(params: Record<string, string>, fromDate: string, toDate: string): Promise<Array<{ noticeId: string; title: string; department?: string; fullParentPathName?: string }>> {
    const url = new URL(SAM_OPPS_URL);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('postedFrom', fromDate);
    url.searchParams.set('postedTo', toDate);
    url.searchParams.set('limit', '10');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (naicsCode) {
      const firstNaics = naicsCode.split(',')[0]?.trim();
      if (firstNaics && /^\d{2,6}$/.test(firstNaics)) {
        url.searchParams.set('ncode', firstNaics);
      }
    }
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    } catch {
      return [];
    }
    if (!res.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = await res.json().catch(() => null) as any;
    return payload?.opportunitiesData || [];
  }

  // Loop the two date windows (current calendar year, then last year);
  // return first window's results that yielded hits. Same-year
  // constraint is a SAM API quirk — 'Date range must be null year(s)
  // apart' is their (incoherent) error when from + to span years.
  async function search(params: Record<string, string>): Promise<Array<{ noticeId: string; title: string; department?: string; fullParentPathName?: string }>> {
    for (const window of dateWindows) {
      const hits = await searchWindow(params, window.from, window.to);
      if (hits.length > 0) return hits;
    }
    return [];
  }

  // Attempt 1: solnum lookup if extractable
  const solnum = extractSolnumFromDirtyId(dirtyNoticeId);
  if (solnum) {
    const hits = await search({ solnum });
    if (hits.length > 0 && hits[0].noticeId) {
      return {
        noticeId: hits[0].noticeId,
        matchedTitle: hits[0].title || '',
        matchedBy: 'solnum',
      };
    }
  }

  // Attempt 2: cleaned title
  const cleaned = cleanTitle(title);
  if (cleaned.length >= 4) {
    const hits = await search({ title: cleaned.slice(0, 100) });
    if (hits.length > 0) {
      const agencyLower = (agency || '').toLowerCase();
      const scored = hits.map((opp) => {
        let score = 0;
        if (opp.title?.toLowerCase().includes(cleaned.toLowerCase())) score += 5;
        if (agencyLower) {
          const dept = (opp.department || opp.fullParentPathName || '').toLowerCase();
          if (dept.includes(agencyLower) || agencyLower.includes(dept)) score += 3;
        }
        return { opp, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const winner = scored[0]?.opp;
      if (winner?.noticeId) {
        return {
          noticeId: winner.noticeId,
          matchedTitle: winner.title || '',
          matchedBy: 'title-clean',
        };
      }
    }
  }

  // Attempt 3: raw title (last resort, in case cleaning was too aggressive)
  if (title !== cleaned && title.length >= 4) {
    const hits = await search({ title: title.slice(0, 100) });
    if (hits.length > 0 && hits[0].noticeId) {
      return {
        noticeId: hits[0].noticeId,
        matchedTitle: hits[0].title || '',
        matchedBy: 'title-raw',
      };
    }
  }

  return null;
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
      dirtyNoticeId: row.notice_id,
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
        matched_by: match.matchedBy,
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
      matched_by: match.matchedBy,
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
