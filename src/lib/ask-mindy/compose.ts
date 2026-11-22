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

export type HorizonLike = { status?: string; items?: Array<Record<string, unknown>>; matched_count?: number | null };

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
  const ranked = rankFindResult(findResult(run), profile, opts);
  const not_checked = run.status === 'ran'
    ? run.steps.filter((s) => s.outcome.state !== 'ok').map((s) => ({ step: s.id, state: s.outcome.state, reason: (s.outcome as { reason: string }).reason }))
    : [{ step: 'recipe', state: 'not_implemented', reason: 'recipe not built' }];
  return { ...ranked, not_checked };
}

/**
 * Ranks a find_opportunities result (as the chat route already holds it) for this company. The chat wiring
 * calls this directly; composeWhereToStart calls it for a recipe run.
 */
export function rankFindResult(
  result: { horizons?: Partial<Record<HorizonKey, HorizonLike>> } | null,
  profile: CompanyProfile,
  opts: { queryConcepts?: string[]; nowMs?: number } = {},
): Omit<AnswerContext, 'not_checked'> {
  const fitProfile = toFitProfile(profile, opts.queryConcepts);
  const candidates: TopPick[] = [];
  let related = 0;
  const horizons: AnswerContext['horizons'] = [];

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

  return {
    top_picks: candidates.sort((a, b) => b.score - a.score).slice(0, MAX_TOP_PICKS),
    related_count: related,
    horizons,
    profile_gaps: { unknown: profile.unknown, unavailable: profile.unavailable ?? [] },
    next_steps: profileIsEmpty(profile) ? [PROFILE_COMPLETION_STEP] : [],
  };
}

const HORIZON_WORDS: Readonly<Record<HorizonKey, string>> = { open_now: 'Open now', coming_back: 'Coming back', coming_soon: 'Coming soon (forecast)' };

/**
 * The answer-prompt note for a ranked find result, or null when there is nothing to rank. It orders and explains;
 * it never adds a fact the tool result does not hold, and it never prints a score.
 */
