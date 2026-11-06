/**
 * How a recompete becomes a pursuit — ONE definition shared by the map's "Track this recompete",
 * the map's Saved page "Start Pursuit" and the app's "Saved on the map" tab.
 *
 * The pursuit is keyed on the PIID, not the recompete_opportunities.contract_id (CONT_AWD_…): the
 * pipeline writer drops ids that fail isValidSamNoticeId, and a contract_id fails it, which left the
 * pursuit with no notice_id and no UNIQUE(user_email, notice_id) duplicate protection.
 *
 * The map's inline scripts can't import TS, so they build the regex from PIID_ROLLUP_SUFFIX_SOURCE
 * (interpolated into the emitted script) — the three surfaces cannot drift.
 */

/** The vehicle rollup's "(+N more)" suffix on a PIID, as a RegExp source (case-insensitive). */
export const PIID_ROLLUP_SUFFIX_SOURCE = '\\s*\\(\\+\\d+\\s*more\\)\\s*$';

export const RECOMPETE_PURSUIT_SOURCE = 'recompete_map';

/** "N0018926F0012 (+3 more)" → "N0018926F0012"; '' when there is no PIID. */
export function cleanRecompetePiid(v: unknown): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  return s.replace(new RegExp(PIID_ROLLUP_SUFFIX_SOURCE, 'i'), '').trim();
}

/** "Recompete: <incumbent or title> · <PIID>" — the title every surface gives a recompete pursuit. */
export function recompetePursuitTitle(name: unknown, piid: string): string {
  const n = (typeof name === 'string' ? name : '').trim() || 'Awarded contract';
  return `Recompete: ${n} · ${piid}`;
}
