/**
 * The NAICS catalog the picker searches — authoritative, not hand-maintained.
 *
 * WHY THIS EXISTS. Two users, two days, same wall:
 *
 *   2026-08-22, demo: "Why don't I see all the NAICS codes? I cant filter with 333612"
 *   2026-08-23, Hector Jaquez Jr (JPAC Global): "I tried to search NAICS 324110 in the Mindy
 *              map and it doesn't exist. Are you pulling in fuel contracts?"
 *
 * We WERE pulling fuel contracts — 226 SAM records under 324110. But the industry picker is
 * 16 curated presets covering ~13 sectors, and petroleum is not one of them. Neither is food,
 * primary metals, plastics, furniture, publishing, real estate, or agriculture support. A
 * contractor who opened the picker, failed to find their industry, and concluded we don't
 * cover it was reading the product correctly.
 *
 * MEASURED 2026-08-23 — 547 NAICS codes had open opportunities:
 *   the authoritative catalog (src/data/naics-codes.json, USASpending) covers  547 / 547 = 100%
 *   the hand-maintained NAICS_DATABASE covers                                  342 / 547 = 62.5%
 *
 * 205 codes with live inventory were unselectable. The fix is not to hand-add the eight
 * families that got reported; it is to stop letting a hand-maintained list be the ceiling.
 *
 * THE INVARIANT this file exists to hold:
 *
 *   If the data layer can return opportunities for a NAICS code, the UI catalog must be able
 *   to represent that code.
 *
 * ⚠️ DISCOVERY ONLY. This widens what a user can FIND. It must never widen what gets WRITTEN
 * to a profile — that is `normalizeNAICSForPersist()` and it stays curated. Query-time broad,
 * persist-time exact; see the PERSIST vs QUERY rule. (2026-08-23: an earlier attempt at this
 * fix appended families to PERSIST_COVERAGE_SETS by mistake, which would have written whole
 * industry families onto profiles — the documented failure where 12% of profiles drove 82% of
 * alert volume. Keep the two jobs apart.)
 */
import catalog from '@/data/naics-codes.json';

export interface NaicsEntry {
  /** 2–6 digit NAICS code. */
  code: string;
  /** Official title, e.g. "Petroleum Refineries". */
  title: string;
  /** 2 = sector … 6 = national industry. */
  level: number;
  /** Parent code, or undefined at sector level. */
  parent?: string;
}

// `parent` is null at sector level in the JSON, so widen it here rather than at every use.
type RawEntry = { title: string; level: number; parent?: string | null };
const RAW = (catalog as unknown as { codes: Record<string, RawEntry> }).codes;

/** Every code in the authoritative catalog, sectors through national industries. */
export const NAICS_CATALOG: NaicsEntry[] = Object.entries(RAW).map(([code, e]) => ({
  code,
  title: e.title,
  level: e.level,
  parent: e.parent ?? undefined,
}));

const BY_CODE = new Map(NAICS_CATALOG.map((e) => [e.code, e]));

/** The 6-digit codes a contractor actually bids under. */
export const NAICS_SIX_DIGIT = NAICS_CATALOG.filter((e) => e.code.length === 6);

/** Look up one code. Returns undefined rather than inventing a title. */
export function naicsTitle(code: string): string | undefined {
  return BY_CODE.get(String(code || '').trim())?.title;
}

/** True when the catalog can represent this code — the invariant's read side. */
export function isKnownNaics(code: string): boolean {
  return BY_CODE.has(String(code || '').trim());
}

/**
 * Search by CODE or by plain-English NAME, because a contractor thinks "petroleum" as often as
 * "324110". Both must resolve to the same canonical entry, or the picker has two vocabularies.
 *
 * Ranking, most-useful first:
 *   1. exact code match        — they typed what they know
 *   2. code prefix             — "3336" while still typing
 *   3. title starts with query — "petro" → "Petroleum Refineries"
 *   4. title contains query    — "refineries"
 *
 * 6-digit codes rank above their parents at equal relevance: a bid is placed under a 6-digit
 * code, so that is the useful answer.
 */
export function searchNaics(query: string, limit = 25): NaicsEntry[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const scored: Array<{ e: NaicsEntry; score: number }> = [];
  for (const e of NAICS_CATALOG) {
    const code = e.code;
    const title = e.title.toLowerCase();
    let score = -1;

    if (code === q) score = 0;
    else if (code.startsWith(q) && /^\d+$/.test(q)) score = 1;
    else if (title.startsWith(q)) score = 2;
    else if (title.includes(q)) score = 3;

    if (score >= 0) {
      // Prefer the level a contractor bids at.
      scored.push({ e, score: score * 10 + (code.length === 6 ? 0 : 1) });
    }
  }

  scored.sort((a, b) => a.score - b.score || a.e.code.localeCompare(b.e.code));
  return scored.slice(0, limit).map((s) => s.e);
}
