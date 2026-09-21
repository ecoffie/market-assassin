/**
 * /api/admin/backfill-target-counts
 *
 * Refresh BOTH `upcoming_event_count` AND `open_opp_count` on every saved
 * user_target_list row (all users), the SAME way the live Target Market Research
 * view now computes them — so stale/leaked snapshots (the "337 events / 546 opps
 * on every Army office" bug) get corrected for everyone, not just new saves.
 *
 * Supersedes /api/admin/backfill-target-opp-counts, which (a) only did opps and
 * (b) skipped rows without a valid 6-char DoDAAC office_code — leaving specific
 * offices (short codes like "HA20", or DoDAAC-less pre-award offices) stuck on the
 * leaked dept-wide number. This one handles them: a SPECIFIC office shows its own
 * count or 0, NEVER the whole-department roll-up.
 *
 * Resolution per row (mirrors target-market-research/route.ts):
 *   - opps:   office's DoDAAC prefix count (office_code / decoded), else — for a
 *             specific office — 0; only true dept/sub-agency rows keep dept-wide.
 *   - events: office's DoDAAC prefix count OR SAM inferred_office name count;
 *             else 0 for a specific office; dept-wide only for dept rows.
 *
 * "Specific office" = a distinct office_name that isn't just the agency label.
 *
 * Auth: ?password=ADMIN_PASSWORD (or cron bearer).
 *   GET/POST ?mode=preview (default) — count + samples of what WOULD change (DRY).
 *   POST ?mode=execute               — apply the updates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeAgencyKey } from '@/lib/gov-contacts/agency-key';
import { decodeDodaac } from '@/lib/gov-contacts/dodaac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function authed(request: NextRequest): boolean {
  const pw = request.nextUrl.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isCron = request.headers.get('x-cron-dispatch') === '1'
    || (!!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
  return (!!pw && pw === process.env.ADMIN_PASSWORD) || isCron;
}

interface TargetRow {
  id: string;
  user_email: string | null;
  office_name: string | null;
  office_code: string | null;
  agency_name: string | null;
  sub_agency_name: string | null;
  upcoming_event_count: number | null;
  open_opp_count: number | null;
}

/** A row is a DEPARTMENT/sub-agency roll-up (not a specific buying office) only
 *  when it has NO office_code AND its office_name is just an agency label. Those
 *  are the ONLY rows allowed to carry a dept-wide count. Everything with an
 *  office_code, or a distinct office_name, is a specific office → own count or 0.
 *
 *  NOTE (learned in dry-run): this table often duplicates office_name INTO
 *  agency_name (e.g. "Wiesbaden Contracting Center" in both), so an
 *  office≠agency name check ALONE misclassifies real offices as departments and
 *  would inflate them to the dept-wide phantom. The presence of an office_code is
 *  the reliable "this is an office" signal. */
function isDepartmentRow(t: TargetRow): boolean {
  const code = String(t.office_code || '').trim();
  if (code) return false; // has an office code → it's a specific office
  const office = normalizeAgencyKey(t.office_name || '');
  if (!office) return true; // no office identity at all → treat as dept
  // office name present but no code: department only if the name IS an agency label
  return office === normalizeAgencyKey(t.agency_name || '')
    || office === normalizeAgencyKey(t.sub_agency_name || '');
}

/** The 6-char DoDAAC for a row from its stored office_code (already the buying-
 *  office code). Only a full valid 6-char code anchors; short codes (HA20, BN01)
 *  don't decode → the office gets 0, never dept-wide. */
function rowDodaac(t: TargetRow, known: Set<string>): string | null {
  const code = String(t.office_code || '').toUpperCase().trim();
  if (code.length === 6 && /^[A-Z0-9]+$/.test(code)) return code;
  const dec = decodeDodaac(t.office_code || null, known);
  return dec?.dodaac || null;
}

