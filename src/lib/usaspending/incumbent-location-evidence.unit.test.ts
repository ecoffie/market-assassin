/**
 * RULE D — location corroborates an incumbent, it never establishes one.
 *
 * Pinned to both RC-3 production incidents AND to the opposite failure the rule
 * could cause: federal agencies buy roads, highways, forests and grounds, so a
 * lexicon that calls those "geography" would delete the strongest evidence a road
 * or grounds recompete has. Both directions are asserted here.
 */
import { describe, it, expect } from 'vitest';
import {
  canEnrichIncumbentFinancials,
  isLocationToken,
  locationTokens,
  splitEvidenceHits,
} from './incumbent-location-evidence';
import { groundIncumbent } from './incumbent-evidence';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const incSrc = readFileSync(join(process.cwd(), 'src/lib/usaspending/solicitation-incumbent.ts'), 'utf8');
/** Work-ish nouns NONDISTINCTIVE already removes upstream of Rule D. */
const NONDISTINCTIVE_SAMPLE = ['park', 'port', 'harbor', 'river', 'lake', 'island', 'coast'];

describe('RULE D — geography cannot carry an identification', () => {
  it('classifies generic geography without any place list', () => {
    for (const t of ['northeastern', 'united', 'states', 'east', 'county', 'township', 'metropolitan']) {
      expect(isLocationToken(t)).toBe(true);
    }
  });

  it('classifies 2-letter codes and SINGLE-WORD state names', () => {
    for (const t of ['nj', 'fl', 'florida', 'texas', 'virginia', 'ohio']) {
      expect(isLocationToken(t)).toBe(true);
    }
  });

  it('does NOT put the words of a MULTI-WORD state name into the generic lexicon', () => {
    // Splitting "Rhode Island" / "New Jersey" / "North Carolina" once leaked
    // `island`, `new`, `carolina` and `york` into the geography set — and `island`
    // is a work object ("BAR ISLAND DAM RECONSTRUCTION"). A multi-word state is
    // recognised through the notice's own pop_state instead.
    for (const t of ['island', 'new', 'jersey', 'york', 'carolina', 'dakota', 'mexico', 'columbia']) {
      expect(isLocationToken(t)).toBe(false);
    }
    const fromNotice = locationTokens('NJ');
    expect(isLocationToken('jersey', fromNotice)).toBe(true);
    expect(isLocationToken('new', fromNotice)).toBe(true);
  });

  it("recognises a SPECIFIC city only from the notice's own pop_city — not a hardcoded list", () => {
    expect(isLocationToken('orange')).toBe(false);
    expect(isLocationToken('lyons')).toBe(false);
    const fromNotice = locationTokens('East Orange', 'NJ');
    expect(isLocationToken('orange', fromNotice)).toBe(true);
    expect(isLocationToken('east', fromNotice)).toBe(true);
  });

  it('SPE60525R0222 shape — every hit is geography, so the work is unevidenced', () => {
    const { workHits, locationHits } = splitEvidenceHits(['Northeastern', 'United', 'States']);
    expect(workHits).toBe(0);
    expect(locationHits).toBe(3);
    const r = groundIncumbent({
      distinctiveHits: 3, workHits, locationHits,
      pscMatch: false, naicsMatch: true, matchConfidence: 'high',
    });
    expect(r.grounded).toBe(false);
    expect(r.reason).toMatch(/PLACE/i);
  });

  it('36C24226Q0857 shape — the VA campuses come from pop_city, not a gazetteer', () => {
    const places = locationTokens('East Orange', 'NJ');
    const { workHits, locationHits } = splitEvidenceHits(['East', 'Orange', 'Lyons'], places);
    expect(workHits).toBe(1); // only "Lyons" survives — the second campus is not in pop_city
    expect(locationHits).toBe(2);
    // One work token is not the >=2 bar, and no PSC match: not grounded.
    expect(groundIncumbent({
      distinctiveHits: 3, workHits, locationHits,
      pscMatch: false, naicsMatch: true, matchConfidence: 'high',
    }).grounded).toBe(false);
  });
});

