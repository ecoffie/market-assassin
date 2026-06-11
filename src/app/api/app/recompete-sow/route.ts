/**
 * GET /api/app/recompete-sow?piid=&naics=&agency=&description=
 *
 * Semantic match: expiring contract description → likely recovered SOW/PWS
 * from sam_opportunities corpus. Pre-filtered by agency + 3-digit NAICS;
 * confidence = top score AND gap to runner-up (not score alone).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  agencyDepartmentPatterns,
  agencyFilterToken,
  buildRecompeteQueryText,
  embedText,
  evaluateRecompeteMatch,
  isPossibleRecompeteMatch,
  naics2Prefix,
  naicsPrefix,
  parseEmbedding,
  topMatches,
} from '@/lib/market/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function samNoticeUrl(noticeId: string) {
  return `https://sam.gov/workspace/contract/opp/${noticeId}/view`;
}

function snippet(text: string, max = 600) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const piid = sp.get('piid') || '';
  const naics = sp.get('naics') || '';
  const agency = sp.get('agency') || '';
  const description = sp.get('description') || sp.get('title') || '';

  if (!description.trim()) {
    return NextResponse.json({ success: false, error: 'description or title required' }, { status: 400 });
  }

  const prefix = naicsPrefix(naics);
  const deptPatterns = agencyDepartmentPatterns(agency);
  const agencyToken = deptPatterns[0] || agencyFilterToken(agency);

  const telemetry = {
    piid,
    agency_filter: deptPatterns.join('|') || agencyToken,
    naics_prefix: prefix,
    candidate_count: 0,
    top_score: 0,
    runner_up_score: 0,
    score_gap: 0,
    verdict: 'no_confident_match' as 'confident_match' | 'no_confident_match',
  };

  try {
    const queryText = buildRecompeteQueryText(description, naics, agency);
    const queryVec = await embedText(queryText);

    const sb = getSupabase();

    async function fetchRows(naicsLike: string | null) {
      let q = sb
        .from('sam_opportunities')
        .select(
          'id, notice_id, solicitation_number, title, department, naics_code, sow_doc_type, sow_filename, sow_text, sow_embedding',
        )
        .eq('has_sow_doc', true)
        .not('sow_embedding', 'is', null);

      if (naicsLike) {
        q = q.like('naics_code', `${naicsLike}%`);
      }
      if (deptPatterns.length) {
        q = q.or(deptPatterns.map((p) => `department.ilike.%${p}%`).join(','));
      } else if (agencyToken) {
        q = q.ilike('department', `%${agencyToken}%`);
      }

      return q.limit(500);
    }

    let { data: rows, error } = await fetchRows(prefix);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const twoDigit = naics2Prefix(naics);
    if ((rows?.length ?? 0) < 20 && twoDigit && twoDigit !== prefix?.slice(0, 2)) {
      const wider = await fetchRows(twoDigit);
      if (!wider.error && (wider.data?.length ?? 0) > (rows?.length ?? 0)) {
        rows = wider.data;
      }
    }

    const seenNotices = new Set<string>();
    const candidates = (rows || [])
      .map((row) => {
        const noticeId = row.notice_id as string;
        if (noticeId && seenNotices.has(noticeId)) return null;
        if (noticeId) seenNotices.add(noticeId);
        const vec = parseEmbedding(row.sow_embedding);
        if (!vec) return null;
        return {
          id: row.id as string,
          noticeId: row.notice_id as string,
          solicitationNumber: row.solicitation_number as string | null,
          title: row.title as string,
          department: row.department as string | null,
          naicsCode: row.naics_code as string | null,
          sowDocType: row.sow_doc_type as string | null,
          sowFilename: row.sow_filename as string | null,
          sowText: row.sow_text as string | null,
          vec,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      noticeId: string;
      solicitationNumber: string | null;
      title: string;
      department: string | null;
      naicsCode: string | null;
      sowDocType: string | null;
      sowFilename: string | null;
      sowText: string | null;
      vec: number[];
    }>;

    telemetry.candidate_count = candidates.length;

    if (!candidates.length) {
      console.log('[recompete-sow]', JSON.stringify(telemetry));
      return NextResponse.json({
        success: true,
        verdict: 'no_confident_match',
        reason: 'no_candidates',
        match: null,
        telemetry,
      });
    }

    const ranked = topMatches(queryVec, candidates, 3);
    const top = ranked[0];
    const runnerUp = ranked[1];
    const verdict = evaluateRecompeteMatch(top.score, runnerUp?.score ?? 0);

    telemetry.top_score = Math.round(verdict.topScore * 1000) / 1000;
    telemetry.runner_up_score = Math.round(verdict.runnerUpScore * 1000) / 1000;
    telemetry.score_gap = Math.round(verdict.gap * 1000) / 1000;
    telemetry.verdict = verdict.confident ? 'confident_match' : 'no_confident_match';

    console.log('[recompete-sow]', JSON.stringify(telemetry));

    const formatMatch = (m: (typeof ranked)[0], tier: 'confident' | 'possible') => ({
      id: m.id,
      noticeId: m.noticeId,
      solicitationNumber: m.solicitationNumber,
      title: m.title,
      department: m.department,
      naicsCode: m.naicsCode,
      sowDocType: m.sowDocType,
      sowFilename: m.sowFilename,
      score: Math.round(m.score * 1000) / 1000,
      scorePct: Math.round(m.score * 100),
      snippet: snippet(m.sowText || ''),
      samUrl: m.noticeId ? samNoticeUrl(m.noticeId) : null,
      label:
        tier === 'confident'
          ? 'Likely SOW match by semantic similarity'
          : 'Possible match — review before relying on this link',
    });

    if (!verdict.confident) {
      const showPossible = isPossibleRecompeteMatch(top.score);
      return NextResponse.json({
        success: true,
        verdict: 'no_confident_match',
        reason: top.score < verdict.threshold ? 'below_threshold' : 'gap_too_small',
        match: null,
        possible: showPossible ? formatMatch(top, 'possible') : null,
        top: ranked.map((m) => formatMatch(m, 'possible')),
        telemetry,
      });
    }

    return NextResponse.json({
      success: true,
      verdict: 'confident_match',
      match: formatMatch(top, 'confident'),
      top: ranked.map((m) => formatMatch(m, 'confident')),
      telemetry,
    });
  } catch (e) {
    const msg = (e as Error).message || 'match failed';
    console.error('[recompete-sow] error', piid, msg);
    return NextResponse.json({ success: false, error: msg, telemetry }, { status: 500 });
  }
}
