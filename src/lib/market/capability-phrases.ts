/**
 * Capability phrases extracted from a company's OWN words.
 *
 * Ranking a bag of loose keywords cannot produce "courier services" or "civil
 * construction" — those are phrases in the source text that keyword extraction
 * shreds into unigrams. This reads the description directly and emits head-anchored
 * capability phrases, so the anchor is something the company actually said.
 *
 * Each bonus below is a general writing signal, not a per-company rule:
 *   focus clause  — "we specialize in X" names the capability outright
 *   definitional  — "<Company> is a X" is the self-definition sentence
 *   literal       — the exact phrase appears in the text, not assembled from conjuncts
 *   repetition    — the capability the company keeps returning to
 *   list primacy  — writers lead a list with their main line of business
 *
 * ⚠️ A bonus only ORDERS phrases that already passed `scoreAnchorPhrase`. It can never
 * rescue a rejected one, and it never asserts a market — grounding does that.
 */

/** Nouns that make a phrase a buyable capability rather than a description. */
export const CAPABILITY_HEADS = new Set([
  'services', 'service', 'management', 'maintenance', 'modernization', 'construction',
  'engineering', 'staffing', 'support', 'consulting', 'training', 'design', 'integration',
  'operations', 'logistics', 'security', 'development', 'assessment', 'assessments',
  'review', 'monitoring', 'analytics', 'specialists', 'transportation', 'delivery',
  'therapy', 'testing', 'compliance', 'warehousing', 'strategy', 'transformation',
  'systems', 'solutions', 'contractor', 'contracting', 'installation', 'repair',
  'remediation', 'research', 'evaluation', 'counseling', 'psychotherapy', 'augmentation',
  'reinforcement', 'placement', 'program', 'programs', 'platform', 'platforms',
  'network', 'networks', 'cybersecurity',
]);

/**
 * Single-word heads that ARE the capability (not packaging). "Undergrid Networks is a …"
 * must emit "networks" even though the modifier is the company name and gets stripped.
 */
export const PRODUCT_UNIGRAM_HEADS = new Set([
  'networks', 'network', 'cybersecurity', 'construction', 'engineering', 'staffing',
  'logistics', 'maintenance', 'warehousing', 'telecommunications',
]);

/** Heads carrying little specificity — a phrase ending here ranks below a concrete head. */
const WEAK_HEADS = new Set(['support', 'systems', 'contractor', 'contracting']);

/** Heads that are pure packaging: "logistics solutions" says nothing "logistics" doesn't. */
const EMPTY_HEADS = new Set(['solutions', 'platform', 'platforms']);

/**
 * Words that end a modifier run: pronouns, prepositions, and the verbs that introduce a list.
 * ⚠️ `it` is deliberately ABSENT — in this corpus it is overwhelmingly the IT acronym, and
 * breaking on it lost "managed IT services" entirely, leaving only the packaging phrase
 * "services solutions" as GCubed's anchor.
 */
const RUN_BREAKERS = new Set([
  'we', 'our', 'us', 'they', 'their', 'its', 'this', 'these', 'those', 'who', 'which',
  'that', 'is', 'are', 'was', 'were', 'be', 'been', 'a', 'an', 'the', 'of', 'in', 'on', 'for',
  'to', 'with', 'by', 'from', 'at', 'as', 'across', 'through', 'into', 'than', 'also', 'both',
  'provides', 'provide', 'providing', 'provided', 'delivers', 'deliver', 'delivering',
  'offers', 'offer', 'offering', 'includes', 'include', 'including', 'included',
  'specializes', 'specialize', 'specializing', 'focuses', 'focus', 'focused',
  'serves', 'serve', 'serving', 'helps', 'help', 'helping', 'combines', 'combine',
  'builds', 'build', 'brings', 'bring', 'span', 'spans', 'enable', 'enables', 'enabling',
  'supporting', 'committed', 'dedicated', 'known', 'founded', 'headquartered', 'located',
  'ensuring', 'ensure', 'assisting', 'assist', 'navigating', 'meeting', 'achieving',
  'driving', 'leveraging', 'employing', 'implementing', 'maintaining', 'protecting',
  'enhance', 'enhancing', 'improve', 'improving', 'increase', 'strengthen', 'create',
  'creating', 'expand', 'solve', 'solving', 'transform', 'modernize', 'designs',
  'manages', 'modernizes', 'operating', 'requiring', 'seeking', 'work', 'works',
  'sustain', 'scale', 'secure', 'partner', 'collaborate', 'consult',
]);

