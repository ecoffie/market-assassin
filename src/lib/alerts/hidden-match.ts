/**
 * "Hidden match" matcher (Phase 3 semantic alerts).
 *
 * Surfaces ACTIVE opportunities whose SOW semantically matches a user's capability
 * vector but that their NAICS/keyword search MISSED. Clones the proven recompete-sow
 * fetch→parse→topMatches pattern — but with NO NAICS pre-filter (the whole point is
 * the cross-code work their codes never surface); the cosine threshold is the
 * precision control instead. In-app JS cosine, no pgvector.
 */
import { createClient } from '@supabase/supabase-js';
import {
  parseEmbedding,
  topMatches,
  HIDDEN_MATCH_THRESHOLD,
  HIDDEN_MATCH_MAX,
} from '@/lib/market/embeddings';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const POOL_SIZE = parseInt(process.env.HIDDEN_MATCH_POOL_SIZE || '1500', 10);
const POOL_WINDOW_DAYS = parseInt(process.env.HIDDEN_MATCH_WINDOW_DAYS || '60', 10);

export interface HiddenCandidate {
  noticeId: string;
  title: string;
  department: string;
  naics: string;
  noticeType: string | null;
  deadline: string | null;
  postedDate: string | null;
  url: string;
  vec: number[];
  // Index signature so the type satisfies topMatches' Record<string, unknown> constraint.
  [key: string]: unknown;
}

export interface HiddenMatch {
  noticeId: string;
  title: string;
  agency: string;
  naics: string;
  deadline: string | null;
  url: string;
  score: number;
}

// Module-cache the parsed pool for the lifetime of ONE serverless invocation, so a
// 150-user batch reuses a single query. A fresh lambda re-fetches (≤29/day — trivial).
let _poolCache: { rows: HiddenCandidate[]; at: number } | null = null;
const POOL_TTL_MS = 10 * 60 * 1000; // 10 min — safely within one cron invocation

function samUrl(noticeId: string, uiLink?: string | null): string {
  if (uiLink && /^https?:\/\//.test(uiLink)) return uiLink;
  return `https://sam.gov/workspace/contract/opp/${noticeId}/view`;
}

/**
 * Fetch + parse the candidate pool: ACTIVE, recently-posted, still-open opps that
 * have an embedded SOW. UNFILTERED by NAICS. Cached per invocation.
 */
export async function fetchHiddenMatchPool(): Promise<HiddenCandidate[]> {
  if (_poolCache && Date.now() - _poolCache.at < POOL_TTL_MS) return _poolCache.rows;

  const sb = getSupabase();
  const since = new Date(Date.now() - POOL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const { data, error } = await sb
    .from('sam_opportunities')
    .select('notice_id, title, department, naics_code, notice_type, response_deadline, posted_date, ui_link, sow_embedding')
    .eq('has_sow_doc', true)
    .not('sow_embedding', 'is', null)
    .gte('posted_date', since)
    .gt('response_deadline', nowIso)
    .order('posted_date', { ascending: false })
    .limit(POOL_SIZE);

  if (error || !data) {
    console.warn('[hidden-match] pool fetch failed:', error?.message);
    return [];
  }

  const seen = new Set<string>();
  const rows: HiddenCandidate[] = [];
  for (const r of data as Array<Record<string, unknown>>) {
    const noticeId = String(r.notice_id || '');
    if (!noticeId || seen.has(noticeId)) continue;
    const vec = parseEmbedding(r.sow_embedding);
    if (!vec) continue;
    seen.add(noticeId);
    rows.push({
      noticeId,
      title: String(r.title || 'Untitled'),
      department: String(r.department || ''),
      naics: String(r.naics_code || ''),
      noticeType: (r.notice_type as string) || null,
      deadline: (r.response_deadline as string) || null,
      postedDate: (r.posted_date as string) || null,
      url: samUrl(noticeId, r.ui_link as string | null),
      vec,
    });
  }

  _poolCache = { rows, at: Date.now() };
  return rows;
}

/**
 * Find the user's hidden matches: top candidates by cosine ≥ threshold, EXCLUDING
 * everything they already got (recent sends + this email's keyword/NAICS results).
 * Returns [] when nothing clears the bar (caller omits the section — honest, not noise).
 */
export function findHiddenMatches(
  userVec: number[],
  excludedNoticeIds: Set<string>,
  pool: HiddenCandidate[],
  opts?: { threshold?: number; max?: number },
): HiddenMatch[] {
  const threshold = opts?.threshold ?? HIDDEN_MATCH_THRESHOLD;
  const max = opts?.max ?? HIDDEN_MATCH_MAX;
  if (!userVec.length || !pool.length) return [];

  const eligible = pool.filter((c) => !excludedNoticeIds.has(c.noticeId));
  if (!eligible.length) return [];

  // topMatches over a generous K, then keep only those clearing the floor, cap at max.
  return topMatches(userVec, eligible, max * 4)
    .filter((m) => m.score >= threshold)
    .slice(0, max)
    .map((m): HiddenMatch => ({
      noticeId: m.noticeId,
      title: m.title,
      agency: m.department,
      naics: m.naics,
      deadline: m.deadline,
      url: m.url,
      score: Math.round(m.score * 1000) / 1000,
    }));
}
