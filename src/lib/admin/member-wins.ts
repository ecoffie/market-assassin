/**
 * Pure counting for /api/admin/member-contract-wins: which companies (by SAM UEI) Mindy members
 * saved, when each member joined, and what those companies won — lifetime and since joining.
 */
export const UEI_RE = /^[A-Z0-9]{12}$/;

export type ProfileRow = { user_email: string; uei: string | null; created_at: string | null };
export type SettingsRow = { user_email: string; created_at: string | null };
export type AwardRow = { recipient_uei: string; award_id: string; first_action: string; amount: number };

/** UEI → earliest join date (ms) of any member who saved it; NaN when no date is known. */
export function memberUeis(profiles: ProfileRow[], settings: SettingsRow[]) {
  const settingsDate = new Map<string, string>();
  for (const s of settings) if (s.user_email && s.created_at) settingsDate.set(s.user_email.toLowerCase(), s.created_at);
  const joined = new Map<string, number>();
  let withUei = 0;
  for (const p of profiles) {
    const uei = (p.uei || '').trim().toUpperCase();
    if (!UEI_RE.test(uei)) continue;
    withUei += 1;
    const dates = [p.created_at, settingsDate.get((p.user_email || '').toLowerCase())]
      .filter(Boolean).map((d) => Date.parse(d as string)).filter((n) => Number.isFinite(n));
    const date = dates.length ? Math.min(...dates) : NaN;
    const prev = joined.get(uei);
    if (prev === undefined || (Number.isFinite(date) && (!Number.isFinite(prev) || date < prev))) joined.set(uei, date);
  }
  return { joined, withUei };
}

/** Counts only awards with positive net obligation. Contracts = distinct (UEI, award_id). */
export function tallyWins(rows: AwardRow[]) {
  const won = rows.filter((r) => Number(r.amount) > 0);
  return {
    companiesWithWins: new Set(won.map((r) => r.recipient_uei)).size,
    contracts: new Set(won.map((r) => `${r.recipient_uei}|${r.award_id}`)).size,
    dollars: Math.round(won.reduce((s, r) => s + Number(r.amount), 0)),
  };
}

/** Awards whose first action is on/after the member's join date (unknown join date → excluded). */
export function sinceJoining(rows: AwardRow[], joined: Map<string, number>) {
  return rows.filter((r) => {
    const j = joined.get(r.recipient_uei);
    return j !== undefined && Number.isFinite(j) && Date.parse(r.first_action) >= j;
  });
}
