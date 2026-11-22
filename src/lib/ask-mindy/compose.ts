/**
 * Ask Mindy composer: turns a recipe run (orchestrator.ts) plus the company profile (company-profile.ts) into the
 * structured, already-ranked context an answer is written from (spec sections 4 and 8). Pure: no I/O, no model
 * call. Not wired into the chat route yet (that wiring waits for #2204, behind ASK_MINDY_RECIPES, default off).
 *
 * What it guarantees, so the answer model cannot get these wrong:
 *   - Picks are ranked by the shared fit scorer (src/lib/fit), never by the model. Only band 'show' becomes a
 *     top pick (at most 5 across horizons); 'related' is counted for "show more"; 'hidden' and 'unscored' are not
 *     picks.
 *   - Each pick carries its plain-word reasons and its route; a subcontract-route pick says so first.
 *   - An unavailable horizon is reported as unavailable, never as zero. A partial window carries its coverage note.
 *   - Profile gaps are reported once (unknown vs unavailable). Value first: an empty profile never blocks the
 *     answer; it only adds the optional profile-completion next step.
 */
import { scoreFindHorizon } from '@/lib/fit/find-rows';
import { reasonSentence, type FitProfile, type FitScore } from '@/lib/fit/fit-scorer';
import type { CompanyProfile, ProfileField } from './company-profile';
import { PROFILE_COMPLETION_STEP } from './intent';
import type { RecipeRun } from './orchestrator';
import type { AskMindyProfile } from './recipes';

export const MAX_TOP_PICKS = 5;
const HORIZON_KEYS = ['open_now', 'coming_back', 'coming_soon'] as const;
type HorizonKey = (typeof HORIZON_KEYS)[number];

/** Company profile → the recipe-planning profile. Unknown stays absent; set-aside preferences are not carried. */
export function toAskMindyProfile(p: CompanyProfile): AskMindyProfile {
  return {
    ...(p.companyName ? { companyName: p.companyName } : {}),
    ...(p.uei ? { uei: p.uei } : {}),
    ...(p.naicsCodes ? { naicsCodes: p.naicsCodes } : {}),
    ...(p.states ? { states: p.states } : {}),
    ...(p.targetAgencies ? { agencies: p.targetAgencies } : {}),
    ...(p.keywords ? { keywords: p.keywords } : {}),
  };
}

/**
 * Company profile → the fit scorer's profile. Certifications are the Vault's self-reported ones (never set-aside
 * preferences); size-by-NAICS and PSC codes are not in the profile yet, so they stay unknown.
 */
export function toFitProfile(p: CompanyProfile, queryConcepts?: string[]): FitProfile {
  const pp = p.pastPerformance;
  return {
    ...(p.naicsCodes ? { naicsCodes: p.naicsCodes } : {}),
    // Absent (not []) when unknown or unavailable: an empty list would read as "holds none".
    ...(p.certifications ? { certifications: p.certifications.map((c) => c.name) } : {}),
    ...(p.states ? { states: p.states } : {}),
    ...(pp?.largestAward !== undefined ? { largestPastAward: pp.largestAward } : {}),
    ...(pp ? { pastPerformance: { buyerAgencies: pp.buyerAgencies, buyerOffices: pp.buyerOffices, naicsCodes: pp.naicsCodes } } : {}),
    ...(p.vehiclesHeld ? { vehiclesHeld: p.vehiclesHeld } : {}),
    ...(queryConcepts?.length ? { queryConcepts } : {}),
  };
}

export interface TopPick {
  horizon: HorizonKey;
  title: string;
  buyer: string | null;
  /** The horizon's own date label and value label, copied from the tool result (never recomputed). */
  date_label: string | null;
  value_label: string | null;
  score: number;
  /** "Matches your registered work codes and is open with time to respond." */
  why: string;
  route: FitScore['route'];
  evidence_note?: string;
}

