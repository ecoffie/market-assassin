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
 * `profileFirst` reports the spec rule "if a user has no profile, the first recipe is Profile Setup". It is
 * reported, not applied: the existing first-turn contract (Potato P2, value before qualification) says the
 * opposite for FIND questions, so which one wins is a product decision for whoever wires this in.
 */
import { isNoticeUuid, isSolicitationIdentifier } from '@/lib/sam/resolve-solicitation';
import { RECIPE_IDS, RECIPES, type AskMindyProfile, type RecipeContext, type RecipeId } from './recipes';

export interface IntentResult {
  primary: RecipeId;
  secondary: RecipeId | null;
  /** 'rule' = deterministic shortcut; 'model' = classified by meaning; 'fallback' = model failed or was invalid. */
  via: 'rule' | 'model' | 'fallback';
  identifiers: NonNullable<RecipeContext['identifiers']>;
  /** True when the spec would run Profile Setup first because the profile is empty. Not applied here. */
  profileFirst: boolean;
}

/** The model call. Returns raw JSON text: {"primary":"<recipe id>","secondary":"<recipe id>|null"}. */
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
  const profileFirst = profileIsEmpty(profile);
  const lone = q.split(/\s+/).length === 1 ? q.replace(/[.,;:!?]+$/, '') : null;

  if (lone) {
    if (isNoticeUuid(lone)) return { primary: 'opportunity_deep_dive', secondary: null, via: 'rule', identifiers, profileFirst };
    if (URL_RE.test(lone) && identifiers.url) return { primary: 'profile_setup', secondary: null, via: 'rule', identifiers, profileFirst };
    if (isSolicitationIdentifier(lone) && !UEI_SHAPE.test(lone)) {
      return { primary: 'opportunity_deep_dive', secondary: null, via: 'rule', identifiers, profileFirst };
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
    return { primary: parsed.primary, secondary, via: 'model', identifiers, profileFirst };
  } catch {
    return { primary: 'general_research', secondary: null, via: 'fallback', identifiers, profileFirst };
  }
}
