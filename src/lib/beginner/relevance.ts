/**
 * Relevance gate for beginner SAM results — activity evidence, not token hits.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 * The previous gate asked `title.includes(token)` for every 4+ char word in
 * the user's sentence that was not on a 19-item weak list. Two consequences,
 * both measured live on 2026-09-21 for
 * "can a 2 person garbage company do government contracts":
 *
 *   1. "person" was a token, because it came from "2 person".
 *   2. `.includes` has no word boundary, so "person" hit "PersonNEL Security",
 *      "PersonAL Alert Safety System" and "PersonAL Services Contractors".
 *
 * Thirteen results, none about garbage, all under "Matches what you described".
 *
 * ── The gate ──────────────────────────────────────────────────────────────
 * Only ACTIVITY terms (see ./activity) may establish a match. Context words —
 * person, company, government, contracts, services — score zero by
 * construction: they never reach this module.
 *
 *   direct   an activity term matches the title on a word boundary
 *   broader  weaker but real evidence: a shortened form of the term, a term
 *            from an explicitly-broader search, or a structured code overlap
 *   reject   no activity evidence in the title
 *
 * ── Three rules the false positives forced ────────────────────────────────
 * • WORD BOUNDARY, always. person ≠ personnel ≠ personal. guard ≠ lifeguard.
 * • EXPANDING the user's word is safe; SHORTENING it is not. "cater" →
 *   "Catering" keeps its meaning (direct). "trucking" → "Trucks" does not —
 *   an object is not the service (broader). Same asymmetry demotes
 *   "roofing" → "REPLACE ROOF SURFACES" to broader rather than dropping it.
 * • CODE OVERLAP ALONE IS NOT A MATCH. "ZFW Cafeteria and Vending Services"
 *   carries the same NAICS 722320 as real catering work. Codes can corroborate
 *   or demote; they cannot admit. Conversely a NULL NAICS never deletes a
 *   result that has real activity evidence — 47% of open notices are missing
 *   fields, and "Remediation and Specialty Cleaning Services" is a cleaning
 *   job whatever code it carries.
 *
 * ── Buyer names are not work ──────────────────────────────────────────────
 * "US COAST GUARD TRACEN PETALUMA PROPANE DELIVERY" is propane, not guarding.
 * Organisation names that contain a trade word are blanked before matching.
 */

import { extractBusinessActivity, type BusinessActivity } from './activity';
import type { ResolvedBusiness, SamSearchItem } from './types';

export type MatchTier = 'direct' | 'broader' | 'reject';

export interface MatchEvidence {
  tier: MatchTier;
  score: number;
  /** Activity terms that matched the title exactly (word-boundary). */
  matchedTerms: string[];
  /** Human-readable why, for debugging and the PR packet. Never rendered. */
  reasons: string[];
}

export interface RelevanceContext {
  activity: BusinessActivity;
  /** 6-digit NAICS the caller has ESTABLISHED. Empty is normal on /try. */
  codes?: readonly string[];
  /** Language from an explicitly-broader search. Corroborates, never admits. */
  broaderTerms?: readonly string[];
}

const SCORE = {
  activityPhrase: 5,
  activityWord: 4,
  shortenedForm: 2,
  broaderTerm: 2,
  codeExact: 2,
  codeGroup: 1,
} as const;

const DIRECT_FLOOR = SCORE.activityWord;
const BROADER_FLOOR = SCORE.shortenedForm;

/**
 * Organisation names whose words collide with real trades. The buyer is not
 * the work. Blanked from the title before any term is matched.
 */
const BUYER_NAME_PHRASES: readonly RegExp[] = [
  /\bu\.?\s?s\.?\s+coast\s+guard\b/gi,
  /\bcoast\s+guard\b/gi,
  /\b(?:air|army)?\s*national\s+guard\b/gi,
  /\bguard\s+bureau\b/gi,
  /\bcorps\s+of\s+engineers\b/gi,
  /\b(?:national\s+)?park\s+service\b/gi,
  /\bforest\s+service\b/gi,
  /\bmarine\s+corps\b/gi,
  /\bborder\s+patrol\b/gi,
  /\bfish\s+(?:and|&)\s+wildlife\b/gi,
  /\bpostal\s+service\b/gi,
  /\bsecret\s+service\b/gi,
];

