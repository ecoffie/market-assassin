/**
 * Per-search alert status: what THIS saved search can do, reported FIRST and separately from the
 * saved-search alerts job (delivery-readiness.ts).
 *
 * Why: the saved-search-alerts run is marked `error` whenever ANY search fails (from 2026-09-30, three
 * searches on one hard-bounced internal address plus one malformed customer search). The tool handed
 * that run status to the host as "delivery degraded, last success Sept 29", and a host told a customer
 * whose two brand-new searches had never been evaluated that Mindy's email alerts were unreliable —
 * while the same runs delivered ~46 alerts a day.
 *
 * Rules:
 *   - Saving and validating a search never implies delivery works.
 *   - One invalid search is THAT search blocked; valid searches continue.
 *   - A confirmed suppressed recipient is an action item for that recipient, not an outage.
 *   - A suppression LOOKUP that fails is a processing error (unknown), never "suppressed".
 *   - No email yet is explained: not yet evaluated, baseline-only, no new matches, or skipped.
 *   - Another customer's failure never becomes this search's status.
 *   - Provider acceptance is not inbox delivery; Mindy never claims the latter.
 *   - Unreadable evidence is `unknown`, never "fine" and never "failed".
 */
import { getAppSupabase } from '@/lib/app/workspace';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { hierarchyFilterLimitations, type FilterLimitation, type MapHorizon } from '@/lib/opportunities/hierarchy-sub-agency';
import { isSavedSearchDueAt } from './cadence';
import type { SavedSearchDeliveryReadiness } from './delivery-readiness';
import { storedNaicsValidity } from './stored-naics';
import type { SavedSearchRow } from './types';
import { valueShapeError } from './validate-filters';

export type SearchDeliveryStatus =
  /** alerts_enabled=false or cadence paused — a user choice, not a failure. */
  | 'paused'
  /** The STORED filters cannot be evaluated (value shape, or every NAICS code unknown). This search only. */
  | 'blocked_invalid_filters'
  /** The account's address is on the suppression list (bounce/complaint/unsubscribe). Action item. */
  | 'blocked_recipient_suppressed'
  /** The account has no deliverable address on file (synthetic client namespace). */
  | 'blocked_recipient_address'
  /** Due in the latest run that processed searches, but not evaluated by it. */
  | 'failing'
  /** Saved after the latest run; its first check has not happened yet. */
  | 'not_yet_evaluated'
  /** Evaluated once: current matches recorded as the baseline, nothing emailed by design. */
  | 'baseline_only'
  /** Evaluated past its baseline with no new matches yet, so nothing emailed. */
  | 'no_new_matches'
  /** Alerts for this search were sent and the provider accepted mail to this account. */
  | 'delivered'
  /** The recipient check could not be read — a processing error, not a verdict. */
  | 'unknown';

/** First evaluation snapshots current matches as "seen" and sends nothing; only later NEW matches email. */
export type SearchBaseline = 'pending' | 'established';

/**
 * Can these filters reach a SAM open notice? A supported filter with no records is
 * `no_matches_in_available_data` (a future posting can still alert) — never "unsupported".
 */
export type FilterReach = 'matches_open_now' | 'matched_historically' | 'no_matches_in_available_data' | 'unknown';
export type FilterReachResult = { reach: FilterReach; detail: string | null };

/**
 * Whether the filter IMPLEMENTATION can represent the search on the horizons it alerts on. Only an
 * actual limitation counts (hierarchyFilterLimitations, #1840); zero records never does.
 */
export type FilterSupport = 'supported' | 'partially_supported' | 'unsupported';

/** The single most important thing to tell the customer about THIS search, most severe first. */
export type AlertHeadline =
  | 'search_blocked_invalid_filters'
  | 'search_blocked_recipient'
  | 'search_failing'
  | 'search_filter_unsupported'
  | 'job_failure'
  | 'paused'
  | 'awaiting_first_check'
  | 'no_alert_yet'
  | 'delivering'
  | 'unknown';

