/**
 * Sector expansions (Eric, Jun 22 2026) — broad sector terms whose specialty
 * SUB-trades never surface under a literal keyword match. An electrical/plumbing
 * contractor's awards say "electrical" or "plumbing", NOT "construction", so a
 * USASpending `keyword=construction` exact-phrase search returns building +
 * heavy-civil + (legitimately) shipbuilding, but ZERO of the 238xxx specialty
 * trades. When a query hits a sector here we ALSO ground these sub-trade keywords
 * and merge — so "construction" surfaces 238210/238220/238160/238910… — still
 * award-backed (real USASpending $), not invented.
 *
 * Shared by both grounding paths so they stay in sync:
 *  - /api/suggest-codes (manual code lookup)
 *  - keywordCoverage()  (auto-onboarding profile-from-text)
 */
export const SECTOR_EXPANSIONS: { match: RegExp; keywords: string[] }[] = [
  {
    match: /\b(construction|contractor|contracting|building|builder|renovation|remodel(?:ing)?)\b/i,
    keywords: [
      'electrical contractor', 'plumbing heating air conditioning', 'roofing',
      'masonry', 'site preparation', 'concrete', 'painting', 'drywall',
      'framing carpentry', 'glass glazing', 'flooring',
    ],
  },
];

/** Sub-trade keywords to also ground for a broad sector term, or null if none. */
export function sectorSubTradeKeywords(keyword: string): string[] | null {
  const s = SECTOR_EXPANSIONS.find((e) => e.match.test(keyword));
  return s ? s.keywords : null;
}

/**
 * Terms-of-art expansion (Eric, Jul 28 2026 — real-run feedback) — a keyword whose OWN market is
 * badly under-counted because federal award TEXT spells it with synonyms/acronyms the literal term
 * never matches. This is NOT the sector→sub-trade case above (broad→specialty); it's ONE product
 * that goes by many names. USASpending keyword search is exact-phrase, so:
 *   - "drones" returned ~$243M because it missed UAS / UAV / unmanned aircraft / sUAS entirely.
 *   - "explosive ordnance disposal" collapsed to "explosive" → the $2.7B ammunition-MFG market
 *     (the OPPOSITE of a firm that makes EOD TOOLS).
 * We OR-expand the term to its real aliases so the market measured is the one a domain expert means.
 * Each `match` is anchored on the acronym/short form AND the spelled-out form so either input hits.
 * Keep entries to genuine terms of art where the literal keyword provably misses the market — the
 * naics_vocabulary + phrase-reduction handle ordinary words; this is only for the acronym gaps.
 */