export function stripBuyerNames(title: string): string {
  let out = String(title || '');
  for (const re of BUYER_NAME_PHRASES) out = out.replace(re, ' ');
  return out;
}

function normalizeTitle(title: string): string {
  return stripBuyerNames(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleWords(title: string): string[] {
  const n = normalizeTitle(title);
  return n ? n.split(' ') : [];
}

const SUFFIXES = ['s', 'es', 'ing', 'ed'] as const;

/** Does a title word mean the same thing as the term, possibly inflected? */
function wordMatchesExact(word: string, term: string): boolean {
  if (word === term) return true;
  // EXPANDING the user's word keeps its meaning: cater → catering/catered.
  for (const suffix of SUFFIXES) {
    if (word === term + suffix) return true;
    // clean → cleaning is term+ing; roof → roofing likewise.
  }
  // "cater" → "catering" is covered above; "cater" → "catered" too. Handle a
  // terminal -e being dropped/kept ("remodele" never occurs, but "service" →
  // "servicing" does).
  if (term.endsWith('e')) {
    const stem = term.slice(0, -1);
    for (const suffix of ['ing', 'ed'] as const) if (word === stem + suffix) return true;
  }
  return false;
}

/** The title carries a SHORTENED form of the term: trucking → Trucks. */
function wordMatchesShortened(word: string, term: string): boolean {
  if (word.length < 4 || word.length >= term.length) return false;
  if (!term.startsWith(word)) return false;
  const tail = term.slice(word.length);
  return (SUFFIXES as readonly string[]).includes(tail);
}

export type TermHit = 'exact' | 'shortened' | null;

/** Match one activity term against a title. Multi-word terms need every token. */
export function matchTerm(title: string, term: string): TermHit {
  const words = titleWords(title);
  if (words.length === 0) return null;
  const tokens = String(term || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  if (tokens.length === 0) return null;

  let anyShortened = false;
  for (const token of tokens) {
    if (words.some((w) => wordMatchesExact(w, token))) continue;
    if (words.some((w) => wordMatchesShortened(w, token))) {
      anyShortened = true;
      continue;
    }
    return null;
  }
  return anyShortened ? 'shortened' : 'exact';
}

/** Filler that carries no market signal inside a buying phrase. */
const BROADER_TERM_FILLER = new Set([
  'services', 'service', 'support', 'other', 'related', 'general', 'and', 'the',
]);

/** A broader/coverage phrase matches on any distinctive token it carries. */
export function matchBroaderTerm(title: string, term: string): boolean {
  const words = titleWords(title);
  if (words.length === 0) return false;
  const tokens = String(term || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 5 && !BROADER_TERM_FILLER.has(t));
  if (tokens.length === 0) return matchTerm(title, term) !== null;
  return tokens.some((t) => words.some((w) => wordMatchesExact(w, t)));
}

export function naicsSector(code: string | null | undefined): string | null {
  const digits = String(code || '').replace(/\D/g, '');
  if (digits.length < 2) return null;
  return digits.slice(0, 2);
}

function naicsGroup(code: string | null | undefined): string | null {
  const digits = String(code || '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return digits.slice(0, 4);
}

/** Score ONE opportunity. Pure — no corpus-wide context. */
export function scoreOpportunity(item: SamSearchItem, ctx: RelevanceContext): MatchEvidence {
  const title = item.title || '';
  const reasons: string[] = [];
  const matchedTerms: string[] = [];
  let score = 0;
  let hasExactActivity = false;

  for (const term of ctx.activity.terms) {
    const hit = matchTerm(title, term);
    if (hit === 'exact') {
      hasExactActivity = true;
      matchedTerms.push(term);
      const points = term.includes(' ') ? SCORE.activityPhrase : SCORE.activityWord;
      score = Math.max(score, points);
      reasons.push(`title names "${term}"`);
    } else if (hit === 'shortened') {
      matchedTerms.push(term);
      score = Math.max(score, SCORE.shortenedForm);
      reasons.push(`title carries a shortened form of "${term}"`);
    }
  }

  for (const term of ctx.broaderTerms || []) {
    // A coverage phrase like "Janitorial Services" must match on its
    // DISTINCTIVE token, not every token — "Janitorial Custodial" is the same
    // market and carries no "services". Same rule as `titleMatchesExpanded`.
    if (matchBroaderTerm(title, term)) {
      score = Math.max(score, SCORE.broaderTerm);
      reasons.push(`title names the broader search term "${term}"`);
    }
  }

  const codes = ctx.codes || [];
  if (codes.length > 0 && item.naics) {
    if (codes.includes(item.naics)) {
      score += SCORE.codeExact;
      reasons.push(`NAICS ${item.naics} is in the established set`);
    } else if (codes.some((c) => naicsGroup(c) && naicsGroup(c) === naicsGroup(item.naics))) {
      score += SCORE.codeGroup;
      reasons.push(`NAICS ${item.naics} shares an industry group with the established set`);
    }
  }

  let tier: MatchTier = 'reject';
  if (hasExactActivity && score >= DIRECT_FLOOR) tier = 'direct';
  else if (score >= BROADER_FLOOR) tier = 'broader';
  else reasons.push('no activity evidence in the title');

  return { tier, score, matchedTerms, reasons };
}

/**
 * Sector agreement, applied ONLY to demote and ONLY within the set matched by
 * the SAME activity term.
 *
 * "guard" exactly matches "WJHTC Armed Security Guard Services" (561612),
 * "Fairbanks Alaska CBOC Security Guard" (561612) and "Front Mounted Bus Grill
 * Guards" (336390). The third is a vehicle part; nothing in its title says so.
 * When a term's own matches agree on a sector by a clear majority, the odd one
 * out is adjacent evidence, not a described match.
 *
 * Scoped per-term on purpose: a genuinely multi-service business ("commercial
 * cleaning and small construction") has two terms with two different sectors,
 * and neither may demote the other.
 */
const SECTOR_MIN_ITEMS = 3;
const SECTOR_MAJORITY = 0.6;

function demoteSectorOutliers(
  scored: Array<{ item: SamSearchItem; evidence: MatchEvidence }>,
  activity: BusinessActivity,
): void {
  for (const term of activity.terms) {
    const forTerm = scored.filter(
      (s) => s.evidence.tier === 'direct' && s.evidence.matchedTerms.includes(term),
    );
    if (forTerm.length < SECTOR_MIN_ITEMS) continue;
    const withSector = forTerm.filter((s) => naicsSector(s.item.naics));
    if (withSector.length < SECTOR_MIN_ITEMS) continue;
    const counts = new Map<string, number>();
    for (const s of withSector) {
      const sec = naicsSector(s.item.naics) as string;
      counts.set(sec, (counts.get(sec) || 0) + 1);
    }
    let top: string | null = null;
    let topN = 0;
    for (const [sec, n] of counts) if (n > topN) { top = sec; topN = n; }
    if (!top || topN / withSector.length < SECTOR_MAJORITY) continue;
    for (const s of withSector) {
      const sec = naicsSector(s.item.naics) as string;
      if (sec === top) continue;
      // Another term may still hold it as a direct match — check the rest.
      const heldByAnother = s.evidence.matchedTerms.some((t) => t !== term);
      if (heldByAnother) continue;
      s.evidence.tier = 'broader';
      s.evidence.reasons.push(
        `NAICS sector ${sec} is an outlier among "${term}" matches (${topN}/${withSector.length} are sector ${top})`,
      );
    }
  }
}

/**
 * PHRASE ANCHOR — the best evidence in THIS result set sets the bar.
 *
 * "physical security guard services" resolves the activity to "guard", and
 * against the live cache on 2026-09-21 that put "25--Front Mounted Bus Grill
 * Guards", "Cattle Guards for the Tonto National Forest" and "MN-MORRIS
 * WMD-GUTTERS AND SNOW GUARDS" in the described-match group, above the two
 * real ones. Every "Guards" is a genuine word-boundary hit — nothing is
 * fabricated — they are just the wrong sense of it.
 *
 * The plain sector rule cannot catch this: those matches span too many
 * sectors for any majority to form. But the SAME result set contains matches
 * for the longer term "security guard", and those DO agree (561612). So:
 * when a multi-word activity term has real matches, a single-word-only match
 * in a different sector is adjacent evidence, not a described match.
 *
 * Only demotes. Fires only when the phrase has ≥2 agreeing matches, so one
 * stray phrase hit can never gut a legitimate single-word result set.
 */
const PHRASE_ANCHOR_MIN = 2;

function demoteAgainstPhraseAnchor(
  scored: Array<{ item: SamSearchItem; evidence: MatchEvidence }>,
): void {
  const phraseHits = scored.filter(
    (s) => s.evidence.tier === 'direct' && s.evidence.matchedTerms.some((t) => t.includes(' ')),
  );
  if (phraseHits.length < PHRASE_ANCHOR_MIN) return;
  const sectors = new Set(
    phraseHits.map((s) => naicsSector(s.item.naics)).filter((x): x is string => Boolean(x)),
  );
  if (sectors.size === 0 || sectors.size > 2) return;
  for (const s of scored) {
    if (s.evidence.tier !== 'direct') continue;
    if (s.evidence.matchedTerms.some((t) => t.includes(' '))) continue;
    const sec = naicsSector(s.item.naics);
    // An unknown sector is not evidence AGAINST the item — leave it alone.
    if (!sec || sectors.has(sec)) continue;
    s.evidence.tier = 'broader';
    s.evidence.reasons.push(
      `only the broad term matched; the specific term "${
        phraseHits[0].evidence.matchedTerms.find((t) => t.includes(' ')) ?? ''
      }" matches sector ${[...sectors].join('/')}, this is ${sec}`,
    );
  }
}

export interface ClassifiedOpportunities {
  direct: SamSearchItem[];
  broader: SamSearchItem[];
  rejected: SamSearchItem[];
  evidence: Array<{ item: SamSearchItem; evidence: MatchEvidence }>;
}

export function classifyOpportunities(
  items: readonly SamSearchItem[],
  ctx: RelevanceContext,
): ClassifiedOpportunities {
  // No activity means no defensible claim — admit nothing rather than guess.
  if (!ctx.activity.head || ctx.activity.terms.length === 0) {
    return {
      direct: [],
      broader: [],
      rejected: [...items],
      evidence: items.map((item) => ({
        item,
        evidence: { tier: 'reject', score: 0, matchedTerms: [], reasons: ['no business activity resolved'] },
      })),
    };
  }
  const scored = items.map((item) => ({ item, evidence: scoreOpportunity(item, ctx) }));
  demoteSectorOutliers(scored, ctx.activity);
  demoteAgainstPhraseAnchor(scored);
  return {
    direct: scored.filter((s) => s.evidence.tier === 'direct').map((s) => s.item),
    broader: scored.filter((s) => s.evidence.tier === 'broader').map((s) => s.item),
    rejected: scored.filter((s) => s.evidence.tier === 'reject').map((s) => s.item),
    evidence: scored,
  };
}

/** The activity behind a resolution, from the user's own words + derived keywords. */
export function activityFor(resolution: ResolvedBusiness): BusinessActivity {
  const text = [resolution.original, resolution.followUpUsed].filter(Boolean).join('\n');
  const derived = resolution.keywords.status === 'known' ? resolution.keywords.items : [];
  return extractBusinessActivity(text, derived);
}

/**
 * Back-compat: "is this worth showing at all" (direct OR broader).
 * Callers that need the two groups apart must use `classifyOpportunities`.
 */
export function isRelevantOpportunity(item: SamSearchItem, resolution: ResolvedBusiness): boolean {
  const activity = activityFor(resolution);
  if (!activity.head) return false;
  const codes = resolution.naicsCodes.status === 'known' ? resolution.naicsCodes.items : [];
  return scoreOpportunity(item, { activity, codes }).tier !== 'reject';
}

export function filterRelevantOpportunities(
  items: readonly SamSearchItem[],
  resolution: ResolvedBusiness,
): SamSearchItem[] {
  const activity = activityFor(resolution);
  const codes = resolution.naicsCodes.status === 'known' ? resolution.naicsCodes.items : [];
  const { direct, broader } = classifyOpportunities(items, { activity, codes });
  const keep = new Set<SamSearchItem>([...direct, ...broader]);
  return items.filter((i) => keep.has(i));
}
