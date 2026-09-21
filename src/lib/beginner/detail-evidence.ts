/**
 * "Your words are in the DETAILS, not the title."
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 * The relevance gate admits an opportunity only when the TITLE names the
 * user's work, because the title is the only text `search_sam_opportunities`
 * hands back — and a match we cannot see is a match we cannot defend.
 *
 * That is correct, and it was also silently deleting real markets. Measured
 * 2026-09-21 for "we mow lawns":
 *   • `lawn`   → 0 open TITLES.  `mowing` → 0 open TITLES.
 *   • but the tool's body pass returns "PSW Landscaping Hilo, Hawaii" and
 *     "Grounds Maintenance Services, Ft Sill National Cemetery" (both 561730),
 *     whose descriptions literally read "frequent mowing, weeding, and general
 *     lawn maintenance year-round" and "Mowing, trimming, edging … turf areas".
 * Answering that with "nothing found" describes an EXACT-TOKEN MISS as market
 * absence. There are ~18 open grounds-maintenance notices in 561730.
 *
 * ── Why this is not the rejected synonym experiment ───────────────────────
 * Nothing is inferred. We do not map `lawn` → "grounds maintenance" (a hop
 * that measured BADLY: `naics_vocabulary` sends `lawn` → 333112 LAWN-MOWER
 * MANUFACTURING at df 17 — the same shape as the 562998 → "grease trap"
 * failure). We go and READ the notice, match the user's own word against its
 * own text on a word boundary, and keep the passage so the claim can be shown.
 *
 * ── Bounded ───────────────────────────────────────────────────────────────
 * One extra query, only when the direct group is EMPTY, only over candidates
 * the search already returned. `description` is populated on 4,798 of 9,045
 * active open rows (53%) — a null description yields no claim, never a guess.
 * Results land in the explicitly-broader group, never in "Matches what you
 * described": the title is still what names a market.
 */

import { isDistinctiveKeyword } from '@/lib/market/keyword-sanitize';
import type { SamSearchItem } from './types';
import { opportunityKey } from './opportunity-key';

/** Cap the read: this is a rescue path, not a corpus scan. */
export const DETAIL_EVIDENCE_MAX_CANDIDATES = 40;
export const DETAIL_PASSAGE_WINDOW = 90;
/** A rescue may add a few adjacent listings; it may not become the page. */
export const DETAIL_EVIDENCE_MAX_HITS = 6;
/**
 * A multi-word term must appear as a PHRASE, not as two words that happen to
 * occur somewhere in a 48 KB statement of work. Measured: "medical staffing"
 * "matched" 23 VA facility notices because both words exist in any hospital
 * SOW ("…licenses for medical staff…"). Tokens must fall inside one window.
 */
export const DETAIL_PHRASE_SPAN = 40;

/**
 * Which terms may be used as DETAIL evidence at all.
 *
 * ⚠️ Stricter than the title gate on purpose. A title is ~8 words, so a broad
 * single word is mostly self-limiting there; a description is thousands of
 * words, where a wildcard matches everything. "medical" pulled in VA Medical
 * Center duct work, radiopharmaceuticals and bed-bug pest control.
 */
export function usableDetailTerms(terms: readonly string[]): string[] {
  return terms.filter((t) => (t.includes(' ') ? true : isDistinctiveKeyword(t)));
}

function tokensOf(term: string): string[] {
  return term.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
}

function boundaryPositions(haystack: string, token: string): number[] {
  const out: number[] = [];
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es|ing|ed)?\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    out.push(m.index);
    if (out.length > 200) break;
  }
  return out;
}

/**
 * Does the notice's own text carry this term? Returns the character offset of
 * the proof, or -1. Single words match on a word boundary; multi-word terms
 * must land inside `DETAIL_PHRASE_SPAN` characters of each other.
 */
