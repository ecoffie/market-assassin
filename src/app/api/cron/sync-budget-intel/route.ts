/**
 * GET /api/cron/sync-budget-intel
 *
 * One roster agency, one federal-account page, into the existing budget tables.
 * Upsert on source_key. Never deletes. Preview (`?mode=preview`) fetches and
 * returns the rows without writing and does not report a cron outcome.
 *
 * USASpending non-2xx → 502. performance.gov non-2xx still writes the budget
 * rows already fetched, then returns 503. The migration
 * 20261118_budget_intel_usaspending_acquire.sql is not applied by this route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authorizeCronRequest } from '@/lib/cron/cron-request-auth';
import { reportCronOutcome } from '@/lib/cron-self-report';
import { resolveForecastAgencies } from '@/lib/forecasts/agency-identity';
import { BudgetSourceDown, fetchBudgetSlice } from '@/lib/budget-intel/fetch';
import {
  RUN_TYPE,
  buildRoster,
  classifyBudgetLinks,
  normalizeCursor,
  sliceHttp,
  type BudgetCursor,
  type BudgetSlice,
  type ForecastCandidate,
  type LinkRow,
} from '@/lib/budget-intel/slice';
import toptierCodes from '@/data/agency-toptier-codes.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOB_NAME = 'sync-budget-intel';

function sb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function missingColumn(message: string): boolean {
  return /source_key|fetched_at|obligated_amount|budget_intel_links|Could not find the/i.test(message);
}

async function readCursor(db: SupabaseClient): Promise<BudgetCursor | 'unmeasured'> {
  const roster = buildRoster(toptierCodes as Record<string, { code: string; abbreviation: string }>);
  const { data, error } = await db.from('budget_intel_sync_runs')
    .select('metadata')
    .eq('run_type', RUN_TYPE)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1);
  if (error) return 'unmeasured';
  if (!data?.length) return { agencyIndex: 0, page: 1 };
  const next = (data[0] as { metadata?: { nextCursor?: unknown } }).metadata?.nextCursor;
  if (next == null) return 'unmeasured';
  return normalizeCursor(next, roster.agencies.length) ?? 'unmeasured';
}

async function forecastsFor(db: SupabaseClient, slice: BudgetSlice): Promise<ForecastCandidate[]> {
  const codes = resolveForecastAgencies(slice.agency.agency).codes;
  if (codes.length === 0 || slice.programs.length === 0) return [];
  const found = new Map<string, ForecastCandidate>();
  for (const program of slice.programs) {
    const lookups: Array<[string, string]> = [
      ['title', program.program_name],
      ['program_office', program.program_name],
      ['external_id', program.program_code],
      ['title', program.program_code],
      ['program_office', program.program_code],
    ];
    for (const [column, value] of lookups) {
      const { data, error } = await db.from('agency_forecasts')
        .select('id, source_agency, title, program_office, external_id')
        .in('source_agency', codes)
        .eq(column, value)
        .limit(5);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as ForecastCandidate[]) {
        if (row.id) found.set(row.id + program.source_key, row);
      }
    }
  }
  return [...found.values()];
}

async function persist(db: SupabaseClient, slice: BudgetSlice, links: LinkRow[]): Promise<void> {
  const writes: Array<[string, unknown[]]> = [
    ['agency_budget_authority', slice.authority],
    ['budget_programs', slice.programs],
    ['agency_priorities_db', slice.priorities],
    ['budget_intel_links', links],
  ];
  for (const [table, rows] of writes) {
    if (rows.length === 0) continue;
    const { error } = await db.from(table).upsert(rows, {
      onConflict: table === 'budget_intel_links'
        ? 'source_table,source_key,target_table,target_id'
        : 'source_key',
    });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  const { error } = await db.from('budget_intel_sync_runs').insert({
    run_type: RUN_TYPE,
    agency: slice.agency.agency,
    status: 'completed',
    completed_at: new Date().toISOString(),
    programs_added: slice.programs.length,
    priorities_added: slice.priorities.length,
    metadata: {
      meaning: 'programs_added and priorities_added are rows upserted this slice, not net-new counts',
      cursor: slice.cursor,
      nextCursor: slice.nextCursor,
      fiscalYears: slice.fiscalYears,
      authorityUpserted: slice.authority.length,
      programsUpserted: slice.programs.length,
      prioritiesUpserted: slice.priorities.length,
      linksUpserted: links.length,
      prioritiesOutcome: slice.prioritiesOutcome,
      authoritySourceUrl: slice.authoritySourceUrl,
      programSourceUrl: slice.programSourceUrl,
      prioritiesSourceUrl: slice.prioritiesSourceUrl,
      fetchedAt: slice.authority[0]?.fetched_at ?? slice.programs[0]?.fetched_at ?? null,
    },
  });
  if (error) throw new Error(`budget_intel_sync_runs: ${error.message}`);
}

/** True when the unapplied migration's source_key column is already on the table. */
export async function budgetAcquireReady(db: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await db.from('agency_budget_authority').select('source_key').limit(1);
    if (!error) return true;
    return !missingColumn(error.message);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const preview = request.nextUrl.searchParams.get('mode') === 'preview';
  const auth = await authorizeCronRequest(request, { isTest: preview });
  if (!auth.ok) return auth.response;

  let db: SupabaseClient;
  try {
    db = sb();
  } catch {
    return NextResponse.json({
      success: true, degraded: true, wrote: false, reason: 'database_unconfigured',
    }, { status: 200 });
  }
  if (!await budgetAcquireReady(db)) {
    return NextResponse.json({
      success: true,
      degraded: true,
      wrote: false,
      reason: 'migration_not_applied',
      note: 'agency_budget_authority.source_key is not present. Nothing was fetched or written. Nothing schedules this route until the migration inserts the cron row.',
    }, { status: 200 });
  }

  const cursor = await readCursor(db);
  if (cursor === 'unmeasured') {
    const http = sliceHttp({ sourceDown: false, prioritiesSourceDown: false, writeFailed: true, migrationMissing: false });
    if (!preview) await reportCronOutcome(JOB_NAME, http.cronOutcome, 'cursor unmeasured');
    return NextResponse.json({
      success: false,
      shown: 'none',
      error: 'cursor_unmeasured',
      note: 'The last sync run could not be read. This slice was not started at agency 0.',
    }, { status: http.status });
  }

  let slice: BudgetSlice;
  try {
    slice = await fetchBudgetSlice(cursor);
  } catch (error) {
    const down = error instanceof BudgetSourceDown;
    const http = sliceHttp({
      sourceDown: true,
      prioritiesSourceDown: false,
      writeFailed: !down,
      migrationMissing: false,
    });
    const message = error instanceof Error ? error.message : 'source down';
    if (!preview) await reportCronOutcome(JOB_NAME, 'error', message);
    return NextResponse.json({
      success: false,
      error: down ? 'source_down' : 'slice_failed',
      message,
    }, { status: down ? http.status : 503 });
  }

  if (preview) {
    return NextResponse.json({
      success: true,
      mode: 'preview',
      wrote: false,
      agency: slice.agency.agency,
      cursor: slice.cursor,
      nextCursor: slice.nextCursor,
      fiscalYears: slice.fiscalYears,
      authority: slice.authority.length,
      programs: slice.programs.length,
      priorities: slice.priorities.length,
      prioritiesOutcome: slice.prioritiesOutcome,
      authoritySourceUrl: slice.authoritySourceUrl,
      programSourceUrl: slice.programSourceUrl,
      samplePrograms: slice.programs.slice(0, 5).map((row) => ({
        program_code: row.program_code,
        program_name: row.program_name,
        fiscal_year: row.fiscal_year,
        obligated_amount: row.obligated_amount,
        funding_trend: row.funding_trend,
        category: row.category,
        source_url: row.source_url,
      })),
    });
  }

  let links: LinkRow[] = [];
  let linkError: string | null = null;
  try {
    const forecasts = await forecastsFor(db, slice);
    links = classifyBudgetLinks({
      forecastCodes: resolveForecastAgencies(slice.agency.agency).codes,
      programs: slice.programs.map((row) => ({
        sourceKey: row.source_key,
        code: row.program_code,
        name: row.program_name,
      })),
      forecasts,
    });
  } catch (error) {
    linkError = error instanceof Error ? error.message : 'link read failed';
    links = [];
  }

  try {
    await persist(db, slice, links);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'write failed';
    const migrationMissing = missingColumn(message);
    const http = sliceHttp({
      sourceDown: false,
      prioritiesSourceDown: false,
      writeFailed: !migrationMissing,
      migrationMissing,
    });
    await reportCronOutcome(JOB_NAME, http.cronOutcome, message);
    return NextResponse.json({
      success: false,
      error: migrationMissing ? 'migration_not_applied' : 'write_failed',
      message,
      migration: 'supabase/migrations/20261118_budget_intel_usaspending_acquire.sql',
    }, { status: http.status });
  }

  const prioritiesDown = slice.prioritiesOutcome === 'source_down';
  const http = sliceHttp({
    sourceDown: false,
    prioritiesSourceDown: prioritiesDown || linkError != null,
    writeFailed: false,
    migrationMissing: false,
  });
  if (http.cronOutcome !== 'success') {
    await reportCronOutcome(JOB_NAME, http.cronOutcome, linkError ?? 'performance.gov source down');
  } else {
    await reportCronOutcome(JOB_NAME, 'success');
  }
  return NextResponse.json({
    success: http.status === 200,
    agency: slice.agency.agency,
    cursor: slice.cursor,
    nextCursor: slice.nextCursor,
    fiscalYears: slice.fiscalYears,
    authorityUpserted: slice.authority.length,
    programsUpserted: slice.programs.length,
    prioritiesUpserted: slice.priorities.length,
    linksUpserted: links.length,
    prioritiesOutcome: slice.prioritiesOutcome,
    linkError,
    shown: 'would be live_table after this write',
  }, { status: http.status });
}
