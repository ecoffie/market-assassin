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
import { normalizeOfficeName } from '@/lib/gov-contacts/office-name';

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

/** How many of the top buying agencies Auto seeds into the Target List. */
const MAX_AGENCIES = 8;

interface ScanAgency {
  name: string;
  contractingOffice?: string;
  subAgency?: string;
  parentAgency?: string;
  agencyCode?: string;
  subAgencyCode?: string;
  officeId?: string;
  location?: string;
  setAsideSpending?: number;
  contractCount?: number;
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
  const byKey = new Map<string, ScanAgency>();
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
      for (const a of (Array.isArray(sb.body.agencies) ? sb.body.agencies : []) as ScanAgency[]) {
        const key = `${(a.name || '').toLowerCase()}|${(a.contractingOffice || '').toLowerCase()}`;
        const prev = byKey.get(key);
        if (!prev || (a.setAsideSpending || 0) > (prev.setAsideSpending || 0)) byKey.set(key, a);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Could not scan your market: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 502 },
    );
  }
  // Highest set-aside spend first — the most relevant buyers lead.
  const agencies: ScanAgency[] = Array.from(byKey.values())
    .sort((x, y) => (y.setAsideSpending || 0) - (x.setAsideSpending || 0));

  if (agencies.length === 0) {
    // Surface the REAL reason instead of a generic "none found" (the silent
    // failure). If every scan errored, say so; otherwise it's genuinely empty.
    const allFailed = scanErrors.length > 0 && scanErrors.length === codesToScan.length;
    return NextResponse.json(
      {
        success: false,
        error: allFailed
          ? `Market scan failed: ${scanErrors[0]}`
          : 'No matching buying agencies found for your codes.',
        scanErrors: scanErrors.slice(0, 3),
      },
      { status: allFailed ? 502 : 200 },
    );
  }

  // 3) ADD-ONLY insert into user_target_list. 23505 (already saved) → skipped.
  const sourceNaics = naicsCodes.join(',') || null;
  let added = 0;
  let skipped = 0;
  const addedNames: string[] = [];
  let insertError: string | null = null;

  for (const a of agencies.slice(0, MAX_AGENCIES)) {
    const rawOfficeName = a.contractingOffice || a.name;
    // DODAAC ingestion guard: the FPDS path can emit a bogus office_code (e.g.
    // "GU22"/"CA09" — postcode-ish junk, NOT a 6-char DoDAAC) and an office name
    // with a stray "/xx" suffix ("Army Sustainment Command/ysk"). Only persist a
    // real DoDAAC, and clean the name — so auto_setup stops saving the garbage the
    // manual-save path would have caught via dodaac_directory enrichment.
    const codeUpper = String(a.officeId || '').toUpperCase().trim();
    const officeCode = /^[A-Z][A-Z0-9]{5}$/.test(codeUpper) ? codeUpper : null;
    const officeName = normalizeOfficeName(rawOfficeName, { mode: 'clean' }) || rawOfficeName;
    const payload = {
      user_email: rowEmail,
      workspace_id: asClient ? workspaceId : null,
      agency_code: a.agencyCode || null,
      agency_name: a.name,
      sub_agency_code: a.subAgencyCode || null,
      sub_agency_name: a.subAgency || null,
      office_code: officeCode,
      office_name: officeName,
      location: a.location || null,
      source_naics: sourceNaics,
      // set_aside_spending can be billions — round to a safe integer; clamp so a
      // bigint/int column can't reject the row and fail the whole batch silently.
      set_aside_spending: Math.min(Math.round(a.setAsideSpending || 0), 9_000_000_000),
      contract_count: Math.round(a.contractCount || 0),
      status: 'targeting',
      priority: 'medium',
      added_from: 'auto_setup',
    };
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
