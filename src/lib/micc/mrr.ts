/**
 * Army Market Research Report (MRR) assembler.
 *
 * Pulls the DATA sections Mindy has real, citable data for — §5 taxonomy,
 * §9 procurement history, §11 potential suppliers, §12 small-business
 * opportunities, §15 market intelligence — from existing engines, and returns a
 * structured MRR + the list of sections the CO must complete (IGE, commerciality,
 * signatures). Matches the official Army MAY-2026 template.
 * (MICC-MRR-SPEC.md · honesty: auto-filled fields cite USASpending; the rest is
 *  bracketed for the CO — we never invent an IGE or a determination.)
 */
import { procurementHistoryByCode, findCapableSmallBusinesses, type ProcurementHistoryRow, type CapableSmbRow } from '@/lib/bigquery/recipients';
import { keywordCoverage } from '@/lib/market/keyword-coverage';

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
  supplierTotal: number;
  marketIntel: {
    supplierCount: number;          // distinct capable firms found
    smallBusinessCount: number;     // of those, under the small ceiling
    setAsideWinners: number;        // firms that have won set-aside work
    competition: 'broad' | 'moderate' | 'limited';
  };
  smallBizRecommendation: {
    recommendedSetAside: string;
    rationale: string;
  };
  coMustComplete: string[];         // the bracketed sections (honest scope)
}

export async function buildMrr(input: MrrInput): Promise<MrrResult> {
  const { psc, naics, keyword } = input;

  const [history, smbAll, smbSmall, coverage] = await Promise.all([
    procurementHistoryByCode({ psc, naics, limit: 15, liveBq: true }).catch(() => [] as ProcurementHistoryRow[]),
    findCapableSmallBusinesses({ psc, naics, maxObligated: 100_000_000, limit: 50, liveBq: true }).catch(() => ({ rows: [] as CapableSmbRow[], total: 0 })),
    findCapableSmallBusinesses({ psc, naics, maxObligated: 25_000_000, limit: 1, liveBq: true }).catch(() => ({ rows: [] as CapableSmbRow[], total: 0 })),
    keyword ? keywordCoverage(keyword).catch(() => null) : Promise.resolve(null),
  ]);

  const suppliers = smbAll.rows;
  const setAsideWinners = suppliers.filter(s => s.won_set_aside).length;
  const supplierCount = smbAll.total;
  const smallBusinessCount = smbSmall.total;

  const competition: 'broad' | 'moderate' | 'limited' =
    supplierCount >= 50 ? 'broad' : supplierCount >= 10 ? 'moderate' : 'limited';

  // Set-aside recommendation grounded in the real footprint (FAR Part 19 "rule
  // of two": 2+ capable small businesses → set-aside is supportable).
  const smallEnough = smallBusinessCount;
  let recommendedSetAside = 'Full and open competition';
  let rationale = `Only ${smallEnough} small business(es) with relevant award history were found — below the threshold to support a set-aside; recommend full and open with small-business participation encouraged.`;
  if (smallEnough >= 2) {
    const saWinners = setAsideWinners;
    recommendedSetAside = 'Small business set-aside';
    rationale = `${smallEnough} small businesses with relevant award history were identified (FAR 19 "rule of two" supported); ${saWinners} have won small-business set-aside work in this space. A small-business set-aside is recommended; review §11 for specific socioeconomic categories (8(a)/HUBZone/SDVOSB/WOSB).`;
  }

  return {
    generatedAt: new Date().toISOString(),
    input,
    taxonomy: {
      psc: psc || null,
      naics: naics || null,
      marketTotal: coverage?.totalMarket ?? null,
      topPsc: coverage?.topPsc ? `${coverage.topPsc.code} ${coverage.topPsc.name}` : null,
      naicsCount: coverage?.naicsCount ?? null,
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
