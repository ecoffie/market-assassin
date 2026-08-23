/**
 * /api/cron/saved-search-alerts — the Opportunity Map "Save search" alert dispatcher.
 *
 * For each ENABLED saved search due today, re-run its saved filter set against fresh
 * active opportunities (via the SHARED applyMapFilters — identical to what the user saw
 * on the map), diff against last_seen_notice_ids, and email the NEW matches. Stamps
 * last_alerted_at + the seen ids so nothing double-sends. Batched + resumable.
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
 * Registered as a cron_jobs row (dispatcher-fired) — NOT vercel.json.
 * ?mode=preview lists what WOULD send without sending. ?limit=N caps the batch.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { sendEmail } from '@/lib/send-email';
import { buildEmail } from '@/lib/alerts/saved-search-email';
import { applyForecastFilters } from '@/lib/opportunities/map-data';
import { toAlertRow, type ForecastRowForAlert } from '@/lib/alerts/forecast-alert-row';

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
    return [];
  }
  return (data || []) as ForecastRowForAlert[];
}

type SavedSearch = {
  id: string; user_email: string; name: string; mode: string;
  filters: Record<string, unknown>; alert_frequency: string;
  last_seen_notice_ids: string[]; total_alerts_sent: number;
  last_alerted_at: string | null;
};

// Weekly searches fire only on Mondays (UTC); daily every run; paused never.
function isDue(freq: string): boolean {
  if (freq === 'paused') return false;
  if (freq === 'weekly') return new Date().getUTCDay() === 1;
  return true; // daily (default)
}

// buildEmail (the Target-card email) lives in a lib so it's testable + offline-previewable.

export async function GET(request: NextRequest) {
  const preview = request.nextUrl.searchParams.get('mode') === 'preview';
  const limit = Math.min(200, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '50', 10) || 50));
  const db = sb();

  // Enabled searches, least-recently-alerted first (fair drain, resumable).
  const { data: searches, error } = await db
    .from('saved_searches')
    .select('id, user_email, name, mode, filters, alert_frequency, last_seen_notice_ids, total_alerts_sent, last_alerted_at')
    .eq('alerts_enabled', true)
    .order('last_alerted_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    if (error.code === '42P01') return NextResponse.json({ success: true, note: 'saved_searches table not present yet', processed: 0 });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const results = { processed: 0, sent: 0, noMatches: 0, skippedNotDue: 0, skippedNoProfile: 0, failed: 0 };
  const previewRows: Array<{ email: string; name: string; newCount: number }> = [];

  for (const s of (searches || []) as SavedSearch[]) {
    results.processed++;
    if (!isDue(s.alert_frequency)) { results.skippedNotDue++; continue; }

    try {
      // OPEN (sam_opportunities) and FORECAST (agency_forecasts) both alert here.
      // Recompete is still a follow-up — different table again.
      const doOpen = s.mode === 'open';
      const doForecast = wantsForecasts(s);
      if (!doOpen && !doForecast) continue;

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
          const { data: prof, error: profErr } = await db
            .from('user_profiles')
            .select('naics_codes, location_states')
            .eq('email', s.user_email)
            .maybeSingle();
          // A failed profile read and an empty profile are indistinguishable, and treating a
          // failure as "no codes" would fall through to the unscoped query this fix exists to
          // prevent. Skip and retry tomorrow rather than email the whole corpus once.
          if (profErr) {
            console.error(`[saved-search-alerts] profile read failed for ${s.user_email}:`, profErr.message);
            results.failed++;
            continue;
          }
          const pn = (prof?.naics_codes as string[] | null) || [];
          const ps = (prof?.location_states as string[] | null) || [];
          // No profile codes = no way to honour the scope. Skip rather than silently widen to
          // everything: an alert claiming to be "your market" must not be the whole corpus.
          if (!pn.length) {
            console.warn(`[saved-search-alerts] skipping ${s.id}: scope=profile but no profile NAICS for ${s.user_email}`);
            results.skippedNoProfile++;
            continue;
          }
          profileOpts = { profileNaics: pn, profileStates: ps };
        }
        const f = parseMapFilters((k) => savedFilters[k] ?? null, profileOpts);
        f.postedDays = f.postedDays || 30;
        let q = db.from('sam_opportunities').select(PIN_COLS).limit(200);
        q = applyMapFilters(q, f);
        const { data, error: qErr } = await q.order('posted_date', { ascending: false });
        if (qErr) { results.failed++; continue; }
        opps = data || [];
      }

      if (doForecast) {
        // Forecasts are the EARLIEST signal (6-18mo upstream) and the only corpus with no
        // push channel until now. Adapted into the same card shape so one email template
        // serves both — see src/lib/alerts/forecast-alert-row.ts.
        const fc = await fetchForecastMatches(db, s);
        opps = opps.concat(fc.map((r) => toAlertRow(r, MINDY_URL)));
      }

      const seen = new Set(Array.isArray(s.last_seen_notice_ids) ? s.last_seen_notice_ids : []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allNoticeIds = (opps || []).map((o: any) => o.notice_id).filter(Boolean);

      // FIRST RUN (never alerted): snapshot the current matches as "seen" WITHOUT emailing —
      // else a brand-new saved search blasts every current match (200) as "new". Only opps
      // that appear AFTER this baseline are alerts. (Same pattern as pursuit-changes.)
      if (!s.last_alerted_at && seen.size === 0) {
        if (!preview) {
          await db.from('saved_searches').update({
            last_alerted_at: new Date().toISOString(),
            last_seen_notice_ids: [...new Set(allNoticeIds)].slice(0, 500),
            updated_at: new Date().toISOString(),
          }).eq('id', s.id);
        }
        results.noMatches++; // counted as "baselined this run, nothing to send"
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fresh = (opps || []).filter((o: any) => o.notice_id && !seen.has(o.notice_id));

      if (fresh.length === 0) { results.noMatches++; continue; }

      if (preview) {
        previewRows.push({ email: s.user_email, name: s.name, newCount: fresh.length });
        continue;
      }

      const { subject, html, text } = buildEmail(s, fresh);
      const ok = await sendEmail({
        to: s.user_email, subject, html, text,
        emailType: 'saved_search_alert', eventSource: 'saved_search',
      });

      // Stamp seen ids (cap the stored list so it can't grow unbounded) + timestamps.
      const cappedSeen = [...new Set([...allNoticeIds, ...seen])].slice(0, 500);
      await db.from('saved_searches').update({
        last_alerted_at: new Date().toISOString(),
        last_seen_notice_ids: cappedSeen,
        total_alerts_sent: (s.total_alerts_sent || 0) + (ok ? 1 : 0),
        updated_at: new Date().toISOString(),
      }).eq('id', s.id);

      if (ok) results.sent++; else results.failed++;
    } catch {
      results.failed++;
    }
  }

  return NextResponse.json({ success: true, ...results, ...(preview ? { preview: previewRows } : {}) });
}
