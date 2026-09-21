/**
 * SOW → card facts (Tier 1) — three high-signal qualifying facts extracted from the SOW/PWS
 * text we already store (`sam_opportunities.sow_text`), for opps that don't carry a clean
 * structured column for them (scope: tasks/sow-card-facts-scope-2026-07-26.md).
 *
 * 1. brandName / brandNameOrEqual — a 🚩 wired-buy signal ("equal to Pollstar", "BRAND NAME
 *    STRATASYS", "salient characteristics").
 * 2. evalBasis — Best Value | LPTA | Trade-off, one enum. Changes the whole bid strategy.
 * 3. setAsideFromText — the set-aside AS STATED in the SOW body. Fills the ~22% gap where the
 *    structured `set_aside_code` column is null, and flags a mismatch when the structured
 *    column disagrees with the text.
 *
 * GROUNDING RULE ([[ground_in_real_data]]): every fact returned MUST carry the verbatim SOW
 * span that produced it (`evidence`). The regex/LLM only LABELS; if the extractor can't point
 * to real text, the fact is null — never fabricated. Brand-name and set-aside are unambiguous
 * enough to resolve with tight regex alone (validated on a 50-opp sample — see the backfill
 * script's sample-eval mode). evalBasis regexes first; only escalates to a single mini-tier LLM
 * call when the regex hits are genuinely AMBIGUOUS (both LPTA and best-value/tradeoff language
 * present) — NOT on every SOW with no regex hit at all (measured: only ~10% of SOWs state an
 * eval basis in text, so a blanket fallback would burn an LLM call on ~90% of the corpus for a
 * predictable null) — this repo's cheapest tier (`callLLM({ job: 'reasoning' })`, gpt-4o-mini
 * first) per LLM model tiering.
 */
import { callLLM } from '@/lib/llm/call-llm';
import { setGroupKey } from '@/lib/opportunities/map-data';

export type EvalBasis = 'best_value' | 'lpta' | 'tradeoff' | null;

export interface SowCardFacts {
  brandName: string | null;
  brandNameOrEqual: boolean;
  evalBasis: EvalBasis;
  setAsideFromText: string | null;
  setAsideMismatch: boolean;
  evidence: {
    brandName?: string;
    evalBasis?: string;
    setAside?: string;
  };
  computedAt: string;
}

// ---------- Brand-name / brand-name-or-equal ----------

// Words that showed up as JUNK captures on a real 50-opp sample when a bare "equal to X" was
// matched without requiring proximity to an actual brand-name/or-equal SIGNAL — "equal to" alone
// is common generic spec language ("materials equal to or greater than the original", "competence
// roughly equal to at the GS-5 level", "restored to a condition equal to or better than existing").
// Filtering the captured group against this stop-list (case-insensitive, whole-capture match)
// prevents those from being reported as a "brand". The SIGNAL (brandNameOrEqual=true) still fires
// off the phrase-level patterns below, which all require a brand-name-specific anchor, not "equal
// to" in isolation.
const BRAND_CAPTURE_STOPWORDS = new Set([
  'or', 'at', 'that', 'this', 'the', 'a', 'an', 'price', 'or better', 'or greater',
  'or greater than the', 'or better than the', 'or better than existing at the',
  'or exceed', 'that named as approved by', 'or approved equal',
  // Generic nouns that follow "brand name" WITHOUT actually naming a brand — e.g. "Brand Name
  // Justification documentation", "brand name product", "Brand Name requirement" — the signal
  // (brandNameOrEqual) still fires; only the (non-)capture is dropped.
  'product', 'products', 'item', 'items', 'requirement', 'requirements', 'justification',
  'justification documentation', 'documentation', 'approval', 'only', 'or equal',
]);

