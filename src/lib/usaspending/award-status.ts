/**
 * Award status + successor probe (Ask Mindy Phase 1, R5).
 *
 * The defect: "Is the Navy ID card administration order in Millington still active?" could not be
 * answered because the award detail carried dates but no status, and nothing looked for a
 * follow-on. A model then guessed or searched open solicitations.
 *
 * `computeAwardStatus` derives status from the period-of-performance end against TODAY (passed in,
 * never hardcoded). `probeSuccessor` looks for a likely follow-on with explicit, inspectable
 * evidence, and reports "checked, none found" with exactly what it checked when nothing qualifies.
 * A candidate is never presented as a certified successor: USASpending does not link awards that
 * way, so the evidence is the answer.
 */
import { CONTRACT_CODES } from '@/lib/usaspending/award-type-codes';
import type { AwardDetail } from '@/lib/usaspending/award-detail';
import { isoDay } from '@/lib/usaspending/freshness';

const SEARCH = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const DAY_MS = 86_400_000;

export type AwardStatus = 'active' | 'expired' | 'not_started' | 'unknown';

export interface AwardStatusResult {
  status: AwardStatus;
  /** Whole days from today to the current end date (negative once expired). Null when unknown. */
  days_until_end: number | null;
  status_basis: {
    as_of: string;
    end_date_used: string | null;
    end_date_field: 'period_of_performance.end_date' | 'period_of_performance.potential_end_date' | null;
    start_date: string | null;
    potential_end_date: string | null;
    note: string;
  };
}

function day(s: string | null | undefined): string | null {
  const v = String(s ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function utcMs(isoDay: string): number {
  return Date.parse(`${isoDay}T00:00:00Z`);
}

/** Today's calendar day in US Eastern time (the federal business day). */
export function isoToday(now: Date): string {
  return isoDay(now);
}

/**
 * Status from the CURRENT period-of-performance end (options not yet exercised do not keep an
 * award active). The end date is inclusive: work through 2026-07-31 is active on 07-31 and expired
 * from 08-01.
 */
export function computeAwardStatus(
  award: Pick<AwardDetail, 'popStart' | 'popEnd' | 'popPotentialEnd'>,
  now: Date = new Date(),
): AwardStatusResult {
  const today = isoToday(now);
  const start = day(award.popStart);
  const end = day(award.popEnd);
  const potential = day(award.popPotentialEnd);
  const endUsed = end ?? potential;
  const field = end ? 'period_of_performance.end_date' : potential ? 'period_of_performance.potential_end_date' : null;
  const lagCaveat =
    'USASpending shows what the agency has reported; a recent extension or option exercise can take weeks (DoD: ~90 days) to appear.';

  if (!endUsed) {
    return {
      status: start && start > today ? 'not_started' : 'unknown',
      days_until_end: null,
      status_basis: { as_of: today, end_date_used: null, end_date_field: null, start_date: start, potential_end_date: potential, note: `No period-of-performance end date was reported, so whether it is still active cannot be established. ${lagCaveat}` },
    };
  }
  const days = Math.round((utcMs(endUsed) - utcMs(today)) / DAY_MS);
  let status: AwardStatus;
  if (start && start > today) status = 'not_started';
  else if (days < 0) status = 'expired';
  else status = 'active';

  const optionsNote =
    potential && end && potential > end
      ? ` Unexercised options run to ${potential}; the award would only continue past ${end} if those options are exercised.`
      : '';
  const note =
    status === 'expired'
      ? `Period of performance ended ${endUsed} (${Math.abs(days)} days before ${today}).${optionsNote} ${lagCaveat}`
      : status === 'not_started'
      ? `Period of performance starts ${start}.${optionsNote}`
      : `Period of performance runs through ${endUsed} (${days} days after ${today}).${optionsNote} ${lagCaveat}`;
  return {
    status,
    days_until_end: days,
    status_basis: { as_of: today, end_date_used: endUsed, end_date_field: field, start_date: start, potential_end_date: potential, note },
  };
}

// ── successor probe ───────────────────────────────────────────────────────────────────────────────

/** Days before the old end date a follow-on may start (bridge/early award) and days after. */
export const SUCCESSOR_START_BEFORE_DAYS = 365;
export const SUCCESSOR_START_AFTER_DAYS = 180;
/** Run the probe only when the award is expired or ends within this many days. */
export const SUCCESSOR_PROBE_WITHIN_DAYS = 180;
/** Pages of 100 rows scanned per code filter. */
export const SUCCESSOR_PAGES = 3;

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'per', 'all', 'other', 'into',
  'service', 'services', 'support', 'supports', 'contract', 'contractor', 'contracts', 'shall', 'provide',
  'provides', 'providing', 'program', 'requirement', 'requirements', 'task', 'order', 'orders', 'base',
  'option', 'year', 'period', 'performance', 'work', 'statement', 'pws', 'sow', 'iaw', 'accordance',
  'department', 'navy', 'army', 'force', 'air', 'office', 'command', 'headquarters', 'administration',
  'administrative', 'igf', 'new', 'follow', 'bridge', 'extension', 'continued', 'continuation',
]);

