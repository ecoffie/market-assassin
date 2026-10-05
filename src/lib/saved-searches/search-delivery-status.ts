/**
 * Per-search alert status — what THIS saved search can actually do, kept separate from
 * system-wide delivery (delivery-readiness.ts).
 *
 * Why two layers: the saved-search-alerts run is marked `error` whenever ANY search fails
 * (three internal hard-bounced addresses were enough, every day from 2026-09-30). The tool used
 * to hand that run status straight to the host as "delivery degraded, last success Sept 29",
 * and a host told a customer whose two brand-new searches had never been evaluated that Mindy's
 * email alerts were unreliable — while the same runs were delivering ~46 alerts a day.
 *
 * Rules:
 *   - Saving and validating a search never implies delivery works (`not_yet_tested` until an
 *     alert to this recipient is on the provider ledger).
 *   - Another customer's failure never becomes this search's status.
 *   - An unreadable check is `unknown`, never "fine" and never "failed".
 */
import { getAppSupabase } from '@/lib/app/workspace';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { isSavedSearchDueAt } from './cadence';
import type { SavedSearchDeliveryReadiness } from './delivery-readiness';
import type { SavedSearchRow } from './types';

export type SearchDeliveryStatus =
  /** alerts_enabled=false or cadence paused — a user choice, not a failure. */
  | 'paused'
  /** This recipient cannot receive alerts (suppressed: bounce / complaint / unsubscribe). */
  | 'blocked'
  /** This search was due in the latest run but was not evaluated — its own evaluation is failing. */
  | 'failing'
  /** No alert for this search has been delivered yet (new, or no new matches since baseline). */
  | 'not_yet_tested'
  /** At least one alert for this search went out and the recipient has provider-accepted alert mail. */
  | 'delivered'
  /** The recipient/suppression check could not be read. */
  | 'unknown';

/** First evaluation snapshots current matches as "seen" and sends nothing; only later NEW matches email. */
export type SearchBaseline = 'pending' | 'established';

/**
 * Can this filter set match anything in Mindy's SAM corpus? Structural validation does not answer
 * this: `subAgency: "Marine Corps"` is a well-formed filter that has never matched a row, because SAM
 * files Marine Corps buys under sub_tier "DEPT OF THE NAVY".
 */
export type FilterReach = 'matches_open_now' | 'matched_historically' | 'never_matched' | 'unknown';

/** The single most important thing to tell the customer, most severe first. */
export type AlertHeadline =
  | 'system_delivery_failure'
  | 'search_delivery_blocked'
  | 'search_delivery_failing'
  | 'search_never_matches'
  | 'paused'
  | 'delivery_not_yet_tested'
  | 'delivering';

export type SavedSearchAlertStatus = {
  saved: true;
  /** Structural validation passed (it ran at save time — rows that fail it are never stored). */
  validated: true;
  filter_reach: FilterReach;
  search_delivery: SearchDeliveryStatus;
  search_delivery_reason: string | null;
  baseline: SearchBaseline;
  last_evaluated_at: string | null;
  alerts_sent: number;
  /** Last saved-search alert the provider accepted for this account (any of its searches). */
  recipient_last_alert_at: string | null;
  next_evaluation_at: string | null;
  system_status: SavedSearchDeliveryReadiness['system_status'];
  headline: AlertHeadline;
  summary: string;
};

type RecipientEvidence = {
  suppressed: string | null | undefined; // reason; null = not suppressed; undefined = unreadable
  lastAlertAt: string | null | undefined; // undefined = unreadable
};

const RUN_EVAL_SLACK_MS = 5 * 60 * 1000;
const WEEKLY_STALE_MS = 8 * 24 * 60 * 60 * 1000;

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

/**
 * Probe whether the saved filters can reach any SAM notice — open now, else ever. Profile-scoped
 * searches resolve against the owner's profile at send time, so they are not probed here.
 */
export async function probeFilterReach(filters: Record<string, unknown>): Promise<FilterReach> {
  if (filters.scope === 'profile') return 'unknown';
  const supabase = getAppSupabase();
  const get = (k: string) => {
    const v = filters[k];
    if (v === undefined || v === null) return null;
    return Array.isArray(v) ? v.join(',') : typeof v === 'object' ? null : String(v);
  };
  try {
    const open = parseMapFilters(get);
    const { data: openRows, error: openErr } = await applyMapFilters(
      supabase.from('sam_opportunities').select('notice_id').limit(1),
      open,
    );
    if (openErr) return 'unknown';
    if (openRows?.length) return 'matches_open_now';

    const all = parseMapFilters(get);
    all.status = 'all';
    const { data: anyRows, error: anyErr } = await applyMapFilters(
      supabase.from('sam_opportunities').select('notice_id').limit(1),
      all,
    );
    if (anyErr) return 'unknown';
    return anyRows?.length ? 'matched_historically' : 'never_matched';
  } catch {
    return 'unknown';
  }
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
    next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
  }
  return isSavedSearchDueAt(search.alert_frequency, next) ? next.toISOString() : null;
}

/**
 * Was this search due in the latest run yet not evaluated by it? Every evaluation (baseline, no
 * match, send) stamps last_alerted_at, so a due search left unstamped is one whose own evaluation
 * failed. Only judged against a run inside today's window, for a search that existed before it.
 */
