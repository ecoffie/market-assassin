/**
 * /api/app/target-enrichment — LIVE pain-point + open-opp counts for the
 * user's saved target list, in ONE batch call.
 *
 * WHY THIS EXISTS (2026-07-09): pain_point_count / open_opp_count on
 * user_target_list are a SNAPSHOT the client passed at save time — but only ONE
 * of the five save paths (research_drawer) ever populated them. auto_setup,
 * target_list_search, triage_modal, and profile_agency all saved 0, so ~87% of
 * saved targets (measured: 458/524) showed no "pain pts" / "open opps" badges
 * across 20+ accounts. Snapshots also go stale (open opps change daily). This
 * endpoint computes both counts LIVE so every account's cards are correct with
 * no per-row backfill, and it never drifts.
 *
 *   - pain points: in-process from the static agency-pain-points catalog
 *     (@/lib/utils/pain-points) — same source /api/pain-points uses.
 *   - open opps:  the DoDAAC-anchored count the live Target Market Research view
 *     uses — open sam_opportunities whose solicitation_number starts with the
 *     target's 6-char office_code. ONLY office-anchored targets get a count; a
 *     dept-level / junk-code target returns null (never inflate to dept-wide — a
 *     "Department of Defense" card showing 8,000 opps is the bug, not the fix).
 *     Mirrors /api/admin/backfill-target-opp-counts exactly.
 *
 * (Event counts stay in /api/app/target-events, already loaded live by the panel.)
 *
 * Returns: { success, enrichment_by_target: Record<id, {pain_point_count, open_opp_count}> }
 * Pro-gated (target lists are Pro; belt + suspenders).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { isValidDodaac } from '@/lib/gov-contacts/agency-key';
import { getPainPointsForAgency } from '@/lib/utils/pain-points';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

interface TargetRow {
  id: string;
  agency_name: string | null;
  sub_agency_name: string | null;
  office_code: string | null;
}

interface Enrichment {
  pain_point_count: number;
  // null = not office-anchored (dept-level/junk code) → the card keeps its own
  // stored value rather than showing an inflated dept-wide number.
  open_opp_count: number | null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
  }
  const gate = requireMIAuthSession(request, email);
  if (!gate.ok) return gate.response;

  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      { upgrade_required: true, message: 'Target intelligence is included with Mindy Pro' },
      { status: 402 },
    );
  }

  try {
    const supabase = getSupabase();
    // Coach Mode: enrich the ACTIVE CLIENT's target list, not the coach's.
    const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
    const lowerEmail = asClient ? clientNotificationEmail(workspaceId) : email.toLowerCase();

    const { data: targets, error: tErr } = await supabase
      .from('user_target_list')
      .select('id, agency_name, sub_agency_name, office_code')
      .eq('user_email', lowerEmail);

    if (tErr) {
      console.error('[target-enrichment] target list query failed:', tErr);
      return NextResponse.json({ error: tErr.message, code: tErr.code }, { status: 500 });
    }

    if (!targets || targets.length === 0) {
      return NextResponse.json({ success: true, enrichment_by_target: {}, target_count: 0 });
    }

    const rows = targets as TargetRow[];

    // --- Open opps: DoDAAC-prefix count, ONLY if any target is office-anchored.
    // Build the office→count map once by paging the open opportunities (PostgREST
    // caps a response at 1000 rows). Skip the whole scan when no target has a
    // valid DoDAAC — nothing would use it.
    const anchoredCodes = new Set(
      rows
        .map((t) => String(t.office_code || '').toUpperCase().trim())
        .filter((c) => isValidDodaac(c)),
    );

    const oppCountsByDodaac: Record<string, number> = {};
    if (anchoredCodes.size > 0) {
      const nowIso = new Date().toISOString();
      for (let from = 0; from < 60000; from += 1000) {
        const { data: oppRows, error: oErr } = await supabase
          .from('sam_opportunities')
          .select('solicitation_number')
          .gte('response_deadline', nowIso)
          .range(from, from + 999);
        if (oErr) {
          console.error('[target-enrichment] opp scan failed:', oErr);
          break; // fail-soft: pain points still return; opps degrade to stored value
        }
        if (!oppRows || oppRows.length === 0) break;
        for (const r of oppRows) {
          const sol = String(r.solicitation_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (sol.length >= 6) {
            const code = sol.slice(0, 6);
            if (anchoredCodes.has(code)) {
              oppCountsByDodaac[code] = (oppCountsByDodaac[code] || 0) + 1;
            }
          }
        }
        if (oppRows.length < 1000) break;
      }
    }

    // --- Per-target enrichment.
    const enrichment_by_target: Record<string, Enrichment> = {};
    for (const t of rows) {
      // Pain points — EXACTLY what the panel's badge drill-down fetches:
      // /api/pain-points?agency=<sub_agency_name || agency_name>. Matching the
      // count to the drill-down list keeps "43 pain pts" == the 43 shown on click.
      const queryName = t.sub_agency_name || t.agency_name || '';
      const painPoints = getPainPointsForAgency(queryName);

      const code = String(t.office_code || '').toUpperCase().trim();
      const open_opp_count = isValidDodaac(code) ? (oppCountsByDodaac[code] || 0) : null;

      enrichment_by_target[t.id] = {
        pain_point_count: Array.isArray(painPoints) ? painPoints.length : 0,
        open_opp_count,
      };
    }

    return NextResponse.json({
      success: true,
      enrichment_by_target,
      target_count: rows.length,
    });
  } catch (err) {
    console.error('[target-enrichment] unexpected error:', err);
    return NextResponse.json({ error: 'enrichment failed' }, { status: 500 });
  }
}
