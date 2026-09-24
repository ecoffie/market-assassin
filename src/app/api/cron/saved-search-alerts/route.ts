/**
 * /api/cron/saved-search-alerts — the Opportunity Map "Save search" alert dispatcher.
 *
 * For each ENABLED saved search due today, re-run its saved filter set against fresh
 * active opportunities (via the SHARED applyMapFilters — identical to what the user saw
 * on the map), diff against last_seen_notice_ids, and email the NEW matches. Stamps
 * last_alerted_at + the seen ids so nothing double-sends. Pages due rows in
 * bounded batches inside one invocation until the day's audience is drained
 * or a time/row ceiling below the 290s timeout is hit. Leftover backlog is
 * reported as partial/error — never success.
 *
 * FORECASTS (Eric, 2026-08-02: "you should be able to see any new forecast that surfaces
 * that you might have missed"). A saved search with the forecast horizon on also diffs
 * agency_forecasts. Two things make this the important half:
 *
 *   1. 14,389 of 33,075 forecasts have NO coordinate — the agency said "TBD" or
 *      "VENDOR'S FACILITY", or published no place field at all — so they can never appear
 *      on the map. This alert is the only PUSH channel that reaches them.
 *   2. Forecasts are the earliest signal in the cycle (6-18mo upstream of a solicitation)
 *      and had no proactive path at all: chat, MCP and the market report are all PULL, so
 *      a user only found a forecast if they already suspected it existed.
 *
 * NEW-RECORD ONLY, deliberately. Field-change alerts ("TBD → Q2 FY26", set-aside decided)
 * are the obvious follow-up, and the enterprise pattern is to make those opt-in and narrow
 * — Salesforce caps field-history tracking at 20 fields per object precisely because
 * unbounded change alerts get muted. Ship the id-diff first, tune changes against real
 * volume later.
 *
 * FORECAST ENGINE (2026-09-23). The Forecast half has two engines:
 *   legacy    — applyForecastFilters over q/naics/agency/state (the pre-migration semantics). DEFAULT.
 *   canonical — the canonical Discovery plan through src/lib/saved-searches/forecast-discovery.ts, the
 *               SAME request→plan builder the Maps Forecast horizon uses. Carries coverage: an
 *               unavailable publisher is never a zero, a partial list names what was not measured.
 * canonical runs only when SAVED_SEARCH_FORECAST_CANONICAL is exactly 'true', or read-only under
 * ?mode=preview&forecastEngine=canonical. Both engines share decideSavedSearchAlert (dedupe/new-record
 * rules unchanged). Open is unchanged by either.
 *
 * Registered as a cron_jobs row (dispatcher-fired) — NOT vercel.json.
 * ?mode=preview lists what WOULD send without sending. ?limit=N caps each
 * fetch page, not the day's work.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { sendEmail } from '@/lib/send-email';
import { buildEmail } from '@/lib/alerts/saved-search-email';
import { applyForecastFilters } from '@/lib/opportunities/map-data';
import { toAlertRow, type ForecastRowForAlert } from '@/lib/alerts/forecast-alert-row';
import { reportCronOutcome } from '@/lib/cron-self-report';
import {
  forecastCoverageNotice,
  resolveForecastEngine,
  type ForecastEngine,
  type ForecastHorizonOutcome,
} from '@/lib/saved-searches/forecast-discovery';
import { decideSavedSearchAlert } from '@/lib/saved-searches/alert-decision';
import {
  evaluateForecastWatermark,
  readForecastSnapshot,
  readPublisherFloors,
  stateFromRow,
  stateToColumns,
} from '@/lib/saved-searches/forecast-watermark';
import {
  SAVED_SEARCH_ALERT_BATCH_SIZE,
  SAVED_SEARCH_ALERT_ROW_CEILING,
  SAVED_SEARCH_ALERT_TIME_BUDGET_MS,
  runSavedSearchAlertDrain,
  type SavedSearchAlertDueRow,
  type SavedSearchAlertEvalCounts,
} from '@/lib/saved-searches/alert-drain';
import { dueSavedSearchFrequenciesAt, isSavedSearchDueAt } from '@/lib/saved-searches';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const PIN_COLS = 'notice_id, title, department, naics_code, set_aside_code, notice_type, posted_date, response_deadline, ui_link, solicitation_number, pop_state, pop_city';

const FORECAST_COLS = 'external_id, title, source_agency, department, contracting_office, naics_code, '
  + 'set_aside_type, fiscal_year, anticipated_quarter, anticipated_award_date, solicitation_date, '
  + 'estimated_value_max, estimated_value_range, pop_city, pop_state, last_synced_at';

const MINDY_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://getmindy.ai';
const JOB_NAME = 'saved-search-alerts';
const DUE_SELECT =
  'id, user_email, name, mode, filters, alert_frequency, last_seen_notice_ids, total_alerts_sent, last_alerted_at';
// The watermark columns exist only after 20260924_saved_search_forecast_watermark.sql; the legacy engine
// never selects them, so deploying this code before the migration cannot break the legacy cron.
const DUE_SELECT_CANONICAL = `${DUE_SELECT}, forecast_seen_through, forecast_gap_since`;

/**
 * Does this saved search want FORECASTS?
 *
 * The map's horizon chips (open / recompete / forecast) drive what the user is
 * looking at, and a saved search records them in `filters.horizons`. A search
 * saved BEFORE horizons were captured has no such key — those stay open-only,
 * which is what their owner saw when they saved it. Never opt an existing
 * search into a new corpus retroactively; that is a surprise alert, not a
 * feature.
 */
