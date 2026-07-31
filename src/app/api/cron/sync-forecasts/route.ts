/**
 * Cron: sync agency procurement forecasts (DHS today).
 *
 * WHY ONLY DHS: a health sweep of all 9 registered scrapers on 2026-07-31 found
 * 2 alive. DHS returns 754 records from a plain JSON API (apfs-cloud.dhs.gov);
 * the other 7 are Puppeteer scrapers whose selectors have rotted — they load the
 * page and extract 0 rows. Scheduling those would create 7 jobs that "succeed"
 * while importing nothing, which is precisely the silent-failure shape that hid
 * the DIBBS outage for two days. Add an agency here only after its scraper is
 * verified against the live portal.
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
    const rows = await fetchDHS();

    // THE ALARM. A portal that changed shape still returns 200 and parses to
    // nothing — treating that as success is how a dead source stays dead for
    // months. 754 records is the observed baseline; anything near zero is broken.
    if (rows.length === 0) {
      const msg = 'DHS APFS returned 0 forecasts — the API responded but parsed to nothing (shape change?).';
      console.error(`[${JOB_NAME}] ${msg}`);
      await sendOpsAlert({
        subject: 'Forecast sync FAILED — DHS returned 0 records',
        html: `<p>${msg}</p><p>Baseline is ~754. Check <code>${DHS_API}</code> for a payload change before trusting forecast data.</p>`,
      }).catch(() => {});
      await reportCronOutcome(JOB_NAME, 'error', 'DHS returned 0 forecasts');
      return NextResponse.json({ success: false, error: msg, fetched: 0 }, { status: 500 });
    }

    if (dryRun) {
      return NextResponse.json({ success: true, dryRun: true, fetched: rows.length, sample: rows[0] });
    }

    // Dedupe on the conflict key before upserting — Postgres rejects an
    // ON CONFLICT that would touch the same row twice in one statement.
    const byKey = new Map<string, Record<string, unknown>>();
    for (const r of rows) byKey.set(`${r.source_agency}|${r.external_id}`, r);
    const deduped = [...byKey.values()];

    let upserted = 0;
    for (let i = 0; i < deduped.length; i += 500) {
      const batch = deduped.slice(i, i + 500);
      const { error } = await supabase
        .from('agency_forecasts')
        .upsert(batch, { onConflict: 'source_agency,external_id' });
      if (error) throw new Error(`upsert failed at ${i}: ${error.message}`);
      upserted += batch.length;
    }

    await reportCronOutcome(JOB_NAME, 'success');
    return NextResponse.json({
      success: true,
      fetched: rows.length,
      deduped: deduped.length,
      upserted,
      message: `DHS forecasts: fetched ${rows.length}, upserted ${upserted}`,
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