export function descriptionTerms(text: string): Set<string> {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)),
  );
}

/**
 * The office portion of a PIID: the first 6 characters (a DoD DoDAAC like N00189 / W912EQ, or a
 * civilian agency office code). Null when the PIID is too short to carry one.
 */
export function piidOfficePrefix(piid: string): string | null {
  const v = String(piid || '').trim().toUpperCase();
  if (v.length < 10 || !/^[A-Z0-9]{6}/.test(v)) return null;
  return v.slice(0, 6);
}

export interface SuccessorCandidate {
  awardId: string;
  recipientName: string;
  awardAmount: number;
  description: string;
  startDate: string;
  endDate: string;
  generatedId: string;
  usaSpendingUrl: string;
  evidence: {
    same_piid_office_prefix: string;
    matched_code_filters: Array<'naics' | 'psc'>;
    start_days_from_old_end: number;
    shared_description_terms: string[];
    same_recipient: boolean;
  };
  strength: 'likely' | 'possible';
}

export interface SuccessorProbe {
  /** 'candidates' = at least one follow-on candidate; 'none_found' = checked, none qualified. */
  state: 'candidates' | 'none_found' | 'not_checked' | 'unavailable';
  candidates: SuccessorCandidate[];
  checked: {
    piid_office_prefix: string | null;
    naics: string | null;
    psc: string | null;
    start_window: { from: string; to: string } | null;
    award_types: string;
    rows_seen: number;
    same_office_same_code_rows: number;
    truncated: boolean;
  };
  method: string;
  note: string;
}

type Fetcher = typeof fetch;

async function fetchCandidates(
  fetcher: Fetcher,
  prefix: string,
  code: { naics?: string; psc?: string },
  window: { from: string; to: string },
  page = 1,
): Promise<{ ok: boolean; rows: Record<string, unknown>[]; hasNext: boolean }> {
  const filters: Record<string, unknown> = {
    award_type_codes: [...CONTRACT_CODES],
    keywords: [prefix],
    time_period: [{ start_date: window.from, end_date: window.to }],
  };
  if (code.naics) filters.naics_codes = { require: [code.naics] };
  if (code.psc) filters.psc_codes = [code.psc];
  try {
    const res = await fetcher(SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters,
        fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Description', 'Start Date', 'End Date', 'generated_internal_id'],
        page,
        limit: 100,
        sort: 'Award Amount',
        order: 'desc',
        subawards: false,
      }),
    });
    if (!res.ok) return { ok: false, rows: [], hasNext: false };
    const j = (await res.json()) as { results?: Record<string, unknown>[]; page_metadata?: { hasNext?: boolean } };
    return { ok: true, rows: j.results || [], hasNext: !!j.page_metadata?.hasNext };
  } catch {
    return { ok: false, rows: [], hasNext: false };
  }
}

/**
 * Look for a likely follow-on to an award: same PIID office prefix (the awarding office), same NAICS
 * or same PSC, start date between SUCCESSOR_START_BEFORE_DAYS before and SUCCESSOR_START_AFTER_DAYS
 * after the old end date, and at least one shared distinctive description term. Definitive
 * contracts and orders only (IDV vehicles are not searched).
 */