export type SavedSearchAlertStatus = {
  saved: true;
  /** Structural validation at save time. Stored-filter evaluability is `search_delivery`. */
  validated: true;
  filter_support: FilterSupport;
  filter_limitations: FilterLimitation[];
  /** Stored NAICS codes that are not Census 2022 codes (reported, never silently dropped). */
  invalid_naics: string[];
  filter_reach: FilterReach;
  filter_reach_detail: string | null;
  search_delivery: SearchDeliveryStatus;
  search_delivery_reason: string | null;
  baseline: SearchBaseline;
  last_evaluated_at: string | null;
  alerts_sent: number;
  /** Last saved-search alert the email PROVIDER accepted for this account. Not inbox delivery. */
  recipient_last_alert_provider_accepted_at: string | null;
  inbox_delivery: 'not_observable';
  next_evaluation_at: string | null;
  job: 'saved-search-alerts';
  job_status: SavedSearchDeliveryReadiness['job_status'];
  job_status_reason: string;
  headline: AlertHeadline;
  /** Customer-facing: this search first, then (only if relevant) the labelled saved-search alerts job. */
  summary: string;
};

export type RecipientEvidence = {
  suppressed: string | null | undefined; // reason; null = not suppressed; undefined = lookup failed
  lastAlertAt: string | null | undefined; // undefined = unreadable
};

const RUN_EVAL_SLACK_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_STALE_MS = 8 * DAY_MS;

/** Recipient-level evidence, read once per account (every search of one account shares it). */
export async function readRecipientEvidence(userEmail: string): Promise<RecipientEvidence> {
  const supabase = getAppSupabase();
  const email = userEmail.toLowerCase().trim();
  const [supp, sends] = await Promise.all([
    supabase.from('email_suppressions').select('reason').eq('user_email', email).maybeSingle(),
    supabase
      .from('email_provider_sends')
      .select('sent_at')
      .eq('user_email', email)
      .eq('email_type', 'saved_search_alert')
      .in('status', ['sent', 'delivered'])
      .order('sent_at', { ascending: false })
      .limit(1),
  ]);
  return {
    suppressed: supp.error ? undefined : ((supp.data as { reason?: string } | null)?.reason ?? null),
    lastAlertAt: sends.error ? undefined : ((sends.data?.[0] as { sent_at?: string } | undefined)?.sent_at ?? null),
  };
}

