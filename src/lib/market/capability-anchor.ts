/**
 * Capability anchor ranking + grounding for capability_market_match.
 *
 * Ranks keyword candidates by capability signal (not list order), strips company
 * brand tokens, rejects filler/certification/abstraction anchors, and validates
 * proposed NAICS against SAM registration + award-history evidence when available.
 */
import type { KeywordCoverage } from '@/lib/market/keyword-coverage';
import { extractCapabilityPhrases } from '@/lib/market/capability-phrases';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';

/** Bare modifiers that must never anchor a company's market (P0-1). */
export const GENERIC_ANCHOR_UNIGRAMS = new Set([
  'small', 'large', 'new', 'other', 'general', 'total', 'full', 'complete', 'custom',
  'special', 'standard', 'advanced', 'modern', 'basic', 'quality', 'commercial',
  'industrial', 'military', 'federal', 'national', 'local', 'domestic', 'various',
  'high', 'low', 'medium', 'heavy', 'light', 'main', 'primary', 'multi', 'single',
  'headquartered', 'located', 'based', 'founded', 'since', 'california', 'virginia',
  'maryland', 'texas', 'florida', 'dc', 'region', 'capital',
]);

/** Generic abstractions that describe nothing buyable. */
export const GENERIC_ABSTRACTIONS = new Set([
  'outcomes', 'solutions', 'customized', 'innovative', 'certifications', 'technology',
  'strategy', 'mission', 'mission-driven', 'performance', 'excellence', 'value',
  'results', 'services', 'service', 'support', 'consulting', 'management', 'firm',
  'company', 'business', 'organization', 'organizations', 'capabilities', 'capability',
  'professional', 'integrated', 'comprehensive', 'scalable', 'secure', 'trusted',
  'leading', 'dedicated', 'proven', 'tailored', 'effective', 'sustainable',
  'award-winning', 'award winning', 'transformation', 'environments', 'intelligence',
  'multidisciplinary', 'multicultural', 'ensuring', 'initiatives', 'expertise',
]);

const BARE_CONJUNCTIONS = new Set(['and', 'or', 'but', 'the', 'for', 'with', 'our', 'your']);
export { BARE_CONJUNCTIONS };

const VERB_LED_PREFIX =
  /^(helps?|provides?|providing|delivers?|delivering|serves?|serving|offers?|offering|specializ(es|ing|ed)|perform(s|ing)?|focused on|focuses on|empowering|enabling|supporting|delivering|a firm focused|firm focused)\b/i;

/** Multi-word verb-led fragments from the Morehouse Ascend defect cohort. */
const VERB_LED_PHRASE_RE =
  /\b(helps organizations|provides practical|provides commercial|consulting company|helps mission[- ]driven)\b/i;

const OK_AS_TRAILING = new Set([
  'services', 'service', 'support', 'management', 'systems', 'system',
  'solutions', 'performance', 'requirements', 'program',
]);

/** Domain terms that strongly signal a buyable federal market (boost ranking). */
const CAPABILITY_DOMAIN_BOOST = new Set([
  'cybersecurity', 'security', 'construction', 'engineering', 'janitorial', 'logistics',
  'staffing', 'healthcare', 'aviation', 'software', 'cloud', 'network', 'networks', 'testing',
  'penetration', 'grc', 'threat', 'infrastructure', 'environmental', 'courier', 'elevator',
  'concrete', 'maintenance', 'transportation', 'telecommunications', 'energy', 'medical',
  'administrative', 'acquisition', 'warehousing', 'civil',
]);

/** Short tokens that are real capability/product terms, not company acronyms. */
const ALLOWED_SHORT_UNIGRAMS = new Set([
  'hvac', 'cnc', 'gis', 'erp', 'sap', 'dev', 'ops', 'hr', 'pmp', 'sow', 'pws',
  'rfp', 'rfq', 'sbir', 'it', 'ai', 'iot', 'sql', 'api', 'aws', 'gcp',
]);

const SOCIOECONOMIC_RE =
  /\b(sdvosb|sdvos|veteran[- ]owned|woman[- ]owned|service[- ]disabled|wosb|vosb|8\s*\(?a\)?|hubzone|minority[- ]owned|small business set[- ]aside|sb set[- ]aside)\b/i;

/**
 * Mission/values adjectives. Every federal vendor claims these, so they separate
 * nobody from anybody and cannot identify a market. "mission-focused consulting"
 * scored like a capability and gave BMA a confident TAM off a values statement.
 */
const MISSION_ADJECTIVE_RE =
  /\b(mission[\s-]?(?:focused|focussed|driven|first|critical|centered|centred|led|oriented|ready|aligned)|people[\s-]?(?:always|centered|centred|first)|client[\s-]?centered|purpose[\s-]?driven|values[\s-]?driven|data[\s-]?driven|evidence[\s-]?based|technology[\s-]?enabled|results[\s-]?driven|world[\s-]?class|best[\s-]?in[\s-]?class|industry[\s-]?leading|cutting[\s-]?edge|state[\s-]?of[\s-]?the[\s-]?art|high[\s-]?quality|end[\s-]?to[\s-]?end|decision[\s-]?making|turnkey)\b/i;

