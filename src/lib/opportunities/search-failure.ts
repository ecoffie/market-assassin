/**
 * A search that FAILED is not an empty market (Agent 3, 2026-11-14; Eric: "replace raw timeout failures with a clear,
 * actionable message; do not return an empty result set when the search actually failed").
 *
 * Measured: the four long benchmark paragraphs build 50–65 word-boundary regex clauses over title / description /
 * statement of work (~250 ms per clause over ~9.7k open notices) and hit Postgres's ~8.3 s statement timeout
 * (`57014 canceling statement due to statement timeout`) on every attempt. The Map returned HTTP 500 with that raw
 * text; FIND returned it as `error.message`. This module is the one classification both use. It changes no query.
 *
 * Not a fix for the timeout itself (stabilization gate A2 stays failing): see
 * tasks/search-stabilization-2026-11-14/LONG-QUERY-DESIGN.md.
 */
export type SearchFailureCode = 'search_too_long' | 'query_failed';

export const SEARCH_TOO_LONG_MESSAGE =
  'This search was too long to run in one pass, so Mindy did not finish it. These are not zero results. '
  + 'Shorten it to the products or services you sell (for example "valves, fittings" or "janitorial, custodial") and try again.';

export function isStatementTimeout(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  return String(e?.code ?? '') === '57014' || /statement timeout/i.test(String(e?.message ?? err ?? ''));
}

export function classifySearchFailure(err: unknown): { code: SearchFailureCode; message: string; status: number } {
  if (isStatementTimeout(err)) return { code: 'search_too_long', message: SEARCH_TOO_LONG_MESSAGE, status: 503 };
  const e = err as { message?: unknown } | null | undefined;
  return { code: 'query_failed', message: String(e?.message ?? err ?? 'Search failed'), status: 500 };
}
