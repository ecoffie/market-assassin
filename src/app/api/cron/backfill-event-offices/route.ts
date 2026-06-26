/**
 * Cron: backfill the buying OFFICE on existing sam_events rows.
 *
 * GET /api/cron/backfill-event-offices?password=... (or CRON_SECRET bearer)
 *
 * sam_events.agency is department-level ("DEPT OF DEFENSE"). This decodes each
 * event's solicitation-number DoDAAC → real office + sub-agency (see
 * src/lib/gov-contacts/event-office.ts) so the Target List Event Radar can scope
 * events to the actual command. Batched + resumable: processes the next chunk of
 * untagged rows per run, returns `remaining`, and the dispatcher re-fires until
 * drained. Requires /api/admin/apply-event-office-columns to have run first.
 *
 * "Attempted" is marked by setting solicitation_number (the looked-up value, or
 * '' when the notice has none) so civilian / no-DoDAAC rows aren't reprocessed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { inferOfficeFromSolicitation } from '@/lib/gov-contacts/event-office';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BATCH_SIZE = Number(process.env.EVENT_OFFICE_BACKFILL_BATCH) || 300;
const SOFT_BUDGET_MS = 45_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  if (password !== ADMIN_PASSWORD && cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = getSupabase();

  // Rows not yet attempted (solicitation_number IS NULL — set after processing).
  const { data: rows, error } = await supabase
    .from('sam_events')
    .select('id, notice_id')
    .is('solicitation_number', null)
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ success: true, processed: 0, tagged: 0, remaining: 0, done: true });
  }

  // One query for all the solicitation numbers in this batch.
  const noticeIds = rows.map((r: { notice_id: string }) => r.notice_id);
  const { data: opps } = await supabase
    .from('sam_opportunities')
    .select('notice_id, solicitation_number')
    .in('notice_id', noticeIds);
  const solByNotice = new Map<string, string | null>();
  for (const o of (opps || []) as { notice_id: string; solicitation_number: string | null }[]) {
    solByNotice.set(o.notice_id, o.solicitation_number || null);
  }

  let processed = 0;
  let tagged = 0;
  for (const row of rows as { id: string; notice_id: string }[]) {
    if (Date.now() - startedAt > SOFT_BUDGET_MS) break;
    const sol = solByNotice.get(row.notice_id) ?? null;
    const office = await inferOfficeFromSolicitation(sol);
    if (office.dodaac) tagged++;
    await supabase
      .from('sam_events')
      .update({
        // mark attempted: store the value, or '' when there's no sol number so the
        // row isn't picked up again on the next run.
        solicitation_number: sol ?? '',
        inferred_dodaac: office.dodaac,
        inferred_office: office.office,
        inferred_subagency: office.subAgency,
      })
      .eq('id', row.id);
    processed++;
  }

  const { count: remaining } = await supabase
    .from('sam_events')
    .select('id', { count: 'exact', head: true })
    .is('solicitation_number', null);

  return NextResponse.json({
    success: true,
    processed,
    tagged,
    remaining: remaining ?? 0,
    done: (remaining ?? 0) === 0,
    durationMs: Date.now() - startedAt,
  });
}
