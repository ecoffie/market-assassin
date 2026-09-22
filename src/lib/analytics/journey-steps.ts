/**
 * The Journey Analytics step definition — SAVED, WATCHING and PURSUING are three
 * different states, and this module is the ONE place that says which telemetry
 * token belongs to which.
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
 * It used to be a `const JOURNEY_STEPS` inside `api/admin/map-funnel/route.ts`,
 * with a SECOND hand-written copy of the save tokens 180 lines below it (the
 * right-column `savedUsers` counter) and a THIRD copy in the unit test's local
 * `FUNNEL_STEPS` mirror. Three copies of one fact is how this file has already
 * been wrong twice: the token→step map once silently overwrote, so the discovery
 * "Saved" row reported 0 users while the separate counter reported 6 — two
 * numbers for one action in the same payload — and the test mirror could not
 * catch it because it was a copy, not the thing.
 *
 * One exported constant. The route derives its counters FROM it, and the guard
 * test imports THIS, so a mirror cannot drift out of sync with reality again.
 *
 * ── THE THREE STATES (they are NOT the same thing) ─────────────────────────
 *   SAVED    "I want to keep this."                → `anonymous_shortlist`
 *   WATCHING "Tell me when this market changes."   → `saved_searches`
 *   PURSUING "I have decided to work this."        → `user_pipeline`
 *
 * RETURNING IS THE CONVERSION. A save belongs to the DISCOVERY loop; a pursuit
 * belongs to the EXECUTION loop. Browsing with no intent to transact is the
 * NORMAL state, and a pursuit being far rarer than a save is HEALTHY, not a leak.
 *
 * ⚠️ A SAVE TOKEN MUST NEVER APPEAR IN AN EXECUTION STEP. Measured on production
 * 2026-09-21: the discovery "Saved" step and the execution "Pursuit started" step
 * were declared with the SAME three tokens, so they returned byte-identical
 * numbers (58 users / 108 events each) — the dashboard built to show that a
 * pursuit is rarer than a save DEFINED them as the same event, and could never
 * have shown otherwise. Meanwhile the only tokens that record a real save
 * (`shortlist_saved`, `shortlist_attached`) or a real watch (`watch_created`,
 * `watch_claimed`) were emitted by the Map and read by NOTHING, so the two
 * features built to let anonymous visitors keep things would have reported the
 * pursuit count as their result. `state-separation.unit.test.ts` now fails the
 * build if a save or watch token re-enters an execution step.
 */

export type Loop = 'discovery' | 'execution';

export interface JourneyStep {
  step: string;
  label: string;
  /** The `metadata.action` / `metadata.kind` tokens that COUNT as this step. */
  tokens: string[];
  loop: Loop;
}

/**
 * Tokens that record SAVED — "I want to keep this." Emitted by the Map's
 * anonymous shortlist path (`/api/app/shortlist`). These are DISCOVERY-only.
 */
export const SAVE_TOKENS = ['shortlist_saved', 'shortlist_attached'] as const;

/**
 * Tokens that record WATCHING — "tell me when this market changes." Emitted by
 * the Map's watch path (`/api/app/map-watch` → `saved_searches`). Watching a
 * market is not a decision to bid on anything in it, so these are DISCOVERY-only.
 */
export const WATCH_TOKENS = ['watch_created', 'watch_claimed'] as const;

/**
 * Tokens that record PURSUING — an explicit decision to work an opportunity,
 * which is what writes `user_pipeline` through `createCanonicalPursuit`.
 */
export const PURSUIT_TOKENS = ['pursuit_started', 'save_to_pipeline', 'start_pursuit_clicked'] as const;

/**
 * The ordered journey. Each step lists the tokens that COUNT as that step and
 * which LOOP it belongs to. The DISCOVERY loop is measured by engagement/return
 * (NEVER conversion); the EXECUTION loop is a legitimate funnel and the only
 * place a drop callout may appear.
 *
 * `map_open` is emitted as `map_view` (once/session); the rest are their own
 * tokens. Token lists fold in the pre-existing app-panel tokens observed live in
 * `user_engagement` (save_to_pipeline, open_details, open_sam …) alongside the
 * map's own tokens.
 */
export const JOURNEY_STEPS: JourneyStep[] = [
  // ── DISCOVERY loop — browsing is the point; measured by return, not conversion ──
  { step: 'map_open', label: 'Map opened', tokens: ['map_view'], loop: 'discovery' },
  { step: 'pin_clicked', label: 'Pin clicked', tokens: ['pin_clicked'], loop: 'discovery' },
  { step: 'popup_open', label: 'Popup opened', tokens: ['popup_open'], loop: 'discovery' },
  // A listing opens via: map __track 'listing_open', __trackCard 'click' (card→drawer), or the app panel's 'open_details'.
  { step: 'listing_open', label: 'Listing opened', tokens: ['listing_open', 'click', 'open_details'], loop: 'discovery' },
  // "Saved" is the end of the discovery loop — a bookmark, not a commitment to bid.
  // It counts a real SAVE, and also a pursuit, because someone who went on to
  // pursue plainly kept it too: this step is "did they keep it, in any form", so
  // it is a strict SUPERSET of the execution step below, never a copy of it.
  { step: 'saved', label: 'Saved', tokens: [...SAVE_TOKENS, ...PURSUIT_TOKENS], loop: 'discovery' },
  // WATCHING is a discovery OUTCOME that runs parallel to saving, not a stage
  // between them — you can watch a market without ever opening a listing in it.
  // Listed last so the sequential bars above stay a sequence.
  { step: 'watching', label: 'Watching a market', tokens: [...WATCH_TOKENS], loop: 'discovery' },
  // ── EXECUTION loop — the rare minority path. A pursuit is far rarer than a save,
  //    and that is healthy. A drop callout is meaningful HERE (a started-but-never-
  //    submitted proposal is a real stall), and ONLY here. ──
  { step: 'pursuit_started', label: 'Pursuit started', tokens: [...PURSUIT_TOKENS], loop: 'execution' },
  { step: 'proposal_started', label: 'Proposal opened', tokens: ['proposal_started', 'proposal_opened'], loop: 'execution' },
  { step: 'proposal_built', label: 'Section drafted', tokens: ['section_built'], loop: 'execution' },
  { step: 'proposal_exported', label: 'Proposal exported', tokens: ['export_proposal'], loop: 'execution' },
  { step: 'proposal_submitted', label: 'Proposal submitted', tokens: ['proposal_submitted'], loop: 'execution' },
];

/**
 * The tokens of one step, by id. The route's right-column counters read this
 * instead of re-listing tokens by hand — the hand-written second copy is exactly
 * what drifted before.
 */
export function tokensForStep(step: string): string[] {
  return JOURNEY_STEPS.find((s) => s.step === step)?.tokens ?? [];
}