/** Marketing adjectives and non-capability nouns stripped from the front of a modifier. */
const LEADING_FILLER = new Set([
  'high-quality', 'high', 'quality', 'dependable', 'innovative', 'customized', 'custom',
  'tailored', 'proven', 'trusted', 'comprehensive', 'integrated', 'scalable', 'secure',
  'professional', 'advanced', 'reliable', 'best', 'exceptional', 'responsive', 'general',
  'complete', 'full', 'total', 'various', 'other', 'related', 'several', 'many', 'core',
  'key', 'critical', 'complex', 'measurable', 'sustainable', 'effective', 'strategic',
  'leading', 'award-winning', 'world-class', 'end-to-end', 'turnkey', 'cutting-edge',
  'one', 'two', 'three', 'four', 'five', 'six', 'top-tier', 'long', 'term', 'unique',
  'clients', 'client', 'customers', 'customer', 'organizations', 'organization',
  'agencies', 'agency', 'partners', 'people', 'businesses', 'communities', 'teams',
  'distinguished', 'expert', 'family', 'operated', 'certified', 'trusted', 'highly',
]);

const SEPARATORS = new Set([',', ';', '&', 'and', 'or', '/']);

/** A company naming its capability outright — the strongest statement of what it sells. */
const STRONG_FOCUS =
  /\b(?:specializ(?:es?|ing) in|focus(?:es|ed)? on|core (?:services|areas|capabilities|competencies)|service areas(?: include| are)?)\b/gi;

/** "<Company> is a …" / "We are a …" — the self-definition sentence. */
const DEFINITIONAL = /\b(?:we are an?|is an?|are an?)\s/gi;

/** Ordinary enumeration of offerings. */
const NORMAL_FOCUS =
  /\b(?:provides?|providing|offers?|offering|delivers?|delivering|services include|capabilities include|what we do)\b/gi;

/**
 * A mission/vision sentence lists the MARKETS a company wants to improve, not the
 * capabilities it sells — "our mission is to … improve productivity, education,
 * healthcare, manufacturing, and public services" made "healthcare services" outrank
 * Space Continuum's actual workforce-development line. It still gets read (a mission
 * sentence can name a real capability), just at plain weight.
 */
