/**
 * Ask Mindy intent classification (spec flow step 2 and the routing rule in section 5): classify on MEANING,
 * not keywords. When two recipes fit, the primary is the one whose output answers the literal question and
 * the other is returned as `secondary`, for a next-step button.
 *
 * Deterministic only where the message carries no other meaning: a message that is nothing but one notice id,
 * solicitation number or website URL. A lone 12-character token is ambiguous (UEI or solicitation number), so
 * it goes to the model with a hint instead of being guessed. Everything else is classified by an injected
 * model call (`classify`), and its answer is validated: an unknown recipe or a failure falls back to
 * general_research, as the spec says.
 *
 * Value first (Eric, 2026-11-21): an empty profile NEVER blocks, replaces or reorders the first answer. It only
 * sets `offerProfileCompletion`, which a caller may turn into one optional next step (PROFILE_COMPLETION_STEP).
 * The spec's "no profile, run Profile Setup first" rule is superseded by Potato P2 (value before qualification).
 */
import { isNoticeUuid, isSolicitationIdentifier } from '@/lib/sam/resolve-solicitation';
import { RECIPE_IDS, RECIPES, type AskMindyProfile, type RecipeContext, type RecipeId } from './recipes';

export interface IntentResult {
  primary: RecipeId;
  secondary: RecipeId | null;
  /** 'rule' = deterministic shortcut; 'model' = classified by meaning; 'fallback' = model failed or was invalid. */
  via: 'rule' | 'model' | 'fallback';
  identifiers: NonNullable<RecipeContext['identifiers']>;
  /** The profile is empty: a caller may add PROFILE_COMPLETION_STEP as an optional next step. Never changes `primary`. */
  offerProfileCompletion: boolean;
}

/** The model call. Returns raw JSON text: {"primary":"<recipe id>","secondary":"<recipe id>|null"}. */
/** The only thing an empty profile adds: one optional next step after the answer. */
export const PROFILE_COMPLETION_STEP = 'Complete your company profile for better ranking';

export type IntentModel = (system: string, user: string) => Promise<string>;

const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;
const UEI_SHAPE = /^[A-Z0-9]{12}$/;

export function profileIsEmpty(p: AskMindyProfile): boolean {
  return !p.companyName && !p.uei && !p.naicsCodes?.length && !p.keywords?.length;
}

/** Identifiers mentioned anywhere in the question (hints for recipes; never a classification on their own). */
export function extractIdentifiers(question: string): IntentResult['identifiers'] {
  const out: IntentResult['identifiers'] = {};
  for (const raw of question.split(/\s+/)) {
    const t = raw.replace(/^[("'[]+|[)"'\].,;:!?]+$/g, '');
    if (!t) continue;
    if (!out.noticeId && isNoticeUuid(t)) out.noticeId = t;
    else if (!out.url && URL_RE.test(t) && /\.[a-z]{2,}/i.test(t) && !/^\d/.test(t)) out.url = t;
    else if (!out.uei && UEI_SHAPE.test(t)) out.uei = t; // may also be a solicitation number; the model decides
    else if (!out.solicitation && isSolicitationIdentifier(t)) out.solicitation = t;
  }
  return out;
}

export function buildIntentPrompt(): string {
  const lines = RECIPE_IDS.map((id) => `- ${id}: ${RECIPES[id].name}. Examples: ${RECIPES[id].examples.join(' / ')}`);
  return [
    'Classify a federal contracting customer\'s question into the Ask Mindy recipe whose output answers it.',
    'Classify by what the customer wants to get, not by which words appear.',
    'If two recipes fit, primary is the one that answers the literal question; secondary is the other. Otherwise secondary is null.',
    'If nothing fits, primary is general_research.',
    'Recipes:',
    ...lines,
    'Return STRICT JSON only: {"primary":"<recipe id>","secondary":"<recipe id>"|null}',
  ].join('\n');
}

function valid(id: unknown): id is RecipeId {
  return typeof id === 'string' && (RECIPE_IDS as readonly string[]).includes(id);
}

export async function classifyIntent(question: string, profile: AskMindyProfile, model: IntentModel): Promise<IntentResult> {
  const q = question.trim();
  const identifiers = extractIdentifiers(q);
  const offerProfileCompletion = profileIsEmpty(profile);
  const lone = q.split(/\s+/).length === 1 ? q.replace(/[.,;:!?]+$/, '') : null;

  if (lone) {
    if (isNoticeUuid(lone)) return { primary: 'opportunity_deep_dive', secondary: null, via: 'rule', identifiers, offerProfileCompletion };
    if (URL_RE.test(lone) && identifiers.url) return { primary: 'profile_setup', secondary: null, via: 'rule', identifiers, offerProfileCompletion };
    if (isSolicitationIdentifier(lone) && !UEI_SHAPE.test(lone)) {
      return { primary: 'opportunity_deep_dive', secondary: null, via: 'rule', identifiers, offerProfileCompletion };
    }
  }

  const hints = Object.entries(identifiers).map(([k, v]) => `${k}=${v}`).join(', ');
  const user = [
    `Question: """${q.slice(0, 800)}"""`,
    hints ? `Identifiers seen (a 12-character token may be a UEI or a solicitation number): ${hints}` : '',
  ].filter(Boolean).join('\n');
  try {
    const parsed = JSON.parse(await model(buildIntentPrompt(), user)) as { primary?: unknown; secondary?: unknown };
    if (!valid(parsed.primary)) throw new Error('invalid primary');
    const secondary = valid(parsed.secondary) && parsed.secondary !== parsed.primary ? parsed.secondary : null;
    return { primary: parsed.primary, secondary, via: 'model', identifiers, offerProfileCompletion };
  } catch {
    return { primary: 'general_research', secondary: null, via: 'fallback', identifiers, offerProfileCompletion };
  }
}
