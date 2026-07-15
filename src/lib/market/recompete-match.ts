/**
 * Recompete SOW matching — the shared engine behind BOTH the in-app route
 * (`/api/app/recompete-sow`) and the MCP tool (`match_recompete_sow`).
 *
 * Semantic match: an expiring contract's description/SOW → the likely open
 * solicitation that is its recompete, recovered from the `sam_opportunities`
 * corpus by embedding similarity. Pre-filtered by agency + NAICS prefix;
 * confidence = the top score AND the gap to the runner-up (not score alone),
 * so a field of equally-plausible matches honestly returns "no confident match".
 *
 * Factored out of the route (Jul 2026) so the match is a pure, transport-agnostic
 * fn — no auth, no NextResponse. The reusable primitives already live in
 * `src/lib/market/embeddings.ts`; this lib is the fetch + rank + verdict flow.
 */
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

export interface RecompeteMatchInput {
  description: string;
  naics?: string;
  agency?: string;
  piid?: string;
}

export interface RecompeteMatchRow {
  id: string;
  noticeId: string;
  solicitationNumber: string | null;
  title: string;
  department: string | null;
  naicsCode: string | null;
  sowDocType: string | null;
  sowFilename: string | null;
  score: number;
  scorePct: number;
  snippet: string;
  samUrl: string | null;
  label: string;
}

export interface RecompeteTelemetry {
  piid: string;
  agency_filter: string;
  naics_prefix: string | null;
  candidate_count: number;
  top_score: number;
  runner_up_score: number;
  score_gap: number;
  verdict: 'confident_match' | 'no_confident_match';
}

export interface RecompeteMatchResult {
  ok: boolean; // false only on an infrastructure error (query/embed failure) — degraded
  error?: string;
  verdict: 'confident_match' | 'no_confident_match';
  reason?: 'no_candidates' | 'below_threshold' | 'gap_too_small';
  match: RecompeteMatchRow | null;
  possible: RecompeteMatchRow | null;
  top: RecompeteMatchRow[];
  telemetry: RecompeteTelemetry;
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function samNoticeUrl(noticeId: string) {
  return `https://sam.gov/workspace/contract/opp/${noticeId}/view`;
}

function snippet(text: string, max = 600) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Find the open solicitation that is the likely recompete of an expiring contract.
 * Embeds the query text, pulls SOW-bearing candidates (agency + NAICS-prefix scoped,
 * widening to the 2-digit NAICS if the narrow set is thin), ranks by cosine, and
 * applies the confidence verdict (threshold + runner-up gap). `ok=false` marks an
 * infrastructure failure (distinct from an honest "no_confident_match").
 */
export async function matchRecompeteSow(input: RecompeteMatchInput): Promise<RecompeteMatchResult> {
  const description = (input.description || '').trim();
  const naics = input.naics || '';
  const agency = input.agency || '';
  const piid = input.piid || '';

  const prefix = naicsPrefix(naics);
  const deptPatterns = agencyDepartmentPatterns(agency);
  const agencyToken = deptPatterns[0] || agencyFilterToken(agency);

  const telemetry: RecompeteTelemetry = {
    piid,
    agency_filter: deptPatterns.join('|') || agencyToken || '',
    naics_prefix: prefix,
    candidate_count: 0,
    top_score: 0,
    runner_up_score: 0,
    score_gap: 0,
    verdict: 'no_confident_match',
  };

  const empty = (
    partial: Partial<RecompeteMatchResult> & Pick<RecompeteMatchResult, 'ok' | 'verdict'>,
  ): RecompeteMatchResult => ({
    match: null,
    possible: null,
    top: [],
    telemetry,
    ...partial,
  });

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

      if (naicsLike) q = q.like('naics_code', `${naicsLike}%`);
      if (deptPatterns.length) {
        q = q.or(deptPatterns.map((p) => `department.ilike.%${p}%`).join(','));
      } else if (agencyToken) {
        q = q.ilike('department', `%${agencyToken}%`);
      }

      return q.limit(500);
    }

    let { data: rows, error } = await fetchRows(prefix);
    if (error) return empty({ ok: false, verdict: 'no_confident_match', error: error.message });

    const twoDigit = naics2Prefix(naics);
    if ((rows?.length ?? 0) < 20 && twoDigit && twoDigit !== prefix?.slice(0, 2)) {
      const wider = await fetchRows(twoDigit);
      if (!wider.error && (wider.data?.length ?? 0) > (rows?.length ?? 0)) rows = wider.data;
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
      return empty({ ok: true, verdict: 'no_confident_match', reason: 'no_candidates' });
    }

    const ranked = topMatches(queryVec, candidates, 3);
    const top = ranked[0];
    const runnerUp = ranked[1];
    const verdict = evaluateRecompeteMatch(top.score, runnerUp?.score ?? 0);

    telemetry.top_score = Math.round(verdict.topScore * 1000) / 1000;
    telemetry.runner_up_score = Math.round(verdict.runnerUpScore * 1000) / 1000;
    telemetry.score_gap = Math.round(verdict.gap * 1000) / 1000;
    telemetry.verdict = verdict.confident ? 'confident_match' : 'no_confident_match';

    const formatMatch = (m: (typeof ranked)[0], tier: 'confident' | 'possible'): RecompeteMatchRow => ({
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
      return {
        ok: true,
        verdict: 'no_confident_match',
        reason: top.score < verdict.threshold ? 'below_threshold' : 'gap_too_small',
        match: null,
        possible: showPossible ? formatMatch(top, 'possible') : null,
        top: ranked.map((m) => formatMatch(m, 'possible')),
        telemetry,
      };
    }

    return {
      ok: true,
      verdict: 'confident_match',
      match: formatMatch(top, 'confident'),
      possible: null,
      top: ranked.map((m) => formatMatch(m, 'confident')),
      telemetry,
    };
  } catch (e) {
    const msg = (e as Error).message || 'match failed';
    return empty({ ok: false, verdict: 'no_confident_match', error: msg });
  }
}
