/**
 * RULE D — location may CORROBORATE an incumbent, it may never ESTABLISH one.
 *
 * WHY (production, 2026-09-22). The sector/taxonomy guardrails in
 * `incumbent-evidence.ts` reject a candidate whose NAICS sector disagrees. They
 * cannot see the failure underneath both incidents: the distinctive-token overlap
 * that produced "high confidence" was **entirely geography**.
 *
 *   36C24226Q0857  "…Demolition and Abatement IDIQ East Orange and Lyons"
 *                  -> AT&T. The three tokens that matched were East, Orange, Lyons
 *                     (the two VA campuses). "demolition"/"abatement" never matched.
 *   SPE60525R0222  "3.22 COG 2 Northeastern United States"
 *                  -> Lockheed PAC-3. The matched tokens were literally `United`
 *                     and `States`. That title contains no work token at all.
 *
 * A same-sector candidate can be assembled the same way, so the taxonomy rules are
 * a floor, not a cure. Distinctive hits are therefore split into WORK hits and
 * LOCATION hits, and location alone cannot reach a confidence tier.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ⚠️ THE LEXICON MUST NOT CONTAIN A WORD THAT CAN NAME THE WORK.
 *
 * Federal procurement buys roads, highways, forests and grounds. Measured against
 * live `sam_opportunities` titles in work sectors (23x/56x/115x):
 *
 *     road 740 · building 2,024 · forest 709 · park 705 · grounds 433 · bridge 306
 *     harbor 263 · beach 161 · highway 24
 *     e.g. "Repair North Park Road at Milepost", "Ottawa National Forest Kangaroo
 *          Timber Marking", "Gardening and Exterior Grounds", "Lexington Harbor
 *          Breakwater Repair", "Western Federal Lands Highway Division"
 *
 * Classifying those as geography would delete the strongest evidence a road or
 * grounds recompete has. So this lexicon holds ONLY words that cannot plausibly
 * name a procurement's work object: directions, nation/scope words, and purely
 * administrative units.
 *
 * A SPECIFIC place is not handled here at all — it comes from the notice's own
 * `pop_city`/`pop_state` (see `locationTokens`). "East Orange" is excluded because
 * SAM records it as this notice's place of performance, never because it was typed
 * into this file. That is what keeps the rule data-driven instead of a gazetteer.
 *
 * (Note: `building`, `facility`, `site`, `area`, `district`, `region`, `base`,
 * `station`, `center`, `plant`, `depot`, `yard`, `field` are already dropped
 * upstream by NONDISTINCTIVE in `solicitation-incumbent.ts`, which runs BEFORE
 * this rule. They are deliberately absent here rather than duplicated.)
 */
import { US_STATE_NAMES, normalizeStateCode } from '@/lib/utils/us-states';

/**
 * Words that are ONLY ever geography. Deliberately narrow — see the header.
 * Anything that can be the OBJECT of a procurement stays out.
 */
const GEO_WORDS = new Set<string>([
  // compass + relative position
  'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western',
  'northeast', 'northwest', 'southeast', 'southwest', 'northeastern', 'northwestern',
  'southeastern', 'southwestern', 'central', 'upper', 'lower', 'midwest', 'midwestern',
  'greater', 'metro', 'metropolitan', 'inland',
  // nation / scope
  'united', 'states', 'usa', 'america', 'american', 'nationwide',
  'domestic', 'overseas', 'conus', 'oconus', 'continental', 'worldwide',
  // purely administrative units (never the thing being bought)
  'county', 'counties', 'parish', 'borough', 'township', 'municipal', 'municipality',
  'province', 'territory', 'vicinity', 'locality',
]);

/**
 * State identifiers safe to treat as geography GENERICALLY: the 2-letter codes and
 * SINGLE-WORD state names.
 *
 * ⚠️ Multi-word state names are deliberately NOT split into words here. Doing so
 * put `island` (Rhode Island), `new` (New Jersey/York/Mexico/Hampshire), `virginia`
 * (West Virginia), `carolina`, `dakota`, `york`, `mexico` and `columbia` into the
 * generic lexicon — and `island` is a work object ("BAR ISLAND DAM RECONSTRUCTION",
 * 333 live titles), while `new` appears in a huge share of all titles. A multi-word
 * state reaches the rule the correct way instead: through the NOTICE'S OWN
 * pop_state, via `locationTokens`, scoped to that solicitation.
 */
const STATE_TOKENS: Set<string> = (() => {
  const s = new Set<string>();
  for (const [code, name] of Object.entries(US_STATE_NAMES)) {
    s.add(code.toLowerCase());
    const words = name.toLowerCase().split(/\s+/);
    if (words.length === 1 && words[0].length >= 4) s.add(words[0]);
  }
  return s;
})();

/**
 * Tokens of THIS notice's own place of performance. The data-driven half of the
 * rule: a specific city is recognised because SAM recorded it for this notice.
 */
export function locationTokens(...values: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    for (const raw of String(v).split(/[^A-Za-z0-9]+/)) {
      const t = raw.toLowerCase();
      if (t.length >= 2) out.add(t);
    }
    // A state given as a name also contributes its code, and vice versa — an award
    // may spell it either way.
    const code = normalizeStateCode(String(v).trim());
    if (code) {
      out.add(code.toLowerCase());
      const name = US_STATE_NAMES[code];
      if (name) for (const w of name.toLowerCase().split(/\s+/)) if (w.length >= 2) out.add(w);
    }
  }
  return out;
}

/**
 * True when a token is geography rather than work. `noticePlaceTokens` carries the
 * notice's own pop_city/pop_state, so a place name specific to THIS solicitation is
 * recognised without ever being hardcoded.
 */
export function isLocationToken(token: string, noticePlaceTokens?: Set<string>): boolean {
  const t = token.toLowerCase();
  if (GEO_WORDS.has(t)) return true;
  if (STATE_TOKENS.has(t)) return true;
  if (noticePlaceTokens?.has(t)) return true;
  return false;
}

/** Split matched distinctive tokens into work evidence and location corroboration. */
export function splitEvidenceHits(
  hitTokens: readonly string[],
  noticePlaceTokens?: Set<string>,
): { workHits: number; locationHits: number } {
  let locationHits = 0;
  for (const t of hitTokens) if (isLocationToken(t, noticePlaceTokens)) locationHits += 1;
  return { workHits: hitTokens.length - locationHits, locationHits };
}

/**
 * RULE C — financial enrichment (SEC EDGAR) is only defensible on a candidate that
 * procurement evidence actually supports. A false incumbent must not cascade into a
 * named company's filings appearing on someone's pursuit.
 */
export function canEnrichIncumbentFinancials(candidate: {
  matchConfidence?: 'high' | 'medium' | 'low' | null;
  incumbent_certainty?: string | null;
} | null | undefined): boolean {
  if (!candidate) return false;
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const conf = candidate.matchConfidence;
  if (!conf || rank[conf] < rank.medium) return false;
  return candidate.incumbent_certainty === 'supported';
}
