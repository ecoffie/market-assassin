/**
 * Category caveats for the answer model (Agent 4 scorecard 2026-11-16, C2).
 *
 * "I run a small janitorial company in Florida. Which agencies should I target first?" was answered with a
 * ranking whose biggest Florida dollars were AbilityOne awards (Global Connections, Brevard), with no warning
 * that those requirements are mandatory-source and not open to a small business. Claude + the Mindy MCP flagged
 * it. Janitorial/custodial is one of the AbilityOne Program's core service categories, so the caveat is grounded
 * by the CATEGORY of the work the customer named in THIS message, not added to every turn.
 *
 * The note states only the program rule (FAR subpart 8.7: items on the AbilityOne Procurement List must be
 * bought from the designated nonprofit agency). It never says a particular requirement is on the list; that is
 * shown only by a record (a "Not competed · AbilityOne" Coming back row from competition-facts.ts).
 */

/** Janitorial services (NAICS 561720). Kept narrow on purpose: add a category only with the same grounding. */
const ABILITYONE_CORE_NAICS = new Set(['561720']);
const ABILITYONE_CORE_WORDS = /\b(janitorial|janitor|janitors|custodial|custodian|custodians)\b/i;

export const ABILITYONE_CAVEAT_NOTE = [
  'CATEGORY NOTE: janitorial/custodial work is a core AbilityOne Program category.',
  'When this answer recommends janitorial targets, agencies or opportunities, add ONE short caveat (one or two sentences, after the answer, not before it):',
  'requirements on the AbilityOne Procurement List are mandatory-source under FAR subpart 8.7, so the agency must buy them from the designated nonprofit agency and a small business cannot compete for them;',
  'before pursuing a target, check whether its requirement is on the Procurement List (abilityone.gov). A Coming back row labelled "Not competed · AbilityOne" is one; treat such rows as not open to the customer and do not lead with them.',
  'Never say a specific requirement or office is on the list unless a result shows it. If you already gave this caveat earlier in the conversation, do not repeat it.',
].join(' ');

/**
 * The AbilityOne note when the customer's own words in this message name janitorial work (by word or by its
 * NAICS code), else null.
 * @param customerText the customer's words for this turn (map view preamble removed)
 * @param codes NAICS codes interpreted from those words
 */
export function abilityOneCaveat(customerText: string, codes: readonly string[] = []): string | null {
  if (codes.some((c) => ABILITYONE_CORE_NAICS.has(String(c).trim()))) return ABILITYONE_CAVEAT_NOTE;
  if (ABILITYONE_CORE_WORDS.test(String(customerText || ''))) return ABILITYONE_CAVEAT_NOTE;
  return null;
}
