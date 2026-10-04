/**
 * Which population answers a NAICS-scoped Players request.
 *
 * `canonical` reads players_naics_recipients (full, award-derived, filter-then-rank). It is OFF by
 * default and MUST stay off until the production table exists AND has passed reconciliation —
 * required sequence: BQ awards repair → awards reconciliation → Players rebuild → Players
 * reconciliation (`npm run verify:oracles -- --only players`). Literal `canonical` only; any other
 * value (unset, `1`, `true`) keeps the legacy source.
 *
 * `legacy` reads top_contractors_by_dimension (national top 50 per NAICS). Every NAICS answer from
 * it is reported as `coverage_incomplete` — never a confident count and never a confident zero.
 */
export type PlayersSourceMode = 'canonical' | 'legacy';

export function playersSourceMode(env: Record<string, string | undefined> = process.env): PlayersSourceMode {
  return (env.PLAYERS_SOURCE || '').trim() === 'canonical' ? 'canonical' : 'legacy';
}
