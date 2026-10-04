/**
 * Players copy — the ONE place the Maps Players count is worded.
 *
 * `PLAYERS_HEADER_TEXT_JS` is injected VERBATIM into the map's client JS, so it is plain ES5 source.
 *
 * Rules (Eric, 2026-10-04):
 *  - Proven Players = "Companies with federal award history in this market."
 *  - If only a ranked subset is displayed, say "Top N shown" — never "N companies exist".
 *  - Unavailable is never 0 and never sales copy. Partial coverage is never a confident zero.
 *  - Registered Players (SAM registration) are a separate population — not worded here.
 */
export const PROVEN_PLAYERS_LABEL = 'Proven Players';
export const PROVEN_PLAYERS_DESCRIPTION = 'Companies with federal award history in this market.';

export interface PlayersHeaderView {
  status: 'success_nonzero' | 'success_zero' | 'unavailable' | 'coverage_incomplete';
  total: number | null;
  shown: number;
  reason?: string | null;
}

/**
 * The header function as PLAIN JS SOURCE. It is injected into the map page verbatim and evaluated
 * here for tests — never via Function#toString of compiled TS, which picks up transpiler helpers
 * (`__name`) that do not exist in the browser (caught 2026-10-04 before ship).
 */
export const PLAYERS_HEADER_TEXT_JS = `function (v) {
  var desc = 'companies with federal award history in this market';
  var fmt = function (n) { return Number(n || 0).toLocaleString('en-US'); };
  if (v.status === 'unavailable') {
    return { count: 'Unavailable', detail: 'Players couldn’t load — this is not a count of zero', title: '' };
  }
  if (v.status === 'coverage_incomplete') {
    return {
      count: 'Top ' + fmt(v.shown),
      detail: v.shown > 0
        ? 'shown · partial list, not every company in this market'
        : 'shown · partial list — not evidence that none exist',
      title: v.reason || ''
    };
  }
  if (v.status === 'success_zero') return { count: '0', detail: desc, title: '' };
  var total = v.total == null ? v.shown : v.total;
  return { count: fmt(total), detail: desc + (v.shown < total ? ' · top ' + fmt(v.shown) + ' shown' : ''), title: '' };
}`;

// eslint-disable-next-line @typescript-eslint/no-implied-eval
export const playersHeaderText = new Function('return (' + PLAYERS_HEADER_TEXT_JS + ')')() as
  (v: PlayersHeaderView) => { count: string; detail: string; title: string };
