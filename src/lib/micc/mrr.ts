/**
 * Army Market Research Report (MRR) assembler.
 *
 * Pulls the DATA sections Mindy has real, citable data for — §5 taxonomy,
 * §9 procurement history, §11 potential suppliers, §12 small-business
 * opportunities, §15 market intelligence — from existing engines, and returns a
 * structured MRR + the list of sections the CO must complete (IGE, commerciality,
 * signatures). Matches the official Army MAY-2026 template.
 * (ACC-ORLANDO-MRR-SPEC.md · honesty: auto-filled fields cite USASpending; the rest is
 *  bracketed for the CO — we never invent an IGE or a determination.)
 */
import { procurementHistoryByCode, findCapableSmallBusinesses, type ProcurementHistoryRow, type CapableSmbRow } from '@/lib/bigquery/recipients';
import { keywordCoverage, codeMarketSize } from '@/lib/market/keyword-coverage';

export interface MrrInput {
  psc?: string;
  naics?: string;
  title?: string;     // requirement title (CO-provided)
  keyword?: string;   // optional: drives market-size coverage
}

export interface MrrResult {
  generatedAt: string;
  input: MrrInput;
  taxonomy: {
    psc: string | null;
    naics: string | null;
    marketTotal: number | null;     // total federal $ in this space
    topPsc: string | null;          // what's actually bought (from coverage)
    naicsCount: number | null;      // how many NAICS the work spans
  };
  procurementHistory: ProcurementHistoryRow[];
  suppliers: CapableSmbRow[];
  // `null` = the count could not be established. NOT zero — a null coerced to 0 would read as
  // evidence AGAINST a set-aside in an acquisition file, which is the opposite of the truth.
  supplierTotal: number | null;
  marketIntel: {
    supplierCount: number | null;      // distinct capable firms found; null = unmeasured
    smallBusinessCount: number | null; // of those, under the small ceiling; null = unmeasured
    setAsideWinners: number;           // floor: set-aside winners among the DISPLAYED top-N
    competition: 'broad' | 'moderate' | 'limited' | 'unknown';
  };
  smallBizRecommendation: {
    recommendedSetAside: string;
    rationale: string;
  };
  coMustComplete: string[];         // the bracketed sections (honest scope)
}

