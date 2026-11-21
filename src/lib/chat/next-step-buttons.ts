/**
 * Next-step buttons written from the answer (Ask Mindy Backend Spec, Nov 21 2026, section 8 and flow step 7).
 *
 * Used by generateFollowups ONLY when the Ask Mindy rules layer is on for the caller (ASK_MINDY_RULES_LAYER,
 * see ask-mindy-rules.ts). Off → the existing follow-up prompt and filtering, byte-identical.
 *
 * Two parts:
 *   - NEXT_STEP_SYSTEM_PROMPT: the spec's pattern (each button names a specific item from the answer).
 *   - isGroundedNextStep: a deterministic check the model output must pass. A button survives only when it
 *     names something the answer itself contains (a pick number, an ID, a date, or a proper name that is not
 *     just a generic agency word), and never sends the user to another website or asks chat to save/track.
 * Fewer than three buttons is acceptable; padding with a generic button is not.
 */

export const NEXT_STEP_SYSTEM_PROMPT = [
  'You write the three next-step buttons shown under Mindy\'s answer to a federal contracting user.',
  'Each button is a short request the user can click to send back to Mindy (max about 12 words).',
  'Each button MUST name one specific item from the answer: a numbered pick ("pick #1"), a contract or solicitation title, a solicitation or award number, a named office or person, or an event with its date.',
  'Good: "Build my plan for the Army small business day on December 9". "Who holds the Access Road Repair contract now, and do they subcontract?". "Draft a capability email to the contracting officer for pick #1".',
  'Bad (never write these): "Find open opportunities at Department of Defense". "Who is the incumbent?" with no item named. Anything that would fit any answer.',
  'Mindy can look up contacts, solicitations, incumbents, spending, pricing, draft emails and evaluate bids. Mindy cannot save, track or add anything to a pipeline or list, and cannot browse other websites. Never suggest those, and never send the user to SAM.gov or any other site.',
  'Copy names, numbers and dates exactly as the answer writes them. Never invent an item the answer does not contain.',
  'Return STRICT JSON: {"suggestions":["...","...","..."]}. Exactly 3 if the answer names enough items, fewer otherwise. No numbering. No em dashes.',
].join('\n');

/** Sends the user elsewhere, or asks chat to write state it cannot write. */
const OFF_PLATFORM = /\b(sam\.gov|usaspending(\.gov)?|grants\.gov|website|web site|portal|google|linkedin|visit|go to|log ?in|browse)\b/i;
const WRITE_ASK = /\b(save|track|bookmark|watchlist|add (it|this|them|.{0,30}) to (my |the )?(pipeline|list|crm))\b/i;

/**
 * Capitalized words that name a kind of thing rather than a specific item. An answer-matched word from this
 * list does not ground a button on its own ("Find open opportunities at Department of Defense").
 */
const GENERIC_WORDS = new Set([
  'department', 'defense', 'army', 'navy', 'air', 'force', 'marine', 'corps', 'coast', 'guard', 'agency', 'administration',
  'federal', 'government', 'office', 'offices', 'small', 'business', 'contract', 'contracts', 'contracting', 'officer',
  'opportunity', 'opportunities', 'solicitation', 'solicitations', 'award', 'awards', 'incumbent', 'prime', 'primes',
  'draft', 'email', 'find', 'show', 'list', 'build', 'plan', 'tell', 'what', 'which', 'when', 'where', 'does', 'they',
  'this', 'that', 'with', 'from', 'about', 'more', 'open', 'next', 'move', 'pick', 'picks', 'veterans', 'affairs',
  'health', 'human', 'services', 'homeland', 'security', 'general', 'national', 'united', 'states', 'program',
  'gsa', 'dod', 'va', 'dhs', 'hhs', 'naics', 'psc', 'rfp', 'rfq', 'rfi', 'idiq', 'bpa', 'gwac',
]);

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sept?\\.?|Oct\\.?|Nov\\.?|Dec\\.?';
const DATE_RE = new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}\\b`, 'g');
/** Solicitation / award / UEI-like identifiers: 6+ characters mixing letters and digits. */
const ID_RE = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{5,}\b/g;
const PICK_RE = /\bpick\s*#?\s*(\d)\b/i;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Numbered picks the answer actually shows ("1. Title, Buyer ..." lines). */
function pickNumbers(answer: string): Set<string> {
  const out = new Set<string>();
  for (const m of answer.matchAll(/^\s*(\d)[.)]\s+\S/gm)) out.add(m[1]);
  return out;
}

/** Is this button grounded in the answer and allowed? */
export function isGroundedNextStep(suggestion: string, answer: string): boolean {
  const s = norm(suggestion);
  if (!s || OFF_PLATFORM.test(s) || WRITE_ASK.test(s)) return false;

  const pick = s.match(PICK_RE);
  if (pick) return pickNumbers(answer).has(pick[1]);

  for (const id of s.toUpperCase().match(ID_RE) ?? []) if (answer.toUpperCase().includes(id)) return true;
  for (const d of s.match(DATE_RE) ?? []) if (norm(answer).includes(d)) return true;

  // A proper name from the answer: a capitalized word of 4+ letters that is not a generic word and appears,
  // capitalized, in the answer.
  for (const w of s.match(/\b[A-Z][A-Za-z&'-]{3,}\b/g) ?? []) {
    if (GENERIC_WORDS.has(w.toLowerCase())) continue;
    if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(answer)) return true;
  }
  return false;
}

/** Keep only grounded, allowed buttons, first three, no duplicates. */
export function filterNextSteps(suggestions: string[], answer: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of suggestions) {
    const s = norm(raw);
    const key = s.toLowerCase();
    if (seen.has(key) || !isGroundedNextStep(s, answer)) continue;
    seen.add(key);
    out.push(s);
    if (out.length === 3) break;
  }
  return out;
}
