/**
 * Award-warehouse name resolution shared by get_contractor_profile and
 * get_contractor_award_history.
 *
 * search_contractors already returns every award-holding recipient whose name
 * contains the query (searchRecipients, live BigQuery). A single-entity tool
 * must use that same index and then refuse to guess:
 *   unique     — one row, or exactly one exact legal-stem match among a
 *                complete (untruncated) list
 *   ambiguous  — more than one, and we do not pick the first or the largest
 *   none       — no row in this dataset (not a claim about all federal awards)
 *   degraded   — the lookup failed
 *
 * A substring search of the raw string misses when the stored name has a comma
 * the query lacks. The retry uses the legal-name stem, which is the same stem
 * the existence check already uses. That is string-form tolerance, not fuzzy
 * edit-distance matching.
 */
import { searchRecipients, getRollupOrSingleBySlug, resolveCanonicalSlug, recipientSlug, type RecipientSearchRow } from '@/lib/bigquery/recipients';
import { legalNameSearchStem, namesMatchLegalStem } from '@/lib/contractor/legal-name-stem';

export interface AwardNameCandidate {
  name: string;
  uei: string;
  total_obligated: number;
  award_count: number;
  /** Trade name / DBA. An exact DBA stem among many legal names is unique, not a guess. */
  dba?: string;
}

export type AwardNameResolution =
  | {
      status: 'unique';
      uei: string;
      name: string;
      total_obligated: number;
      award_count: number;
      /** slug = the same suffix-variant slug the profile tool uses. sole_hit = the name index returned one row. exact_stem = one complete-list row's stem equals the query. exact_dba_stem = one complete-list row's DBA stem equals the query. */
      match: 'sole_hit' | 'exact_stem' | 'exact_dba_stem' | 'slug';
    }
  | {
      status: 'ambiguous';
      match_count: number;
      candidates: AwardNameCandidate[];
      truncated: boolean;
      note: string;
    }
  | { status: 'none'; searched: string }
  | { status: 'degraded'; detail: string };

const CANDIDATE_CAP = 10;
const SEARCH_LIMIT = 25;

function toCandidate(row: RecipientSearchRow): AwardNameCandidate {
  return {
    name: row.recipient_name,
    uei: row.recipient_uei,
    total_obligated: Number(row.total_obligated || 0),
    award_count: Number(row.award_count || 0),
  };
}

export function classifyNameHits(
  query: string,
  rows: AwardNameCandidate[],
  total: number,
): Exclude<AwardNameResolution, { status: 'degraded' }> {
  const matchCount = Math.max(total, rows.length);
  if (matchCount === 0 || rows.length === 0) {
    return { status: 'none', searched: query };
  }

  const truncated = total > rows.length;
  if (matchCount === 1) {
    const row = rows[0];
    return {
      status: 'unique',
      uei: row.uei,
      name: row.name,
      total_obligated: row.total_obligated,
      award_count: row.award_count,
      match: namesMatchLegalStem(query, row.name) === 'exact' ? 'exact_stem' : 'sole_hit',
    };
  }

  // A complete list with exactly one legal-stem equal to the query is the
  // entity the user named, not a guess among ties. If the list is truncated,
  // an unseen row could also be exact — do not pick.
  if (!truncated) {
    const exact = rows.filter((row) => namesMatchLegalStem(query, row.name) === 'exact');
    if (exact.length === 1) {
      const row = exact[0];
      return {
        status: 'unique',
        uei: row.uei,
        name: row.name,
        total_obligated: row.total_obligated,
        award_count: row.award_count,
        match: 'exact_stem',
      };
    }
    // Users type the trade name. Legal-name stems of Monarch* firms are not
    // "Monarch Yachts"; the DBA on one of those rows is. Exact DBA stem among
    // a complete list is the entity they named, not a guess among ties.
    const exactDba = rows.filter((row) => row.dba && namesMatchLegalStem(query, row.dba) === 'exact');
    if (exactDba.length === 1) {
      const row = exactDba[0];
      return {
        status: 'unique',
        uei: row.uei,
        name: row.name,
        total_obligated: row.total_obligated,
        award_count: row.award_count,
        match: 'exact_dba_stem',
      };
    }
  }

  const shown = rows.slice(0, CANDIDATE_CAP);
  return {
    status: 'ambiguous',
    match_count: matchCount,
    candidates: shown,
    truncated: truncated || rows.length > CANDIDATE_CAP,
    note:
      `${matchCount} award-holding recipients match "${query}". ` +
      'This tool will not pick one. Name the legal entity or pass its UEI, ' +
      'or use search_contractors for the full list.',
  };
}

async function searchAwardNames(query: string): Promise<{ rows: AwardNameCandidate[]; total: number }> {
  const res = await searchRecipients({
    search: query,
    limit: SEARCH_LIMIT,
    sortBy: 'total_obligated',
    liveBq: true,
  });
  const rows = (res.rows || []).map(toCandidate);
  const total = res.total > 0 ? res.total : rows.length;
  return { rows, total };
}

async function uniqueBySlug(name: string): Promise<AwardNameResolution | null> {
  const base = recipientSlug(name);
  if (!base) return null;
  const variants = Array.from(new Set([
    base, `${base}-inc`, `${base}-llc`, `${base}-corporation`, `${base}-corp`, `${base}-company`,
  ]));
  for (const slug of variants) {
    const canonical = await resolveCanonicalSlug(slug).catch(() => null);
    const profile = await getRollupOrSingleBySlug(canonical || slug, true).catch(() => null);
    if (!profile?.rollup_uei) continue;
    return {
      status: 'unique',
      uei: profile.rollup_uei,
      name: profile.rollup_name,
      total_obligated: Number(profile.total_obligated || 0),
      award_count: Number(profile.award_count || 0),
      match: 'slug',
    };
  }
  return null;
}

export async function resolveAwardCorpusByName(query: string): Promise<AwardNameResolution> {
  const name = query.trim();
  if (!name) return { status: 'none', searched: name };
  try {
    // Slug equality is how get_contractor_profile resolves a specific name
    // ("Leidos" → leidos-inc). It is not a substring guess. A miss falls
    // through to the name index, which refuses to pick among several hits.
    const slugHit = await uniqueBySlug(name);
    if (slugHit) return slugHit;

    let { rows, total } = await searchAwardNames(name);
    const stem = legalNameSearchStem(name);
    if (rows.length === 0 && stem && stem.toLowerCase() !== name.toLowerCase()) {
      const retry = await searchAwardNames(stem);
      rows = retry.rows;
      total = retry.total;
    }
    return classifyNameHits(name, rows, total);
  } catch (err) {
    return {
      status: 'degraded',
      detail: err instanceof Error ? err.message : 'award-warehouse name search failed',
    };
  }
}