const MISSION_SENTENCE =
  /^\W*(?:our|the company['\u2019]?s|its)\s+(?:mission|vision|values|purpose|goal|commitment|passion)\b/i;

/**
 * A named asset says more than the umbrella category it sits under ("a Facilities
 * Management Company … we focus on elevators"). These map the asset to the capability
 * actually bought around it. Curated and deliberately tiny — same precedent as
 * `termOfArtSynonyms`; extend only with a real cohort case.
 */
const ASSET_TO_CAPABILITY: Record<string, string> = {
  elevator: 'elevator maintenance',
  elevators: 'elevator maintenance',
  escalator: 'elevator maintenance',
  escalators: 'elevator maintenance',
  hvac: 'hvac services',
  janitorial: 'janitorial services',
};

/**
 * Self-descriptions that federal buyers purchase under a different canonical phrase.
 * "energy solutions provider" is bought as engineering services (541330) — the same
 * class of mapping as elevator → elevator maintenance, not a per-company override.
 */
const PHRASE_CANONICAL: Record<string, string> = {
  'energy solutions': 'engineering services',
  'it energy solutions': 'engineering services',
};

const BONUS = {
  strongFocus: 100,
  definitional: 92,
  normalFocus: 85,
  plain: 40,
  weakHeadPenalty: 25,
  emptyHeadPenalty: 40,
  literal: 15,
  perRepeat: 10,
  maxRepeats: 3,
  listPrimacy: 5,
  specializationOverUmbrella: 30,
  /**
   * Product noun immediately before the copula ("Undergrid Networks is a …").
   * Has to outrank a 3-word services-list item without promoting every domain
   * unigram in a definitional sentence ("… Contractor with engineering …").
   */
  definitionalProduct: 60,
} as const;

export interface ExtractedPhrase {
  phrase: string;
  /** Added to the anchor score — provenance strength, not a quality judgement. */
  bonus: number;
  source: 'focus' | 'specialization' | 'head';
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[()"'\u2018\u2019\u201c\u201d]/g, ' ')
    .replace(/([,;:/])/g, ' $1 ')
    .split(/\s+/)
    .map((t) => t.replace(/[.!?]+$/, ''))
    .filter(Boolean);
}

function isModifierWord(tok: string): boolean {
  if (SEPARATORS.has(tok) || RUN_BREAKERS.has(tok)) return false;
  return /^[a-z][a-z-]{1,}$/.test(tok);
}

function stripLeadingFiller(words: string[]): string[] {
  let i = 0;
  while (i < words.length && LEADING_FILLER.has(words[i])) i++;
  return words.slice(i);
}

/**
 * Walk backwards from a head noun collecting the modifiers that attach to it, splitting
 * on conjunctions so "administrative, human resources, and investigative support
 * services" yields each conjunct rather than one run-on phrase. Returned in reverse
 * document order, so the last element is the first-listed conjunct.
 */
function modifiersBeforeHead(tokens: string[], headIndex: number): string[] {
  const parts: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const cleaned = stripLeadingFiller(buf);
    if (cleaned.length && cleaned.length <= 3) parts.push(cleaned.join(' '));
    buf = [];
  };

  for (let k = headIndex - 1; k >= 0 && parts.length < 5; k--) {
    const tok = tokens[k];
    if (SEPARATORS.has(tok)) {
      flush();
      continue;
    }
    if (!isModifierWord(tok)) {
      flush();
      break;
    }
    buf.unshift(tok);
    if (buf.length >= 3) flush();
  }
  flush();
  return parts.filter(Boolean);
}

/** Character ranges covered by a clause type (marker → end of that sentence). */
function clauseRanges(text: string, re: RegExp): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const stop = text.slice(start).search(/[.\n]/);
    ranges.push([start, stop === -1 ? text.length : start + stop]);
  }
  return ranges;
}

const covers = (ranges: Array<[number, number]>, from: number, to: number) =>
  ranges.some(([s, e]) => from < e && to > s);

