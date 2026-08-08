/**
 * Cron: sync agency procurement forecasts (DHS + DOE).
 *
 * WHY ONLY THESE TWO: a health sweep of all 9 registered scrapers on 2026-07-31
 * found 2 alive; a second sweep of all 13 stale sources on 2026-08-01 found
 * exactly one more that can be automated. DHS returns ~754 records from a plain
 * JSON API (apfs-cloud.dhs.gov); DOE publishes a public XLSX on energy.gov with
 * no WAF and no login (~870 rows, updated monthly, incumbent + contract number
 * on every row). Everything else is blocked, not merely broken:
 *
 *   HHS                      login-gated SPA (osdbu.hhs.gov) — no file, no API
 *   VA, DOT                  migrated to the GSA Acquisition Gateway, which is
 *                            itself login-gated (its backend host is internal)
 *   USACE                    Akamai WAF — stays a MANUAL drop, see
 *                            scripts/ingest-usace-forecast.ts
 *   DOI/USDA/DOJ/GSA/DOL/NASA  no public file found; Puppeteer scrapers rotted
 *
 * The rotted scrapers stay unscheduled on purpose: they load the page and
 * extract 0 rows, so scheduling them would create jobs that "succeed" while
 * importing nothing — precisely the silent-failure shape that hid the DIBBS
 * outage for two days, and that let 15 of 17 sources go 36+ days stale.
 * Add an agency here only after its fetch is verified against the live portal.
 *
 * ⚠️ A ZERO-RECORD FETCH IS A FAILURE, NOT A QUIET SUCCESS. Government portals
 * change without notice; the failure mode is always "still returns 200, now
 * parses to nothing". This route returns HTTP 500 + a Slack ops alert when a
 * source yields no rows, so a rotted scraper surfaces the day it breaks instead
 * of after a customer notices the data is months old.
 *
 * Mirrors the proven upsert contract in scripts/import-forecasts-live.js:
 * onConflict 'source_agency,external_id', so re-running is idempotent and a
 * re-post of the same forecast updates rather than duplicates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOpsAlert } from '@/lib/ops-alert';
import { reportCronOutcome } from '@/lib/cron-self-report';
import * as XLSX from 'xlsx';
import { DOE_FORECAST_URL, parseDoeForecast, doeExternalId } from '@/lib/forecasts/doe-forecast';
import { parseMoneyRange, parseSetAside, parseNaics } from '@/lib/forecasts/usace-district-parse';
import { normalizeForecastRow, cleanForecastState, type ForecastRowFields } from '@/lib/forecasts/normalize-row';
import { resolvePinCoord } from '@/lib/opportunities/map-data';
import { resolveNavyPlace } from '@/lib/forecasts/navy-installations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const JOB_NAME = 'sync-forecasts';
const DHS_API = 'https://apfs-cloud.dhs.gov/api/forecast/';

const clean = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const nn = (v: string): string | null => (v && v !== '-' ? v : null);

/** "FY2026" | "2026" | 2026 -> "FY2026"; anything unparseable -> null. */
function fyDigits(v: unknown): string | null {
  const m = clean(v).match(/(\d{2,4})/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 2000 && n <= 2100) return `FY${n}`;
  if (n >= 20 && n <= 99) return `FY${2000 + n}`;
  return null;
}