// ORDER MATTERS: more-specific patterns FIRST (termOfArtSynonyms returns the first match). "counter-
// drone" must hit Counter-UAS, not the plain UAS entry — so Counter-UAS precedes UAS, and the UAS
// pattern explicitly refuses a preceding "counter-"/"c-" (negative lookbehind).
//
// `pscCodes` (optional) — AUTHORITATIVE PSC pinning for terms where the KEYWORD is fundamentally
// polluted (Eric, Jul 28 2026). "Explosive ordnance disposal" keyword-matches the ammunition/energetics
// MANUFACTURERS (top PSC 1376 BULK EXPLOSIVES $1.2B), NOT the EOD tools market — because that's who
// USASpending's exact-phrase search matches. For these, the honest market is "what was BOUGHT" (PSC),
// not "who the seller is" (keyword→NAICS). Verified live 2026-07-28: PSC 1385 "Surface Use EOD Tools &
// Equipment" = $173M + 1386 "Underwater Use EOD" = $39M → the real ~$212M EOD-equipment market, vs the
// keyword's misleading $2.81B. When pscCodes is set, keywordCoverage measures via those PSCs.
// `naicsCodes` (optional) — a TIGHT, CURATED set of the codes that genuinely ARE this industry, for
// the NAICS-based expansion path (recompete + contacts search, Eric 2026-07-28). Those datasets search
// NAMES (incumbent/company/person), so text-synonym expansion adds noise — the honest equivalent is
// "filter to firms/recompetes IN this industry" via NAICS. This is DELIBERATELY NOT the full ~90%
// keywordCoverage set: that tail includes tangential codes (drones' coverage carries 541110 Offices of
// Lawyers) which would surface law-firm recompetes under a "drones" search. Curated to the core codes,
// each verified against live USASpending (drones → the UAS-manufacturing core; EOD → the PSC-1385/1386
// performers). NOT a guess.
export const TERM_OF_ART_EXPANSIONS: { match: RegExp; keywords: string[]; pscCodes?: string[]; naicsCodes?: string[] }[] = [
  {
    // Counter-UAS / drone defense — a distinct market from UAS itself. Checked BEFORE UAS.
    match: /\b(c-?uas|counter-?uas|counter-?drones?|drone\s+defense)\b/i,
    keywords: ['counter-UAS', 'counter-drone', 'C-UAS', 'drone defense'],
    naicsCodes: ['334511', '336411', '541715'], // detection/C2, aircraft, R&D
  },
  {
    // Unmanned aircraft — the acronym soup is the whole problem. NOT when preceded by counter-/c-.
    // Keyword-based expansion works here (UAS/UAV terms are clean): drones $243M → $3.9B, real market.
    match: /(?<!counter-)(?<!counter\s)(?<!\bc-)\b(drones?|uas|uav|suas|unmanned\s+(aircraft|aerial|air)\s*(system|vehicle)?s?)\b/i,
    keywords: ['drone', 'unmanned aircraft', 'unmanned aerial', 'UAS', 'UAV', 'sUAS'],
    // The UAS-manufacturing CORE (verified live top-by-$), NOT the full coverage tail (which carries
    // 541110 Lawyers / 561210 Facilities that would surface unrelated recompetes).
    naicsCodes: ['336411', '336413', '334511'],
  },
  {
    // HYPERSONICS — the textbook "the market is bigger than the contracts that say its
    // name" case (Eric, 2026-08-15). The literal keyword finds the program offices that
    // spell it out; the surrounding work is bought as scramjet/ramjet propulsion, boost-
    // glide, and the named programs (CPS/LRHW), which never say "hypersonic".
    //
    // Verified live on USASpending FY23-25, per term, before inclusion:
    //   hypersonic                 $1.63B (top-10 agencies)
    //   conventional prompt strike $68.3M  → JHU APL
    //   air-breathing              $90.8M  → Raytheon
    //   ramjet                     $20.8M  → Alliant Techsystems
    //   boost glide                $10.5M  → BAE Systems
    //   scramjet                   $9.3M   → Physical Sciences Inc.
    //   long range hypersonic      $4.6M   → Honeywell
    // Expanded set → $1.81B and the buyer ranking becomes Air Force / Navy / MDA /
    // DARPA / Army — the actual hypersonics ecosystem.
    //
    // DELIBERATELY EXCLUDED, each measured and rejected as noise:
    //   'thermal protection system' — $50.8M led by SpaceX (spacecraft reentry, not
    //     hypersonic weapons). A real hypersonics input, but the phrase buys the wrong
    //     market.
    //   'glide body' alone — $0. Covered by 'boost glide'/'hypersonic glide body'.
    //   'high speed strike' — $2.5M and generic enough to pull unrelated strike work.
    match: /\b(hypersonics?|scramjets?|boost[-\s]?glide|hypersonic\s+(weapon|missile|glide))\b/i,
    keywords: [
      'hypersonic',
      'scramjet',
      'ramjet',
      'boost glide',
      'hypersonic glide body',
      'conventional prompt strike',
      'long range hypersonic weapon',
    ],
    // The core codes the CURATED keyword set actually buys through (live top-by-$),
    // not the coverage tail: ammunition mfg (the dominant code), physical-sciences R&D,
    // engineering services, and guided-missile propulsion.
    naicsCodes: ['332993', '541715', '541330', '336414', '336415'],
  },
  {
    // Explosive Ordnance Disposal — PSC-PINNED (the keyword is dominated by explosives MFG). The real
    // EOD *tools/equipment* market is PSC 1385 (surface) + 1386 (underwater), verified live.
    match: /\b(eod|explosive\s+ordnance\s+disposal|render\s+safe|ied\s+defeat|c-?ied|counter-?ied)\b/i,
    keywords: ['explosive ordnance disposal', 'EOD', 'render safe', 'IED defeat', 'counter-IED'],
    pscCodes: ['1385', '1386'],
    // The verified EOD-equipment performers (from the PSC-1385/1386 breakdown, live 2026-07-28).
    naicsCodes: ['561210', '334511', '336992'],
  },
  {
    // ISR — intelligence, surveillance, reconnaissance (acronym rarely spelled in the query).
    match: /\b(isr|intelligence\s+surveillance\s+reconnaissance)\b/i,
    keywords: ['ISR', 'intelligence surveillance reconnaissance', 'surveillance reconnaissance'],
  },
];

/**
 * The OR-array of aliases to ALSO query for a term of art (so the measured market includes the
 * synonym-spelled awards), or null when the keyword isn't a known term of art. Merged into the
 * coverage the same way sectorSubTradeKeywords() is — real USASpending $, never invented.
 */
export function termOfArtSynonyms(keyword: string): string[] | null {
  const s = TERM_OF_ART_EXPANSIONS.find((e) => e.match.test(keyword));
  return s ? s.keywords : null;
}

/**
 * Authoritative PSC codes to PIN a term of art to, or null. Only set for terms where the KEYWORD is
 * fundamentally polluted (EOD → the ammunition-MFG market). When present, the market must be measured
 * via these PSCs ("what was bought"), NOT the keyword's NAICS ("who the seller is"). Verified against
 * live USASpending before pinning — never a guessed code (a wrong pin just trades one wrong market
 * for another).
 */
export function termOfArtPscCodes(keyword: string): string[] | null {
  const s = TERM_OF_ART_EXPANSIONS.find((e) => e.match.test(keyword));
  return s?.pscCodes && s.pscCodes.length ? s.pscCodes : null;
}

/**
 * A TIGHT, curated NAICS set for a term of art (or null) — for datasets that search NAMES
 * (recompete = incumbent, contacts = company/person), where text-synonym expansion is noise. Searching
 * a term of art there filters to firms/recompetes IN this industry via these codes. Curated to the
 * core codes (NOT the full keywordCoverage tail), each verified against live USASpending.
 */
export function termOfArtNaicsCodes(keyword: string): string[] | null {
  const s = TERM_OF_ART_EXPANSIONS.find((e) => e.match.test(keyword));
  return s?.naicsCodes && s.naicsCodes.length ? s.naicsCodes : null;
}
