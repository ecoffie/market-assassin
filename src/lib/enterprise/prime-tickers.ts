/**
 * Curated federal-prime → ticker overrides for the Enterprise/API feed (GOS #018).
 *
 * The EDGAR client matches by company NAME, which misses legacy/merged names — "Raytheon
 * Company" is now RTX Corp, "Harris Corporation" is now L3Harris (LHX), etc. For a feed a fund
 * trades on, landing the RIGHT current ticker is the whole value. This map overrides the fuzzy
 * name match for the top public federal contractors; anything not here still falls back to the
 * name match (and to grounded=false when genuinely private).
 *
 * Keyed by a substring of the normalized incumbent name → current US ticker. Order matters:
 * more specific phrases first (e.g. "general dynamics" before "general").
 */
const PRIME_TICKER_RULES: Array<[pattern: string, ticker: string]> = [
  ['raytheon', 'RTX'], ['rtx corp', 'RTX'], ['united technologies', 'RTX'],
  ['lockheed', 'LMT'],
  ['boeing', 'BA'],
  ['northrop', 'NOC'],
  ['general dynamics', 'GD'],
  ['l3harris', 'LHX'], ['l-3 harris', 'LHX'], ['l3 technologies', 'LHX'], ['harris corp', 'LHX'],
  ['leidos', 'LDOS'],
  ['booz allen', 'BAH'],
  ['science applications', 'SAIC'], ['saic', 'SAIC'],
  ['caci', 'CACI'],
  ['huntington ingalls', 'HII'],
  ['kbr', 'KBR'],
  ['jacobs', 'J'],
  ['parsons', 'PSN'],
  ['v2x', 'VVX'], ['vectrus', 'VVX'],
  ['maximus', 'MMS'],
  ['amentum', 'AMTM'],
  ['accenture', 'ACN'],
  ['international business machines', 'IBM'],
  ['honeywell', 'HON'],
  ['ge aerospace', 'GE'], ['general electric', 'GE'],
  ['textron', 'TXT'],
  ['oshkosh', 'OSK'],
  ['l3 ', 'LHX'],
];

const norm = (s: string) => (s || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

/** The current ticker for a known public federal prime, or null (→ fall back to EDGAR name match). */
export function primeTickerFor(incumbentName: string | null | undefined): string | null {
  if (!incumbentName) return null;
  const n = norm(incumbentName);
  for (const [pattern, ticker] of PRIME_TICKER_RULES) if (n.includes(pattern)) return ticker;
  return null;
}