function wantsForecasts(s: SavedSearch): boolean {
  const h = (s.filters as Record<string, unknown>)?.horizons;
  if (h && typeof h === 'object') return (h as Record<string, unknown>).forecast === true;
  return s.mode === 'forecast';
}

/**
 * Forecast rows matching a saved search's filters.
 *
 * ⚠️ NO map_lat FILTER. This is the whole point: 14,389 of 33,075 forecasts
 * have no coordinate (the agency said "TBD"/"VENDOR'S FACILITY", or published
 * no place field), so they can never appear on the map. The alert is the only
 * PUSH channel that can reach them — filtering on coordinates here would
 * recreate the exact blind spot this is meant to close.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchForecastMatches(db: any, s: SavedSearch): Promise<ForecastRowForAlert[]> {
  const f = (s.filters || {}) as Record<string, string>;
  let q = db.from('agency_forecasts').select(FORECAST_COLS).limit(200);
  q = applyForecastFilters(q, {
    q: f.q ?? null, naics: f.naics ?? null, agency: f.agency ?? null, state: f.state ?? null,
  });
  const { data, error } = await q.order('last_synced_at', { ascending: false });
  if (error) {
    console.error('[saved-search-alerts] forecast query failed:', error.message);
    throw new Error('forecast_query_failed');
  }
  return (data || []) as ForecastRowForAlert[];
}

type SavedSearch = SavedSearchAlertDueRow;

type PreviewRow = {
  email: string;
  name: string;
  newCount: number;
  forecastEngine?: ForecastEngine;
  forecastCoverage?: string;
  coverageNotices?: string[];
  openNewCount?: number;
  forecastNewCount?: number;
  forecastWatermarkBefore?: string | null;
  forecastWatermarkAfter?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function stampSearchEvaluation(db: any, id: string, updates: Record<string, unknown>): Promise<boolean> {
  const { error } = await db
    .from('saved_searches')
    .update({
      ...updates,
      last_alerted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  return !error;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyDueSavedSearchScope(q: any, dueFrequencies: readonly string[], excludeIds: readonly string[]) {
  q = q
    .eq('alerts_enabled', true)
    // ⚠️ DEFENCE IN DEPTH. An anonymous map watch is stored with
    // alerts_enabled=false and can only become alertable through a VERIFIED
    // claim, which replaces the anon id with the session's real account. This
    // predicate is the second lock: even if a row were ever written or migrated
    // with alerts_enabled wrongly true, an `anon:<uuid>` owner is not an email
    // address and must never enter an email send.
    .not('user_email', 'like', 'anon:%')
    .eq('mode', 'open')
    .in('alert_frequency', [...dueFrequencies]);
  if (excludeIds.length > 0) {
    q = q.not('id', 'in', `(${excludeIds.join(',')})`);
  }
  return q;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fetchDueSavedSearchBatch(
  db: any,
  dueFrequencies: readonly string[],
  excludeIds: readonly string[],
  limit: number,
  select: string = DUE_SELECT,
) {
  return applyDueSavedSearchScope(
    db.from('saved_searches').select(select).limit(limit),
    dueFrequencies,
    excludeIds,
  )
    .order('last_alerted_at', { ascending: true, nullsFirst: true })
    .order('id', { ascending: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countDueSavedSearches(
  db: any,
  dueFrequencies: readonly string[],
  excludeIds: readonly string[],
) {
  return applyDueSavedSearchScope(
    db.from('saved_searches').select('id', { count: 'exact', head: true }),
    dueFrequencies,
    excludeIds,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function evaluateSavedSearch(
  db: any,
  s: SavedSearch,
  now: Date,
  preview: boolean,
  previewRows: PreviewRow[],
  forecastEngine: ForecastEngine = 'legacy',
): Promise<SavedSearchAlertEvalCounts> {
  if (!isSavedSearchDueAt(s.alert_frequency, now)) return { skippedNotDue: 1 };

  const doOpen = s.mode === 'open';
  const doForecast = wantsForecasts(s);
  if (!doOpen && !doForecast) return {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let opps: any[] = [];

  if (doOpen) {
    // Run the SAME filters the user saved. Recent active opps only (posted last 30d as a
    // sane ceiling — new matches are what matter for an alert).
    // scope=profile means "my market", and it is only honoured when the caller SUPPLIES
    // the profile. parseMapFilters reads it from opts, never from the saved filters — so
    // this cron was running a profile-scoped search against the ENTIRE active corpus with
    // no NAICS filter at all, then emailing the result as the user's saved market.
    const savedFilters = s.filters as Record<string, string>;
    let profileOpts: { profileNaics?: string[]; profileStates?: string[] } | undefined;
    if (savedFilters.scope === 'profile') {
      // Gold master: opportunity-map loadProfile. Onboarding writes NAICS/states to
      // user_notification_settings.user_email. user_profiles has no location_states
      // (PostgREST 42703) — selecting it fails every profile-scoped search, measured
      // 2026-09-09 as a standing profile_query_failed=6 on the daily cron.
      const { data: prof, error: profErr } = await db
        .from('user_notification_settings')
        .select('naics_codes, location_states')
        .eq('user_email', s.user_email)
        .maybeSingle();
      // A failed profile read and an empty profile are indistinguishable, and treating a
      // failure as "no codes" would fall through to the unscoped query this fix exists to
      // prevent. Skip and retry tomorrow rather than email the whole corpus once.
      if (profErr) {
        console.error(`[saved-search-alerts] profile read failed for ${s.user_email}:`, profErr.message);
        return { failureClass: 'profile_query_failed' };
      }
      const pn = (prof?.naics_codes as string[] | null) || [];
      const ps = (prof?.location_states as string[] | null) || [];
      // No profile codes = no way to honour the scope. Skip rather than silently widen to
      // everything: an alert claiming to be "your market" must not be the whole corpus.
      if (!pn.length) {
        console.warn(`[saved-search-alerts] skipping ${s.id}: scope=profile but no profile NAICS for ${s.user_email}`);
        if (!preview) {
          const stamped = await stampSearchEvaluation(db, s.id, {});
          if (!stamped) return { failureClass: 'state_update_failed' };
        }
        return { skippedNoProfile: 1 };
      }
      profileOpts = { profileNaics: pn, profileStates: ps };
    }
    const f = parseMapFilters((k) => savedFilters[k] ?? null, profileOpts);
    f.postedDays = f.postedDays || 30;
    let q = db.from('sam_opportunities').select(PIN_COLS).limit(200);
    q = applyMapFilters(q, f);
    const { data, error: qErr } = await q.order('posted_date', { ascending: false });
    if (qErr) return { failureClass: 'opportunity_query_failed' };
    opps = data || [];
  }

  // CANONICAL engine: the Forecast horizon runs on the created_at watermark, and last_seen_notice_ids
  // becomes Open-only state. See evaluateCanonicalForecast.
  if (doForecast && forecastEngine === 'canonical') {
    return evaluateCanonicalForecast(db, s, opps, preview, previewRows);
  }

  if (doForecast) {
    // Forecasts are the EARLIEST signal (6-18mo upstream) and the only corpus with no
    // push channel until now. Adapted into the same card shape so one email template
    // serves both — see src/lib/alerts/forecast-alert-row.ts.
    try {
      const fc = await fetchForecastMatches(db, s);
      opps = opps.concat(fc.map((r) => toAlertRow(r, MINDY_URL)));
    } catch {
      return { failureClass: 'forecast_query_failed' };
    }
  }

  // FIRST RUN (never alerted): snapshot the current matches as "seen" WITHOUT emailing —
  // else a brand-new saved search blasts every current match (200) as "new". Only opps
  // that appear AFTER this baseline are alerts. (Same pattern as pursuit-changes.)
  // The rules live in decideSavedSearchAlert (Open under the canonical engine; Open + legacy Forecast here).
  const decision = decideSavedSearchAlert({
    lastAlertedAt: s.last_alerted_at,
    lastSeenIds: s.last_seen_notice_ids,
    records: opps || [],
  });

  if (decision.action === 'baseline') {
    if (!preview) {
      const stamped = await stampSearchEvaluation(db, s.id, {
        last_seen_notice_ids: decision.nextSeen,
      });
      if (!stamped) return { failureClass: 'state_update_failed' };
    }
    return { noMatches: 1 };
  }

  if (decision.action === 'no_new') {
    if (!preview) {
      const stamped = await stampSearchEvaluation(db, s.id, {});
      if (!stamped) return { failureClass: 'state_update_failed' };
    }
    return { noMatches: 1 };
  }

  const fresh = decision.fresh;

  if (preview) {
    previewRows.push({ email: s.user_email, name: s.name, newCount: fresh.length });
    return { matched: 1 };
  }

  const { subject, html, text } = buildEmail(s, fresh);
  let ok = false;
  try {
    ok = await sendEmail({
      to: s.user_email, subject, html, text,
      emailType: 'saved_search_alert', eventSource: 'saved_search',
    });
  } catch {
    return { matched: 1, sendAttempts: 1, failureClass: 'email_send_failed' };
  }

  if (!ok) return { matched: 1, sendAttempts: 1, failureClass: 'email_send_rejected' };

  const cappedSeen = decision.nextSeenAfterSend;
  const stamped = await stampSearchEvaluation(db, s.id, {
    last_seen_notice_ids: cappedSeen,
    total_alerts_sent: (s.total_alerts_sent || 0) + 1,
  });
  if (!stamped) return { matched: 1, sendAttempts: 1, failureClass: 'state_update_failed' };
  return { matched: 1, sendAttempts: 1, sent: 1 };
}

/**
 * CANONICAL engine for a Forecast-alerting search (SAVED_SEARCH_FORECAST_CANONICAL='true').
 *
 *   Forecast new = canonical plan ∧ covered publisher ∧ created_at ∈ (watermark, snapshot] ∧ > publisher floor.
 *   Open new     = the existing decideSavedSearchAlert over last_seen_notice_ids — which now holds OPEN ids
 *                  only (Forecast ids are never added), so neither horizon can evict the other's state.
 *
 * State moves in ONE update, and only when the run completed: after a successful send, or when there was
 * nothing to send. A failed query / snapshot / floor read / send writes nothing. Unavailable and refused
 * plans leave the Forecast watermark untouched. A NULL watermark baselines silently (safety net for new
 * searches and missed migrations; production cutover uses scripts/saved-search-forecast-baseline.ts).
 */
