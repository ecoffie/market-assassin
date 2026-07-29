/**
 * QUERY-TIME NAICS broadening for briefing opportunity fetches (recall, not persist).
 *
 * A curated subsector→member map used to widen a user's codes when fetching opportunities for their
 * briefing template — so a 3-digit prefix ('541') pulls its common members, and a partial code
 * matches its family. This is a MATCH-TIME broadening (the PERSIST-vs-QUERY rule in CLAUDE.md: broad
 * recall is correct here; it is NOT written to any profile), and it is deliberately a small CURATED
 * table, NOT the full lib expander — swapping to expandNAICSCodes would change matching breadth for
 * every briefing user. Kept curated on purpose.
 *
 * Was copy-pasted (byte-identical) into 3 briefing routes: send-all-briefings, precompute-weekly-
 * briefings, weekly-deep-dive. Consolidated here (Eric/QA 2026-07-28). Two bugs fixed in the process:
 *   1. send-all-briefings was MISSING the no-match fallback → an unmatched code dropped entirely,
 *      leaving that user's briefing to fetch on a shorter/empty NAICS set.
 *   2. ALL THREE checked `expanded.length === 0` (the TOTAL accumulated across every code) for the
 *      fallback — so once ANY earlier code matched, a later unmatched code was silently swallowed and
 *      never kept. The guard must be PER-CODE.
 */

/** Curated subsector (3-digit) → representative member codes. Query-time recall only. */
export const NAICS_BRIEFING_EXPANSION: Record<string, string[]> = {
  '236': ['236220', '236210', '236115', '236116', '236117', '236118'], // Construction of Buildings
  '237': ['237110', '237120', '237130', '237210', '237310', '237990'], // Heavy & Civil Engineering
  '238': ['238110', '238120', '238130', '238140', '238150', '238160', '238170', '238190', '238210', '238220', '238290', '238310', '238320', '238330', '238340', '238350', '238390', '238910', '238990'], // Specialty Trade Contractors
  '541': ['541511', '541512', '541513', '541519', '541611', '541612', '541613', '541614', '541618', '541620', '541690', '541710', '541720', '541810', '541820', '541830', '541840', '541850', '541860', '541870', '541890', '541910', '541921', '541922', '541930', '541940', '541990'], // Professional Services
  '518': ['518210'], // Data Processing, Hosting
  '519': ['519130', '519190'], // Other Information Services
  '561': ['561110', '561210', '561311', '561312', '561320', '561330', '561410', '561421', '561422', '561431', '561439', '561440', '561450', '561491', '561492', '561499', '561510', '561520', '561591', '561599', '561611', '561612', '561613', '561621', '561622', '561710', '561720', '561730', '561740', '561790', '561910', '561920', '561990'], // Administrative and Support Services
};

/** Cap on the expanded set fed to the opportunity fetch (unchanged from the original route copies). */
export const NAICS_BRIEFING_EXPANSION_CAP = 10;

/**
 * Broaden a user's NAICS codes for a briefing opportunity fetch. 3-digit prefix → its curated members;
 * 6-digit → kept exact; anything else → its family by prefix, else KEPT AS-IS (never dropped).
 */
export function expandNaicsForBriefing(codes: string[] | null | undefined): string[] {
  const expanded: string[] = [];
  for (const raw of codes || []) {
    const code = String(raw || '').trim();
    if (!code) continue;
    if (code.length === 3 && NAICS_BRIEFING_EXPANSION[code]) {
      expanded.push(...NAICS_BRIEFING_EXPANSION[code]);
      continue;
    }
    if (code.length === 6) {
      expanded.push(code);
      continue;
    }
    // Partial/other: try to expand by family prefix; track whether THIS code matched.
    let matched = false;
    for (const [prefix, fullCodes] of Object.entries(NAICS_BRIEFING_EXPANSION)) {
      if (code.startsWith(prefix)) {
        expanded.push(...fullCodes);
        matched = true;
        break;
      }
    }
    // No family match → keep the code as-is rather than drop it. PER-CODE (the old
    // `expanded.length === 0` check swallowed unmatched codes once any earlier code had matched).
    if (!matched && code.length >= 3) expanded.push(code);
  }
  return [...new Set(expanded)].slice(0, NAICS_BRIEFING_EXPANSION_CAP);
}
