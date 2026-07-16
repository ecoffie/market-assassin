/**
 * /api/admin/backfill-pop-state
 *
 * Recover the place-of-performance state for LEGACY `sam_opportunities` rows
 * where the flat `pop_state` column is NULL but the raw SAM payload still
 * carries a state code at `raw_data.placeOfPerformance.state.code`.
 *
 * The live sync (`sync-sam-opportunities`) already reads that path for NEW
 * rows — this only closes the legacy gap. It does NOT touch the sync.
 *
 * WHY a JS cursor scan (not a WHERE on the jsonb path): there is no index on
 * `raw_data->placeOfPerformance->state->>code`, and ~83K rows have NULL
 * pop_state, so any DB-side filter/count on that nested path times out. We page
 * null-pop_state rows by an `id` cursor (uuid, ordered), inspect the code in JS,
 * and validate `^[A-Z]{2}$` before writing. The cursor advances monotonically
 * past every scanned row (recovered or not), so the job is drainable even though
 * recoverable rows are sparse — a plain re-fetch of "still NULL" rows would loop
 * forever on the unrecoverable ones.
 *
 * Auth: ?password=ADMIN_PASSWORD (CLAUDE.md "Admin Endpoint Standard")
 *   GET  ?mode=preview (default) — count recoverable rows (scans up to SCAN_CAP,
 *        reports `capped` if it hit the cap). Read-only.
 *   POST ?mode=execute&cursor=<id> — recover a window of rows, write pop_state,
 *        return { updated, remaining, scanned, nextCursor, done }. Resumable:
 *        pass `nextCursor` back until `done`. Idempotent (only NULL pop_state).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CODE_PATH = 'raw_data->placeOfPerformance->state->>code';
const PAGE = 1000;            // PostgREST hard-caps a response at 1000 rows
const SCAN_CAP = 20000;       // preview: max rows to inspect before reporting capped
const TIME_BUDGET_MS = 40000; // execute: soft wall-clock budget per invocation
const EXEC_ROW_CAP = 40000;   // execute: hard row ceiling per invocation
const VALID_CODE = /^[A-Z]{2}$/;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function authed(request: NextRequest): boolean {
  const pw = request.nextUrl.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isCron = request.headers.get('x-cron-dispatch') === '1'
    || (!!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
  return (!!pw && pw === process.env.ADMIN_PASSWORD) || isCron;
}

interface ScanRow { id: string; pop_code: string | null }

// Fetch one page of NULL-pop_state rows after `cursor`, ordered by id.
async function fetchPage(
  supabase: ReturnType<typeof getSupabase>,
  cursor: string,
): Promise<ScanRow[]> {
  let q = supabase
    .from('sam_opportunities')
    .select(`id, pop_code:${CODE_PATH}`)
    .is('pop_state', null)
    .order('id', { ascending: true })
    .limit(PAGE);
  if (cursor) q = q.gt('id', cursor);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as unknown as ScanRow[];
}

// GET preview — count recoverable rows across up to SCAN_CAP scanned rows.
async function preview() {
  const supabase = getSupabase();

  // Total NULL-pop_state rows (cheap head count on the indexed flat column).
  const { count: nullTotal } = await supabase
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true })
    .is('pop_state', null);

  let cursor = '';
  let scanned = 0;
  let recoverable = 0;
  const byCode: Record<string, number> = {};
  let capped = false;

  while (scanned < SCAN_CAP) {
    const rows = await fetchPage(supabase, cursor);
    if (rows.length === 0) break;
    for (const r of rows) {
      const code = String(r.pop_code ?? '').toUpperCase();
      if (VALID_CODE.test(code)) {
        recoverable++;
        byCode[code] = (byCode[code] || 0) + 1;
      }
    }
    scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE) break; // reached the end
    if (scanned >= SCAN_CAP) { capped = true; break; }
  }

  const topCodes = Object.entries(byCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([code, count]) => ({ code, count }));

  return {
    success: true,
    mode: 'preview',
    message: capped
      ? `Scanned ${scanned} of ${nullTotal ?? '?'} NULL-pop_state rows (cap ${SCAN_CAP}); found ${recoverable} recoverable. More rows remain unscanned — run execute to drain all.`
      : `Scanned all ${scanned} NULL-pop_state rows; ${recoverable} are recoverable from raw_data.placeOfPerformance.state.code.`,
    data: {
      nullPopStateTotal: nullTotal ?? null,
      scanned,
      recoverable,
      capped,
      topCodes,
    },
  };
}

// POST execute — recover a window of rows and write pop_state.
async function execute(startCursor: string) {
  const supabase = getSupabase();
  const started = Date.now();

  let cursor = startCursor;
  let scanned = 0;
  let done = false;
  const idsByCode: Record<string, string[]> = {};

  while (scanned < EXEC_ROW_CAP && Date.now() - started < TIME_BUDGET_MS) {
    const rows = await fetchPage(supabase, cursor);
    if (rows.length === 0) { done = true; break; }
    for (const r of rows) {
      const code = String(r.pop_code ?? '').toUpperCase();
      if (VALID_CODE.test(code)) (idsByCode[code] ||= []).push(r.id);
    }
    scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE) { done = true; break; }
  }

  // Group updates by recovered code → one UPDATE per distinct code.
  let updated = 0;
  for (const [code, ids] of Object.entries(idsByCode)) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { error } = await supabase
        .from('sam_opportunities')
        .update({ pop_state: code })
        .in('id', chunk)
        .is('pop_state', null); // guard: stay idempotent even under races
      if (error) return { success: false, message: `update failed for ${code}: ${error.message}`, data: { updated, scanned, cursor } };
      updated += chunk.length;
    }
  }

  // Informational: rows still NULL (indexed head count).
  const { count: remaining } = await supabase
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true })
    .is('pop_state', null);

  return {
    success: true,
    mode: 'execute',
    message: done
      ? `Reached end of NULL-pop_state rows. Updated ${updated} this run.`
      : `Recovered ${updated} rows from ${scanned} scanned. Pass nextCursor to continue.`,
    data: {
      updated,
      scanned,
      remaining: remaining ?? null,
      nextCursor: done ? null : cursor,
      done,
    },
  };
}

export async function GET(request: NextRequest) {
  if (!authed(request)) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  // Allow a cron dispatch to run execute; a plain GET defaults to preview.
  const wantExecute = request.nextUrl.searchParams.get('mode') === 'execute';
  const cursor = request.nextUrl.searchParams.get('cursor') || '';
  try {
    return NextResponse.json(wantExecute ? await execute(cursor) : await preview());
  } catch (e) {
    return NextResponse.json({ success: false, message: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!authed(request)) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  const execMode = request.nextUrl.searchParams.get('mode') === 'execute';
  const cursor = request.nextUrl.searchParams.get('cursor') || '';
  try {
    return NextResponse.json(execMode ? await execute(cursor) : await preview());
  } catch (e) {
    return NextResponse.json({ success: false, message: (e as Error).message }, { status: 500 });
  }
}
