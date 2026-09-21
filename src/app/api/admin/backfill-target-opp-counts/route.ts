/**
 * /api/admin/backfill-target-opp-counts
 *
 * Refresh `user_target_list.open_opp_count` for already-saved targets.
 *
 * The count is a SNAPSHOT the client passes at save time, so old cards keep a
 * stale (and, for DoD offices, INFLATED dept-wide) number even after the live
 * Target Market Research view started anchoring on the office DoDAAC. This
 * recomputes every saved row the SAME way TMR does now:
 *   - valid 6-char office_code (DoDAAC)  → opps whose solicitation_number starts
 *     with that code (the office's OWN open opps — e.g. a USACE district, not all
 *     of DoD).
 *   - otherwise (dept-level / junk code) → dept-wide count by normalized agency.
 *
 * Auth: ?password=ADMIN_PASSWORD
 *   GET  ?mode=preview (default) — count + sample of what WOULD change
 *   POST ?mode=execute           — apply the updates
 *   Cron: the dispatcher fires this (GET) on its own schedule to keep counts fresh.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidDodaac } from '@/lib/gov-contacts/agency-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function authed(request: NextRequest): boolean {
  const pw = request.nextUrl.searchParams.get('password');
  // Vercel cron hits this via the dispatcher with a CRON_SECRET bearer.
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isCron = request.headers.get('x-cron-dispatch') === '1'
    || (!!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
  return (!!pw && pw === process.env.ADMIN_PASSWORD) || isCron;
}

interface TargetRow {
  id: string;
  agency_name: string | null;
  sub_agency_name: string | null;
  office_code: string | null;
  open_opp_count: number | null;
}

async function run(execute: boolean) {
  const supabase = getSupabase();

  // 1) Build the office-DoDAAC count map the live TMR view uses: open opps keyed
  // by their solicitation_number's 6-char DoDAAC prefix. Page through the open
  // opportunities (PostgREST caps a response at 1000 rows).
  const oppCountsByDodaac: Record<string, number> = {};
  const nowIso = new Date().toISOString();
  let scanned = 0;
  for (let from = 0; from < 50000; from += 1000) {
    const { data: oppRows, error } = await supabase
      .from('sam_opportunities')
      .select('solicitation_number')
      .gte('response_deadline', nowIso)
      .range(from, from + 999);
    if (error) return { success: false, error: `opp scan failed: ${error.message}` };
    if (!oppRows || oppRows.length === 0) break;
    for (const row of oppRows) {
      const sol = String(row.solicitation_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (sol.length >= 6) {
        const code = sol.slice(0, 6);
        oppCountsByDodaac[code] = (oppCountsByDodaac[code] || 0) + 1;
      }
    }
    scanned += oppRows.length;
    if (oppRows.length < 1000) break;
  }

  // 2) Recompute each saved target's count the anchored way.
  const { data: targets, error: tErr } = await supabase
    .from('user_target_list')
    .select('id, agency_name, sub_agency_name, office_code, open_opp_count')
    .limit(5000);
  if (tErr) return { success: false, error: `target read failed: ${tErr.message}` };

  // ONLY recompute OFFICE-ANCHORED targets — those with a real 6-char DoDAAC
  // office_code, where the count is the office's own open opps (solicitation
  // prefix). We deliberately do NOT touch dept-level / junk-code targets: a
  // dept-wide fallback would re-introduce the exact inflation the DoDAAC work
  // removed (a "Department of Defense" card jumping to 8,000+ open opps is the
  // bug, not the fix). Those cards keep their existing value untouched.
  const computeCount = (t: TargetRow): number | null => {
    const code = String(t.office_code || '').toUpperCase().trim();
    if (!isValidDodaac(code)) return null; // skip — never inflate to dept-wide
    return oppCountsByDodaac[code] || 0;
  };

  let skippedNonAnchored = 0;
  const changes = (targets || [])
    .map((t) => {
      const next = computeCount(t as TargetRow);
      if (next === null) { skippedNonAnchored++; return null; }
      return { id: t.id, agency: t.agency_name, office_code: t.office_code, old: t.open_opp_count ?? 0, next };
    })
    .filter((c): c is { id: string; agency: string | null; office_code: string | null; old: number; next: number } => c !== null && c.old !== c.next);

  let updated = 0;
  if (execute) {
    for (const c of changes) {
      const { error: upErr } = await supabase
        .from('user_target_list')
        .update({ open_opp_count: c.next })
        .eq('id', c.id);
      if (!upErr) updated++;
    }
  }

  return {
    success: true,
    mode: execute ? 'execute' : 'preview',
    opps_scanned: scanned,
    targets: (targets || []).length,
    skipped_non_anchored: skippedNonAnchored, // dept-level / junk-code rows left untouched
    would_change: changes.length,
    updated: execute ? updated : 0,
    // Most useful sample: the biggest corrections (office_code → real office count).
    samples: changes
      .slice()
      .sort((a, b) => Math.abs(b.old - b.next) - Math.abs(a.old - a.next))
      .slice(0, 12)
      .map((c) => ({ agency: c.agency, office_code: c.office_code, from: c.old, to: c.next })),
  };
}

export async function GET(request: NextRequest) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Cron fires GET → execute so counts stay fresh without a separate POST.
  const isCron = request.headers.get('x-cron-dispatch') === '1';
  const execute = isCron || request.nextUrl.searchParams.get('mode') === 'execute';
  return NextResponse.json(await run(execute));
}

export async function POST(request: NextRequest) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const execute = request.nextUrl.searchParams.get('mode') === 'execute';
  return NextResponse.json(await run(execute));
}
