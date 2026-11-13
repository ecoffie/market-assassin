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
  recipient_name?: string | null; awarding_agency?: string | null; naics_code?: string | null;
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

/**
 * Public breakdowns for /customers. Every bucket is an AGGREGATE of at least `minCompanies`
 * distinct member companies, so no single company's awards can be read off the page. Smaller
 * buckets fold into `other` (unlabelled). Only positive awards count, as in tallyWins.
 */
export const MIN_COMPANIES_PER_BUCKET = 3;

export type StatBucket = { key: string; label: string; dollars: number; contracts: number; companies: number };
export type BucketSet = {
  buckets: StatBucket[];
  /** Everything not shown as its own bucket. null when nothing was folded. */
  other: { dollars: number; contracts: number; companies: number } | null;
};

export function bucketAwards(
  rows: AwardRow[],
  keyOf: (r: AwardRow) => string | null | undefined,
  labelOf: (key: string) => string,
  { top = 8, minCompanies = MIN_COMPANIES_PER_BUCKET }: { top?: number; minCompanies?: number } = {},
): BucketSet {
  const acc = new Map<string, { dollars: number; awards: Set<string>; companies: Set<string> }>();
  const won = rows.filter((r) => Number(r.amount) > 0);
  for (const r of won) {
    const key = (keyOf(r) || '').trim() || '__unknown__';
    const b = acc.get(key) ?? { dollars: 0, awards: new Set<string>(), companies: new Set<string>() };
    b.dollars += Number(r.amount);
    b.awards.add(`${r.recipient_uei}|${r.award_id}`);
    b.companies.add(r.recipient_uei);
    acc.set(key, b);
  }
  const ranked = [...acc.entries()].sort((a, b) => b[1].dollars - a[1].dollars);
  const shown = ranked.filter(([k, b]) => k !== '__unknown__' && b.companies.size >= minCompanies).slice(0, top);
  const shownKeys = new Set(shown.map(([k]) => k));
  const rest = ranked.filter(([k]) => !shownKeys.has(k));
  const otherCompanies = new Set<string>();
  let otherDollars = 0;
  let otherContracts = 0;
  for (const [, b] of rest) {
    otherDollars += b.dollars;
    otherContracts += b.awards.size;
    b.companies.forEach((c) => otherCompanies.add(c));
  }
  return {
    buckets: shown.map(([k, b]) => ({
      key: k, label: labelOf(k), dollars: Math.round(b.dollars), contracts: b.awards.size, companies: b.companies.size,
    })),
    other: rest.length ? { dollars: Math.round(otherDollars), contracts: otherContracts, companies: otherCompanies.size } : null,
  };
}

/** Federal fiscal year of a date: FY runs Oct 1 – Sep 30, so Oct 2025 is FY2026. */
export function fiscalYear(date: string): number | null {
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

/**
 * Wins by fiscal year of the award's first action, most recent `years` only. A year with fewer than
 * `minCompanies` companies is left out entirely (a year has no meaningful "Other").
 */
export function winsByFiscalYear(
  rows: AwardRow[], { years = 6, minCompanies = MIN_COMPANIES_PER_BUCKET, now = Date.now() } = {},
): StatBucket[] {
  const current = fiscalYear(new Date(now).toISOString()) ?? new Date(now).getUTCFullYear();
  const set = bucketAwards(
    rows.filter((r) => { const fy = fiscalYear(r.first_action); return fy !== null && fy > current - years && fy <= current; }),
    (r) => String(fiscalYear(r.first_action)),
    (k) => `FY${k}`,
    { top: years, minCompanies },
  );
  return set.buckets.sort((a, b) => Number(a.key) - Number(b.key));
}
