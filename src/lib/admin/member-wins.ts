/**
 * Pure counting for /api/admin/member-contract-wins: which companies (by SAM UEI) Mindy members
 * saved, when each member joined, and what those companies won — lifetime and since joining.
 */
export const UEI_RE = /^[A-Z0-9]{12}$/;

/** Staff, demo and reviewer accounts. Their Vault holds sample companies (e.g. the demo account's
 *  SIKICH FEDERAL INC), so they must never count as a member's win. */
const SAMPLE_DOMAINS = ['getmindy.ai', 'govcongiants.com'];
export function isSampleAccount(email: string | null | undefined): boolean {
  const domain = (email || '').trim().toLowerCase().split('@')[1] || '';
  return SAMPLE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export type ProfileRow = { user_email: string; uei: string | null; created_at: string | null };
export type SettingsRow = { user_email: string; created_at: string | null };
export type AwardRow = {
  recipient_uei: string; award_id: string; first_action: string; amount: number;
  recipient_name?: string | null; awarding_agency?: string | null;
};

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

/**
 * Members whose company won a NEW award (first action) in the last `months`, one row per company,
 * biggest first. `now` is injectable for tests.
 */
export function recentWinners(rows: AwardRow[], emailsByUei: Map<string, string[]>, months: number, now = Date.now()) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const recent = rows.filter((r) => Number(r.amount) > 0 && Date.parse(r.first_action) >= cutoff.getTime());
  const byUei = new Map<string, { uei: string; company: string; emails: string[]; contracts: number; dollars: number; latestAward: string; agencies: Set<string> }>();
  for (const r of recent) {
    const cur = byUei.get(r.recipient_uei) ?? {
      uei: r.recipient_uei, company: r.recipient_name || '', emails: emailsByUei.get(r.recipient_uei) ?? [],
      contracts: 0, dollars: 0, latestAward: r.first_action, agencies: new Set<string>(),
    };
    cur.contracts += 1;
    cur.dollars += Number(r.amount);
    if (r.first_action > cur.latestAward) cur.latestAward = r.first_action;
    if (!cur.company && r.recipient_name) cur.company = r.recipient_name;
    if (r.awarding_agency) cur.agencies.add(r.awarding_agency);
    byUei.set(r.recipient_uei, cur);
  }
  const members = [...byUei.values()]
    .map((m) => ({ ...m, dollars: Math.round(m.dollars), agencies: [...m.agencies].slice(0, 5) }))
    .sort((a, b) => b.dollars - a.dollars);
  return { since: cutoff.toISOString().slice(0, 10), ...tallyWins(recent), members };
}

export type CompanyBreakdown = {
  company: string; uei: string; emails: string[]; joined: string | null;
  lifetime: { contracts: number; dollars: number };
  last12Months: { contracts: number; dollars: number };
  sinceJoining: { contracts: number; dollars: number };
  latestAward: string | null; agencies: string[];
};

/** One row per member company that has ANY positive award, biggest lifetime dollars first. */
export function companyBreakdown(
  rows: AwardRow[], emailsByUei: Map<string, string[]>, joined: Map<string, number>, now = Date.now(),
): CompanyBreakdown[] {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
  const out = new Map<string, CompanyBreakdown & { _ag: Map<string, number> }>();
  for (const r of rows) {
    const amt = Number(r.amount);
    if (!(amt > 0)) continue;
    const j = joined.get(r.recipient_uei);
    const c = out.get(r.recipient_uei) ?? {
      company: r.recipient_name || '', uei: r.recipient_uei, emails: emailsByUei.get(r.recipient_uei) ?? [],
      joined: j !== undefined && Number.isFinite(j) ? new Date(j).toISOString().slice(0, 10) : null,
      lifetime: { contracts: 0, dollars: 0 }, last12Months: { contracts: 0, dollars: 0 }, sinceJoining: { contracts: 0, dollars: 0 },
      latestAward: null, agencies: [], _ag: new Map<string, number>(),
    };
    if (!c.company && r.recipient_name) c.company = r.recipient_name;
    const t = Date.parse(r.first_action);
    c.lifetime.contracts += 1; c.lifetime.dollars += amt;
    if (t >= cutoff.getTime()) { c.last12Months.contracts += 1; c.last12Months.dollars += amt; }
    if (j !== undefined && Number.isFinite(j) && t >= j) { c.sinceJoining.contracts += 1; c.sinceJoining.dollars += amt; }
    if (!c.latestAward || r.first_action > c.latestAward) c.latestAward = r.first_action;
    if (r.awarding_agency) c._ag.set(r.awarding_agency, (c._ag.get(r.awarding_agency) ?? 0) + amt);
    out.set(r.recipient_uei, c);
  }
  const round = (x: { contracts: number; dollars: number }) => ({ contracts: x.contracts, dollars: Math.round(x.dollars) });
  return [...out.values()]
    .map(({ _ag, ...c }) => ({
      ...c, lifetime: round(c.lifetime), last12Months: round(c.last12Months), sinceJoining: round(c.sinceJoining),
      latestAward: c.latestAward ? c.latestAward.slice(0, 10) : null,
      agencies: [..._ag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a),
    }))
    .sort((a, b) => b.lifetime.dollars - a.lifetime.dollars);
}
