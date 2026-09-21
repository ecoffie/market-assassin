/**
 * Canonical listing identity — ONE key, used everywhere (Eric 2026-08-04:
 * "one solicitation → one listing → one pin → one rail card → one drawer → one estimate → one
 * result count").
 *
 * A single SAM solicitation is posted as MANY `sam_opportunities` rows (the combined synopsis +
 * each amendment = its own notice_id) — 5,181 active solicitations have >1 row, one has 138. If the
 * map, the rail, the clusters, and the headline COUNT each dedupe (or not) with their own logic, the
 * user sees "4,712 results" over fewer unique pins — a second trust gap after the pricing one. So the
 * canonical key + winner-selection live HERE, in one place, and every surface calls this. Do NOT
 * re-derive dedupe logic in the count query or anywhere else.
 *
 * The raw duplicate rows are PRESERVED in the table (each amendment is real history) — this only
 * collapses them at read/display time.
 */

/** The minimum shape any caller must provide. Extra fields are ignored by the key; the winner
 *  comparison reads `intel_value_range` + `posted_date` when present. */
export interface CanonicalRow {
  notice_id?: string | null;
  solicitation_number?: string | null;
  posted_date?: string | null;
  intel_value_range?: { median?: unknown } | null;
  // Callers pass their full row; anything else is carried through untouched.
  [k: string]: unknown;
}

/**
 * The ONE canonical key for a listing. Prefer the solicitation number (the real "one listing"
 * identity across amendments); when a row has none (rare — some notices are posted without one),
 * fall back to its own notice_id so it stays a distinct listing rather than collapsing every
 * solicitation-less row into one bucket. The fallback is PREFIXED so a notice_id can never collide
 * with a real solicitation number. Returns '' only when BOTH are missing (an unusable row).
 *
 * This is the shared key the pin dedupe AND the unique-count both use — never invent a second one.
 */
export function canonicalListingKey(row: CanonicalRow): string {
  const sol = String(row.solicitation_number ?? '').trim().toUpperCase();
  if (sol) return `sol:${sol}`;
  const nid = String(row.notice_id ?? '').trim();
  if (nid) return `nid:${nid}`; // stable per-row fallback — keeps solicitation-less notices distinct
  return '';
}

/** True when a row carries a real numeric M-Estimate median. */
function hasEstimate(r: CanonicalRow): boolean {
  const m = r.intel_value_range && (r.intel_value_range as { median?: unknown }).median;
  return typeof m === 'number';
}

/**
 * Pick the canonical winner between two rows sharing a key. An M-Estimate beats no estimate (so the
 * drawer the pin opens shows a real number); on a tie, the most recently POSTED row wins (the newest
 * notice is the current state of the solicitation). Deterministic — no Date.now(), pure string
 * compare on posted_date (ISO sorts lexically).
 */
export function canonicalWinner<T extends CanonicalRow>(a: T, b: T): T {
  const ae = hasEstimate(a), be = hasEstimate(b);
  if (ae !== be) return ae ? a : b;
  return String(a.posted_date ?? '') >= String(b.posted_date ?? '') ? a : b;
}

/**
 * Collapse rows to ONE canonical row per listing key, applying `canonicalWinner`. Preserves input
 * order of first appearance for stability. Rows with an empty key (no solicitation AND no notice_id)
 * are dropped — they can't be identified as a listing.
 */
export function dedupeByListing<T extends CanonicalRow>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const r of rows) {
    const key = canonicalListingKey(r);
    if (!key) continue;
    const cur = byKey.get(key);
    byKey.set(key, cur ? canonicalWinner(cur, r) : r);
  }
  return [...byKey.values()];
}

/**
 * Count DISTINCT canonical listings across rows that carry only the two key columns
 * (solicitation_number + notice_id). Used by the headline count so "N results" means unique
 * LISTINGS, not raw rows — computed with the SAME key function as the pins, by construction.
 */
export function countDistinctListings(keyRows: Array<Pick<CanonicalRow, 'solicitation_number' | 'notice_id'>>): number {
  const keys = new Set<string>();
  for (const r of keyRows) {
    const key = canonicalListingKey(r);
    if (key) keys.add(key);
  }
  return keys.size;
}