async function run(execute: boolean) {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 90);
  const horizonDay = horizon.toISOString().slice(0, 10);

  // 1) Open-opp counts by DoDAAC prefix + by normalized department (dept fallback).
  const oppByDodaac: Record<string, number> = {};
  const oppByDept: Record<string, number> = {};
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await supabase
      .from('sam_opportunities')
      .select('department, solicitation_number')
      .gte('response_deadline', nowIso)
      .range(from, from + 999);
    if (error) return { success: false, error: `opp scan failed: ${error.message}` };
    if (!data || data.length === 0) break;
    for (const r of data) {
      const dk = normalizeAgencyKey(r.department || '');
      if (dk) oppByDept[dk] = (oppByDept[dk] || 0) + 1;
      const sol = String(r.solicitation_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (sol.length >= 6) { const c = sol.slice(0, 6); oppByDodaac[c] = (oppByDodaac[c] || 0) + 1; }
    }
    if (data.length < 1000) break;
  }

  // 2) Upcoming-event counts by DoDAAC, by SAM office name, and by department.
  const evByDodaac: Record<string, number> = {};
  const evByOffice: Record<string, number> = {};
  const evByDept: Record<string, number> = {};
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await supabase
      .from('sam_events')
      .select('agency, inferred_dodaac, inferred_office')
      .gte('event_date', today).lte('event_date', horizonDay)
      .range(from, from + 999);
    if (error) return { success: false, error: `event scan failed: ${error.message}` };
    if (!data || data.length === 0) break;
    for (const r of data) {
      const dk = normalizeAgencyKey(r.agency || '');
      if (dk) evByDept[dk] = (evByDept[dk] || 0) + 1;
      const dod = String(r.inferred_dodaac || '').toUpperCase().trim();
      if (dod.length >= 6) { const c = dod.slice(0, 6); evByDodaac[c] = (evByDodaac[c] || 0) + 1; }
      const ok = normalizeAgencyKey(String(r.inferred_office || ''));
      if (ok) evByOffice[ok] = (evByOffice[ok] || 0) + 1;
    }
    if (data.length < 1000) break;
  }

  // 3) Recompute each saved target.
  const { data: targets, error: tErr } = await supabase
    .from('user_target_list')
    .select('id, user_email, office_name, office_code, agency_name, sub_agency_name, upcoming_event_count, open_opp_count')
    .limit(5000);
  if (tErr) return { success: false, error: `target read failed: ${tErr.message}` };

  const known = new Set<string>(); // no live directory needed here; office_code is already the code
  const deptKeys = (t: TargetRow) => [t.sub_agency_name, t.agency_name, t.office_name]
    .map((s) => normalizeAgencyKey(s || '')).filter(Boolean);

  const changes: Array<{
    id: string; user: string | null; office: string | null;
    oppOld: number; oppNew: number; evtOld: number; evtNew: number;
  }> = [];

  let skippedDept = 0;
  for (const t of (targets || []) as TargetRow[]) {
    // SAFETY: only recompute SPECIFIC OFFICE rows. Department/sub-agency roll-up
    // rows are LEFT UNTOUCHED (Eric, 2026-07-10) — writing a raw dept-wide count
    // (DoD → 8,378 open opps) is the inflation bug, not the fix. Their existing
    // value stands.
    if (isDepartmentRow(t)) { skippedDept++; continue; }

    // Specific office: its OWN DoDAAC count / SAM-office event count, or 0 — NEVER
    // dept-wide. (sam_opportunities has no inferred_office, so opps use DoDAAC only.)
    const dod = rowDodaac(t, known);
    const dodOpp = dod ? (oppByDodaac[dod] || 0) : 0;
    const dodEvt = dod ? (evByDodaac[dod] || 0) : 0;
    const officeEvt = [t.office_name].map((s) => normalizeAgencyKey(s || '')).filter(Boolean)
      .reduce((n, k) => n || evByOffice[k] || 0, 0);

    const oppNew = dodOpp;
    const evtNew = dodEvt || officeEvt;

    const oppOld = t.open_opp_count ?? 0;
    const evtOld = t.upcoming_event_count ?? 0;
    if (oppNew !== oppOld || evtNew !== evtOld) {
      changes.push({ id: t.id, user: t.user_email, office: t.office_name, oppOld, oppNew, evtOld, evtNew });
    }
  }

  let updated = 0;
  if (execute) {
    for (const c of changes) {
      const { error } = await supabase
        .from('user_target_list')
        .update({ open_opp_count: c.oppNew, upcoming_event_count: c.evtNew })
        .eq('id', c.id);
      if (!error) updated++;
    }
  }

  const affectedUsers = new Set(changes.map((c) => c.user)).size;
  return {
    success: true,
    mode: execute ? 'execute' : 'preview',
    targets_scanned: (targets || []).length,
    skipped_department_rows: skippedDept, // left untouched by design
    would_change: changes.length,
    affected_users: affectedUsers,
    updated: execute ? updated : 0,
    // Biggest corrections first (where the leak was largest).
    samples: changes
      .slice()
      .sort((a, b) => (Math.abs(b.evtOld - b.evtNew) + Math.abs(b.oppOld - b.oppNew))
        - (Math.abs(a.evtOld - a.evtNew) + Math.abs(a.oppOld - a.oppNew)))
      .slice(0, 15)
      .map((c) => ({ office: c.office, events: `${c.evtOld}→${c.evtNew}`, opps: `${c.oppOld}→${c.oppNew}` })),
  };
}

export async function GET(request: NextRequest) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isCron = request.headers.get('x-cron-dispatch') === '1';
  const execute = isCron || request.nextUrl.searchParams.get('mode') === 'execute';
  return NextResponse.json(await run(execute));
}

export async function POST(request: NextRequest) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const execute = request.nextUrl.searchParams.get('mode') === 'execute';
  return NextResponse.json(await run(execute));
}