function filterGetter(filters: Record<string, unknown>) {
  return (k: string) => {
    const v = filters[k];
    if (v === undefined || v === null) return null;
    return Array.isArray(v) ? v.join(',') : typeof v === 'object' ? null : String(v);
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function anyRow(supabase: any, f: ReturnType<typeof parseMapFilters>): Promise<boolean | null> {
  const { data, error } = await applyMapFilters(supabase.from('sam_opportunities').select('notice_id').limit(1), f);
  if (error) return null;
  return !!data?.length;
}

/**
 * Probe whether the saved filters reach any SAM notice — open now, else ever — through the SAME
 * parseMapFilters/applyMapFilters the Map and the alert cron use. Profile-scoped searches resolve
 * against the owner's profile at send time, so they are not probed.
 */
export async function probeFilterReach(filters: Record<string, unknown>): Promise<FilterReachResult> {
  if (filters.scope === 'profile') return { reach: 'unknown', detail: 'profile-scoped search' };
  if (valueShapeError(filters)) return { reach: 'unknown', detail: 'stored filters cannot be evaluated' };
  const supabase = getAppSupabase();
  try {
    const open = await anyRow(supabase, parseMapFilters(filterGetter(filters)));
    if (open === null) return { reach: 'unknown', detail: null };
    if (open) return { reach: 'matches_open_now', detail: null };
    const all = parseMapFilters(filterGetter(filters));
    all.status = 'all';
    const ever = await anyRow(supabase, all);
    if (ever === null) return { reach: 'unknown', detail: null };
    return ever ? { reach: 'matched_historically', detail: null } : { reach: 'no_matches_in_available_data', detail: null };
  } catch {
    return { reach: 'unknown', detail: null };
  }
}

/** The horizons this search ALERTS on (same gate as the cron: Open for mode=open, Forecast when enabled). */
function alertHorizons(search: SavedSearchRow): MapHorizon[] {
  const h: MapHorizon[] = [];
  if (search.mode === 'open') h.push('open');
  const hz = (search.filters as Record<string, unknown>)?.horizons;
  const forecast = hz && typeof hz === 'object' ? (hz as Record<string, unknown>).forecast === true : (search.mode as string) === 'forecast';
  if (forecast) h.push('forecast');
  return h;
}

function nextDailyRun(cronExpr: string | null, now: Date): Date | null {
  if (!cronExpr) return null;
  const [m, h] = cronExpr.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(m) || !Number.isInteger(h)) return null;
  const next = new Date(now);
  next.setUTCHours(h, m, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function nextEvaluation(search: SavedSearchRow, cronExpr: string | null, now: Date): string | null {
  let next = nextDailyRun(cronExpr, now);
  if (!next) return null;
  for (let i = 0; i < 8 && !isSavedSearchDueAt(search.alert_frequency, next); i++) {
    next = new Date(next.getTime() + DAY_MS);
  }
  return isSavedSearchDueAt(search.alert_frequency, next) ? next.toISOString() : null;
}

/**
 * Due in the latest run that processed searches yet not evaluated by it? Every evaluation (baseline,
 * no new matches, send) stamps last_alerted_at, so a due search left unstamped failed on its own.
 * Only judged against a run that provably processed searches (healthy / partial_failure).
 */
function missedLatestRun(search: SavedSearchRow, job: SavedSearchDeliveryReadiness, now: Date): boolean {
  if (search.alert_frequency === 'weekly') {
    const created = Date.parse(search.created_at);
    const last = search.last_alerted_at ? Date.parse(search.last_alerted_at) : 0;
    return now.getTime() - created > WEEKLY_STALE_MS && now.getTime() - last > WEEKLY_STALE_MS;
  }
  if (job.job_status !== 'healthy' && job.job_status !== 'partial_failure') return false;
  if (!job.latest_run_in_window || !job.latest_run_started_at) return false;
  const runAt = Date.parse(job.latest_run_started_at);
  if (!Number.isFinite(runAt) || !isSavedSearchDueAt(search.alert_frequency, new Date(runAt))) return false;
  if (Date.parse(search.created_at) >= runAt) return false;
  const last = search.last_alerted_at ? Date.parse(search.last_alerted_at) : 0;
  return last < runAt - RUN_EVAL_SLACK_MS;
}

/** First evaluation happens at the first run after creation; a stamp within one cadence of it is the baseline. */
function isBaselineOnly(search: SavedSearchRow): boolean {
  if (!search.last_alerted_at || (search.total_alerts_sent || 0) > 0) return false;
  const span = search.alert_frequency === 'weekly' ? WEEKLY_STALE_MS : DAY_MS + 2 * 60 * 60 * 1000;
  return Date.parse(search.last_alerted_at) - Date.parse(search.created_at) <= span;
}

function utc(iso: string | null): string {
  return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'an unknown time';
}

function jobNote(job: SavedSearchDeliveryReadiness, thisSearchAffected: boolean): string {
  const why = job.job_status_reason.replace(/^saved-search alerts: /, '');
  switch (job.job_status) {
    case 'healthy':
      return '';
    case 'partial_failure':
      return thisSearchAffected
        ? ` Saved-search alerts: ${why}.`
        : ' Saved-search alerts: the latest run had failures in other saved searches; this one is not affected.';
    case 'job_failure':
      return ` Saved-search alerts: ${why}. No saved-search alert emails can be expected until it recovers.`;
    case 'unknown':
      return ` Saved-search alerts: status could not be established (${why}).`;
    case 'not_observed':
      return ' Saved-search alerts: the job has not been seen to run yet.';
  }
}

function summarize(s: Omit<SavedSearchAlertStatus, 'summary'>, job: SavedSearchDeliveryReadiness): string {
  const first = s.next_evaluation_at ? ` Next check: ${utc(s.next_evaluation_at)}.` : '';
  const reach = s.filter_reach === 'matched_historically'
    ? ' Its filters have matched past notices; none are open right now.'
    : s.filter_reach === 'no_matches_in_available_data'
      ? " No notice in Mindy's data has matched these filters yet; a matching notice posted later will alert."
      : s.filter_reach === 'matches_open_now' ? ' Its filters match notices that are open now.' : '';
  const limits = s.filter_support === 'partially_supported'
    ? ` ${[...new Set(s.filter_limitations.map((l) => l.reason))].join(' ')}`
    : '';
  const naics = s.invalid_naics.length ? ` Unknown NAICS code(s) ${s.invalid_naics.join(', ')} cannot match anything.` : '';
  let lead: string;
  switch (s.headline) {
    case 'search_blocked_invalid_filters':
      lead = `This saved search is blocked: ${s.search_delivery_reason}. It will not alert until its filters are corrected; your other searches are unaffected.`;
      break;
    case 'search_blocked_recipient':
      lead = `Alerts for this search are held: ${s.search_delivery_reason}. Action needed on the account email; this is not a system outage.`;
      break;
    case 'search_failing':
      lead = `This saved search was skipped by the latest saved-search alerts run (${s.search_delivery_reason}), so its alerts are not currently going out.`;
      break;
    case 'search_filter_unsupported':
      lead = `This saved search cannot run as written: ${[...new Set(s.filter_limitations.map((l) => l.reason))].join(' ')}`;
      break;
    case 'job_failure':
      lead = 'This saved search is saved and valid.';
      break;
    case 'paused':
      lead = 'This saved search is saved with alerts paused; no emails until alerts are re-enabled.';
      break;
    case 'awaiting_first_check':
      lead = 'This saved search is saved and valid. Delivery is not yet tested: its first check records current matches without emailing, and an alert is sent only when a NEW match appears after that.';
      break;
    case 'no_alert_yet':
      lead = s.search_delivery === 'baseline_only'
        ? 'This saved search has had its first check (current matches recorded, nothing emailed by design). No new match has appeared since, so no alert has been sent yet.'
        : 'This saved search is being checked; no new match has appeared since its first check, so no alert has been sent yet.';
      break;
    case 'delivering':
      lead = `Alerts for this search have been sent; our email provider last accepted one for this account at ${utc(s.recipient_last_alert_provider_accepted_at)} (inbox delivery is not tracked).`;
      break;
    default:
      lead = `This saved search is saved and valid. Its delivery status could not be checked (${s.search_delivery_reason ?? 'evidence unreadable'}).`;
  }
  const tail = s.headline === 'search_blocked_invalid_filters' || s.headline === 'paused' ? '' : `${reach}${limits}${naics}${first}`;
  const note = s.search_delivery === 'paused' ? '' : jobNote(job, s.headline === 'search_failing');
  return `${lead}${tail}${note}`.trim();
}

/** Compose one search's customer-facing status from job readiness + recipient evidence. */
export function composeSearchAlertStatus(
  search: SavedSearchRow,
  job: SavedSearchDeliveryReadiness,
  recipient: RecipientEvidence,
  reach: FilterReachResult,
  now: Date = new Date(),
): SavedSearchAlertStatus {
  const filters = (search.filters || {}) as Record<string, unknown>;
  const baseline: SearchBaseline = search.last_alerted_at ? 'established' : 'pending';
  const paused = !search.alerts_enabled || search.alert_frequency === 'paused';
  const synthetic = search.user_email.toLowerCase().endsWith('@clients.getmindy.ai');
  const shapeErr = valueShapeError(filters);
  const { stored, invalid } = storedNaicsValidity(filters);
  const allNaicsInvalid = stored.length > 0 && invalid.length === stored.length;

  const horizons = alertHorizons(search);
  const limitations = hierarchyFilterLimitations(filters, horizons);
  const limitedHorizons = new Set(limitations.map((l) => l.horizon));
  const filter_support: FilterSupport = !limitations.length ? 'supported'
    : horizons.every((h) => limitedHorizons.has(h)) ? 'unsupported' : 'partially_supported';

  let search_delivery: SearchDeliveryStatus;
  let reason: string | null = null;
  if (paused) {
    search_delivery = 'paused';
  } else if (shapeErr || allNaicsInvalid) {
    search_delivery = 'blocked_invalid_filters';
    reason = shapeErr ? `its stored filters cannot be evaluated (${shapeErr})` : `none of its NAICS codes exist (${invalid.join(', ')})`;
  } else if (synthetic) {
    search_delivery = 'blocked_recipient_address';
    reason = 'the account has no deliverable email address on file';
  } else if (recipient.suppressed) {
    search_delivery = 'blocked_recipient_suppressed';
    reason = `the account email is on the suppression list (${recipient.suppressed})`;
  } else if (missedLatestRun(search, job, now)) {
    search_delivery = 'failing';
    reason = 'not evaluated by the latest run';
  } else if (recipient.suppressed === undefined) {
    search_delivery = 'unknown';
    reason = 'the recipient suppression check failed (processing error)';
  } else if ((search.total_alerts_sent || 0) > 0 && recipient.lastAlertAt) {
    search_delivery = 'delivered';
  } else if (!search.last_alerted_at) {
    search_delivery = 'not_yet_evaluated';
  } else {
    search_delivery = isBaselineOnly(search) ? 'baseline_only' : 'no_new_matches';
  }

  let headline: AlertHeadline;
  if (search_delivery === 'blocked_invalid_filters') headline = 'search_blocked_invalid_filters';
  else if (search_delivery === 'blocked_recipient_suppressed' || search_delivery === 'blocked_recipient_address') headline = 'search_blocked_recipient';
  else if (search_delivery === 'failing') headline = 'search_failing';
  else if (filter_support === 'unsupported' && !paused) headline = 'search_filter_unsupported';
  else if (paused) headline = 'paused';
  else if (job.job_status === 'job_failure') headline = 'job_failure';
  else if (search_delivery === 'delivered') headline = 'delivering';
  else if (search_delivery === 'not_yet_evaluated') headline = 'awaiting_first_check';
  else if (search_delivery === 'baseline_only' || search_delivery === 'no_new_matches') headline = 'no_alert_yet';
  else headline = 'unknown';

  const partial: Omit<SavedSearchAlertStatus, 'summary'> = {
    saved: true,
    validated: true,
    filter_support,
    filter_limitations: limitations,
    invalid_naics: allNaicsInvalid ? [] : invalid,
    filter_reach: reach.reach,
    filter_reach_detail: reach.detail,
    search_delivery,
    search_delivery_reason: reason,
    baseline,
    last_evaluated_at: search.last_alerted_at,
    alerts_sent: search.total_alerts_sent || 0,
    recipient_last_alert_provider_accepted_at: recipient.lastAlertAt ?? null,
    inbox_delivery: 'not_observable',
    next_evaluation_at: paused || search_delivery === 'blocked_invalid_filters' ? null : nextEvaluation(search, job.cron_expr, now),
    job: 'saved-search-alerts',
    job_status: job.job_status,
    job_status_reason: job.job_status_reason,
    headline,
  };
  return { ...partial, summary: summarize(partial, job) };
}