/** Hyphenated cert/set-aside fragments that must never anchor a market. */
const SOCIOECONOMIC_FRAGMENT_RE =
  /^(woman-owned|service-disabled|veteran-owned|service-disabled veteran-owned|disabled veteran|small business)$/;

/** TAM bounds — outside these ranges downgrade confidence (not hard reject alone). */
export const TAM_TOO_BROAD_USD = 500_000_000_000; // $500B — national catch-all markets
export const TAM_TOO_NARROW_USD = 500_000; // $500K — likely keyword miss / empty slice

export type AnchorConfidence = 'high' | 'medium' | 'low' | 'unverified';

export interface RankedAnchorCandidate {
  phrase: string;
  score: number;
  rejectReason?: string;
  kind?: AnchorCandidateKind;
  /** 'extracted' = the sentence-aware extractor (tier 1); 'derived' = keywords + decomposition. */
  origin?: 'extracted' | 'derived';
}

export interface BrandStripContext {
  clientName?: string;
  extraExclude?: string[];
  /**
   * The raw capability description. When present, phrases are read out of the
   * company's own sentences instead of only re-ranking shredded keywords — that
   * is what makes "courier services" reachable when the keyword list holds
   * "logistics", "delivery" and "customized" separately.
   */
  sourceText?: string;
}

/** Whether the company was resolved to exactly one real registered entity. */
export type EntityIdentityStatus = 'unique' | 'ambiguous' | 'none';

export interface AnchorEvidence {
  /** Only `unique` may elevate confidence — see capability-anchor-evidence.ts. */
  identity: EntityIdentityStatus;
  identityUei: string | null;
  identityName: string | null;
  /** Distinct entities the name matched; >1 without an exact hit is a collision. */
  identityCandidates: number;
  samNaics: string[];
  awardNaics: string[];
  awardObligatedUsd: number | null;
  samAsOf: string | null;
  awardAsOf: string | null;
}

export function emptyAnchorEvidence(): AnchorEvidence {
  return {
    identity: 'none',
    identityUei: null,
    identityName: null,
    identityCandidates: 0,
    samNaics: [],
    awardNaics: [],
    awardObligatedUsd: null,
    samAsOf: null,
    awardAsOf: null,
  };
}

export interface AnchorValidationResult {
  anchor: string;
  anchor_confidence: AnchorConfidence;
  anchor_verified: boolean;
  grounded: boolean;
  anchor_note?: string;
  rejectReasons: string[];
  tamFlag?: 'too_broad' | 'too_narrow' | null;
  sectorContradiction: boolean;
}

/**
 * Words that appear in company names but are ordinary capability vocabulary.
 *
 * Treating every name word as a brand token is over-correction: "Information Management
 * Resources" made `management` a forbidden word, which rejected IMRI's own
 * "cybersecurity risk management". The distinctive part of a name is still stripped —
 * the acronym, the compact form, and any multi-word prefix of the full name.
 */
const BRAND_TOKEN_STOPLIST = new Set([
  'management', 'resources', 'information', 'solutions', 'services', 'systems',
  'technologies', 'technology', 'associates', 'partners', 'industries', 'holdings',
  'global', 'national', 'federal', 'international', 'business', 'builders', 'contract',
  'agency', 'alliance', 'consortium', 'institute', 'research', 'digital', 'culture',
  'delivery', 'therapy', 'centric', 'vision', 'space', 'premier', 'regulatory',
]);