function isoDate(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** "$1M to $5M" -> [min, max] in dollars; best-effort, nulls when unparseable. */
function parseRange(v: unknown): [number | null, number | null] {
  const s = clean(v).toLowerCase();
  if (!s) return [null, null];
  const mult = (u: string) => (u === 'b' ? 1e9 : u === 'm' ? 1e6 : u === 'k' ? 1e3 : 1);
  const nums = [...s.matchAll(/\$?\s*([\d.,]+)\s*([bmk])?/g)]
    .map((m) => Number(m[1].replace(/,/g, '')) * mult(m[2] || ''))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return [null, null];
  return [nums[0], nums.length > 1 ? nums[nums.length - 1] : null];
}

interface DhsForecast { [k: string]: unknown }

/** Fetch + map DHS APFS. Same field mapping as import-forecasts-live.js. */
async function fetchDHS(): Promise<Record<string, unknown>[]> {
  const res = await fetch(DHS_API, {
    headers: { Accept: 'application/json', 'User-Agent': 'GovConGiants-Mindy/1.0' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`DHS APFS HTTP ${res.status}`);
  const data = (await res.json()) as DhsForecast[];
  if (!Array.isArray(data)) throw new Error('DHS APFS returned a non-array payload');

  const now = new Date().toISOString();
  return data.map((r) => {
    const [code, , desc] = (clean(r.naics) + ' - ').split(' - ');
    const city = clean(r.place_of_performance_city);
    const st = clean(r.place_of_performance_state);
    const dollarRange = (r.dollar_range as { display_name?: string } | null)?.display_name;
    const [vmin, vmax] = parseRange(dollarRange);
    const title = nn(clean(r.requirements_title)) || nn(clean(r.contract_vehicle));
    return {
      source_agency: 'DHS',
      source_type: 'api',
      source_url: DHS_API,
      external_id: nn(clean(r.apfs_number)) || nn(clean(r.id)) || `DHS:${(title || '').slice(0, 60)}`,
      title: title || nn(clean(r.requirement)) || '(untitled forecast)',
      description: nn(clean(r.requirement)),
      bureau: nn(clean(r.organization)),
      contracting_office: nn(clean(r.organization)),
      program_office: nn(clean(r.organization)),
      naics_code: nn(clean(code)),
      naics_description: nn(clean(desc)),
      fiscal_year: fyDigits(r.fiscal_year),
      anticipated_quarter: clean(r.award_quarter).match(/Q[1-4]/)?.[0] || null,
      anticipated_award_date: null,
      solicitation_date:
        isoDate(r.estimated_solicitation_release_date) || isoDate(r.estimated_release_date),
      estimated_value_min: vmin,
      estimated_value_max: vmax,
      estimated_value_range: nn(clean(dollarRange)),
      contract_type: nn(clean(r.contract_type)),
      set_aside_type: nn(clean(r.small_business_set_aside)) || nn(clean(r.small_business_program)),
      incumbent_name: nn(clean(r.contractor)),
      poc_name: [clean(r.requirements_contact_first_name), clean(r.requirements_contact_last_name)]
        .filter(Boolean).join(' ') || null,
      poc_email: nn(clean(r.requirements_contact_email)),
      poc_phone: nn(clean(r.requirements_contact_phone)),
      pop_state: nn(st),
      pop_city: nn(city),
      status: nn(clean(r.current_state)) || 'forecast',
      last_synced_at: now,
    };
  });
}

/**
 * Fetch + map the DOE (+NNSA) OSDBU forecast spreadsheet.
 *
 * The SECOND automatable source. Probed all 13 stale agencies on 2026-08-01:
 * DOE is the only one besides DHS that publishes a public file with no WAF and
 * no login. HHS and the GSA Acquisition Gateway (which VA and DOT migrated to)
 * are login-gated; USACE sits behind an Akamai WAF and stays a manual drop.
 *
 * Richer than DHS: carries the CURRENT INCUMBENT and contract number per row,
 * which is what makes a forecast a recompete target rather than a heads-up.
 */
async function fetchDOE(): Promise<Record<string, unknown>[]> {
  const res = await fetch(DOE_FORECAST_URL, {
    headers: { 'User-Agent': 'GovConGiants-Mindy/1.0' },
    cache: 'no-store',
  });
  // DOE republishes monthly under a DATED directory, so a moved file 404s.
  // That must fail loudly — it is the one predictable way this source breaks.
  if (!res.ok) {
    throw new Error(
      `DOE forecast HTTP ${res.status} — the monthly file likely moved; ` +
      'check energy.gov/osdbu/small-business-toolbox/acquisition-forecast for the current URL',
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1, defval: '',
  }) as unknown[][];

  const parsed = parseDoeForecast(aoa, { parseMoneyRange, parseSetAside, parseNaics });
  if (parsed.headerRow === -1) throw new Error('DOE forecast: no header row found — layout changed');

  const now = new Date().toISOString();
  return parsed.rows.map((r) => ({
    source_agency: 'DOE',
    source_type: 'osdbu_xlsx',
    source_url: DOE_FORECAST_URL,
    external_id: doeExternalId(r),
    title: r.title,
    description: r.naicsDescription || null,
    bureau: r.programOffice || null,
    contracting_office: r.programOffice || null,
    program_office: r.programOffice || null,
    naics_code: r.naicsCode || null,
    naics_description: r.naicsDescription || null,
    estimated_value_min: r.estimatedValueMin ?? null,
    estimated_value_max: r.estimatedValueMax ?? null,
    estimated_value_range: r.estimatedValueRange || null,
    set_aside_type: r.setAside || null,
    contract_type: r.contractType || null,
    incumbent_name: r.incumbentName || null,
    incumbent_contract_number: r.incumbentContractNumber || null,
    performance_end_date: r.performanceEndDate || null,
    pop_state: r.popState || null,
    status: 'forecasted',
    last_synced_at: now,
  }));
}

/** Per-source baselines. A source that drops far below its observed floor has
 *  broken upstream, even when the HTTP call succeeded. */
const SOURCE_FLOOR: Record<string, number> = { DHS: 1, DOE: 1 };

export async function GET(request: NextRequest) {
  // Auth first — same gate as the other cron routes.
  const password = request.nextUrl.searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const authorized =
    (!!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) ||
    (!!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const dryRun = request.nextUrl.searchParams.get('dry_run') === '1';

  try {
    // Sources run INDEPENDENTLY. One rotted portal must not stop the other from
    // syncing — that is how a single failure quietly ages the whole table.
    const sources: Array<{ name: string; fetch: () => Promise<Record<string, unknown>[]> }> = [
      { name: 'DHS', fetch: fetchDHS },
      { name: 'DOE', fetch: fetchDOE },
    ];

    const rows: Record<string, unknown>[] = [];
    const perSource: Record<string, number> = {};
    const failures: string[] = [];

    for (const s of sources) {
      try {
        const got = await s.fetch();
        // A portal that changed shape still returns 200 and parses to nothing.
        // Treating that as success is how a dead source stays dead for months.
        if (got.length < (SOURCE_FLOOR[s.name] ?? 1)) {
          failures.push(`${s.name} returned ${got.length} rows (parsed to nothing — shape change?)`);
          perSource[s.name] = 0;
          continue;
        }
        perSource[s.name] = got.length;
        rows.push(...got);
      } catch (e) {
        failures.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`);
        perSource[s.name] = 0;
      }
    }

    // Alert on ANY failed source, even when another succeeded — a partial
    // success that silently drops a source is the exact blind spot that let 15
    // of 17 sources go 36+ days stale.
    if (failures.length) {
      console.error(`[${JOB_NAME}] source failures:`, failures.join(' | '));
      await sendOpsAlert({
        subject: `Forecast sync — ${failures.length} source(s) FAILED`,
        html: `<p>${failures.map(f => `<div>${f}</div>`).join('')}</p>`
          + `<p>Succeeded: ${Object.entries(perSource).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(', ') || 'none'}</p>`,
      }).catch(() => {});
    }

    // Only a TOTAL wipeout is a 500 — otherwise the good source still lands.
    if (rows.length === 0) {
      const msg = `All forecast sources failed: ${failures.join(' | ')}`;
      await reportCronOutcome(JOB_NAME, 'error', msg);
      return NextResponse.json({ success: false, error: msg, perSource }, { status: 500 });
    }

    if (dryRun) {
      return NextResponse.json({ success: true, dryRun: true, fetched: rows.length, perSource, failures, sample: rows[0] });
    }

    // Dedupe on the conflict key before upserting — Postgres rejects an
    // ON CONFLICT that would touch the same row twice in one statement.
    const byKey = new Map<string, Record<string, unknown>>();
    for (const r of rows) byKey.set(`${r.source_agency}|${r.external_id}`, r);
    const deduped = [...byKey.values()];

    // Normalise BEFORE the upsert, using the same rules the oracle enforces.
    // A one-time repair against a daily source is a treadmill: the manual pass
    // ran, and this cron put "NA" back into pop_state on 146 rows within a day,
    // turning the oracle red with mismatches nobody had introduced. Cleaning at
    // write time is what makes the fix hold.
    let normalized = 0;
    for (const r of deduped) {
      const patch = normalizeForecastRow(r as ForecastRowFields);
      if (Object.keys(patch).length) { Object.assign(r, patch); normalized++; }
    }
    if (normalized) console.log(`[${JOB_NAME}] normalized ${normalized} row(s) before upsert`);

    // Stamp map coords AT WRITE TIME, for the same reason normalisation happens here.
    // 20260731_forecast_map_latlng.sql said "new rows get stamped by the forecast
    // sync/import going forward" — nothing actually did it, so every row this cron
    // wrote landed with map_lat NULL and stayed off the Forecasts layer until someone
    // remembered to run scripts/backfill-forecast-latlng.ts by hand. Measured 2026-08-06:
    // 100% of DHS rows ingested Aug 3-5 (44/44) were unpinned while Jul 31 sat at 85%,
    // i.e. the gap reopens every day the backfill isn't run. A daily source needs the
    // fix at write time; a one-time drain is a treadmill.
    //
    // Same resolvePinCoord() chain the backfill and the SAM opps layer use, so a forecast
    // pin lands where the geocoder would draw it either way. Returns null when there is no
    // resolvable place — the row is left NULL and honestly won't pin (never a fake coord),
    // which is the policy in src/lib/forecasts/map-coverage.ts.
    let pinned = 0;
    for (const r of deduped) {
      const sh = resolveNavyPlace(String(r.pop_state ?? '') || '');
      const g = resolvePinCoord({
        notice_id: String(r.external_id ?? ''),
        title: (r.title as string) ?? null,
        pop_city: (sh?.city ?? r.pop_city ?? null) as string | null,
        pop_state: (sh?.state ?? cleanForecastState(r.pop_state as string | null)) as string | null,
        pop_zip: (r.pop_zip ?? null) as string | null,
        pop_country: (r.pop_country ?? null) as string | null,
      });
      if (!g) continue;
      r.map_lat = g.lat;
      r.map_lng = g.lng;
      r.map_loc_source = g.city && g.city.trim() ? 'city' : 'state';
      pinned++;
    }
    console.log(`[${JOB_NAME}] stamped map coords on ${pinned}/${deduped.length} row(s)`);

    let upserted = 0;
    for (let i = 0; i < deduped.length; i += 500) {
      const batch = deduped.slice(i, i + 500);
      const { error } = await supabase
        .from('agency_forecasts')
        .upsert(batch, { onConflict: 'source_agency,external_id' });
      if (error) throw new Error(`upsert failed at ${i}: ${error.message}`);
      upserted += batch.length;
    }

    // A partial run reports 'error' so the watchdog sees it — a source that
    // silently stops is worse than one that loudly fails.
    await reportCronOutcome(JOB_NAME, failures.length ? 'error' : 'success',
      failures.length ? failures.join(' | ') : undefined);
    return NextResponse.json({
      success: true,
      fetched: rows.length,
      deduped: deduped.length,
      normalized,
      upserted,
      perSource,
      failures,
      message: `Forecasts: ${Object.entries(perSource).map(([k, n]) => `${k}=${n}`).join(', ')} — upserted ${upserted}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'forecast sync failed';
    console.error(`[${JOB_NAME}]`, message);
    await sendOpsAlert({
      subject: 'Forecast sync ERROR — DHS',
      html: `<p>The DHS forecast sync threw.</p><pre>${message}</pre>`,
    }).catch(() => {});
    await reportCronOutcome(JOB_NAME, 'error', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
