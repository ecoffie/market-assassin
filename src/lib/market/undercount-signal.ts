/**
 * Does this keyword UNDERCOUNT its own market?
 *
 * THE PROBLEM
 * A literal keyword only finds awards whose text says the word. For most markets
 * that is fine — a roofing contract says "roofing". But for a term of art, the
 * surrounding work is bought under other words entirely: hypersonics is bought as
 * scramjet propulsion, boost-glide bodies and named programs (CPS/LRHW), none of
 * which contain "hypersonic". Reporting the literal total as THE market silently
 * undercounts, and the report has no way to say so.
 *
 * Curated TERM_OF_ART_EXPANSIONS fix this per market — but only for markets someone
 * has curated. Measured 2026-08-15 against real user searches: 4 of 18 distinct
 * keywords (22%) had an expansion. Hand-curation cannot be the only answer.
 *
 * THE SIGNAL
 * We already have per-NAICS TF-IDF vocabulary (the terms that distinguish a code,
 * built from real award text). Ask it one question:
 *
 *   Does the vocabulary of this market's own lead code contain the keyword?
 *
 *   YES → contracts in this market SAY the word. The literal total is honest.
 *         (roofing → 238160 vocab has "roofing"; security guard → 561612 has 9 hits)
 *   NO  → the market is bought under DIFFERENT words. The literal total is a floor,
 *         not the market. (quantum → 541511 vocab is "battle management",
 *         "control battle", "operations maintenance" — zero quantum terms)
 *
 * This does not invent a bigger number. It tells the report — and the reader —
 * that the number is a floor, and names the vocabulary the market actually uses so
 * a human can curate a real expansion. Honest gap over invented precision.
 */
import { getVocabularyForCodes, type VocabTerm } from './vocabulary';
import { termOfArtSynonyms } from './sector-expansions';

export interface UndercountSignal {
  /** True when the market's own vocabulary does NOT contain the keyword. */
  undercounts: boolean;
  /** A curated expansion already covers this term — no signal needed. */
  hasCuratedExpansion: boolean;
  /** Vocabulary terms matching the keyword (empty is the undercount case). */
  matchedTerms: string[];
  /**
   * The code's most distinctive terms — what buyers ACTUALLY write. This is the
   * curation shortlist when undercounts is true.
   */
  marketVocabulary: string[];
  /** The lead NAICS whose vocabulary was consulted. */
  leadCode: string | null;
}

const EMPTY: UndercountSignal = {
  undercounts: false, hasCuratedExpansion: false, matchedTerms: [], marketVocabulary: [], leadCode: null,
};

/** Loose stem so "antennas" matches "antenna" and "roofing" matches "roof repair". */
function stems(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/(ing|es|s)$/, ''))
    .filter((w) => w.length >= 4);
}

export async function detectUndercount(
  keyword: string,
  leadNaics: string | null | undefined,
): Promise<UndercountSignal> {
  const kw = (keyword || '').trim();
  if (!kw || !leadNaics) return EMPTY;

  // A curated expansion already answers this — don't second-guess it.
  if (termOfArtSynonyms(kw)?.length) {
    return { ...EMPTY, hasCuratedExpansion: true, leadCode: leadNaics };
  }

  let vocab: VocabTerm[] = [];
  try {
    vocab = await getVocabularyForCodes([leadNaics], { codeType: 'naics', limit: 60 });
  } catch {
    return EMPTY; // no vocabulary → no claim. Silence beats a wrong signal.
  }
  if (!vocab.length) return EMPTY;

  const st = stems(kw);
  if (!st.length) return EMPTY;
  const matched = vocab
    .filter((v) => st.some((s) => String(v.term).toLowerCase().includes(s)))
    .map((v) => v.term);

  return {
    undercounts: matched.length === 0,
    hasCuratedExpansion: false,
    matchedTerms: matched.slice(0, 8),
    marketVocabulary: vocab.slice(0, 12).map((v) => v.term),
    leadCode: leadNaics,
  };
}