/**
 * POSITIVE CONTROLS — the words federal agencies actually BUY.
 * Counts are live `sam_opportunities` titles in work sectors (23x/56x/115x),
 * measured 2026-09-22.
 */
describe('RULE D must not erase legitimate work terms', () => {
  /**
   * Tokens this lexicon preserves AND that actually reach the rule. Counts are live
   * `sam_opportunities` titles in work sectors (23x/56x/115x), measured 2026-09-22.
   *
   * ⚠️ Scope note, so this does not claim more than it does: `park`, `port`,
   * `harbor`, `river`, `lake`, `island`, `mountain`, `valley` and `coast` are
   * dropped UPSTREAM by NONDISTINCTIVE in solicitation-incumbent.ts, which runs
   * before Rule D. Keeping them out of the geography lexicon is correct, but it
   * does not make them usable work evidence — see the separate case below.
   */
  const REACHABLE_WORK_NOUNS: Array<[string, string]> = [
    ['road', '740 titles — "Repair North Park Road at Milepost"'],
    ['highway', '24 — "Western Federal Lands Highway Division"'],
    ['grounds', '433 — "Gardening and Exterior Grounds"'],
    ['forest', '709 — "Ottawa National Forest Kangaroo Timber Marking"'],
    ['bridge', '306 — "Milwaukee Bridge Resurfacing"'],
    ['beach', '161 — beach renourishment'],
    ['street', '60 — street repair / sweeping'],
    ['shore', '87 — "West Shore Lake Pontchartrain" shoreline protection'],
  ];

  it.each(REACHABLE_WORK_NOUNS)('%s is WORK, not geography (%s)', (token) => {
    expect(isLocationToken(token)).toBe(false);
  });

  it('a highway construction match still grounds', () => {
    const { workHits, locationHits } = splitEvidenceHits(['Highway', 'Resurfacing', 'Milling']);
    expect(workHits).toBe(3);
    expect(locationHits).toBe(0);
    expect(groundIncumbent({
      distinctiveHits: 3, workHits, locationHits,
      pscMatch: false, naicsMatch: true, matchConfidence: 'high',
    }).certainty).toBe('supported');
  });

  it('a grounds-maintenance match still grounds', () => {
    const { workHits } = splitEvidenceHits(['Grounds', 'Mowing', 'Landscaping']);
    expect(workHits).toBe(3);
    expect(groundIncumbent({
      distinctiveHits: 3, workHits, locationHits: 0,
      pscMatch: false, naicsMatch: true, matchConfidence: 'high',
    }).certainty).toBe('supported');
  });

  it('a road repair in a named place keeps its WORK evidence while the place corroborates', () => {
    // "Repair Road at Milepost 12" performed in Moose, WY.
    const places = locationTokens('Moose', 'WY');
    const { workHits, locationHits } = splitEvidenceHits(['Road', 'Repair', 'Milepost', 'Wyoming'], places);
    expect(workHits).toBe(3);      // Road, Repair, Milepost
    expect(locationHits).toBe(1);  // Wyoming
    expect(groundIncumbent({
      distinctiveHits: 4, workHits, locationHits,
      pscMatch: false, naicsMatch: true, matchConfidence: 'high',
    }).certainty).toBe('supported');
  });

  it('forest thinning is not deleted by a Forest Service notice location', () => {
    const { workHits } = splitEvidenceHits(['Forest', 'Thinning', 'Mastication']);
    expect(workHits).toBe(3);
  });

  it('DOCUMENTED LIMIT: some work nouns are already excluded upstream by NONDISTINCTIVE', () => {
    // They are correctly absent from the geography lexicon...
    for (const t of ['park', 'port', 'harbor', 'river', 'lake', 'island', 'coast']) {
      expect(isLocationToken(t)).toBe(false);
    }
    // ...but NONDISTINCTIVE drops them before Rule D ever sees them, so a
    // "Harbor Breakwater Repair" recompete cannot use `harbor` as evidence today.
    // Recorded as a known bound of the current matcher, not fixed here.
    expect(NONDISTINCTIVE_SAMPLE.every((t) => incSrc.includes(`'${t}'`))).toBe(true);
  });
});