export function findTermInText(text: string, term: string): number {
  const hay = text.toLowerCase();
  const tokens = tokensOf(term);
  if (tokens.length === 0) return -1;
  const positions = tokens.map((t) => boundaryPositions(hay, t));
  if (positions.some((p) => p.length === 0)) return -1;
  if (tokens.length === 1) return positions[0][0];
  // Cheapest sufficient check: some occurrence of each token inside one window.
  for (const anchor of positions[0]) {
    const picks = [anchor];
    let ok = true;
    for (let i = 1; i < positions.length; i += 1) {
      const near = positions[i].find((p) => Math.abs(p - anchor) <= DETAIL_PHRASE_SPAN);
      if (near === undefined) { ok = false; break; }
      picks.push(near);
    }
    if (ok) return Math.min(...picks);
  }
  return -1;
}

export interface DetailHit {
  item: SamSearchItem;
  /** The term that matched, and the sentence fragment proving it. */
  term: string;
  passage: string;
}

export interface DetailEvidenceDeps {
  /** notice ids → their own text. Returns [] on any failure (fails soft). */
  fetchNoticeText?: (
    noticeIds: readonly string[],
  ) => Promise<Array<{ notice_id: string; description: string | null; sow_text: string | null }>>;
}

async function defaultFetchNoticeText(
  noticeIds: readonly string[],
): Promise<Array<{ notice_id: string; description: string | null; sow_text: string | null }>> {
  try {
    const { getWriteClient } = await import('@/lib/supabase/server-clients');
    const db = getWriteClient();
    const { data, error } = await db
      .from('sam_opportunities')
      .select('notice_id, description, sow_text')
      .in('notice_id', [...noticeIds])
      .limit(noticeIds.length);
    if (error) {
      console.error('[beginner] detail-evidence read failed:', error.message);
      return [];
    }
    return (data || []) as Array<{
      notice_id: string;
      description: string | null;
      sow_text: string | null;
    }>;
  } catch (err) {
    console.error('[beginner] detail-evidence read threw:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** A short quotable fragment around the proof. Never the whole SOW. */
export function passageAround(text: string, at: number, window = DETAIL_PASSAGE_WINDOW): string {
  if (at < 0) return '';
  const start = Math.max(0, at - window);
  const end = Math.min(text.length, at + window * 2);
  const slice = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`;
}

/**
 * Which of these candidates prove the user's words in their OWN text?
 * `terms` must be the activity terms — context words never reach here.
 */
export async function findDetailEvidence(
  candidates: readonly SamSearchItem[],
  terms: readonly string[],
  deps: DetailEvidenceDeps = {},
): Promise<DetailHit[]> {
  if (candidates.length === 0 || terms.length === 0) return [];
  const byId = new Map<string, SamSearchItem>();
  for (const item of candidates) {
    const id = (item.notice_id || '').trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, item);
    if (byId.size >= DETAIL_EVIDENCE_MAX_CANDIDATES) break;
  }
  if (byId.size === 0) return [];

  const usable = usableDetailTerms(terms);
  if (usable.length === 0) return [];

  const fetchText = deps.fetchNoticeText ?? defaultFetchNoticeText;
  const rows = await fetchText([...byId.keys()]);

  const hits: DetailHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (hits.length >= DETAIL_EVIDENCE_MAX_HITS) break;
    const item = byId.get(row.notice_id);
    if (!item) continue;
    const text = `${row.description || ''}\n${row.sow_text || ''}`.trim();
    // No text is NOT evidence of absence — it is simply no evidence.
    if (!text) continue;
    // Longest (most specific) term first, so the quoted line is the best one.
    for (const term of [...usable].sort((a, b) => b.length - a.length)) {
      const at = findTermInText(text, term);
      if (at < 0) continue;
      const passage = passageAround(text, at);
      if (!passage) continue;
      const key = opportunityKey(item) || row.notice_id;
      if (seen.has(key)) break;
      seen.add(key);
      hits.push({ item, term, passage });
      break;
    }
  }
  return hits;
}
