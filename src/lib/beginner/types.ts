/**
 * Beginner translation seam — presentation types only.
 *
 * Existing MCP/tool records stay untouched underneath (`raw`). Beginner UI
 * renders this view model, never NAICS/PSC/office/set-aside/notice codes.
 */

/** How we got from a plain-English description to a search. */
export type ResolutionState =
  | 'structured' // coverage grounded a NAICS/PSC internally
  | 'keyword_fallback' // searching the user's words; classification did not succeed
  | 'need_followup' // first miss — ask what they actually do
  | 'unavailable'; // tool/query failed — NOT the same as "couldn't classify"

export type KnownList<T> =
  | { status: 'known'; items: T[] }
  | { status: 'unknown'; reason: string };

export type EligibilityProgram = 'small' | '8a' | 'wosb' | 'edwosb' | 'sdvosb' | 'hubzone' | 'vosb';

/**
 * Certification/size evidence for THIS user. A business description is never
 * enough. Anonymous / description-only callers pass `{ established: false }`.
 */
export type EligibilityEvidence =
  | { established: false }
  | { established: true; programs: readonly EligibilityProgram[]; source: 'profile' | 'sam_entity' };

export const FOLLOW_UP_PROMPT = 'What do you actually do for customers?';

export const EMPTY_MATCH_MESSAGE =
  "We couldn't find matching opportunities from that search. Try describing your business a little differently.";

export const UNAVAILABLE_MESSAGE = "We couldn't check opportunities right now. Try again in a moment.";

export const CLASSIFY_UNAVAILABLE_MESSAGE =
  "We couldn't classify this business right now. Try again in a moment.";

/** Live `search_sam_opportunities` item — exact contract, not illustrative names. */
export interface SamSearchItem {
  title: string | null;
  agency: string | null;
  naics: string | null;
  /** SAM `set_aside_description` (human text), not the code. */
  set_aside: string | null;
  /** SAM `notice_type`. */
  type: string | null;
  deadline: string | null;
  solicitation: string | null;
  /** SAM `ui_link`. */
  link: string | null;
  location?: {
    pop_state: string | null;
    pop_city: string | null;
    office_state: string | null;
  };
  /**
   * Not returned by search_sam_opportunities today. Optional so a richer
   * caller can pass an established amount without us inventing one.
   * `undefined` = field absent (omit). `null` = present but unknown.
   * `0` = explicit zero.
   */
  amount?: number | null;
  psc_code?: string | null;
  psc_description?: string | null;
}

export type SamSearchResult =
  | { ok: true; count: number; items: SamSearchItem[]; note?: string }
  | { ok: false; error: string; message?: string; count: number; items: SamSearchItem[] };

export interface ResolvedPsc {
  code: string;
  /** Trusted name from coverage. Never guessed from the code. */
  name: string;
}

export interface ResolvedBusiness {
  original: string;
  followUpUsed: string | null;
  state: ResolutionState;
  /** Phrase passed to search_sam_opportunities.keyword (required by that tool). */
  searchKeyword: string | null;
  /** Beginner-visible search context. Structured classification does not need this. */
  contextLabel: string | null;
  keywords: KnownList<string>;
  naicsCodes: KnownList<string>;
  primaryNaics: string | null;
  psc: ResolvedPsc | null;
  coverageKeyword: string | null;
  confidence: 'high' | 'low' | 'none';
  followUpPrompt: string | null;
  /** Raw tool payloads for debug/advanced — never render in beginner UI. */
  provenance: {
    derive?: unknown;
    coverage?: unknown;
  };
}

export interface BeginnerOpportunityCard {
  title: string;
  noticeLabel: string | null;
  setAsideLabel: string | null;
  /** "Who it's for: …" — category language, never "you qualify" without evidence. */
  audienceLabel: string | null;
  dueLabel: string;
  amountLabel: string | null;
  pscLabel: string | null;
  agencyLabel: string | null;
  plainMeaning: string | null;
  nextStep: string;
  referenceNumber: string | null;
  samUrl: string | null;
  source: 'sam';
  grounded: boolean;
  searchContext: string | null;
  /** Hidden from beginner render. */
  raw: SamSearchItem;
}

export type BeginnerSearchOutcome =
  | { kind: 'need_followup'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'empty'; message: string }
  | {
      kind: 'results';
      count: number;
      cards: BeginnerOpportunityCard[];
      rawItems: SamSearchItem[];
    };

export interface BeginnerSearchResult {
  resolution: ResolvedBusiness;
  outcome: BeginnerSearchOutcome;
}
