/**
 * Proposal Workspace — GROUNDED progress derivation (the ONE place the workspace
 * computes per-section % + overall %, and the Team roster from real owners).
 *
 * Every number here traces to a REAL count/flag the workspace already loaded from
 * the existing engine — never a guess:
 *  - a section's % comes from its DRAFT state (does a draft exist? is it long
 *    enough? is it approved?) — from /api/app/proposal/drafts.
 *  - the Compliance section's % comes from done rows / total rows of the persisted
 *    matrix — from /api/app/proposal/compliance-state.
 *  - overall % = the mean of the section %s (empty → 0, never a fabricated number).
 *  - the Team roster = the DISTINCT `owner` emails across compliance-state rows +
 *    how many requirements each owns (empty owners → an empty roster, honest state).
 *
 * Pure + dependency-free so the route (server) and the unit test both import it,
 * and so a browser-side copy of the same logic can mirror it byte-for-byte.
 */

/** A drafted section as returned by /api/app/proposal/drafts (`sections[]`). */
export interface DraftSectionLike {
  /** section key, e.g. 'exec_summary' | 'technical' | 'pricing' | ... */
  section: string;
  /** the drafted body text (may be empty if never drafted) */
  draft?: string;
  /** word count of the draft (0 when none) */
  wordCount?: number;
  /** an explicit approval flag, when the engine ever sets one */
  approved?: boolean;
  status?: string;
}

/** A persisted compliance-matrix row as returned by /api/app/proposal/compliance-state. */
export interface ComplianceRowLike {
  req_key?: string | null;
  owner?: string | null;
  /** open | in_progress | done | n_a */
  status?: string | null;
}

export type SectionState = 'done' | 'in_progress' | 'pending';

export interface SectionProgress {
  /** 0 | in-progress fraction | 100 */
  pct: number;
  state: SectionState;
}

/** A section is "long enough to count as a real draft" at/above this many words. */
export const DRAFT_WORD_FLOOR = 40;
/** A drafted-but-not-approved section reads as in-progress at this fixed fraction. */
export const IN_PROGRESS_PCT = 60;

/**
 * Per-section % from a single drafted section's real state.
 * - approved draft (>= floor words)  → 100 / done
 * - any draft with >= floor words     → IN_PROGRESS_PCT / in_progress
 * - a draft that exists but is a stub → IN_PROGRESS_PCT / in_progress (started)
 * - no draft at all                   → 0 / pending
 */
export function sectionProgressFromDraft(draft: DraftSectionLike | null | undefined): SectionProgress {
  if (!draft) return { pct: 0, state: 'pending' };
  const words = typeof draft.wordCount === 'number' && draft.wordCount > 0
    ? draft.wordCount
    : (draft.draft || '').split(/\s+/).filter(Boolean).length;
  const hasText = words > 0;
  if (!hasText) return { pct: 0, state: 'pending' };
  const approved = draft.approved === true || String(draft.status || '').toLowerCase() === 'approved';
  if (approved && words >= DRAFT_WORD_FLOOR) return { pct: 100, state: 'done' };
  // A real (>= floor) or partial draft is in-progress — grounded in "a draft exists".
  return { pct: IN_PROGRESS_PCT, state: 'in_progress' };
}

/**
 * Compliance section % from the persisted matrix: done rows / total rows.
 * Empty matrix → 0 / pending (honest, never a guess).
 */
export function complianceProgress(rows: ComplianceRowLike[] | null | undefined): SectionProgress & { done: number; total: number } {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  if (total === 0) return { pct: 0, state: 'pending', done: 0, total: 0 };
  const done = list.filter((r) => String(r.status || '').toLowerCase() === 'done').length;
  const pct = Math.round((done / total) * 100);
  const state: SectionState = pct >= 100 ? 'done' : done > 0 ? 'in_progress' : 'pending';
  return { pct, state, done, total };
}

/**
 * Overall % = the mean of every provided section %.
 * Empty (no sections tracked) → 0, never a fabricated number.
 */
export function overallProgress(sectionPcts: number[]): number {
  const vals = (sectionPcts || []).filter((n) => typeof n === 'number' && isFinite(n));
  if (vals.length === 0) return 0;
  const sum = vals.reduce((a, b) => a + b, 0);
  return Math.round(sum / vals.length);
}

export interface TeamMember {
  /** the raw owner email */
  email: string;
  /** display name = the email's local-part (before @) — NO fabricated name */
  name: string;
  /** how many requirements this owner owns */
  count: number;
}

/**
 * Team roster from REAL compliance-matrix owners: the DISTINCT non-empty `owner`
 * emails across the persisted rows, each with a requirement count. Sorted by
 * count desc then email. Empty owners → [] (the caller shows the honest
 * "assign requirements in the Compliance Matrix" empty state — NO invented roster).
 */
export function teamFromComplianceOwners(rows: ComplianceRowLike[] | null | undefined): TeamMember[] {
  const list = Array.isArray(rows) ? rows : [];
  const counts = new Map<string, number>();
  for (const r of list) {
    const owner = String(r.owner || '').trim().toLowerCase();
    if (!owner) continue;
    counts.set(owner, (counts.get(owner) || 0) + 1);
  }
  const localPart = (email: string): string => {
    const at = email.indexOf('@');
    return at > 0 ? email.slice(0, at) : email;
  };
  return Array.from(counts.entries())
    .map(([email, count]) => ({ email, name: localPart(email), count }))
    .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email));
}
