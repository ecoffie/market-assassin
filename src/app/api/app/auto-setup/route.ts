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

  // 2) Run the SAME buying-agency scan Market Research uses (don't reinvent it).
  // TMR takes ONE naicsCode, so scan the top few codes and merge — keeps coverage
  // broad without the user managing codes. Dedup by agency+office name.
  const tmrHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    // Forward auth so the scan runs as this user / workspace.
    'x-mi-auth-token': request.headers.get('x-mi-auth-token') || '',
    'x-mi-2fa-token': request.headers.get('x-mi-2fa-token') || '',
    ...(request.headers.get('x-active-workspace') ? { 'x-active-workspace': request.headers.get('x-active-workspace')! } : {}),
  };
  const base = internalBaseUrl(request);
  const codesToScan = naicsCodes.slice(0, 3); // top 3 codes → plenty of agencies
  const byKey = new Map<string, ScanAgency>();
  try {
    const scans = await Promise.all(
      (codesToScan.length ? codesToScan : ['']).map((code) =>
        fetch(`${base}/api/app/target-market-research`, {
          method: 'POST',
          headers: tmrHeaders,
          // TMR's real field names (NOT naics/keywords): one `naicsCode` + the
          // saved `profileKeywords` (Auto mode unions them into discovery).
          // Passing `naics`/`keywords` was silently ignored → 0 agencies.
          body: JSON.stringify({ email, naicsCode: code, profileKeywords: keywords, locationStates: states }),
        }).then((r) => r.json()).catch(() => null),
      ),
    );
    for (const data of scans) {
      for (const a of (Array.isArray(data?.agencies) ? data.agencies : []) as ScanAgency[]) {
        const key = `${(a.name || '').toLowerCase()}|${(a.contractingOffice || '').toLowerCase()}`;
        const prev = byKey.get(key);
        // Keep the higher-spend instance when the same office shows up twice.
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
    return NextResponse.json(
      { success: false, error: 'No matching buying agencies found for your codes.' },
      { status: 200 },
    );
  }

  // 3) ADD-ONLY insert into user_target_list. 23505 (already saved) → skipped.
  const sourceNaics = naicsCodes.join(',') || null;
  let added = 0;
  let skipped = 0;
  const addedNames: string[] = [];

  for (const a of agencies.slice(0, MAX_AGENCIES)) {
    const officeName = a.contractingOffice || a.name;
    const payload = {
      user_email: rowEmail,
      workspace_id: asClient ? workspaceId : null,
      agency_code: a.agencyCode || null,
      agency_name: a.name,
      sub_agency_code: a.subAgencyCode || null,
      sub_agency_name: a.subAgency || null,
      office_code: a.officeId || null,
      office_name: officeName,
      location: a.location || null,
      source_naics: sourceNaics,
      set_aside_spending: Math.round(a.setAsideSpending || 0),
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
    }
    // other errors: skip silently, keep going (best-effort batch)
  }

  return NextResponse.json({
    success: true,
    agenciesFound: agencies.length,
    added,
    skipped,
    addedNames,
    // The receipt deep-links here.
    surface: 'target-list',
  });
}