async function evaluateCanonicalForecast(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  s: SavedSearch,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openRows: any[],
  preview: boolean,
  previewRows: PreviewRow[],
): Promise<SavedSearchAlertEvalCounts> {
  // ONE immutable snapshot, taken at the start of the Forecast evaluation (DB clock, lagged).
  const snap = await readForecastSnapshot(db);
  if ('error' in snap) return { failureClass: 'forecast_query_failed' };
  const fl = await readPublisherFloors(db);
  if ('error' in fl) return { failureClass: 'forecast_query_failed' };
  const before = stateFromRow(s);
  const fo = await evaluateForecastWatermark(db, s.filters, before, { snapshot: snap.snapshot, floors: fl.floors });
  if (fo.kind === 'failed') {
    console.error('[saved-search-alerts] canonical forecast evaluation failed:', fo.error);
    return { failureClass: 'forecast_query_failed' };
  }

  const forecastCoverage: SavedSearchAlertEvalCounts['forecastCoverage'] =
    fo.kind === 'measured' ? (fo.coverage === 'partial' ? 'partial' : 'covered')
    : fo.kind === 'unavailable' ? 'unavailable'
    : fo.kind === 'needs_refinement' ? 'needs_refinement'
    : 'baseline';
  const cov = { forecastCoverage };
  const notice = fo.kind === 'measured' || fo.kind === 'unavailable' || fo.kind === 'needs_refinement'
    ? forecastCoverageNotice(fo as unknown as ForecastHorizonOutcome) : null;
  const coverageNotices = notice ? [notice] : [];
  // Forecast state: only a MEASURED run or a baseline moves it. Unavailable / refused → untouched.
  const forecastState = fo.kind === 'measured' || fo.kind === 'baseline' ? stateToColumns(fo.nextState) : {};

  const openDecision = decideSavedSearchAlert({ lastAlertedAt: s.last_alerted_at, lastSeenIds: s.last_seen_notice_ids, records: openRows });
  const openFresh = openDecision.action === 'send' ? openDecision.fresh : [];
  const openSeen = openDecision.action === 'baseline' ? { last_seen_notice_ids: openDecision.nextSeen }
    : openDecision.action === 'send' ? { last_seen_notice_ids: openDecision.nextSeenAfterSend } : {};
  const forecastFresh = fo.kind === 'measured' ? fo.rows.map((r) => toAlertRow(r, MINDY_URL)) : [];
  const fresh = [...openFresh, ...forecastFresh];

  if (preview) {
    previewRows.push({
      email: s.user_email, name: s.name, newCount: fresh.length, forecastEngine: 'canonical', forecastCoverage,
      coverageNotices, openNewCount: openFresh.length, forecastNewCount: forecastFresh.length,
      forecastWatermarkBefore: before.seenThrough, forecastWatermarkAfter: fo.kind === 'measured' || fo.kind === 'baseline' ? fo.nextState.seenThrough : before.seenThrough,
    });
    return fresh.length ? { matched: 1, ...cov } : { noMatches: 1, ...cov };
  }

  if (fresh.length === 0) {
    const stamped = await stampSearchEvaluation(db, s.id, { ...openSeen, ...forecastState });
    if (!stamped) return { failureClass: 'state_update_failed', ...cov };
    return { noMatches: 1, ...cov };
  }

  const { subject, html, text } = buildEmail(s, fresh, coverageNotices);
  let ok = false;
  try {
    ok = await sendEmail({ to: s.user_email, subject, html, text, emailType: 'saved_search_alert', eventSource: 'saved_search' });
  } catch {
    return { matched: 1, sendAttempts: 1, failureClass: 'email_send_failed', ...cov };
  }
  if (!ok) return { matched: 1, sendAttempts: 1, failureClass: 'email_send_rejected', ...cov };

  const stamped = await stampSearchEvaluation(db, s.id, {
    ...openSeen, ...forecastState, total_alerts_sent: (s.total_alerts_sent || 0) + 1,
  });
  if (!stamped) return { matched: 1, sendAttempts: 1, failureClass: 'state_update_failed', ...cov };
  return { matched: 1, sendAttempts: 1, sent: 1, ...cov };
}

