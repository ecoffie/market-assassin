/**
 * Cron: sync agency procurement forecasts (DHS + DOE).
 *
 * WHY ONLY THESE TWO: a health sweep of all 9 registered scrapers on 2026-07-31
 * found 2 alive; a second sweep of all 13 stale sources on 2026-08-01 found
 * exactly one more that can be automated. DHS historically returned ~754 records
 * from apfs-cloud.dhs.gov JSON — that host now serves a migration notice (HTML 200),
 * and era-apfs.dhs.gov does not resolve. The default path classifies that body and
 * then tries the public allRecords CSV. A 403, HTML notice, or empty file FAIL-LOUDs
 * (never upserts empty). Optional `DHS_FORECAST_ALLRECORDS_URL` still overrides.
 * DOE's current file is the dated
 * CSV linked from energy.gov/osbp/acquisition-forecast (not the July 2026 XLSX,
 * which still returns 200). Everything else is blocked, not merely broken:
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
import { canonicalDhsExternalId } from '@/lib/forecasts/dhs-identity';
import {
  DHS_ALLRECORDS_CSV_URL,
  DHS_ALLRECORDS_SOURCE_TYPE,
  dhsAllrecordsToDbRow,
  parseDhsAllrecordsBuffer,
} from '@/lib/forecasts/dhs-allrecords';
import { classifyDhsBody } from '@/lib/forecasts/dhs-source';
import { NextRequest, NextResponse } from 'next/server';
import { forecastWriterClient, guardForecastInserts, countNewForecastRows, quarantineRefusedLoad } from '@/lib/forecasts/writer';
import { sendOpsAlert } from '@/lib/ops-alert';
import { reportCronOutcome } from '@/lib/cron-self-report';
import {
  DOE_FORECAST_PAGE,
  absoluteDoeUrl,
  doeExternalId,
  extractDoeForecastDocuments,
  parseDoeCsv,
} from '@/lib/forecasts/doe-forecast';
import { parseMoneyRange, parseSetAside, parseNaics } from '@/lib/forecasts/usace-district-parse';
import { normalizeForecastRow, type ForecastRowFields } from '@/lib/forecasts/normalize-row';

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

/**
 * Optional override: when `DHS_FORECAST_ALLRECORDS_URL` is set, the cron uses the
 * DHS.gov public allRecords file instead of apfs-cloud JSON. Default remains the
 * API path — which now FAIL-LOUDs on HTML/non-JSON so a migration page cannot
 * upsert empty. Do not set the env in prod without a reviewed dry-run
 * (scripts/ingest-dhs-forecast-allrecords.ts).
 */
async function fetchDhsAllrecordsFile(url: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GovConGiants-Mindy/1.0' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(
      `DHS allRecords HTTP ${res.status} — check DHS.gov Advance Acquisition Planning download URL`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('DHS allRecords returned an empty body');
  const parsed = parseDhsAllrecordsBuffer(buf);
  if (parsed.headerRow === -1) throw new Error('DHS allRecords: no APFS Number header — layout changed');
  if (!parsed.rows.length) {
    throw new Error('DHS allRecords parsed to 0 rows — refusing empty upsert');
  }
  const now = new Date().toISOString();
  return parsed.rows.map((r) => ({
    ...dhsAllrecordsToDbRow(r, { sourceUrl: url }),
    source_agency: 'DHS',
    source_type: DHS_ALLRECORDS_SOURCE_TYPE,
    last_synced_at: now,
  }));
}

/**
 * Fetch + map DHS APFS.
 *
 * Default: apfs-cloud JSON. When that host returns HTML / non-JSON (Login.gov
 * migration page), FAIL LOUD — never treat it as an empty success and never
 * upsert zero DHS rows from a soft-failure body.
 *
 * Override: `DHS_FORECAST_ALLRECORDS_URL` → public CSV/XLSX parser (explicit ops).
 */