function tokenizeBrand(raw: string): string[] {
  return raw
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(llc|inc|corp|co|ltd|the|group|enterprises|enterprise|consulting|corporation|company)\b/gi, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

/** Build brand/acronym tokens to strip from anchor candidates. */
export function buildBrandTokenSet(ctx: BrandStripContext): Set<string> {
  const out = new Set<string>();
  const names = [ctx.clientName, ...(ctx.extraExclude || [])].filter(Boolean) as string[];
  for (const name of names) {
    for (const w of tokenizeBrand(name)) {
      if (!BRAND_TOKEN_STOPLIST.has(w)) out.add(w);
    }
    // Acronym from capital letters / first letters
    const letters = name.replace(/[^A-Za-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (letters.length >= 2) {
      const acronym = letters.map((w) => w[0]?.toLowerCase()).join('');
      if (acronym.length >= 2 && acronym.length <= 6) out.add(acronym);
    }
    // Compact form: "RoDa" -> "roda", "GCubed" -> "gcubed", "SRFed" -> "srfed"
    const compact = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (compact.length >= 3) out.add(compact);
    // Domain-style acronyms from description tokens (South River → srfed class)
    if (/south river|srfed/i.test(name)) out.add('srfed');
  }
  return out;
}

function phraseContainsBrand(phrase: string, brand: Set<string>): boolean {
  const words = phrase.toLowerCase().split(/\s+/);
  const compact = phrase.replace(/[\s-]/g, '').toLowerCase();
  for (const b of brand) {
    if (b.length >= 4 && compact.includes(b)) return true;
    if (b.length >= 3 && words.includes(b)) return true;
    // A multi-word phrase that is a fragment of the company's own name IS the name
    // ("information management" for Information Management Resources), not a capability.
    if (words.length >= 2 && compact.length >= 8 && b.length > compact.length && b.includes(compact)) {
      return true;
    }
  }
  return false;
}

/** Extract capability noun when stripping verb-led filler. */
export function extractCapabilityTail(phrase: string): string | null {
  const trimmed = phrase.trim();
  const m = trimmed.match(
    /^(?:helps?|provides?|providing|delivers?|serving|offers?|perform(?:s|ing)?|focused on|firm focused on)\s+(.+)$/i,
  );
  if (m?.[1]) return m[1].trim();
  return null;
}

export function scoreAnchorPhrase(phrase: string, brand: Set<string>): { score: number; rejectReason?: string } {
  const p = phrase.trim().toLowerCase();
  if (!p || p.length < 3) return { score: -1000, rejectReason: 'empty' };

  if (BARE_CONJUNCTIONS.has(p)) return { score: -1000, rejectReason: 'bare_conjunction' };
  if (phraseContainsBrand(p, brand)) return { score: -1000, rejectReason: 'company_name' };
  if (SOCIOECONOMIC_RE.test(p) || SOCIOECONOMIC_FRAGMENT_RE.test(p)) {
    return { score: -1000, rejectReason: 'socioeconomic' };
  }
  if (MISSION_ADJECTIVE_RE.test(p)) {
    return { score: -900, rejectReason: 'mission_adjective' };
  }
  if (VERB_LED_PHRASE_RE.test(p)) {
    return { score: -700, rejectReason: 'verb_led_filler' };
  }

  const words = p.split(/\s+/);
  if (/\bregulatory affairs\b/.test(p) || (words.length === 1 && p === 'affairs')) {
    return { score: -800, rejectReason: 'generic_abstraction' };
  }
  // (A global `roofing|asphalt|shingle` ban used to live here, written for one concrete
  // contractor (Morehouse "Morris Builders") whose text never says roofing. It rejected every
  // genuine roofing contractor. The real guard is SOURCE GROUNDING in rankAnchorCandidates:
  // an anchor's words must come from the company's own text.)
  if (/\bexpert solutions\b/.test(p)) {
    return { score: -500, rejectReason: 'generic_abstraction' };
  }

  if (words.length === 1) {
    if (GENERIC_ANCHOR_UNIGRAMS.has(p)) return { score: -800, rejectReason: 'generic_unigram' };
    if (GENERIC_ABSTRACTIONS.has(p)) return { score: -800, rejectReason: 'generic_abstraction' };
    if (p.length <= 4 && /^[a-z]+$/.test(p) && !ALLOWED_SHORT_UNIGRAMS.has(p)) {
      return { score: -500, rejectReason: 'likely_acronym' };
    }
  }

  if (VERB_LED_PREFIX.test(p)) {
    const tail = extractCapabilityTail(p);
    if (tail && tail.length >= 4 && !GENERIC_ABSTRACTIONS.has(tail.split(/\s+/)[0])) {
      return scoreAnchorPhrase(tail, brand); // recurse on extracted capability
    }
    return { score: -700, rejectReason: 'verb_led_filler' };
  }

  // Penalize phrases dominated by generic abstractions (except normal trailing service-line nouns)
  const genericCount = words.filter((w) => GENERIC_ABSTRACTIONS.has(w) && !OK_AS_TRAILING.has(w)).length;
  const trailingOnlyGeneric =
    words.length === 2 && GENERIC_ABSTRACTIONS.has(words[1]) && OK_AS_TRAILING.has(words[1]) && genericCount === 0;
  if (genericCount === words.length) return { score: -600, rejectReason: 'all_generic' };
  if (genericCount > 0 && words.length <= 2 && !trailingOnlyGeneric) {
    return { score: -400, rejectReason: 'generic_heavy' };
  }

  let score = 0;
  if (p.includes(' ')) score += 40;
  // Word count, not character count — a long word is not a more specific capability.
  score += Math.min(words.length, 3) * 8;
  score -= genericCount * 30;
  if (words.some((w) => w.length >= 6 && !GENERIC_ABSTRACTIONS.has(w))) score += 15;
  if (words.some((w) => CAPABILITY_DOMAIN_BOOST.has(w))) score += 45;
  return { score };
}

/**
 * PLAIN-ENGLISH CANDIDATES (ChatGPT blocker #3, 2026-10-04).
 *
 * Beginners describe WHO they are before WHAT they do — "Small engineering firm doing
 * environmental remediation", "We're a 20-person firm that does building automation and energy
 * audits". The ranker used to anchor on "small engineering" and "automation and energy" — a
 * size descriptor and a phrase spanning two activities — and keywordCoverage (exact phrase on
 * USASpending) found nothing, so the tool returned NO market for 8 of 22 ordinary businesses.
 * These helpers only REARRANGE the company's own words; they never add a word.
 */
const LEAD_FILLER = new Set([
  'we', 'our', 'i', 'my', 'us', 'do', 'does', 'doing', 'make', 'makes', 'making', 'build', 'builds',
  'provide', 'provides', 'providing', 'offer', 'offers', 'offering', 'perform', 'performs',
  'licensed', 'certified', 'experienced', 'professional', 'that', 'who', 'manufacture',
  'manufactures', 'design', 'designs', 'custom', 'help', 'helps', 'achieve', 'deliver', 'delivers',
  'placing', 'serve', 'serves', 'serving', 'supporting', 'specialize', 'specializes', 'specializing',
]);
const DESCRIPTOR_TOKENS = new Set([
  'small', 'firm', 'company', 'business', 'agency', 'contractor', 'contractors', 'family-owned',
  'family-operated', 'veteran-owned', 'woman-owned', 'women-owned', 'minority-owned', 'owned',
  'operated', 'based', 'local', 'leading', 'trusted', 'full-service',
]);
const PERSON_COUNT_RE = /^\d+[- ]?(person|people|employee|employees|man|staff)$/;
/** Words after these describe the CUSTOMER, EQUIPMENT or PLACE — never the work itself
 *  ("photogrammetry FOR infrastructure inspection", "haul freight WITH a fleet of trailers",
 *  "roofing contractor IN Florida", "training software FOR clinicians"). */
const OBJECT_INTRO_RE = /\s(?:for|to|with|serving|across|throughout|in|near|at|through|by|via)\s/i;
const CONJUNCTION_SPLIT_RE = /\s*(?:,|;|\s&\s|\band\b|\bor\b|\bplus\b)\s*/i;

function normalizeForGrounding(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/** Strip filler/descriptors and hyphen-joins from one phrase. Null when nothing is left. */
export function cleanAnchorCandidate(phrase: string): string | null {
  const words = phrase
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // "drone-based" / "cloud-based" qualify the work; they are not the work.
    .filter((w) => !/-based$/.test(w))
    .flatMap((w) => (DESCRIPTOR_TOKENS.has(w) || SOCIOECONOMIC_FRAGMENT_RE.test(w) || PERSON_COUNT_RE.test(w) ? [] : w.split('-')))
    .filter((w) => w && !DESCRIPTOR_TOKENS.has(w));
  while (words.length && LEAD_FILLER.has(words[0])) words.shift();
  while (words.length && (LEAD_FILLER.has(words[words.length - 1]) || BARE_CONJUNCTIONS.has(words[words.length - 1]))) words.pop();
  const out = words.join(' ').trim();
  return out.length >= 3 ? out : null;
}

/** How a candidate was derived — candidates are probed phrases first, single words last. */
export type AnchorCandidateKind = 'phrase' | 'bigram' | 'head' | 'modifier';
const KIND_ORDER: Record<AnchorCandidateKind, number> = { phrase: 0, bigram: 1, head: 2, modifier: 3 };

/** Trailing nouns that name a deliverable type, not the trade ("NEPA compliance STUDIES",
 *  "marketing MATERIALS", "metal PARTS"). Never a head on their own. */
const GENERIC_HEAD_NOUNS = new Set([
  'studies', 'study', 'projects', 'project', 'work', 'works', 'jobs', 'tasks', 'materials',
  'products', 'items', 'parts', 'equipment', 'supplies', 'goods', 'consulting', 'professionals',
]);

/** Evaluative adjectives describe how well, never what — they cannot name a market. */
const EVALUATIVE_ADJECTIVES = new Set([
  'better', 'best', 'greater', 'improved', 'efficient', 'effective', 'reliable', 'innovative',
  'strategic', 'superior', 'excellent', 'dependable', 'affordable', 'premier', 'proven',
]);

function distinctiveWord(w: string): boolean {
  if (ALLOWED_SHORT_UNIGRAMS.has(w)) return true;
  return (
    w.length >= 5 &&
    !GENERIC_ANCHOR_UNIGRAMS.has(w) &&
    !GENERIC_ABSTRACTIONS.has(w) &&
    !OK_AS_TRAILING.has(w) &&
    !LEAD_FILLER.has(w) &&
    !EVALUATIVE_ADJECTIVES.has(w) &&
    !GENERIC_HEAD_NOUNS.has(w)
  );
}

/**
 * The individual activities inside a phrase. Only the ACTIVITY side is used (everything before
 * for/to/with/in…); it is split at and/or/commas, and each part yields itself, its contiguous
 * word pairs (3–5 word parts), its head noun and — for two-word parts — its modifier.
 */
export function decomposeAnchorPhraseWithKinds(phrase: string): { phrase: string; kind: AnchorCandidateKind }[] {
  const out = new Map<string, AnchorCandidateKind>();
  const put = (p: string | null, kind: AnchorCandidateKind) => {
    if (!p) return;
    const prev = out.get(p);
    if (prev === undefined || KIND_ORDER[kind] < KIND_ORDER[prev]) out.set(p, kind);
  };
  const activitySide = ` ${phrase} `.split(OBJECT_INTRO_RE)[0];
  for (const rawPart of activitySide.split(CONJUNCTION_SPLIT_RE)) {
    const part = cleanAnchorCandidate(rawPart);
    if (!part) continue;
    const words = part.split(' ');
    // A single word is never a 'phrase': it ranks with the other single words, and only if it
    // could name a market at all.
    if (words.length === 1) {
      if (distinctiveWord(part)) put(part, 'head');
      continue;
    }
    put(part, 'phrase');
    if (words.length >= 3 && words.length <= 5) {
      for (let i = 0; i + 1 < words.length; i++) put(`${words[i]} ${words[i + 1]}`, 'bigram');
    }
    if (words.length >= 2) {
      // Head: the last DISTINCTIVE word, skipping trailing service-line / deliverable nouns
      // ("translation services" → translation, "environmental consulting" → environmental).
      const head = [...words].reverse().find((w) => distinctiveWord(w));
      if (head) put(head, 'head');
      if (words.length === 2 && distinctiveWord(words[0]) && words[0] !== head) put(words[0], 'modifier');
    }
  }
  return [...out.entries()].map(([p, kind]) => ({ phrase: p, kind }));
}

export function decomposeAnchorPhrase(phrase: string): string[] {
  return decomposeAnchorPhraseWithKinds(phrase).map((c) => c.phrase);
}

/**
 * The ACTIVITY side of the company's own text: each clause up to its first for/to/with/in…
 * Words that only ever appear after those (the customer, equipment or place) never anchor —
 * even when the keyword extractor hands them over as a separate fragment ("tractor-trailers"
 * from "haul freight with a fleet of tractor-trailers", "infrastructure" from "… for
 * infrastructure inspection").
 */
export function activitySideText(sourceText: string): string {
  return sourceText
    .split(/[.;:!?\n]+/)
    .map((clause) => ` ${clause} `.split(OBJECT_INTRO_RE)[0])
    .join(' ');
}

/**
 * Phrases that name the TYPE OF FIRM — the one or two words before firm/company/agency/
 * contractor/provider ("small ENGINEERING firm", "a FACILITIES MANAGEMENT company", "an IT and
 * ENERGY SOLUTIONS provider"). They describe the company, not the specific work, so they are
 * tried last — never preferred over an activity the text also names. Agency/contractor are
 * excluded: there the firm type IS the trade.
 */
export function firmTypePhrases(sourceText: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!sourceText) return out;
  // Not agency/contractor: there the firm type IS the trade ("staffing agency", "roofing contractor").
  const re = /\b([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)\s+(?:firm|company|provider|business)\b/gi;
  for (const m of sourceText.matchAll(re)) {
    const words = (cleanAnchorCandidate(m[1]) ?? '').split(' ').filter(Boolean);
    if (!words.length) continue;
    out.add(words.join(' '));
    out.add(words[words.length - 1]);
  }
  return out;
}

/** Every word of the candidate appears in the company's own text — by default on its ACTIVITY side. */
export function isGroundedInSource(
  phrase: string,
  sourceText: string | undefined,
  opts: { activitySideOnly?: boolean } = {},
): boolean {
  if (!sourceText) return true;
  const src = normalizeForGrounding(opts.activitySideOnly === false ? sourceText : activitySideText(sourceText));
  return phrase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .every((w) => src.includes(` ${w} `) || src.includes(` ${w}s `) || (w.endsWith('s') && src.includes(` ${w.slice(0, -1)} `)));
}

/** Rank candidates; never pick merely because a phrase appeared first. */
export function rankAnchorCandidates(
  keywords: string[],
  ctx: BrandStripContext = {},
): RankedAnchorCandidate[] {
  const brand = buildBrandTokenSet(ctx);
  const seen = new Set<string>();
  const bonus = new Map<string, number>();
  // TIER 1 — phrases from the sentence-aware extractor keep their previous order exactly (that
  // ordering is what the Morehouse Ascend exact cases pin). TIER 2 — the keyword fragments
  // (cleaned of filler/descriptors) and their decomposition (plain-English, 2026-10-04),
  // ordered whole phrases → word pairs → single words. The probe ladder tries tier 1 first.
  const extracted: string[] = [];
  const fromExtractor = new Set<string>();
  for (const e of ctx.sourceText ? extractCapabilityPhrases(ctx.sourceText) : []) {
    bonus.set(e.phrase, e.bonus);
    extracted.push(e.phrase);
    fromExtractor.add(e.phrase.trim().toLowerCase());
  }

  // GROUNDING by provenance. The extractor reads whole sentences and NORMALIZES ("maintaining
  // elevators" → "elevator maintenance"), so its phrases are trusted as-is. Everything else must
  // come from the ACTIVITY side of the text — the words before for/with/in… — so a fragment like
  // "tractor-trailers" (from "… with a fleet of tractor-trailers") cannot anchor.
  const scoreOne = (kw: string): RankedAnchorCandidate => {
    const key = kw.trim().toLowerCase();
    const grounded = fromExtractor.has(key) || isGroundedInSource(key, ctx.sourceText);
    if (!grounded) {
      return { phrase: kw.trim(), score: -1000, rejectReason: 'not_in_source' };
    }
    const { score, rejectReason } = scoreAnchorPhrase(kw, brand);
    // Provenance never rescues a rejected phrase — it only orders survivors.
    const adjusted = score < 0 ? score : score + (bonus.get(key) ?? 0);
    return { phrase: kw.trim(), score: adjusted, ...(rejectReason ? { rejectReason } : {}) };
  };

  const tier1: RankedAnchorCandidate[] = [];
  for (const kw of extracted) {
    const key = kw.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tier1.push({ ...scoreOne(kw), kind: 'phrase', origin: 'extracted' });
  }

  const tier2: RankedAnchorCandidate[] = [];
  for (const kw of [...extracted, ...keywords]) {
    for (const { phrase: c, kind } of decomposeAnchorPhraseWithKinds(kw)) {
      if (seen.has(c)) continue;
      seen.add(c);
      tier2.push({ ...scoreOne(c), kind, origin: 'derived' });
    }
  }

  const firmType = firmTypePhrases(ctx.sourceText);
  const isFirmType = (r: RankedAnchorCandidate) => firmType.has(r.phrase.trim().toLowerCase());
  const survivors = (list: RankedAnchorCandidate[]) => list.filter((r) => r.score >= 0 && !isFirmType(r));
  const rejected = [...tier1, ...tier2].filter((r) => r.score < 0);
  return [
    ...survivors(tier1).sort((a, b) => b.score - a.score),
    ...survivors(tier2).sort((a, b) => {
      const k = KIND_ORDER[a.kind ?? 'phrase'] - KIND_ORDER[b.kind ?? 'phrase'];
      return k !== 0 ? k : b.score - a.score;
    }),
    // Firm-type phrases last among survivors (see firmTypePhrases), tier 1 before tier 2.
    ...[...tier1, ...tier2].filter((r) => r.score >= 0 && isFirmType(r)),
    ...rejected.sort((a, b) => b.score - a.score),
  ];
}

export function normalizeSelectedAnchor(phrase: string): string {
  return extractCapabilityTail(phrase)?.trim() || phrase.trim();
}

export function pickBestAnchor(keywords: string[], ctx: BrandStripContext = {}): RankedAnchorCandidate | null {
  const ranked = rankAnchorCandidates(keywords, ctx);
  const best = ranked[0];
  if (!best || best.score < 0) return null;
  const normalized = normalizeSelectedAnchor(best.phrase);
  if (normalized !== best.phrase) {
    const { score } = scoreAnchorPhrase(normalized, buildBrandTokenSet(ctx));
    if (score >= 0) return { phrase: normalized, score };
  }
  return best;
}

/** @deprecated use pickBestAnchor — kept for incremental migration tests */
export function pickLeadKeyword(keywords: string[]): string {
  const best = pickBestAnchor(keywords);
  if (best) return best.phrase;
  return keywords[0] ?? '';
}

export function isGenericAnchorToken(keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  return !k.includes(' ') && GENERIC_ANCHOR_UNIGRAMS.has(k);
}

function dominantNaicsContradictsEvidence(
  leadNaics: string | null,
  evidence: AnchorEvidence,
): boolean {
  if (!leadNaics) return false;
  const lead = leadNaics.slice(0, 6);
  const sam = evidence.samNaics.map((c) => c.slice(0, 6));
  const awards = evidence.awardNaics.map((c) => c.slice(0, 6));

  // If we have award NAICS with meaningful spend, lead must agree at 6-digit or 3-digit sector
  if (awards.length && evidence.awardObligatedUsd != null && evidence.awardObligatedUsd >= 1_000_000) {
    const awardMatch = awards.some((c) => c === lead || c.slice(0, 3) === lead.slice(0, 3));
    if (!awardMatch) return true;
  }

  // SAM registration: if present and disjoint at 2-digit, treat as contradiction
  if (sam.length) {
    const samMatch = sam.some((c) => c === lead || c.slice(0, 2) === lead.slice(0, 2));
    if (!samMatch) return true;
  }

  return false;
}

/** Lead NAICS incompatible with anchor trade language (Morris / OVP classes). */
export function leadNaicsContradictsAnchor(leadNaics: string | null, anchor: string): boolean {
  if (!leadNaics || !anchor) return false;
  const a = anchor.toLowerCase();
  const prefix3 = leadNaics.slice(0, 3);
  const prefix2 = leadNaics.slice(0, 2);

  // Concrete/construction anchor must not map to asphalt/roofing NAICS (324)
  if (prefix3 === '324' && /\b(concrete|reinforcement|construction|drywall|forming|metal stud)\b/.test(a)) {
    return true;
  }
  // Organizational/consulting anchor must not map to air transport (481)
  if (prefix2 === '48' && leadNaics.startsWith('481')) {
    if (/\b(organizational|leadership|strategic|consulting|development|communications|marketing)\b/.test(a)) {
      return true;
    }
  }
  return false;
}

/**
 * Corroboration requires a uniquely resolved entity FIRST. Registration or award NAICS
 * harvested from an ambiguous name match describes some other company; treating it as
 * evidence is how a plausible-looking market gets attached to the wrong firm.
 */
function hasCorroboratingEvidence(evidence: AnchorEvidence): boolean {
  if (evidence.identity !== 'unique') return false;
  // A corroborating UEI is a SAM identifier, not a test nickname. The gold-master
  // shape lives in `isWellFormedUei` (exactly 12 alphanumerics). A 13-character
  // stub cannot raise confidence — that would let a malformed identifier mint a TAM.
  if (!isWellFormedUei(evidence.identityUei)) return false;
  return (
    evidence.samNaics.length > 0 ||
    evidence.awardNaics.length > 0 ||
    (evidence.awardObligatedUsd != null && evidence.awardObligatedUsd >= 1_000_000)
  );
}

/** Legacy first-keyword anchor (pre-ranking defect) — for before/after matrices only. */
export function pickLegacyLeadAnchor(keywords: string[]): string {
  return keywords[0]?.trim() ?? '';
}

/** Scope- and evidence-relative TAM sanity — not a single global dollar cutoff. */
export function evaluateTamSanity(opts: {
  anchor: string;
  coverage: KeywordCoverage | null;
  evidence: AnchorEvidence;
  leadNaics: string | null;
}): 'too_broad' | 'too_narrow' | null {
  const total = opts.coverage?.totalMarket;
  if (total == null || !Number.isFinite(total) || total <= 0) return null;

  const anchorLower = opts.anchor.trim().toLowerCase();
  const { score } = scoreAnchorPhrase(opts.anchor, new Set());
  if (score < 0 || BARE_CONJUNCTIONS.has(anchorLower)) {
    return 'too_broad';
  }

  const leadSlice =
    opts.leadNaics
      ? (opts.coverage?.allNaics?.find((n) => n.code === opts.leadNaics)?.amount ?? null)
      : null;

  // Lead-slice relative only when a NAICS was established outside coverage share
  // (SAM / award evidence). Do not treat allNaics[0] / topCodePct as identity.
  if (leadSlice != null && leadSlice > 0) {
    if (total > leadSlice * 80) return 'too_broad';
    if (total < leadSlice * 0.002 && total < 10_000_000) return 'too_narrow';
  }

  // Award-history relative (Greenup $21M class): TAM cannot be trivial vs known spend
  if (opts.evidence.awardObligatedUsd != null && opts.evidence.awardObligatedUsd >= 1_000_000) {
    if (total < opts.evidence.awardObligatedUsd * 0.005) return 'too_narrow';
    const awardNaics = opts.evidence.awardNaics[0];
    if (awardNaics && opts.leadNaics && awardNaics.slice(0, 3) === opts.leadNaics.slice(0, 3)) {
      if (total < opts.evidence.awardObligatedUsd * 0.05) return 'too_narrow';
    }
  }

  // Trade anchors with absurd absolute federal totals (Morris $1,328 concrete class)
  if (/\b(concrete|construction|reinforcement|drywall|forming|metal stud)\b/.test(anchorLower)) {
    if (total < 1_000_000) return 'too_narrow';
  }

  return null;
}

export function evaluateTamBounds(totalMarket: number | null | undefined): 'too_broad' | 'too_narrow' | null {
  if (totalMarket == null || !Number.isFinite(totalMarket)) return null;
  if (totalMarket >= TAM_TOO_BROAD_USD) return 'too_broad';
  if (totalMarket > 0 && totalMarket < TAM_TOO_NARROW_USD) return 'too_narrow';
  return null;
}

/** Prefer NAICS aligned with SAM/award evidence when coverage offers a match. */
export function resolveLeadNaicsWithEvidence(
  coverage: KeywordCoverage | null | undefined,
  evidence: AnchorEvidence,
  fallback: string | null,
): string | null {
  if (!coverage?.allNaics?.length) return fallback;
  const sam = evidence.samNaics.map((c) => c.slice(0, 6));
  const awards = evidence.awardNaics.map((c) => c.slice(0, 6));

  const matchFromEvidence = (codes: string[]) => {
    for (const code of codes) {
      const hit = coverage.allNaics.find(
        (n) => n.code === code || n.code.slice(0, 4) === code.slice(0, 4) || n.code.slice(0, 3) === code.slice(0, 3),
      );
      if (hit) return hit.code;
    }
    return null;
  };

  if (awards.length && evidence.awardObligatedUsd != null && evidence.awardObligatedUsd >= 1_000_000) {
    const fromAwards = matchFromEvidence(awards);
    if (fromAwards) return fromAwards;
  }
  if (sam.length) {
    const fromSam = matchFromEvidence(sam);
    if (fromSam) return fromSam;
  }
  return fallback;
}

export function validateMarketAnchor(opts: {
  anchor: string;
  coverage: KeywordCoverage | null;
  leadNaics: string | null;
  evidence?: AnchorEvidence;
}): AnchorValidationResult {
  const { anchor, coverage, leadNaics } = opts;
  const totalMarket = coverage?.totalMarket ?? null;
  const evidence = opts.evidence ?? emptyAnchorEvidence();
  const rejectReasons: string[] = [];

  const brand = buildBrandTokenSet({});
  const { score, rejectReason } = scoreAnchorPhrase(anchor, brand);
  if (rejectReason) rejectReasons.push(rejectReason);
  if (score < 0) {
    return {
      anchor,
      anchor_confidence: 'unverified',
      anchor_verified: false,
      grounded: false,
      rejectReasons,
      sectorContradiction: false,
      anchor_note: `Anchor "${anchor}" is not a defensible capability phrase (${rejectReason ?? 'low score'}). Treat market codes as candidates only.`,
    };
  }

  const leadIsGeneric = isGenericAnchorToken(anchor);
  if (leadIsGeneric) rejectReasons.push('generic_unigram');

  const sectorContradiction =
    dominantNaicsContradictsEvidence(leadNaics, evidence) || leadNaicsContradictsAnchor(leadNaics, anchor);
  if (sectorContradiction) rejectReasons.push('sector_contradiction');

  const tamFlag =
    evaluateTamSanity({ anchor, coverage, evidence, leadNaics }) ??
    evaluateTamBounds(totalMarket);
  if (tamFlag === 'too_broad') rejectReasons.push('tam_too_broad');
  if (tamFlag === 'too_narrow') rejectReasons.push('tam_too_narrow');

  const hasCoverage = Boolean(coverage);
  const corroborated = hasCorroboratingEvidence(evidence);
  // Coverage NAICS share is a measured distribution, not market identity.
  const anchorUnverified =
    leadIsGeneric || sectorContradiction || tamFlag != null || score < 20;

  let anchor_confidence: AnchorConfidence = 'unverified';
  if (!anchorUnverified && hasCoverage && corroborated) anchor_confidence = 'high';
  else if (hasCoverage && !sectorContradiction && score >= 20 && corroborated) anchor_confidence = 'medium';
  else if (hasCoverage && !sectorContradiction && score >= 20) anchor_confidence = 'low';
  else if (hasCoverage) anchor_confidence = 'low';

  const grounded = hasCoverage && anchor_confidence === 'high' && corroborated;

  let anchor_note: string | undefined;
  if (sectorContradiction) {
    anchor_note = `Proposed NAICS ${leadNaics} contradicts SAM registration or award-history evidence. Treat as unverified.`;
  } else if (leadIsGeneric) {
    anchor_note = `Anchored on the generic term "${anchor}", which does not identify an industry. Confirm against SAM registration or award history.`;
  } else if (tamFlag === 'too_broad') {
    anchor_note = `Total market $${Math.round((totalMarket ?? 0) / 1e9)}B is implausibly broad for this capability — anchor confidence reduced.`;
  } else if (tamFlag === 'too_narrow') {
    anchor_note = `Total market under $${TAM_TOO_NARROW_USD / 1e6}M — likely a thin or mis-anchored slice.`;
  } else if (anchor_confidence === 'unverified') {
    anchor_note = `No defensible market anchor from the supplied capability text. Add past performance or a clearer capability statement.`;
  } else if (evidence.identity === 'ambiguous') {
    anchor_note = `"${anchor}" reads as a capability, but the company name matched ${evidence.identityCandidates} distinct SAM entities, so no registration or award history can be attributed to it. Supply a UEI to raise confidence.`;
  } else if (evidence.identity === 'none') {
    anchor_note = `"${anchor}" reads as a capability, but no SAM registration or award history was resolved for this company, so the market below is a candidate rather than a verified fit.`;
  }

  return {
    anchor,
    anchor_confidence,
    anchor_verified: !anchorUnverified,
    grounded,
    anchor_note,
    rejectReasons,
    tamFlag,
    sectorContradiction,
  };
}

/** True when competitor lookup must NOT use keyword/name substring search. */
export function competitorsMustUseNaics(anchor: string, leadNaics: string | null): boolean {
  return Boolean(leadNaics) || scoreAnchorPhrase(anchor, new Set()).score >= 0;
}