export function fitRankingNote(ctx: Omit<AnswerContext, 'not_checked'>): string | null {
  const unavailable = ctx.horizons.filter((h) => h.status === 'unavailable').map((h) => HORIZON_WORDS[h.horizon]);
  const notes = ctx.horizons.filter((h) => h.coverage_note).map((h) => `${HORIZON_WORDS[h.horizon]}: ${h.coverage_note}`);
  if (!ctx.top_picks.length && !ctx.related_count && !unavailable.length) return null;
  const lines = [
    'FIT RANKING (computed for this company by Mindy\'s shared fit scorer from the find_opportunities result above; use it, do not re-rank):',
    ctx.top_picks.length
      ? 'TOP PICKS, best first. Present these as the top picks in this order, each with its "why" in plain words. Never print a score.'
      : 'No result cleared the fit threshold for this company. Say so plainly; do not present weaker results as top picks.',
    ...ctx.top_picks.map((p, i) => `${i + 1}. ${p.title}${p.buyer ? `, ${p.buyer}` : ''} [${HORIZON_WORDS[p.horizon]}${p.date_label ? `; ${p.date_label}` : ''}${p.value_label ? `; ${p.value_label}` : ''}]. Why: ${p.why}${p.route === 'subcontract' ? ' (Subcontract route: do not present this as work the company can bid as prime.)' : ''}${p.evidence_note ? ` Note: ${p.evidence_note}.` : ''}`),
    ...(ctx.related_count ? [`${ctx.related_count} more result(s) are related but a weaker fit: mention they exist and offer to show them; do not list them.`] : []),
    ...(unavailable.length ? [`Could not be checked this turn (unavailable, not zero): ${unavailable.join(', ')}.`] : []),
    ...notes,
    ...(ctx.next_steps.length ? [`Optional next step to offer at the end (never before the answer): ${ctx.next_steps.join('; ')}.`] : []),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Profile Setup: readiness checklist (spec section 5, recipe 2: "contacts, SBA keywords, service codes, website").

export type ReadinessStatus = 'ok' | 'missing' | 'unknown' | 'unavailable';
export interface ReadinessItem {
  item: 'sam_registration' | 'naics_codes' | 'service_codes' | 'points_of_contact' | 'past_performance' | 'derived_keywords' | 'sba_profile' | 'website';
  status: ReadinessStatus;
  /** Plain words, from the record (dates and counts copied, never computed beyond counting). */
  detail: string;
}

type SamEntityLike = {
  registrationStatus?: string; registrationExpirationDate?: string; daysUntilExpiration?: number;
  naicsList?: unknown[]; pscList?: unknown[]; pointsOfContact?: unknown[];
};

const stepOf = (run: RecipeRun, id: string) => (run.status === 'ran' ? run.results[id] : undefined);

/** Profile Setup: what is in place, missing, unknown or unavailable. Nothing is guessed. */
export function composeProfileSetup(run: RecipeRun): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const sam = stepOf(run, 'sam');
  const samValue = sam?.state === 'ok' ? (sam.value as { entity?: SamEntityLike | null; _meta?: { lookup_status?: string; points_of_contact_as_of?: string | null } }) : null;
  const entity = samValue?.entity ?? null;
  const lookup = samValue?._meta?.lookup_status;

  if (!sam || sam.state === 'skipped') items.push({ item: 'sam_registration', status: 'unknown', detail: 'No UEI or company name to look up yet.' });
  else if (sam.state !== 'ok' || lookup === 'lookup_failed') items.push({ item: 'sam_registration', status: 'unavailable', detail: 'SAM.gov lookup could not be completed; this is not a finding that the company is unregistered.' });
  else if (!entity) items.push({ item: 'sam_registration', status: lookup === 'not_found' ? 'missing' : 'unknown', detail: lookup === 'not_found' ? 'No SAM.gov registration found for this UEI or name.' : 'Several or no exact matches; the registration was not identified.' });
  else {
    const active = entity.registrationStatus === 'Active';
    const exp = entity.registrationExpirationDate ? ` until ${entity.registrationExpirationDate}` : '';
    const soon = typeof entity.daysUntilExpiration === 'number' && entity.daysUntilExpiration <= 60 ? ` Renew soon: ${entity.daysUntilExpiration} days left.` : '';
    items.push({ item: 'sam_registration', status: active ? 'ok' : 'missing', detail: active ? `Active${exp}.${soon}` : `Registration is ${entity.registrationStatus ?? 'not active'}.` });
  }

  const listItem = (item: ReadinessItem['item'], list: unknown[] | undefined, what: string) => {
    if (!entity) items.push({ item, status: 'unknown', detail: `${what}: needs the SAM.gov registration first.` });
    else if (list?.length) items.push({ item, status: 'ok', detail: `${list.length} ${what} registered.` });
    else items.push({ item, status: 'missing', detail: `No ${what} on the SAM.gov registration.` });
  };
  listItem('naics_codes', entity?.naicsList, 'NAICS codes');
  listItem('service_codes', entity?.pscList, 'service codes (PSC)');
  listItem('points_of_contact', entity?.pointsOfContact, 'points of contact');

  const awards = stepOf(run, 'awards');
  items.push(!awards || awards.state === 'skipped'
    ? { item: 'past_performance', status: 'unknown', detail: 'Company not identified, so award history was not checked.' }
    : awards.state === 'ok'
      ? { item: 'past_performance', status: 'ok', detail: 'Federal award history retrieved (prime and subcontract shown separately in the answer).' }
      : { item: 'past_performance', status: 'unavailable', detail: 'Award history could not be retrieved; not a finding of no past performance.' });

  const kw = stepOf(run, 'keywords');
  items.push(kw?.state === 'ok'
    ? { item: 'derived_keywords', status: 'ok', detail: 'Search keywords derived from the registration and codes.' }
    : { item: 'derived_keywords', status: kw && kw.state !== 'skipped' ? 'unavailable' : 'unknown', detail: 'Search keywords not derived yet.' });

  const sba = stepOf(run, 'sba_profile');
  const sbaFields = sba && sba.state === 'missing_tool' ? (sba as { unknownFields?: string[] }).unknownFields ?? [] : [];
  items.push({ item: 'sba_profile', status: 'unavailable', detail: `SBA profile lookup is not available yet${sbaFields.length ? `; unknown until then: ${sbaFields.join(', ').replace(/_/g, ' ')}` : ''}.` });

  items.push({ item: 'website', status: 'unknown', detail: 'No tool returns the company website yet; add it on the profile page.' });
  return items;
}