export interface AnswerContext {
  top_picks: TopPick[];
  /** Results in the related band (40 to 59), for "show more". */
  related_count: number;
  /** Per horizon: grounded / empty / unavailable, with any coverage note. Unavailable is never zero. */
  horizons: Array<{ horizon: HorizonKey; status: string; matched_count: number | null; coverage_note?: string }>;
  /** Profile fields to show once on the profile page (never inside the answer body). */
  profile_gaps: { unknown: ProfileField[]; unavailable: ProfileField[] };
  /** Optional next step, only when the profile is empty (value first). */
  next_steps: string[];
  /** Steps the recipe could not run, with their reason (unavailable / skipped / missing tool). */
  not_checked: Array<{ step: string; state: string; reason: string }>;
}

type HorizonLike = { status?: string; items?: Array<Record<string, unknown>>; matched_count?: number | null };

/** The find_opportunities result from a Where to start run, if that step ran. */
function findResult(run: RecipeRun): { horizons?: Partial<Record<HorizonKey, HorizonLike>> } | null {
  if (run.status !== 'ran') return null;
  const open = run.results.open;
  return open && open.state === 'ok' && open.value && typeof open.value === 'object' ? (open.value as { horizons?: Partial<Record<HorizonKey, HorizonLike>> }) : null;
}

function profileIsEmpty(p: CompanyProfile): boolean {
  return !p.companyName && !p.uei && !p.naicsCodes?.length && !p.keywords?.length;
}

/** Where to start: rank every horizon's results for this company and keep the best, explained. */
export function composeWhereToStart(run: RecipeRun, profile: CompanyProfile, opts: { queryConcepts?: string[]; nowMs?: number } = {}): AnswerContext {
  const fitProfile = toFitProfile(profile, opts.queryConcepts);
  const candidates: TopPick[] = [];
  let related = 0;
  const horizons: AnswerContext['horizons'] = [];
  const result = findResult(run);

  for (const key of HORIZON_KEYS) {
    const h = result?.horizons?.[key];
    if (!h) { horizons.push({ horizon: key, status: 'unavailable', matched_count: null }); continue; }
    const status = h.status ?? 'unavailable';
    const matched = typeof h.matched_count === 'number' ? h.matched_count : null;
    if (status === 'unavailable' || !Array.isArray(h.items)) { horizons.push({ horizon: key, status: 'unavailable', matched_count: matched }); continue; }
    const w = scoreFindHorizon({ items: h.items, matched_count: matched }, fitProfile, opts.nowMs);
    horizons.push({ horizon: key, status, matched_count: matched, ...(w.coverage_note ? { coverage_note: w.coverage_note } : {}) });
    for (const { item, fit } of w.ranked) {
      if (fit.band === 'related') related++;
      if (fit.band !== 'show' || fit.score === null) continue;
      candidates.push({
        horizon: key,
        title: String(item.title ?? ''),
        buyer: typeof item.buyer === 'string' ? item.buyer : null,
        date_label: typeof item.relevant_date === 'string' ? `${item.relevant_date_label ?? 'date'}: ${item.relevant_date}` : null,
        value_label: typeof item.value_label === 'string' ? item.value_label : null,
        score: fit.score,
        why: reasonSentence(fit),
        route: fit.route,
        ...(fit.evidenceNote ? { evidence_note: fit.evidenceNote } : {}),
      });
    }
  }

  const not_checked = run.status === 'ran'
    ? run.steps.filter((s) => s.outcome.state !== 'ok').map((s) => ({ step: s.id, state: s.outcome.state, reason: (s.outcome as { reason: string }).reason }))
    : [{ step: 'recipe', state: 'not_implemented', reason: 'recipe not built' }];

  return {
    top_picks: candidates.sort((a, b) => b.score - a.score).slice(0, MAX_TOP_PICKS),
    related_count: related,
    horizons,
    profile_gaps: { unknown: profile.unknown, unavailable: profile.unavailable ?? [] },
    next_steps: profileIsEmpty(profile) ? [PROFILE_COMPLETION_STEP] : [],
    not_checked,
  };
}
