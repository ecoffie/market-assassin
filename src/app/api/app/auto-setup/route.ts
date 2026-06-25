/**
 * POST /api/app/auto-setup
 *
 * "Set up my Mindy" (Auto mode). Takes the user's saved profile (NAICS/keywords)
 * and POPULATES their existing surfaces instead of sending them to a separate
 * aggregated page. v1 fills My Target List: it runs the same buying-agency scan
 * Market Research uses, then ADDS the top agencies to user_target_list — where
 * each one already carries its spend, sources sought, events, and contacts.
 *
 * Principles (memory: simplify-not-complicate):
 *   - Reuses EXISTING pieces — target-market-research for the scan,
 *     user_target_list for the write. No new tables or columns.
 *   - ADD-ONLY. The table's unique constraint returns 23505 on a row the user
 *     already has → counted as "skipped", never overwritten. Sport-mode /
 *     hand-added targets always survive.
 *
 * Returns counts the receipt screen shows ("added N agencies to your Target
 * List"). Forecasts/Pursuits already inherit the profile's codes when opened, so
 * Auto deliberately doesn't touch them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { verifyMIAccess } from '@/lib/api-auth';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { internalBaseUrl } from '@/lib/utils/internal-base-url';
import {
  MAX_AGENCIES,
  type ScanAgency,
  mergeScanAgencies,
  buildTargetRow,
  summarizeEmptyScan,
} from '@/lib/app/auto-setup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function getSupabase() {
  if (!_sb) {
    _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

export async function POST(request: NextRequest) {
  let body: { email?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const email = body.email?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  // Target List is a Pro feature — mirror the target-list POST gate.
  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      { upgrade_required: true, message: 'Auto-setup populates your Target List, a Mindy Pro feature.' },
      { status: 402 },
    );
  }

  const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
  const rowEmail = asClient ? clientNotificationEmail(workspaceId) : email;

  // 1) Read the profile's codes (the same source every surface inherits).
  const { data: prof } = await getSupabase()
    .from('user_notification_settings')
    .select('naics_codes, keywords, location_states')
    .eq('user_email', rowEmail)
    .maybeSingle();

  const naicsCodes: string[] = (prof?.naics_codes || []).map(String).filter(Boolean);
  const keywords: string[] = (prof?.keywords || []).map(String).filter(Boolean);
  const states: string[] = (prof?.location_states || []).map(String).filter(Boolean);

  if (naicsCodes.length === 0 && keywords.length === 0) {
    return NextResponse.json(
      { success: false, needsProfile: true, error: 'Add NAICS codes or keywords to your profile first.' },
      { status: 400 },
    );
  }

  // 2) Find the buying agencies — call find-agencies directly (NOT the richer
  // target-market-research). find-agencies needs NO MI session auth and returns
  // the exact fields we map, so it avoids the server→server auth-forward + 308
  // body-drop fragility that made Auto silently return 0 agencies in Coach Mode.
  // It takes ONE naicsCode, so scan the top 3 profile codes and merge/dedup.
  const base = internalBaseUrl(request);
  const codesToScan = naicsCodes.slice(0, 3);
  const agencyLists: ScanAgency[][] = [];
  const scanErrors: string[] = [];
  try {
    const scans = await Promise.all(
      codesToScan.map((code) =>
        fetch(`${base}/api/usaspending/find-agencies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ naicsCode: code, ...(states.length ? { locationStates: states } : {}) }),
        })
          .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) }))
          .catch((e) => ({ ok: false, status: 0, body: null as unknown, err: String(e) })),
      ),
    );
    for (const s of scans) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = s as any;
      if (!s.ok || !sb.body?.success) {
        scanErrors.push(sb.body?.error || `find-agencies ${s.status}`);
        continue;
      }
      agencyLists.push((Array.isArray(sb.body.agencies) ? sb.body.agencies : []) as ScanAgency[]);
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Could not scan your market: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 502 },
    );
  }
  // Highest set-aside spend first — the most relevant buyers lead.
  const agencies = mergeScanAgencies(agencyLists);

  if (agencies.length === 0) {
    // Surface the REAL reason instead of a generic "none found" (the silent
    // failure). If every scan errored, say so; otherwise it's genuinely empty.
    const { status, ...payload } = summarizeEmptyScan(scanErrors, codesToScan.length);
    return NextResponse.json(payload, { status });
  }

  // 3) ADD-ONLY insert into user_target_list. 23505 (already saved) → skipped.
  const sourceNaics = naicsCodes.join(',') || null;
  let added = 0;
  let skipped = 0;
  const addedNames: string[] = [];
  let insertError: string | null = null;

  for (const a of agencies.slice(0, MAX_AGENCIES)) {
    const payload = buildTargetRow(a, { rowEmail, asClient, workspaceId, sourceNaics });
    const { error } = await getSupabase().from('user_target_list').insert(payload);
    if (!error) {
      added++;
      addedNames.push(a.name);
    } else if (error.code === '23505') {
      skipped++; // already in their list — add-only, leave it
    } else if (!insertError) {
      insertError = error.message; // remember the first real failure
    }
  }

  // If we found agencies but couldn't write ANY (and none were dupes), that's a
  // real failure — surface it instead of a misleading "added 0".
  if (added === 0 && skipped === 0 && insertError) {
    return NextResponse.json(
      { success: false, error: `Found ${agencies.length} agencies but couldn't save them: ${insertError}`, agenciesFound: agencies.length },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    agenciesFound: agencies.length,
    added,
    skipped,
    addedNames,
    surface: 'target-list',
  });
}