// buildEmail (the Target-card email) lives in a lib so it's testable + offline-previewable.

export async function GET(request: NextRequest) {
  const preview = request.nextUrl.searchParams.get('mode') === 'preview';
  const dispatcherRun = request.headers.get('x-cron-dispatch') === '1';
  const batchSize = Math.min(
    200,
    Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || String(SAVED_SEARCH_ALERT_BATCH_SIZE), 10) || SAVED_SEARCH_ALERT_BATCH_SIZE),
  );
  const db = sb();
  const now = new Date();
  const dueFrequencies = dueSavedSearchFrequenciesAt(now);
  const previewRows: PreviewRow[] = [];
  const forecastEngine = resolveForecastEngine(
    process.env.SAVED_SEARCH_FORECAST_CANONICAL,
    preview,
    request.nextUrl.searchParams.get('forecastEngine'),
  );

  const results = await runSavedSearchAlertDrain({
    dueFrequencies,
    batchSize,
    rowCeiling: SAVED_SEARCH_ALERT_ROW_CEILING,
    timeBudgetMs: SAVED_SEARCH_ALERT_TIME_BUDGET_MS,
    fetchDueBatch: async ({ limit, excludeIds }) => {
      const { data, error } = await fetchDueSavedSearchBatch(
        db, dueFrequencies, excludeIds, limit, forecastEngine === 'canonical' ? DUE_SELECT_CANONICAL : DUE_SELECT,
      );
      return { rows: (data || []) as SavedSearch[], error };
    },
    countRemaining: async ({ excludeIds }) => {
      const { count, error } = await countDueSavedSearches(db, dueFrequencies, excludeIds);
      if (error || count === null) return null;
      return count;
    },
    evaluate: (row) => evaluateSavedSearch(db, row, now, preview, previewRows, forecastEngine),
  });

  if (dispatcherRun) {
    await reportCronOutcome(JOB_NAME, results.outcome, results.errorSummary);
  }

  if (results.stopReason === 'query_failed' && results.processed === 0) {
    return NextResponse.json(
      {
        success: false,
        note: results.failuresByClass.saved_search_query_failed
          ? 'saved_searches query failed'
          : undefined,
        processed: 0,
        remaining: results.remaining,
        outcome: results.outcome,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      success: results.success,
      outcome: results.outcome,
      forecastEngine,
      forecastCoverage: results.forecastCoverage,
      processed: results.processed,
      matched: results.matched,
      sendAttempts: results.sendAttempts,
      sent: results.sent,
      noMatches: results.noMatches,
      skippedNotDue: results.skippedNotDue,
      skippedNoProfile: results.skippedNoProfile,
      failed: results.failed,
      remaining: results.remaining,
      batches: results.batches,
      stopReason: results.stopReason,
      failuresByClass: results.failuresByClass,
      ...(preview ? { preview: previewRows } : {}),
    },
    { status: results.success ? 200 : 500 },
  );
}