function missedLatestRun(search: SavedSearchRow, system: SavedSearchDeliveryReadiness, now: Date): boolean {
  if (search.alert_frequency === 'weekly') {
    const created = Date.parse(search.created_at);
    const last = search.last_alerted_at ? Date.parse(search.last_alerted_at) : 0;
    return now.getTime() - created > WEEKLY_STALE_MS && now.getTime() - last > WEEKLY_STALE_MS;
  }
  // Only a run that provably drained and delivered can convict ONE search of being skipped; an
  // unfinished or system-failed run leaves every search unevaluated, which is the system's status.
  if (system.system_status !== 'healthy' && system.system_status !== 'partial_degradation') return false;
  if (!system.latest_run_in_window || !system.latest_run_started_at) return false;
  const runAt = Date.parse(system.latest_run_started_at);
  if (!Number.isFinite(runAt) || !isSavedSearchDueAt(search.alert_frequency, new Date(runAt))) return false;
  if (Date.parse(search.created_at) >= runAt) return false;
  const last = search.last_alerted_at ? Date.parse(search.last_alerted_at) : 0;
  return last < runAt - RUN_EVAL_SLACK_MS;
}

function summarize(s: Omit<SavedSearchAlertStatus, 'summary'>): string {
  const when = s.next_evaluation_at ? ` First check: ${s.next_evaluation_at.slice(0, 16).replace('T', ' ')} UTC.` : '';
  switch (s.headline) {
    case 'system_delivery_failure':
      return 'Search saved, but Mindy alert delivery is currently down for all saved searches — do not expect emails until it recovers.';
    case 'search_delivery_blocked':
      return `Search saved, but alerts cannot be delivered to this account's email (${s.search_delivery_reason}).`;
    case 'search_delivery_failing':
      return 'Search saved, but this search was skipped by the latest alert run — its alerts are not currently being delivered.';
    case 'search_never_matches':
      return 'Search saved, but these filters have never matched any notice in Mindy — it will not alert unless they are changed.';
    case 'paused':
      return 'Search saved with alerts paused — no emails until alerts are re-enabled.';
    case 'delivery_not_yet_tested':
      return (
        (s.baseline === 'pending'
          ? 'Search saved and validated. Delivery not yet tested: the first check records current matches without emailing, and an alert is sent only when a NEW match appears after that.'
          : 'Search saved and validated. No alert has been sent for it yet; one is sent only when a new match appears.') +
        when +
        (s.system_status === 'partial_degradation'
          ? ' (Alert delivery is working; a few other saved searches had problems in the latest run.)'
          : s.system_status === 'degraded_unconfirmed'
            ? ' (The latest alert run reported errors and Mindy could not confirm it delivered — not yet established whether this affects you.)'
            : '')
      );
    case 'delivering':
      return (
        'Alerts for this search have been delivered to this account.' +
        (s.system_status === 'partial_degradation'
          ? ' (A few other saved searches had problems in the latest run; this one is unaffected.)'
          : s.system_status === 'degraded_unconfirmed'
            ? ' (The latest alert run reported errors and Mindy could not confirm it delivered — not yet established whether this affects you.)'
            : '')
      );
  }
}

/** Compose one search's customer-facing status from system readiness + recipient evidence. */
export function composeSearchAlertStatus(
  search: SavedSearchRow,
  system: SavedSearchDeliveryReadiness,
  recipient: RecipientEvidence,
  filterReach: FilterReach,
  now: Date = new Date(),
): SavedSearchAlertStatus {
  const baseline: SearchBaseline = search.last_alerted_at ? 'established' : 'pending';
  const paused = !search.alerts_enabled || search.alert_frequency === 'paused';
  const synthetic = search.user_email.toLowerCase().endsWith('@clients.getmindy.ai');

  let search_delivery: SearchDeliveryStatus;
  let reason: string | null = null;
  if (paused) {
    search_delivery = 'paused';
  } else if (synthetic) {
    search_delivery = 'blocked';
    reason = 'no deliverable email address on file';
  } else if (recipient.suppressed) {
    search_delivery = 'blocked';
    reason = `email suppressed: ${recipient.suppressed}`;
  } else if (missedLatestRun(search, system, now)) {
    search_delivery = 'failing';
    reason = 'not evaluated by the latest alert run';
  } else if (recipient.suppressed === undefined) {
    search_delivery = 'unknown';
    reason = 'recipient check unavailable';
  } else if ((search.total_alerts_sent || 0) > 0 && recipient.lastAlertAt) {
    search_delivery = 'delivered';
  } else {
    search_delivery = 'not_yet_tested';
  }

  const system_status = system.system_status;
  let headline: AlertHeadline;
  if (system_status === 'system_failure' && !paused) headline = 'system_delivery_failure';
  else if (search_delivery === 'blocked') headline = 'search_delivery_blocked';
  else if (search_delivery === 'failing') headline = 'search_delivery_failing';
  else if (filterReach === 'never_matched' && !paused) headline = 'search_never_matches';
  else if (paused) headline = 'paused';
  else if (search_delivery === 'delivered') headline = 'delivering';
  else headline = 'delivery_not_yet_tested';

  const partial: Omit<SavedSearchAlertStatus, 'summary'> = {
    saved: true,
    validated: true,
    filter_reach: filterReach,
    search_delivery,
    search_delivery_reason: reason,
    baseline,
    last_evaluated_at: search.last_alerted_at,
    alerts_sent: search.total_alerts_sent || 0,
    recipient_last_alert_at: recipient.lastAlertAt ?? null,
    next_evaluation_at: paused ? null : nextEvaluation(search, system.cron_expr, now),
    system_status,
    headline,
  };
  return { ...partial, summary: summarize(partial) };
}
