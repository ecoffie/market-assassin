/**
 * "Start here" — the 3-step daily workflow for a signed-in user (nightly team, 2026-11-23).
 *
 * WHY: a paying customer said on a call that nobody showed them how to use the tools; reps were
 * explaining the daily loop (save your search → check what's new → ask Mindy about a match) live.
 * Every onboarding finish lands on MAPS_HOME_PATH ('/?onboarded=1', the marketing homepage), and
 * the only guided walkthrough (ProductTour) auto-starts on /app?onboarded=1 — a URL no onboarding
 * exit produces any more — so a new user got no guide at all.
 *
 * Each step links to a page that exists today (no new destinations):
 *   1. /opportunity-map        — type what you sell, then the map's "Save search" button
 *   2. /opportunity-map/saved  — "Updates" in the account menu: saved searches + their new matches
 *   3. /opportunity-map        — open a listing → "Ask Mindy about this opportunity"
 *
 * State is per-browser localStorage (no per-user server state exists for this). Every access is
 * guarded: a private window or blocked storage shows the guide and simply forgets clicks.
 */

export const FIRST_RUN_GUIDE_KEY = 'mindy_first_run_guide';

export type FirstRunStepId = 'save-search' | 'whats-new' | 'ask-mindy';

export interface FirstRunStep {
  id: FirstRunStepId;
  title: string;
  detail: string;
  href: string;
  cta: string;
}

export const FIRST_RUN_STEPS: readonly FirstRunStep[] = [
  {
    id: 'save-search',
    title: 'Tell Mindy what you sell',
    detail: 'Type what you sell on the Opportunity Map, then click Save search.',
    href: '/opportunity-map',
    cta: 'Open the Map',
  },
  {
    id: 'whats-new',
    title: "See what's new for you",
    detail: 'Updates shows each search you saved and the new opportunities in it.',
    href: '/opportunity-map/saved',
    cta: 'Open Updates',
  },
  {
    id: 'ask-mindy',
    title: 'Ask Mindy about a match',
    detail: 'Open a listing on the Map and click "Ask Mindy about this opportunity".',
    href: '/opportunity-map',
    cta: 'Pick a match',
  },
];

export interface FirstRunGuideState {
  dismissed: boolean;
  done: FirstRunStepId[];
}

const EMPTY: FirstRunGuideState = { dismissed: false, done: [] };
const IDS = new Set<string>(FIRST_RUN_STEPS.map((s) => s.id));

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function parseGuideState(raw: string | null | undefined): FirstRunGuideState {
  if (!raw) return { ...EMPTY, done: [] };
  try {
    const v = JSON.parse(raw) as Partial<FirstRunGuideState> | null;
    const done = Array.isArray(v?.done)
      ? [...new Set(v.done.filter((d): d is FirstRunStepId => typeof d === 'string' && IDS.has(d)))]
      : [];
    return { dismissed: v?.dismissed === true, done };
  } catch {
    return { ...EMPTY, done: [] };
  }
}

export function readGuideState(storage: StorageLike | null | undefined): FirstRunGuideState {
  try {
    return parseGuideState(storage?.getItem(FIRST_RUN_GUIDE_KEY));
  } catch {
    return { ...EMPTY, done: [] };
  }
}

export function writeGuideState(storage: StorageLike | null | undefined, state: FirstRunGuideState): void {
  try {
    storage?.setItem(FIRST_RUN_GUIDE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — the guide just forgets */
  }
}

export function markStepDone(state: FirstRunGuideState, id: FirstRunStepId): FirstRunGuideState {
  return state.done.includes(id) ? state : { ...state, done: [...state.done, id] };
}

export function isGuideComplete(state: FirstRunGuideState): boolean {
  return FIRST_RUN_STEPS.every((s) => state.done.includes(s.id));
}

/**
 * Show only to a SIGNED-IN visitor (the account script's verdict, window.__mindySession === 'valid'),
 * until they dismiss it or have opened all three steps.
 */
export function shouldShowGuide(session: unknown, state: FirstRunGuideState): boolean {
  return session === 'valid' && !state.dismissed && !isGuideComplete(state);
}