async function fetchDHS(): Promise<Record<string, unknown>[]> {
  const fileUrl = process.env.DHS_FORECAST_ALLRECORDS_URL?.trim();
  if (fileUrl) return fetchDhsAllrecordsFile(fileUrl);

  const res = await fetch(DHS_API, {
    headers: { Accept: 'application/json', 'User-Agent': 'GovConGiants-Mindy/1.0' },
    cache: 'no-store',
  });
  const text = await res.text();
  const classified = classifyDhsBody(res.status, text);
  if (classified.kind !== 'json_array') {
    // The JSON host is a migration page. The public CSV is the replacement when
    // DHS.gov actually serves it. A 403 here is still a failure — never [].
    try {
      return await fetchDhsAllrecordsFile(DHS_ALLRECORDS_CSV_URL);
    } catch (csvErr) {
      const csvMsg = csvErr instanceof Error ? csvErr.message : String(csvErr);
      // Keep the fail-loud phrase the repair ledger anchors on. HTML 200 and a
      // denied public file are both unreachable — never an empty upsert.
      throw new Error(
        `DHS APFS returned HTML (not JSON) — ${classified.detail}. Public allRecords file: ${csvMsg}`,
      );
    }
  }
  const data = classified.rows;

  const now = new Date().toISOString();
  return (data as DhsForecast[]).map((r) => {
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
      // Canonical identity: the APFS number WITHOUT DHS's republish `*` — see src/lib/forecasts/dhs-identity.ts.
      external_id: canonicalDhsExternalId(nn(clean(r.apfs_number)), nn(clean(r.id)), title),
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
const DOE_INSTANCE = 'forecast_doe_osbp';
const DHS_INSTANCE = 'forecast_dhs_apfs';

/**
 * The OSDBU page links a dated CSV. The July XLSX still returns 200, so fetching
 * only that URL never sees a newer edition (measured 2026-11-18: page links
 * 2026-11-16, 869 rows; July workbook is a different file).
 */
async function fetchDOE(): Promise<Record<string, unknown>[]> {
  const page = await fetch(DOE_FORECAST_PAGE, {
    headers: { 'User-Agent': 'GovConGiants-Mindy/1.0', Accept: 'text/html' },
    cache: 'no-store',
  });
  if (!page.ok) {
    throw new Error(`DOE forecast page HTTP ${page.status} — ${DOE_FORECAST_PAGE}`);
  }
  const html = await page.text();
  const docs = extractDoeForecastDocuments(html);
  const current = docs[0];
  if (!current) {
    throw new Error(
      `DOE forecast page has no dated public file — refusing the July XLSX fallback (${DOE_FORECAST_PAGE})`,
    );
  }
  const sourceUrl = absoluteDoeUrl(current.href);
  const res = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'GovConGiants-Mindy/1.0', Accept: 'text/csv' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`DOE forecast ${current.edition} HTTP ${res.status} — ${sourceUrl}`);
  }
  const text = await res.text();
  if (/^<!DOCTYPE\s+html/i.test(text.trim()) || /^<html[\s>]/i.test(text.trim())) {
    throw new Error(`DOE forecast ${current.edition} returned HTML, not a CSV — ${sourceUrl}`);
  }
  const parsed = parseDoeCsv(text, { parseMoneyRange, parseSetAside, parseNaics });
  if (parsed.headerRow === -1) throw new Error(`DOE forecast ${current.edition}: no header row — layout changed`);
  if (!parsed.rows.length) throw new Error(`DOE forecast ${current.edition} parsed to 0 rows — refusing empty upsert`);

  const now = new Date().toISOString();
  return parsed.rows.map((r) => ({
    source_agency: 'DOE',
    source_type: 'osdbu_xlsx',
    source_url: sourceUrl,
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

/**
 * Record attempt vs nonempty ingest on the existing forecast instances.
 * A failed source becomes unreachable. A source whose rows were written gets
 * last_verified_ingest. A missing instance row is left alone (update matches 0).
 */
async function stampForecastClocks(
  supabase: { from: (table: string) => { update: (values: Record<string, unknown>) => { eq: (col: string, value: string) => PromiseLike<unknown> } } },
  input: { perSource: Record<string, number>; failures: string[]; wrote: boolean },
): Promise<void> {
  const now = new Date().toISOString();
  const failed = (name: string) =>
    input.failures.some((f) => f.startsWith(`${name}:`) || f.startsWith(`${name} `));
  const touch = async (key: string, patch: Record<string, unknown>) => {
    try {
      await supabase.from('data_source_instances').update(patch).eq('source_key', key);
    } catch (e) {
      console.error(`[${JOB_NAME}] clock stamp ${key} failed:`, (e as Error).message);
    }
  };
  const jobs: Array<Promise<void>> = [];
  for (const [name, key] of [['DHS', DHS_INSTANCE], ['DOE', DOE_INSTANCE]] as const) {
    const landed = input.wrote && (input.perSource[name] ?? 0) > 0 && !failed(name);
    if (landed) {
      jobs.push(touch(key, {
        last_poll: now,
        last_successful_check: now,
        last_verified_ingest: now,
        last_data_advance: now,
        source_state: 'current',
      }));
    } else if (failed(name)) {
      jobs.push(touch(key, { last_poll: now, source_state: 'unreachable' }));
    }
  }
  await Promise.all(jobs);
}

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
  // Declares itself the DAILY SYNC to the agency_forecasts floor guard (src/lib/forecasts/writer.ts).
  const supabase = forecastWriterClient('daily_sync');

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
      if (!dryRun) await stampForecastClocks(supabase, { perSource, failures, wrote: false });
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

    // BACKFILL SAFETY (src/lib/forecasts/writer.ts): per publisher, a daily run may not CREATE a bulk of new rows
    // while its alert floor is active. A refused publisher's rows are held back entirely (its updates wait for the
    // backfill that must handle the bulk) and the run reports an error; other publishers still sync.
    // The decision is made per publisher over its FULL row set before the first upsert, so a refused publisher
    // has zero rows written (no partial prefix from earlier batches) and its whole payload is quarantined.
    const refused: string[] = [];
    const refusedSources = new Set<string>();
    for (const src of [...new Set(deduped.map((r) => String(r.source_agency)))]) {
      const srcRows = deduped.filter((r) => String(r.source_agency) === src);
      const nr = await countNewForecastRows(supabase, src, srcRows.map((r) => String(r.external_id)));
      const g = 'error' in nr ? { allow: false as const, reason: `${src}: new-row count failed: ${nr.error}` } : await guardForecastInserts(supabase, src, nr.newRows);
      if (g.allow) continue;
      refusedSources.add(src);
      const q = await quarantineRefusedLoad(supabase, src, g.reason, 'error' in nr ? -1 : nr.newRows, srcRows);
      refused.push(`${g.reason} — ${q.quarantined ? 'quarantined for replay' : `QUARANTINE FAILED (${q.quarantineError}); replay needs a re-fetch`}`);
    }
    const writable = deduped.filter((r) => !refusedSources.has(String(r.source_agency)));
    if (refused.length) {
      failures.push(...refused.map((r) => `insert_refused: ${r}`));
      await sendOpsAlert({ subject: 'Forecast sync — bulk of NEW rows refused (publisher floor active)', html: `<p>${refused.map((r) => `<div>${r}</div>`).join('')}</p>` }).catch(() => {});
    }

    let upserted = 0;
    for (let i = 0; i < writable.length; i += 500) {
      const batch = writable.slice(i, i + 500);
      const { error } = await supabase
        .from('agency_forecasts')
        .upsert(batch, { onConflict: 'source_agency,external_id' });
      if (error) throw new Error(`upsert failed at ${i}: ${error.message}`);
      upserted += batch.length;
    }

    // A partial run reports 'error' so the watchdog sees it — a source that
    // silently stops is worse than one that loudly fails.
    await stampForecastClocks(supabase, { perSource, failures, wrote: upserted > 0 });
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