describe('RULE C — financial enrichment needs >= medium AND supported', () => {
  it('refuses unsupported, uncertain, low-confidence and null', () => {
    expect(canEnrichIncumbentFinancials({ matchConfidence: 'high', incumbent_certainty: 'uncertain' })).toBe(false);
    expect(canEnrichIncumbentFinancials({ matchConfidence: 'high', incumbent_certainty: 'none' })).toBe(false);
    expect(canEnrichIncumbentFinancials({ matchConfidence: 'low', incumbent_certainty: 'supported' })).toBe(false);
    expect(canEnrichIncumbentFinancials(null)).toBe(false);
  });
  it('allows a supported, >= medium candidate', () => {
    expect(canEnrichIncumbentFinancials({ matchConfidence: 'medium', incumbent_certainty: 'supported' })).toBe(true);
    expect(canEnrichIncumbentFinancials({ matchConfidence: 'high', incumbent_certainty: 'supported' })).toBe(true);
  });
});

/**
 * THE BUYER'S NAME IS NOT GEOGRAPHY — driven through the REAL scoring path.
 *
 * The matcher previously built its place vocabulary from pop_city/pop_state PLUS
 * the buying organisation's name. For the agencies whose name IS the work, that
 * reclassified the single best piece of evidence as scenery:
 *
 *   FOREST SERVICE -> `forest` · NATIONAL PARK SERVICE -> `park`
 *   BUREAU OF RECLAMATION -> `reclamation` · ARMY CORPS OF ENGINEERS -> `engineers`
 *
 * These exercise `scoreAwardEvidence` itself — the function the matcher calls —
 * with the place-token set built exactly as `findLikelyPriorAwards` builds it.
 */
import { noticePlaceVocabulary, scoreAwardEvidence } from './solicitation-incumbent';

/**
 * THE MATCHER'S OWN builder — not a copy. If `findLikelyPriorAwards` ever folds the
 * buyer name back in, these tests go red.
 */
const placeTokensFor = (familyPlaces: string[]) =>
  noticePlaceVocabulary({ family_places: familyPlaces, agency: 'FOREST SERVICE', department: 'AGRICULTURE, DEPARTMENT OF' });

