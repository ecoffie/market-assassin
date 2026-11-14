/**
 * Award-record boilerplate that leaks into naics_vocabulary.
 *
 * The vocabulary is mined from USASpending award DESCRIPTIONS, and many of those are
 * financial-transaction text, not work text ("BASE OBLIGATED AMOUNT", "AGGREGATE AMOUNT",
 * "OPTION PERIOD 2 FUNDING"). Cross-NAICS IDF does not catch them when they cluster in a
 * few codes (561320 stored "base obligated", "obligated amount", "amount", "aggregate",
 * "period"). They describe how the contract was funded, never the work a buyer is buying,
 * so a keyword list built from them misleads.
 *
 * Shared by the read path (src/lib/market/vocabulary.ts filters stored rows) and the build
 * path (scripts/build-naics-vocabulary.ts skips them at extraction), so a stored row and a
 * rebuilt row follow the same rule.
 */

/** A term containing ANY of these tokens is award-funding boilerplate. */
export const AWARD_BOILERPLATE_TOKENS = new Set([
  'obligated', 'obligation', 'obligations', 'obligate', 'obligating',
  'deobligate', 'deobligated', 'deobligation',
  'amount', 'amounts', 'aggregate',
  'funding', 'funded', 'funds', 'incremental', 'increment',
  'modification', 'modifications', 'clin', 'clins',
  'option', 'options', 'period', 'periods',
]);

/**
 * Verbs that only appear in a mined bigram because two clauses ran together
 * ("services perform", "perform warehousing"). They are already dropped as single words
 * at build time; as a bigram EDGE they make a fragment, not a phrase.
 */
export const VERB_EDGE_TOKENS = new Set([
  'perform', 'performs', 'performing', 'provide', 'provides', 'providing', 'furnish', 'furnishes',
]);

/** True when a vocabulary term is award-record boilerplate or a clause-crossing fragment. */
export function isBoilerplateVocabTerm(term: string): boolean {
  const toks = String(term || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (toks.length === 0) return true;
  if (toks.some((t) => AWARD_BOILERPLATE_TOKENS.has(t))) return true;
  if (toks.length > 1 && (VERB_EDGE_TOKENS.has(toks[0]) || VERB_EDGE_TOKENS.has(toks[toks.length - 1]))) return true;
  return false;
}