export async function probeSuccessor(
  award: AwardDetail,
  endDate: string | null,
  now: Date = new Date(),
  fetcher: Fetcher = fetch,
): Promise<SuccessorProbe> {
  const prefix = piidOfficePrefix(award.awardId);
  const naics = /^\d{2,6}$/.test(award.naicsCode || '') ? award.naicsCode : null;
  const psc = (award.pscCode || '').trim().toUpperCase() || null;
  const method =
    'USASpending spending_by_award: keyword = PIID office prefix, one request per code (NAICS, PSC), action dates in the start window; ' +
    'kept rows whose Award ID starts with the prefix, start inside the window, and share a distinctive description term with the old award.';
  const base: SuccessorProbe = {
    state: 'not_checked',
    candidates: [],
    checked: { piid_office_prefix: prefix, naics, psc, start_window: null, award_types: 'definitive contracts and orders (A, B, C, D)', rows_seen: 0, same_office_same_code_rows: 0, truncated: false },
    method,
    note: '',
  };
  if (!endDate) return { ...base, note: 'No end date, so no successor window can be defined.' };
  if (!prefix) return { ...base, note: `PIID ${award.awardId} is too short to carry an office prefix; successor probe not run.` };
  if (!naics && !psc) return { ...base, note: 'The award reports neither NAICS nor PSC; successor probe not run.' };

  const today = isoToday(now);
  const endMs = utcMs(endDate);
  const from = new Date(endMs - SUCCESSOR_START_BEFORE_DAYS * DAY_MS).toISOString().slice(0, 10);
  const toCandidate = new Date(endMs + SUCCESSOR_START_AFTER_DAYS * DAY_MS).toISOString().slice(0, 10);
  const to = toCandidate < today ? toCandidate : today;
  if (from > to) return { ...base, note: 'Successor window has not opened yet.' };
  const window = { from, to };

  const jobs: Array<Promise<{ kind: 'naics' | 'psc'; page: number; r: Awaited<ReturnType<typeof fetchCandidates>> }>> = [];
  // Up to SUCCESSOR_PAGES pages of 100 (largest first) per code, fetched in parallel.
  for (let page = 1; page <= SUCCESSOR_PAGES; page++) {
    if (naics) jobs.push(fetchCandidates(fetcher, prefix, { naics }, window, page).then((r) => ({ kind: 'naics' as const, page, r })));
    if (psc) jobs.push(fetchCandidates(fetcher, prefix, { psc }, window, page).then((r) => ({ kind: 'psc' as const, page, r })));
  }
  const results = await Promise.all(jobs);
  const checked = { ...base.checked, start_window: window };
  if (!results.some((x) => x.r.ok)) {
    return { ...base, state: 'unavailable', checked, note: 'USASpending could not be reached for the successor probe; do not conclude there is no successor.' };
  }

  const oldTerms = descriptionTerms(award.description);
  const oldId = award.awardId.toUpperCase();
  const byId = new Map<string, { row: Record<string, unknown>; kinds: Set<'naics' | 'psc'> }>();
  let rowsSeen = 0;
  let truncated = false;
  for (const { kind, page, r } of results) {
    if (!r.ok) continue;
    rowsSeen += r.rows.length;
    if (r.hasNext && page === SUCCESSOR_PAGES) truncated = true;
    for (const row of r.rows) {
      const id = String(row['Award ID'] || '').toUpperCase();
      if (!id.startsWith(prefix) || id === oldId) continue;
      const start = day(row['Start Date'] as string);
      if (!start || start < from || start > toCandidate) continue;
      const prev = byId.get(id);
      if (prev) prev.kinds.add(kind);
      else byId.set(id, { row, kinds: new Set([kind]) });
    }
  }

  const candidates: SuccessorCandidate[] = [];
  for (const [id, { row, kinds }] of byId) {
    const desc = String(row['Description'] || '');
    const shared = [...descriptionTerms(desc)].filter((t) => oldTerms.has(t));
    if (!shared.length) continue;
    const start = day(row['Start Date'] as string)!;
    const recipient = String(row['Recipient Name'] || '');
    const gid = String(row['generated_internal_id'] || '');
    const matched = [...kinds].sort() as Array<'naics' | 'psc'>;
    candidates.push({
      awardId: id,
      recipientName: recipient,
      awardAmount: Number(row['Award Amount']) || 0,
      description: desc,
      startDate: start,
      endDate: day(row['End Date'] as string) || '',
      generatedId: gid,
      usaSpendingUrl: gid ? `https://www.usaspending.gov/award/${gid}` : `https://www.usaspending.gov/keyword_search/${encodeURIComponent(id)}`,
      evidence: {
        same_piid_office_prefix: prefix,
        matched_code_filters: matched,
        start_days_from_old_end: Math.round((utcMs(start) - endMs) / DAY_MS),
        shared_description_terms: shared,
        same_recipient: !!recipient && recipient.toUpperCase() === award.recipientName.toUpperCase(),
      },
      strength: shared.length >= 2 || matched.length === 2 ? 'likely' : 'possible',
    });
  }
  candidates.sort((a, b) =>
    b.evidence.shared_description_terms.length - a.evidence.shared_description_terms.length
    || b.evidence.matched_code_filters.length - a.evidence.matched_code_filters.length
    || Math.abs(a.evidence.start_days_from_old_end) - Math.abs(b.evidence.start_days_from_old_end));

  const fullChecked = { ...checked, rows_seen: rowsSeen, same_office_same_code_rows: byId.size, truncated };
  const truncNote = truncated ? ` The office/code population exceeded ${SUCCESSOR_PAGES * 100} awards per code (largest first), so a smaller follow-on could be missed.` : '';
  if (!candidates.length) {
    return {
      ...base,
      state: 'none_found',
      checked: fullChecked,
      note:
        `Checked: awards from office prefix ${prefix} with ${[naics && `NAICS ${naics}`, psc && `PSC ${psc}`].filter(Boolean).join(' or ')} ` +
        `starting ${from} to ${toCandidate}. ${byId.size} same-office same-code award(s) found, none sharing a distinctive description term. ` +
        `No successor found in published data (recent DoD awards can lag ~90 days).${truncNote}`,
    };
  }
  return {
    ...base,
    state: 'candidates',
    candidates: candidates.slice(0, 5),
    checked: fullChecked,
    note:
      'Candidates are inferred from the evidence shown (same awarding office prefix, same NAICS/PSC, start near the old end date, shared description terms). ' +
      `USASpending does not certify a successor link: present these as likely follow-ons, citing the evidence.${truncNote}`,
  };
}