describe('FOREST SERVICE — buyer name must not consume the work term', () => {
  // "Mastication and Forest Thinning, Ocean Springs Unit" performed in Lakeview, OR.
  const TITLE_WORDS = ['Mastication', 'Forest', 'Thinning', 'Lakeview', 'Oregon'];
  const AWARD = {
    Description: 'MASTICATION AND FOREST THINNING SERVICES LAKEVIEW OREGON',
    'Recipient Name': 'TIMBER WORKS LLC',
    'Award Amount': 2_400_000,
    'Awarding Agency': 'AGRICULTURE, DEPARTMENT OF',
    'Awarding Sub Agency': 'FOREST SERVICE',
    PSC: 'F002',
  };

  it('counts forest-work terms as WORK and the place terms as LOCATION', () => {
    const places = placeTokensFor(['Lakeview', 'OR']);
    const ev = scoreAwardEvidence(AWARD, TITLE_WORDS, 'FOREST SERVICE', 'F002', places);
    // Mastication, Forest, Thinning are the work; Lakeview + Oregon are the place.
    expect(ev.workHits).toBe(3);
    expect(ev.locationHits).toBe(2);
    expect(ev.pscMatch).toBe(true);
  });

  it('the matcher builds its place vocabulary from pop_city/pop_state ONLY', () => {
    // Drive the REAL builder with a full notice shape, including the buyer whose
    // name is the work. `forest` must survive as work evidence.
    const built = noticePlaceVocabulary({
      family_places: ['Lakeview', 'OR'],
      agency: 'FOREST SERVICE',
      department: 'AGRICULTURE, DEPARTMENT OF',
    });
    expect(built.has('lakeview')).toBe(true);
    expect(built.has('oregon')).toBe(true);   // pop_state OR -> the name too
    expect(built.has('forest')).toBe(false);  // the buyer's word is NOT a place
    expect(built.has('service')).toBe(false);
    expect(built.has('agriculture')).toBe(false);
  });

  it('the buying agency name contributes NO location tokens', () => {
    // If the buyer name were folded in, `forest` would be a place and workHits 3 -> 2.
    const withBuyerFoldedIn = locationTokens('Lakeview', 'OR', 'FOREST SERVICE', 'AGRICULTURE, DEPARTMENT OF');
    expect(isLocationToken('forest', withBuyerFoldedIn)).toBe(true);   // the old, wrong behaviour
    expect(isLocationToken('forest', placeTokensFor(['Lakeview', 'OR']))).toBe(false); // now
    const wrong = scoreAwardEvidence(AWARD, TITLE_WORDS, 'FOREST SERVICE', 'F002', withBuyerFoldedIn);
    expect(wrong.workHits).toBe(2);                 // the regression this pins
    const right = scoreAwardEvidence(AWARD, TITLE_WORDS, 'FOREST SERVICE', 'F002', placeTokensFor(['Lakeview', 'OR']));
    expect(right.workHits).toBe(3);
  });

  it('scores higher than the same award stripped of its work terms', () => {
    const places = placeTokensFor(['Lakeview', 'OR']);
    const work = scoreAwardEvidence(AWARD, TITLE_WORDS, 'FOREST SERVICE', 'F002', places);
    const placeOnly = scoreAwardEvidence(
      { ...AWARD, Description: 'GUEST WIFI SERVICES LAKEVIEW OREGON' },
      TITLE_WORDS, 'FOREST SERVICE', null, places,
    );
    expect(placeOnly.workHits).toBe(0);
    expect(placeOnly.locationHits).toBe(2);
    expect(work.score).toBeGreaterThan(placeOnly.score);
    // And a place-only match cannot be grounded, whatever its NAICS says.
    expect(groundIncumbent({
      distinctiveHits: placeOnly.distinctiveHits, workHits: placeOnly.workHits,
      locationHits: placeOnly.locationHits, pscMatch: placeOnly.pscMatch,
      naicsMatch: true, matchConfidence: 'high', noticeSector: '11', awardSector: '11',
    }).grounded).toBe(false);
  });

  // Buyers whose distinguishing word REACHES Rule D (i.e. is not already dropped
  // by NONDISTINCTIVE). PARK/COAST are covered by the documented-limit case above.
  it.each([
    ['BUREAU OF RECLAMATION', 'reclamation', ['Reclamation', 'Canal', 'Lining']],
    ['ARMY CORPS OF ENGINEERS', 'engineers', ['Engineers', 'Levee', 'Dredging']],
    ['FOREST SERVICE', 'forest', ['Forest', 'Thinning', 'Mastication']],
  ])('%s — "%s" stays WORK, not the buyer or a place', (buyer, workTerm, titleWords) => {
    expect(isLocationToken(workTerm, placeTokensFor(['Denver', 'CO']))).toBe(false);
    const ev = scoreAwardEvidence(
      { Description: titleWords.join(' ').toUpperCase(), 'Recipient Name': 'X', 'Award Amount': 1_000_000, 'Awarding Sub Agency': buyer },
      titleWords, buyer, null, placeTokensFor(['Denver', 'CO']),
    );
    expect(ev.workHits).toBe(titleWords.length);
    expect(ev.locationHits).toBe(0);
  });
});
