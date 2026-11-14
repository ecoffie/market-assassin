/**
 * USASpending freshness + DoD publication-lag disclosure (Ask Mindy Phase 1, R10).
 *
 * The defect: "Who won the Navy ... contract in October 2026?" ran a past-awards search over a
 * window USASpending cannot have yet (DoD contract actions are published with a delay; measured
 * 0 rows for Oct 1 2026 N00189 awards that exist). The tool returned an empty list, and an empty
 * list reads as "nobody won". This module lets a tool say "data current through X; awards in this
 * window may not be published yet" instead.
 *
 * Every date is computed from the CURRENT date at call time. Nothing here is hardcoded to a day.
 */
import { DOD_SUBTIER_ALIASES } from '@/lib/usaspending/awarding-agency-filter';

/**
 * DoD reports contract actions to FPDS with a 90-day delay for operational security, and
 * USASpending only shows what FPDS has published. Treat the most recent ~90 days of DoD awards as
 * not-yet-complete.
 */
export const DOD_PUBLICATION_LAG_DAYS = 90;

const LAST_UPDATED_URL = 'https://api.usaspending.gov/api/v2/awards/last_updated/';
const DAY_MS = 86_400_000;

/**
 * Calendar day (YYYY-MM-DD) in US Eastern time — the federal business day. Using the UTC date
 * would report "tomorrow" every evening in the US.
 */
export function isoDay(d: Date): string {
  try {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** True when the agency text names DoD or a military department / DoD component. */
export function isDodAgency(agency: string | undefined | null): boolean {
  const a = String(agency ?? '').trim();
  if (!a) return false;
  if (DOD_SUBTIER_ALIASES.some((x) => x.re.test(a))) return true;
  return /\b(department of defense|defense|dod|dla|disa|dha|darpa|socom|usace|marine corps)\b/i.test(a);
}

/**
 * USASpending's own "last updated" date for award data (YYYY-MM-DD), or null when it cannot be
 * established. This is the load date of the corpus, NOT a promise that every agency's actions up
 * to that day are present (DoD lags; see DOD_PUBLICATION_LAG_DAYS).
 */
export async function fetchUsaSpendingLastUpdated(): Promise<string | null> {
  try {
    const res = await fetch(LAST_UPDATED_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const j = (await res.json()) as { last_updated?: unknown };
    const raw = String(j.last_updated ?? '').trim();
    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    return null;
  } catch {
    return null;
  }
}

export interface PublicationLagAssessment {
  /** True when the requested window reaches into the most recent DOD_PUBLICATION_LAG_DAYS. */
  applies: boolean;
  /** DoD awards dated after this day may not be published yet (YYYY-MM-DD). */
  dod_complete_through: string;
  lag_days: number;
  note?: string;
}

/**
 * Does the requested window fall inside the DoD publication lag? Applies when a date window was
 * requested, its end is on or after (today - lag), and the agency is DoD or unspecified (an
 * unspecified agency still includes DoD awards). A civilian-only agency gets no note.
 */
export function assessPublicationLag(opts: {
  dateFrom?: string;
  dateTo?: string;
  agency?: string;
  now?: Date;
  asOf?: string | null;
}): PublicationLagAssessment {
  const now = opts.now ?? new Date();
  const cutoff = isoDay(new Date(now.getTime() - DOD_PUBLICATION_LAG_DAYS * DAY_MS));
  const base: PublicationLagAssessment = { applies: false, dod_complete_through: cutoff, lag_days: DOD_PUBLICATION_LAG_DAYS };
  if (!opts.dateFrom && !opts.dateTo) return base;
  const windowEnd = (opts.dateTo || isoDay(now)).slice(0, 10);
  if (windowEnd < cutoff) return base;
  const agencyGiven = !!String(opts.agency ?? '').trim();
  if (agencyGiven && !isDodAgency(opts.agency)) return base;

  const loaded = opts.asOf ? `USASpending data was last loaded ${opts.asOf}, but ` : '';
  const who = agencyGiven ? 'this agency' : 'DoD (including Navy, Army, Air Force)';
  const note =
    `${loaded}contract actions by ${who} are published with a ~${DOD_PUBLICATION_LAG_DAYS}-day delay, so the data is ` +
    `only reliably current through about ${cutoff}. The requested window (through ${windowEnd}) is newer than that: ` +
    'awards made in it may not be published yet. Treat an empty or thin result as "not yet published", NOT as "no award was made". ' +
    'Check SAM.gov award notices or the agency announcement for recent awards.';
  return { ...base, applies: true, note };
}