export function extractCapabilityPhrases(text: string): ExtractedPhrase[] {
  if (!text?.trim()) return [];

  const strong = clauseRanges(text, STRONG_FOCUS);
  const definitional = clauseRanges(text, DEFINITIONAL);
  const normal = clauseRanges(text, NORMAL_FOCUS);
  const out = new Map<string, ExtractedPhrase>();

  const add = (phrase: string, bonus: number, source: ExtractedPhrase['source']) => {
    const key = phrase.trim().toLowerCase();
    if (!key) return;
    const words = key.split(/\s+/);
    if (words.length > 4) return;
    // A repeated word means the walk stitched across a boundary it should not have —
    // a source typo ("Servicesand") produced "management servicesand cloud management".
    if (new Set(words).size !== words.length) return;
    // Infrastructure is the umbrella a network/telecom firm sits under — keep it as a
    // candidate but never let it outrank the product noun.
    const adjusted =
      /\binfrastructure\b/.test(key) && !/\b(network|telecom|cyber|water|power)\b/.test(key)
        ? bonus - 80
        : bonus;
    const canonical = PHRASE_CANONICAL[key];
    const store = (k: string, b: number) => {
      const prev = out.get(k);
      if (!prev || prev.bonus < b) out.set(k, { phrase: k, bonus: b, source });
    };
    store(key, adjusted);
    if (canonical) store(canonical, adjusted + 20);
  };

  let cursor = 0;
  for (const sentence of text.split(/(?<=[.\n])/)) {
    const offset = cursor;
    cursor += sentence.length;
    if (!sentence.trim()) continue;

    const end = offset + sentence.length;
    const isMission = MISSION_SENTENCE.test(sentence);
    const isStrong = !isMission && covers(strong, offset, end);
    const clauseBonus = isMission
      ? BONUS.plain
      : isStrong
        ? BONUS.strongFocus
        : covers(definitional, offset, end)
          ? BONUS.definitional
          : covers(normal, offset, end)
            ? BONUS.normalFocus
            : BONUS.plain;
    const named = clauseBonus > BONUS.plain;
    const tokens = tokenize(sentence);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (ASSET_TO_CAPABILITY[token]) {
        add(
          ASSET_TO_CAPABILITY[token],
          clauseBonus + (isStrong ? BONUS.specializationOverUmbrella : 0),
          'specialization',
        );
        continue;
      }
      if (!CAPABILITY_HEADS.has(token)) continue;

      // "construction specialists" / "support services": the pair is itself the phrase,
      // and it must be emitted on its own — it is often preceded by a conjunction, which
      // would otherwise suppress it as a bare list item. An empty head never pairs:
      // "services solutions" is packaging on packaging.
      const paired =
        i > 0 && CAPABILITY_HEADS.has(tokens[i - 1]) && !EMPTY_HEADS.has(token);
      const headStart = paired ? i - 1 : i;
      const headText = paired ? `${tokens[i - 1]} ${token}` : token;
      const penalty = EMPTY_HEADS.has(token)
        ? BONUS.emptyHeadPenalty
        : WEAK_HEADS.has(token)
          ? BONUS.weakHeadPenalty
          : 0;
      const base = clauseBonus - penalty;
      if (paired) add(headText, base, named ? 'focus' : 'head');
      // Bare product noun: "Undergrid Networks is a …" / "… cybersecurity …"
      // A definitional product noun is the company naming what it is, which outranks
      // a later services-list item ("predictive maintenance").
      // Bare product noun. Extra weight only when it is the name-product sitting
      // on the copula ("Networks is a …") — not every domain unigram that happens
      // to fall inside a definitional sentence.
      if (PRODUCT_UNIGRAM_HEADS.has(token)) {
        const onCopula = /^(is|are|was|were)$/.test(tokens[i + 1] ?? '');
        const extra = onCopula ? BONUS.definitionalProduct : 0;
        add(token, base + extra, named ? 'focus' : 'head');
      }

      // A head sitting directly after a separator is a LIST ITEM, not the list's head —
      // "customized staffing, management, and training solutions" must not yield
      // "staffing management".
      if (SEPARATORS.has(tokens[headStart - 1] ?? '')) continue;

      // A head FOLLOWED by a separator is itself an item in a longer list, so the
      // conjuncts before it are siblings, not shared modifiers: "instructional design,
      // technical writing, data analytics, and technical assistance" must not yield
      // "technical writing analytics". Only a head that ends its list is shared.
      const sharedHead = !SEPARATORS.has(tokens[i + 1] ?? '');

      for (const [rank, mod] of modifiersBeforeHead(tokens, headStart).entries()) {
        if (rank > 0 && !sharedHead) break;
        const modWords = mod.split(' ');
        // Two capability phrases side by side are two capabilities, not modifier + head
        // ("cybersecurity risk management" + "augmentation"). Keep the conjunct alone.
        if (modWords.length >= 2 && CAPABILITY_HEADS.has(modWords[modWords.length - 1])) {
          add(mod, base, named ? 'focus' : 'head');
          continue;
        }
        // parts are reverse document order, so a higher rank was written earlier and a
        // writer leads a list with the main line of business.
        add(`${mod} ${headText}`, base + rank * BONUS.listPrimacy, named ? 'focus' : 'head');
      }
    }
  }

  const haystack = text.toLowerCase();
  const counts = new Map<string, number>();
  for (const tok of tokenize(text)) counts.set(tok, (counts.get(tok) ?? 0) + 1);

  for (const entry of out.values()) {
    if (haystack.includes(entry.phrase)) entry.bonus += BONUS.literal;
    const lead = entry.phrase.split(' ')[0];
    entry.bonus += Math.min((counts.get(lead) ?? 1) - 1, BONUS.maxRepeats) * BONUS.perRepeat;
  }

  return [...out.values()].sort((a, b) => b.bonus - a.bonus);
}