export async function buildMrr(input: MrrInput): Promise<MrrResult> {
  const { psc, naics, keyword } = input;

  // §5 market size: anchor to the EXACT PSC/NAICS the CO supplied (precise to the
  // requirement), NOT the broadening keyword search. The keyword path is built for
  // vague discovery and deliberately over-broadens — e.g. "ship repair" → $84B
  // "Combat Ships" (the whole naval-shipbuilding market) instead of the J998
  // ship-REPAIR market. In an MRR the CO always gives the code, so use it.
  const [history, smbAll, smbSmall, codeMarket, coverage] = await Promise.all([
    procurementHistoryByCode({ psc, naics, limit: 15, liveBq: true }).catch(() => [] as ProcurementHistoryRow[]),
    findCapableSmallBusinesses({ psc, naics, maxObligated: 100_000_000, limit: 50, liveBq: true }).catch(() => ({ rows: [] as CapableSmbRow[], total: 0 })),
    findCapableSmallBusinesses({ psc, naics, maxObligated: 25_000_000, limit: 1, liveBq: true }).catch(() => ({ rows: [] as CapableSmbRow[], total: 0 })),
    (psc || naics) ? codeMarketSize({ psc, naics }).catch(() => null) : Promise.resolve(null),
    keyword ? keywordCoverage(keyword).catch(() => null) : Promise.resolve(null),
  ]);

  const suppliers = smbAll.rows;
  // NOTE: this counts set-aside winners only within the displayed top-N suppliers
  // (smbAll.rows is capped at limit), NOT the full market — so it's a floor, not a
  // total. Phrase it as "at least N of the top suppliers" to stay honest with a CO.
  const setAsideWinners = suppliers.filter(s => s.won_set_aside).length;
  // ⚠️ HIGHEST-STAKES NUMBER IN THIS FILE. `smallBusinessCount` drives a FAR Part 19
  // "rule of two" SET-ASIDE RECOMMENDATION that a contracting officer may put in an
  // acquisition file. It must therefore be a MEASURED count or nothing at all — the count
  // query previously fell back to `rows.length` (the current page), so an unavailable count
  // would have produced a confident "50 suppliers" and a set-aside recommendation built on it.
  const supplierCount = smbAll.total;          // number | null
  const smallBusinessCount = smbSmall.total;   // number | null

  const competition: 'broad' | 'moderate' | 'limited' | 'unknown' =
    supplierCount === null ? 'unknown'
      : supplierCount >= 50 ? 'broad' : supplierCount >= 10 ? 'moderate' : 'limited';

  // Set-aside recommendation grounded in the real footprint (FAR Part 19 "rule
  // of two": 2+ capable small businesses → set-aside is supportable).
  const smallEnough = smallBusinessCount;
  let recommendedSetAside = 'Full and open competition';
  let rationale = `Only ${smallEnough} small business(es) with relevant award history were found — below the threshold to support a set-aside; recommend full and open with small-business participation encouraged.`;

  if (smallEnough === null) {
    // No count = NO RECOMMENDATION. Never let "we could not measure the market" become
    // "there are too few small businesses", which is what a null coerced to 0 would say —
    // and that reads as evidence AGAINST a set-aside in an acquisition file.
    recommendedSetAside = 'Undetermined — supplier evidence unavailable';
    rationale = 'The capable small-business count could not be established for this requirement, '
      + 'so no FAR 19 "rule of two" determination is supportable from this report. Re-run the '
      + 'market research, or perform the supplier search manually, before relying on a set-aside '
      + 'decision. (This is deliberately NOT reported as "0 small businesses found".)';
  } else if (smallEnough >= 2) {
    const saWinners = setAsideWinners;
    recommendedSetAside = 'Small business set-aside';
    rationale = `${smallEnough} small businesses with relevant award history were identified (FAR 19 "rule of two" supported); at least ${saWinners} of the top suppliers shown in §11 have won small-business set-aside work in this space. A small-business set-aside is recommended; review §11 for specific socioeconomic categories (8(a)/HUBZone/SDVOSB/WOSB).`;
  }

  return {
    generatedAt: new Date().toISOString(),
    input,
    taxonomy: {
      psc: psc || null,
      naics: naics || null,
      // Prefer the code-anchored market (precise to the requirement); fall back to
      // the keyword figure only if the code lookup returned nothing.
      marketTotal: codeMarket?.totalMarket ?? coverage?.totalMarket ?? null,
      topPsc: (codeMarket?.topPsc ?? coverage?.topPsc)
        ? `${(codeMarket?.topPsc ?? coverage!.topPsc)!.code} ${(codeMarket?.topPsc ?? coverage!.topPsc)!.name}`
        : null,
      // naicsCount only meaningful for the keyword spread; null when code-anchored.
      naicsCount: codeMarket ? null : (coverage?.naicsCount ?? null),
    },
    procurementHistory: history,
    suppliers,
    supplierTotal: supplierCount,
    marketIntel: { supplierCount, smallBusinessCount, setAsideWinners, competition },
    smallBizRecommendation: { recommendedSetAside, rationale },
    coMustComplete: [
      '§1–3 General Information (program, POCs, contracting activity)',
      '§4 Independent Government Estimate (IGE) — the Government cost estimate',
      '§6–8 Requirement description, performance requirements, background',
      '§10 Non-commercial rationale (if applicable)',
      '§13 Mandatory sources screening (AbilityOne, FPI, FSS)',
      '§14 Market research techniques used (your activities)',
      'Part 4 Signature pages (preparer, technical, contract specialist, CO)',
    ],
  };
}
