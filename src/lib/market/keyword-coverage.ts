/**
 * Keyword → market coverage (the "drones live in 70+ NAICS" fix).
 *
 * Eric's insight: NAICS is the WRONG primary key — "drones" sprawls across 70+
 * codes ($245M, only 28% in the obvious one). Worse, NAICS 336411 alone is BOTH
 * over-broad (all aircraft) AND incomplete (misses drones in other codes).
 * Keyword search is precise AND complete. So: keyword is primary; NAICS is
 * AUTO-DERIVED behind the scenes (only for set-aside/size eligibility), never
 * something the user manages.
 *
 * This returns, for a keyword: the full ranked NAICS list, the total market, and
 * the smallest code set that covers ~90% of the spend (for eligibility filtering).
 */
import { fiscalYearTimePeriod } from '@/lib/utils/fiscal-year';

const BASE = 'https://api.usaspending.gov/api/v2/search/spending_by_category';

export interface KeywordCoverage {
  keyword: string;
  totalMarket: number;            // $ total across all codes that bought this
  naicsCount: number;             // distinct NAICS that bought it
  allNaics: { code: string; name: string; amount: number; pct: number }[];
  coverageCodes: string[];        // smallest NAICS set covering ~coverageTarget
  coveragePct: number;            // what the coverageCodes actually capture (~0.9)
  topCodePct: number;             // % the single biggest NAICS is (the "you'd miss the rest")
  // PSC view (the GovCon-expert lesson: PSC = what was BOUGHT, NAICS = who the
  // seller IS — PSC's top code is usually the literal product, e.g. "Unmanned
  // Aircraft" vs NAICS "Aircraft Manufacturing"). Surfaced to TEACH the user.
  pscCount: number;
  topPsc: { code: string; name: string } | null;
  topPscPct: number;
}

/**
 * Resolve a keyword to its market coverage. coverageTarget = the spend fraction
 * the derived code set should capture (default 0.9 = 90%).
 */
export async function keywordCoverage(keyword: string, coverageTarget = 0.9): Promise<KeywordCoverage | null> {
  const kw = (keyword || '').trim();
  if (kw.length < 2) return null;
  const filters = { keywords: [kw], time_period: [fiscalYearTimePeriod()], award_type_codes: ['A', 'B', 'C', 'D'] };
  const fetchCat = async (cat: 'naics' | 'psc') => {
    try {
      const res = await fetch(`${BASE}/${cat}/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, category: cat, limit: 100 }),
      });
      if (!res.ok) return [];
      const j = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (j.results || []).filter((r: any) => r.code && (r.amount || 0) > 0)
        .sort((a: { amount: number }, b: { amount: number }) => b.amount - a.amount);
    } catch { return []; }
  };
  try {
    const [rows, pscRows] = await Promise.all([fetchCat('naics'), fetchCat('psc')]);
    if (rows.length === 0) return null;

    const total = rows.reduce((s: number, r: { amount: number }) => s + r.amount, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allNaics = rows.map((r: any) => ({ code: r.code, name: r.name || r.code, amount: r.amount, pct: r.amount / total }));

    // Smallest code set that captures coverageTarget of the spend.
    const coverageCodes: string[] = [];
    let cum = 0;
    for (const r of allNaics) {
      coverageCodes.push(r.code);
      cum += r.pct;
      if (cum >= coverageTarget) break;
    }

    // PSC view — "what was bought" (the expert's point). Top PSC is usually the
    // literal product (e.g. 1550 Unmanned Aircraft) vs NAICS's vendor catch-all.
    const pscTotal = pscRows.reduce((s: number, r: { amount: number }) => s + r.amount, 0);
    const topPsc = pscRows[0] ? { code: pscRows[0].code, name: pscRows[0].name || pscRows[0].code } : null;

    return {
      keyword: kw,
      totalMarket: total,
      naicsCount: rows.length,
      allNaics,
      coverageCodes,
      coveragePct: cum,
      topCodePct: allNaics[0].pct,
      pscCount: pscRows.length,
      topPsc,
      topPscPct: pscTotal > 0 && pscRows[0] ? pscRows[0].amount / pscTotal : 0,
    };
  } catch {
    return null;
  }
}