function isJunkCapture(s: string): boolean {
  const norm = s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (BRAND_CAPTURE_STOPWORDS.has(norm)) return true;
  // A capture that's ALL lowercase common words (no real proper-noun-looking token) is junk —
  // a real brand ("Pollstar", "STRATASYS", "Document Reader") has at least one token that starts
  // uppercase or is fully uppercase and 3+ chars (an acronym/model number).
  const tokens = s.trim().split(/\s+/);
  const looksNamed = tokens.some((t) => /^[A-Z][A-Za-z0-9&.\-®™']*$/.test(t) && t.length >= 3);
  return !looksNamed;
}

// Ordered most-specific → least-specific so the FIRST match is the best evidence span. Every
// pattern anchors on an EXPLICIT brand-name-or-equal SIGNAL phrase ("brand name", "brand-name",
// "similar or equal", "referenced brand name") — never a bare "equal to X", which is common
// generic spec language unrelated to sole-source/wired-buy framing (measured false-positive class
// on the 50-opp sample: "equal to or greater than the original materials").
const BRAND_PATTERNS: Array<{ re: RegExp; extractBrand: (m: RegExpMatchArray) => string | null }> = [
  // "similar or equal to <Brand>" / "or equal to <Brand>" immediately following an item/product
  // noun — the "similar or" / "or equal to" pairing (not bare "equal to") is the real signal.
  { re: /\b(?:similar\s+or\s+equal\s+to|or\s+equal\s+to)\s+([A-Z][A-Za-z0-9&.\-®™' ]{1,40}?)(?=[.,;:\n]|\s+or\s|\s+for\s|\s+is\s|$)/i,
    extractBrand: (m) => m[1]?.trim() || null },
  // "is/being seeking a <thing> equal to <Brand>. The referenced brand name product..." — the
  // "referenced brand name" callout confirms the earlier bare "equal to X" really was a brand.
  // Checked BEFORE the generic "brand name <X>" pattern below so it wins on text like
  // "equal to Pollstar. The referenced brand name product is provided solely to describe…"
  // (else the generic pattern would grab "brand name product" first and lose the real brand).
  { re: /\bequal\s+to\s+([A-Z][A-Za-z0-9&.\-®™' ]{1,40}?)\.?\s+(?:the\s+)?referenced\s+brand[\s-]?name/i,
    extractBrand: (m) => m[1]?.trim() || null },
  // "brand name <Brand>" (no "or equal") — e.g. "BRAND-NAME STRATASYS".
  { re: /\bbrand[\s-]?name[:\s-]+([A-Z][A-Za-z0-9&.\-®™' ]{1,40}?)(?=[.,;:\n]|\s+or\s|\s+is\s|$)/i,
    extractBrand: (m) => m[1]?.trim() || null },
  // Standalone signal phrases — no natural single-brand capture; evidence = the phrase itself.
  { re: /\bbrand[\s-]?name\s+or\s+equal\b/i, extractBrand: () => null },
  { re: /\bbrand[\s-]?name\s+only\b/i, extractBrand: () => null },
  { re: /\bbrand[\s-]?name\s+(?:requirement|justification|approval)\b/i, extractBrand: () => null },
  { re: /\bsalient\s+characteristics\b/i, extractBrand: () => null },
];

function detectBrandName(text: string): { brandName: string | null; brandNameOrEqual: boolean; evidence?: string } {
  for (const { re, extractBrand } of BRAND_PATTERNS) {
    const m = text.match(re);
    if (m) {
      let brand = extractBrand(m);
      if (brand && isJunkCapture(brand)) brand = null; // keep the true signal, drop the bad capture
      return { brandName: brand, brandNameOrEqual: true, evidence: m[0].trim() };
    }
  }
  return { brandName: null, brandNameOrEqual: false };
}

// ---------- Evaluation basis ----------

// LPTA before Best Value: "best value" sometimes appears in LPTA solicitations as a throwaway
// phrase ("price is the best value factor" is NOT the same claim as "Best Value Tradeoff"), so
// an explicit LPTA/lowest-price mention is the stronger, less-ambiguous signal and wins ties.
const LPTA_RE = /\b(?:LPTA|lowest[\s-]price[\s-]technically[\s-]acceptable)\b/i;
const TRADEOFF_RE = /\b(?:best[\s-]value[\s-]trade[\s-]?off|trade[\s-]?off\s+(?:process|analysis|basis)|combination\s+of\s+(?:technical|non[\s-]?price)\s+(?:and|factors))\b/i;
const BEST_VALUE_RE = /\bbest[\s-]value\b/i;

function detectEvalBasisRegex(text: string): { evalBasis: EvalBasis; evidence?: string; ambiguous: boolean } {
  const lpta = text.match(LPTA_RE);
  const tradeoff = text.match(TRADEOFF_RE);
  const bestValue = text.match(BEST_VALUE_RE);

  // Unambiguous: exactly one distinct signal type fired.
  if (lpta && !tradeoff && !bestValue) return { evalBasis: 'lpta', evidence: lpta[0].trim(), ambiguous: false };
  if (tradeoff && !lpta) return { evalBasis: 'tradeoff', evidence: tradeoff[0].trim(), ambiguous: false };
  if (bestValue && !lpta && !tradeoff) return { evalBasis: 'best_value', evidence: bestValue[0].trim(), ambiguous: false };
  // Both LPTA and a "best value"/tradeoff phrase appear — genuinely ambiguous (could be
  // boilerplate mentioning both, or a real conflict). Let the LLM read more context.
  if (lpta && (tradeoff || bestValue)) return { evalBasis: null, ambiguous: true };
  return { evalBasis: null, ambiguous: false };
}

async function detectEvalBasisLLM(text: string): Promise<{ evalBasis: EvalBasis; evidence?: string }> {
  // Cap input — this is a classification task, not a summarization task; the eval-basis clause
  // is almost always near the "evaluation"/"basis of award" section, but we don't know where, so
  // send a bounded slice to keep the mini-tier call cheap.
  const slice = text.slice(0, 6000);
  try {
    const { text: out } = await callLLM({
      job: 'reasoning',
      tool: 'sow_card_facts_eval_basis',
      userEmail: null,
      json: true,
      maxTokens: 120,
      temperature: 0,
      system: [
        'You read a federal solicitation/SOW excerpt and identify its EVALUATION BASIS — how the government',
        'will pick a winner. Reply ONLY JSON: {"basis":"best_value"|"lpta"|"tradeoff"|"unknown","quote":"<verbatim span from the text, or empty string>"}.',
        'Rules:',
        '1. "lpta" = Lowest Price Technically Acceptable / LPTA — price alone decides among technically acceptable offers.',
        '2. "tradeoff" = an explicit best-value TRADEOFF between price and non-price factors (technical/past performance weighed against price).',
        '3. "best_value" = "best value" language WITHOUT a clear tradeoff or LPTA framing (ambiguous best-value mention).',
        '4. "unknown" = the text does not state an evaluation basis.',
        '5. "quote" MUST be copied VERBATIM from the provided text — never invent or paraphrase. Empty string if basis is "unknown".',
        'Never guess a basis the text does not state.',
      ].join('\n'),
      user: slice,
    });
    const parsed = JSON.parse(out) as { basis?: string; quote?: string };
    const basis = parsed.basis;
    if (basis === 'best_value' || basis === 'lpta' || basis === 'tradeoff') {
      // Only trust the LLM's quote as evidence if it's actually present in the source text
      // (ground_in_real_data: never surface a fact the SOW doesn't literally contain).
      const quote = (parsed.quote || '').trim();
      const verified = quote && slice.toLowerCase().includes(quote.toLowerCase());
      return { evalBasis: basis, evidence: verified ? quote : undefined };
    }
    return { evalBasis: null };
  } catch {
    return { evalBasis: null };
  }
}

// ---------- Set-aside from text ----------

// Ordered most-specific → least-specific (checked in order; first match wins) so "SDVOSB"
// doesn't get swallowed by a generic "small business" pattern appearing earlier in the SOW.
// "SDVOSB\b" alone MISSES the raw SAM-code suffix forms that legitimately appear inline in a
// SOW's own metadata block (e.g. "SET-ASIDE\n\nSDVOSBC" — the exact SAM code, same family
// map-data.ts's SET_GROUPS lists: SDVOSBC/SDVOSBS) — a trailing \b fails between "B" and "C"
// (both word characters, no boundary). `C?|S?` after each acronym covers the coded-suffix form
// without over-broadening (still an explicit acronym match, not a fuzzy one).
const SET_ASIDE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bservice[\s-]disabled\s+veteran[\s-]owned\b|\bSDVOSB[CS]?\b/i, label: 'SDVOSB' },
  { re: /\bveteran[\s-]owned\s+small\s+business\b|\bVOSB\b/i, label: 'VOSB' },
  { re: /\bwomen[\s-]owned\s+small\s+business\b|\bWOSB(?:SS)?\b/i, label: 'WOSB' },
  { re: /\beconomically\s+disadvantaged\s+women[\s-]owned\b|\bEDWOSB(?:SS)?\b/i, label: 'EDWOSB' },
  { re: /\bHUBZone\b/i, label: 'HUBZone' },
  // \b8\(a\)\b was a bug: ")" and a following space are BOTH non-word chars, so no \b boundary
  // exists between them — the trailing \b silently prevented "8(a)" from ever matching (caught
  // by a unit test, not the sample eval). Anchor the trailing boundary on "a" instead.
  { re: /\b8\(a\b\)|\b8a\s+program\b/i, label: '8(a)' },
  { re: /\b100\s*%\s*small\s+business\b|\btotal\s+small\s+business\s+set[\s-]?aside\b/i, label: '100% Small Business' },
  { re: /\bsmall\s+business\s+set[\s-]?aside\b/i, label: 'Small Business' },
  { re: /\bfull\s+and\s+open\s+competition\b/i, label: 'Full and Open' },
  { re: /\bunrestricted\b/i, label: 'Unrestricted' },
];

// SF-1449/SF-33 box-13 forms print EVERY set-aside category as a checklist legend ("Small
// Business ( ) SDB ( ) HUBZone ( ) Woman-Owned SB ( ) SDVOSB ( ) 8(a) ( ) EDWOSB ( ) Other") —
// that's a MENU, not a selection, and naively matching the first category name in it (measured:
// "SDVOSB", "HUBZone", "WOSB" all found this way on real sample opps) falsely flagged mismatches
// against the real structured code. These forms line-wrap heavily (each category can span
// several newlines: "SERVICE-DISABLED\nVETERAN-OWNED\nSMALL BUSINESS\n(SDVOSB)\nHUBZONE SMALL\n
// BUSINESS\n8(A)\n...WOMEN-OWNED SMALL\nBUSINESS (WOSB)"), so the legend can spread past 200
// chars — detect it by counting DISTINCT category names in a WIDE window (~450 chars each side);
// 3+ distinct categories in that window is the legend, not a real single-category assertion.
const CATEGORY_PROBE = /\b(?:small\s+business|SDB|HUBZone|wom[ae]n[\s-]owned|SDVOSB|8\(a\)|EDWOSB|service[\s-]disabled\s+veteran)\b/gi;
const LEGEND_WINDOW = 450;

function isChecklistLegend(text: string, matchIndex: number): boolean {
  const windowStart = Math.max(0, matchIndex - LEGEND_WINDOW);
  const windowEnd = Math.min(text.length, matchIndex + LEGEND_WINDOW);
  const window = text.slice(windowStart, windowEnd);
  const hits = new Set((window.match(CATEGORY_PROBE) || []).map((h) => h.toLowerCase()));
  return hits.size >= 3;
}

// FAR clauses often DEFINE a set-aside term without asserting THIS solicitation uses it — e.g.
// `"Economically disadvantaged women-owned small business (EDWOSB) concern" means a small
// business concern that is at least 51 percent..." It automatically qualifies as a women-owned
// small business eligible under the WOSB Program.` (measured on a real sample opp: this whole
// paragraph is the standard FAR 52.212-3 "Offeror Representations and Certifications" boilerplate
// clause, present on most commercial-item solicitations REGARDLESS of the actual set-aside, and it
// discusses/defines every set-aside CATEGORY in turn — so a per-match "is there a quote right
// before this word" check is too narrow: the defining paragraph for one term can go on to mention
// the category name several sentences later, still inside the same boilerplate clause, with no
// quote immediately adjacent to THAT specific mention.)
//
// Fix: detect the FAR 52.212-3 clause's own heading ("Offeror Representations and
// Certifications") and exclude a bounded span after it — this is a fixed, well-known FAR
// provision, not something whose extent needs guessing per-opp. `FAR_DEFINITIONS_SPAN` covers
// the measured real extent of this clause's "(a) Definitions" + self-certification sub-sections.
const FAR_REPS_CERTS_HEADING = /\b(?:FAR\s+)?52\.212-3\b[^\n]{0,80}(?:Offeror\s+Representations\s+and\s+Certifications|Representations?\s+and\s+Certifications)/i;
const FAR_DEFINITIONS_SPAN = 12000;

function isInFarRepsCertsClause(text: string, matchIndex: number): boolean {
  const searchStart = Math.max(0, matchIndex - FAR_DEFINITIONS_SPAN);
  const before = text.slice(searchStart, matchIndex);
  const m = before.match(FAR_REPS_CERTS_HEADING);
  if (!m) return false;
  // Only exclude while we're still plausibly inside THIS clause block, not an unrelated later
  // mention a whole document-section away — bound it to the measured span.
  return matchIndex - (searchStart + (m.index ?? 0)) <= FAR_DEFINITIONS_SPAN;
}

// FAR clause checklists print EVERY applicable-clause line prefixed with a checkbox glyph
// (☒ = included / ☐ = NOT included), e.g. "☐ 52.219-4 Notice of Price Evaluation Preference for
// HUBZone Small Business Concerns" (unchecked) next to "☒ 52.219-6 Notice of Total Small Business
// Set-Aside" (checked) — measured on a real sample opp where the UNCHECKED HUBZone line otherwise
// won as a false "text says HUBZone" mismatch against the correct structured Small-Business code.
// If the nearest checkbox glyph before the match on its own line is ☐ (unchecked), skip the match
// — an unchecked FAR-clause line is an explicit NEGATIVE, not an assertion.
function isUncheckedClauseLine(text: string, matchIndex: number): boolean {
  const lineStart = text.lastIndexOf('\n', matchIndex) + 1;
  const linePrefix = text.slice(lineStart, matchIndex);
  if (/☐/.test(linePrefix)) return true;
  // The checkbox can sit a short distance before the clause title even when a clause number
  // ("52.219-4") separates them on the same visual line — check a wider prefix within the line.
  const wideStart = Math.max(0, matchIndex - 120);
  const widePrefix = text.slice(wideStart, matchIndex);
  const lastBox = Math.max(widePrefix.lastIndexOf('☒'), widePrefix.lastIndexOf('☐'));
  if (lastBox === -1) return false;
  return widePrefix[lastBox] === '☐';
}

function detectSetAsideFromText(text: string): { setAsideFromText: string | null; evidence?: string } {
  for (const { re, label } of SET_ASIDE_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = global.exec(text))) {
      if (isChecklistLegend(text, m.index) || isInFarRepsCertsClause(text, m.index) || isUncheckedClauseLine(text, m.index)) continue;
      return { setAsideFromText: label, evidence: m[0].trim() };
    }
  }
  return { setAsideFromText: null };
}

// Maps our text-derived label onto the SAME coarse groups map-data.ts's setGroupKey() uses for
// the structured `set_aside_code` column (SDVOSB / SB / 8A / WOSB / HZ / OTHER / NONE) — reusing
// the canonical grouping (rather than a parallel one) so "SDVOSBC" (structured) and
// "Service-Disabled Veteran-Owned..." (text) are recognized as the SAME family, not a false
// mismatch, and any future change to the grouping only has one place to update.
const TEXT_LABEL_TO_GROUP: Record<string, string> = {
  SDVOSB: 'SDVOSB', VOSB: 'SDVOSB',
  WOSB: 'WOSB', EDWOSB: 'WOSB',
  HUBZone: 'HZ', '8(a)': '8A',
  'Small Business': 'SB', '100% Small Business': 'SB',
  'Full and Open': 'NONE', Unrestricted: 'NONE',
};

function textLabelGroup(label: string | null): string | null {
  if (!label) return null;
  return TEXT_LABEL_TO_GROUP[label.trim()] ?? null;
}

/**
 * Extract Tier-1 SOW card facts. Pure + deterministic where possible; the ONE LLM escalation
 * (eval basis, only on regex ambiguity) is opt-in via `useLLMFallback` so callers/tests can run
 * fully offline. `structuredSetAsideCode` is the row's existing raw SAM `set_aside_code` column
 * (e.g. "SBA", "SDVOSBC", "NONE") — used only to compute the mismatch flag via the SAME grouping
 * `map-data.ts`'s pin coloring uses (`setGroupKey`), never overwritten.
 */
export async function extractSowCardFacts(
  sowText: string | null | undefined,
  structuredSetAsideCode: string | null | undefined,
  opts: { useLLMFallback?: boolean } = {},
): Promise<SowCardFacts> {
  const computedAt = new Date().toISOString();
  const text = (sowText || '').trim();
  if (!text || text.length < 50) {
    return { brandName: null, brandNameOrEqual: false, evalBasis: null, setAsideFromText: null, setAsideMismatch: false, evidence: {}, computedAt };
  }

  const brand = detectBrandName(text);
  const setAside = detectSetAsideFromText(text);

  const regexEval = detectEvalBasisRegex(text);
  let evalBasis = regexEval.evalBasis;
  let evalEvidence = regexEval.evidence;
  const useLLM = opts.useLLMFallback !== false; // default true in prod paths
  // Escalate ONLY on genuine regex ambiguity (conflicting LPTA + best-value/tradeoff signals) —
  // NOT on every long SOW with no hit. Measured on the real corpus: only ~10% of SOWs state an
  // eval basis in text at all, so the other ~90% would call the LLM and (correctly) return null
  // most of the time — that's the "reserve the LLM" principle in the scope doc, not a cost
  // shortcut: an honest null from a cheap regex-miss costs nothing, the same null from an LLM
  // call costs a token spend for 2,500+ opps at backfill scale.
  if (evalBasis === null && useLLM && regexEval.ambiguous) {
    const llmResult = await detectEvalBasisLLM(text);
    evalBasis = llmResult.evalBasis;
    evalEvidence = llmResult.evidence;
  }

  // Mismatch: structured column says one group, text says a DIFFERENT group. Null on either
  // side (nothing to compare) or same group → no mismatch (never a false alarm). The structured
  // code is a raw SAM code (e.g. "SBA", "SDVOSBC") → setGroupKey() (the SAME canonical grouping
  // the map pins use); a missing/blank code maps to 'NONE' by design, which we treat as "no
  // structured signal" here (a genuinely-null code shouldn't flag a mismatch against ANY text
  // label — that's the exact gap-fill case, not a conflict).
  const rawCode = (structuredSetAsideCode || '').trim();
  const structuredGroup = rawCode ? setGroupKey(rawCode) : null;
  const textGroup = textLabelGroup(setAside.setAsideFromText);
  const setAsideMismatch = !!(
    structuredGroup && structuredGroup !== 'NONE' && textGroup && textGroup !== 'NONE' && structuredGroup !== textGroup
  );

  const evidence: SowCardFacts['evidence'] = {};
  if (brand.evidence) evidence.brandName = brand.evidence;
  if (evalEvidence) evidence.evalBasis = evalEvidence;
  if (setAside.evidence) evidence.setAside = setAside.evidence;

  return {
    brandName: brand.brandName,
    brandNameOrEqual: brand.brandNameOrEqual,
    evalBasis,
    setAsideFromText: setAside.setAsideFromText,
    setAsideMismatch,
    evidence,
    computedAt,
  };
}

/** True when the extraction found at least one non-null fact worth storing. */
export function sowCardFactsHasContent(f: SowCardFacts): boolean {
  return !!(f.brandNameOrEqual || f.evalBasis || f.setAsideFromText);
}
