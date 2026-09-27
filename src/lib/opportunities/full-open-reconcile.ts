/**
 * Full & Open DNA reconciliation — the pure planner behind scripts/reconcile-full-open-dna.ts.
 *
 * Repair board P1-A: until #1727, computeGenome gave EVERY `NONE` set-aside bucket a
 * "Full & Open" strand, and NONE also held notices with NO set-aside on record. The persisted
 * `opportunity_dna` / `opportunity_dna_keys` therefore claim Full & Open for rows that never said so.
 *
 * The approved repair is deliberately SURGICAL, not a genome recompute:
 *   - the ONLY field that may change is the `full_open` strand (in `opportunity_dna`) and the
 *     `full_open` key (in `opportunity_dna_keys`); every other strand, its order and every other
 *     column stay byte-identical. A full recompute would also move time-based strands
 *     (closes_soon / last_chance / early_cycle) and data-derived ones (repeat_buyer, posts_early) —
 *     unrelated DNA changes the approval forbids.
 *   - the decision is AFFIRMATIVE: a row keeps its strand only when `mapSetAside()` finds positive
 *     Full & Open evidence in the row's own set_aside_code / set_aside_description. Absence of a
 *     set-aside is never evidence of openness — that inference is the defect being repaired.
 */
import { mapSetAside } from './map-data';

export interface DnaStrandLike { key?: string; [k: string]: unknown }

export interface FullOpenCandidate {
  notice_id: string;
  set_aside_code: string | null;
  set_aside_description: string | null;
  opportunity_dna: DnaStrandLike[] | null;
  opportunity_dna_keys: string[] | null;
}

/** Why a candidate keeps or loses its strand — the "resulting classification". */
export type FullOpenClass =
  | 'affirmative_open'   // the record SAYS no set-aside / Full & Open → strand kept
  | 'not_stated'         // no set-aside on record → strand removed
  | 'explicit_set_aside' // a set-aside IS stated (strand was doubly wrong) → strand removed
  | 'inconsistent';      // key/strand disagree — never written, surfaced for review

export interface FullOpenPlan {
  notice_id: string;
  cls: FullOpenClass;
  action: 'keep' | 'remove' | 'skip';
  /** Evidence string the decision rests on (the raw code/description, or 'none on record'). */
  evidence: string;
  next?: { opportunity_dna: DnaStrandLike[]; opportunity_dna_keys: string[] };
}

export const FULL_OPEN_KEY = 'full_open';

export function planFullOpenReconciliation(row: FullOpenCandidate): FullOpenPlan {
  const dna = Array.isArray(row.opportunity_dna) ? row.opportunity_dna : [];
  const keys = Array.isArray(row.opportunity_dna_keys) ? row.opportunity_dna_keys : [];
  const raw = (row.set_aside_code || '').trim() || (row.set_aside_description || '').trim();
  const evidence = raw || 'none on record';
  const hasKey = keys.includes(FULL_OPEN_KEY);
  const hasStrand = dna.some((s) => s && s.key === FULL_OPEN_KEY);
  if (hasKey !== hasStrand) {
    return { notice_id: row.notice_id, cls: 'inconsistent', action: 'skip', evidence };
  }
  // Affirmative evidence only: the code first, then the description (SAM always pairs them, but a
  // row carrying only an explicit description must still count as stated).
  const byCode = mapSetAside(row.set_aside_code);
  const byDesc = mapSetAside(row.set_aside_description);
  const open = byCode.open || (!(row.set_aside_code || '').trim() && byDesc.open);
  if (open) return { notice_id: row.notice_id, cls: 'affirmative_open', action: 'keep', evidence };

  const cls: FullOpenClass = raw ? 'explicit_set_aside' : 'not_stated';
  return {
    notice_id: row.notice_id,
    cls,
    action: 'remove',
    evidence,
    next: {
      opportunity_dna: dna.filter((s) => !(s && s.key === FULL_OPEN_KEY)),
      opportunity_dna_keys: keys.filter((k) => k !== FULL_OPEN_KEY),
    },
  };
}

/**
 * Post-write check for ONE row: the only permitted difference from the snapshot is the removal of
 * the full_open strand/key (for 'remove'), or nothing at all (for 'keep'/'skip').
 */
export function verifyReconciled(
  before: FullOpenCandidate,
  after: Pick<FullOpenCandidate, 'opportunity_dna' | 'opportunity_dna_keys'>,
  plan: FullOpenPlan,
): { ok: boolean; reason?: string } {
  const expect = plan.action === 'remove' && plan.next
    ? plan.next
    : { opportunity_dna: before.opportunity_dna ?? [], opportunity_dna_keys: before.opportunity_dna_keys ?? [] };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(after.opportunity_dna ?? [], expect.opportunity_dna)) return { ok: false, reason: 'opportunity_dna differs beyond the full_open strand' };
  if (!same(after.opportunity_dna_keys ?? [], expect.opportunity_dna_keys)) return { ok: false, reason: 'opportunity_dna_keys differs beyond the full_open key' };
  return { ok: true };
}
